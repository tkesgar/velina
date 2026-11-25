import { readdir, readlink } from "node:fs/promises";

import type { HostNetworkCounters, MetricsSource, RawProcessUsage } from "./metrics";

export interface ProcReader {
  text(path: string): Promise<string | null>;
  directory(path: string): Promise<string[]>;
  link(path: string): Promise<string | null>;
}

export const bunProcReader: ProcReader = {
  async text(path) {
    try {
      return await Bun.file(path).text();
    } catch {
      return null;
    }
  },
  async directory(path) {
    try {
      return await readdir(path);
    } catch {
      return [];
    }
  },
  async link(path) {
    try {
      return await readlink(path);
    } catch {
      return null;
    }
  },
};

// Linux reports CPU times in clock ticks. sysconf(_SC_CLK_TCK) is not exposed
// by Bun; 100 is the default on every mainstream Linux distribution.
const CLOCK_TICKS_PER_SECOND = 100;

export function parseProcStat(text: string): {
  state: string;
  userCpuMs: number;
  systemCpuMs: number;
} | null {
  // comm is parenthesized and may itself contain spaces or parentheses.
  const end = text.lastIndexOf(")");
  if (end === -1) return null;

  const fields = text
    .slice(end + 1)
    .trim()
    .split(/\s+/);
  const state = fields[0];
  const utime = Number(fields[11]);
  const stime = Number(fields[12]);
  if (!state || !Number.isFinite(utime) || !Number.isFinite(stime)) return null;

  return {
    state,
    userCpuMs: (utime / CLOCK_TICKS_PER_SECOND) * 1000,
    systemCpuMs: (stime / CLOCK_TICKS_PER_SECOND) * 1000,
  };
}

function numericLine(text: string, key: string): number | undefined {
  const match = text.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"));
  return match ? Number(match[1]) : undefined;
}

function parseProcStatus(text: string): {
  memoryBytes: number | null;
  virtualMemoryBytes: number | null;
  threads: number | null;
} {
  const rssKb = numericLine(text, "VmRSS");
  const sizeKb = numericLine(text, "VmSize");
  const threads = numericLine(text, "Threads");
  return {
    memoryBytes: rssKb === undefined ? null : rssKb * 1024,
    virtualMemoryBytes: sizeKb === undefined ? null : sizeKb * 1024,
    threads: threads ?? null,
  };
}

function parseProcIo(text: string): { readBytes?: number; writeBytes?: number } {
  return {
    readBytes: numericLine(text, "rchar"),
    writeBytes: numericLine(text, "wchar"),
  };
}

async function countSockets(
  reader: ProcReader,
  pid: number,
  fds: string[],
): Promise<number | undefined> {
  if (fds.length === 0) return undefined;

  let sockets = 0;
  for (const fd of fds) {
    const target = await reader.link(`/proc/${pid}/fd/${fd}`);
    if (target?.startsWith("socket:")) sockets += 1;
  }
  return sockets;
}

export function createLinuxMetricsSource(reader: ProcReader = bunProcReader): MetricsSource {
  const readProcess = async (pid: number): Promise<RawProcessUsage | null> => {
    const stat = await reader.text(`/proc/${pid}/stat`);
    if (!stat) return null;

    const parsed = parseProcStat(stat);
    if (!parsed) return null;

    const status = parseProcStatus((await reader.text(`/proc/${pid}/status`)) ?? "");
    if (status.memoryBytes === null) return null;

    const io = parseProcIo((await reader.text(`/proc/${pid}/io`)) ?? "");
    const fds = await reader.directory(`/proc/${pid}/fd`);

    return {
      pid,
      state: parsed.state,
      userCpuMs: parsed.userCpuMs,
      systemCpuMs: parsed.systemCpuMs,
      memoryBytes: status.memoryBytes,
      virtualMemoryBytes: status.virtualMemoryBytes ?? undefined,
      threads: status.threads ?? undefined,
      openFiles: fds.length,
      openSockets: await countSockets(reader, pid, fds),
      diskReadBytes: io.readBytes,
      diskWriteBytes: io.writeBytes,
    };
  };

  return {
    supported: true,
    readProcess,
    async readChildren(pid) {
      const text = await reader.text(`/proc/${pid}/task/${pid}/children`);
      if (!text) return [];
      return text
        .trim()
        .split(/\s+/)
        .map(Number)
        .filter((value) => Number.isInteger(value) && value > 0);
    },
    async readHostNetwork(): Promise<HostNetworkCounters | null> {
      const text = await reader.text("/proc/net/dev");
      if (!text) return null;

      let rxBytes = 0;
      let txBytes = 0;
      for (const line of text.trim().split("\n").slice(2)) {
        const separator = line.indexOf(":");
        if (separator === -1) continue;
        // Loopback traffic is local and would swamp the host-wide figure.
        if (line.slice(0, separator).trim() === "lo") continue;

        const fields = line
          .slice(separator + 1)
          .trim()
          .split(/\s+/);
        const rx = Number(fields[0]);
        const tx = Number(fields[8]);
        if (Number.isFinite(rx)) rxBytes += rx;
        if (Number.isFinite(tx)) txBytes += tx;
      }
      return { rxBytes, txBytes };
    },
  };
}
