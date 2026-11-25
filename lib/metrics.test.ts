import { describe, expect, it } from "bun:test";

import { createMetricsSource, MetricsCollector, nullMetricsSource } from "./metrics";
import { createLinuxMetricsSource, parseProcStat, type ProcReader } from "./metrics-linux";

function statLine(pid: number, comm: string, utime: number, stime: number): string {
  const fields = [
    "S",
    "1",
    String(pid),
    String(pid),
    "0",
    "-1",
    "4194304",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "20",
    "0",
    "6",
    "0",
    "2665707",
  ];
  fields[11] = String(utime);
  fields[12] = String(stime);
  return `${pid} (${comm}) ${fields.join(" ")}`;
}

const status = [
  "Name:\tvelina",
  "State:\tS (sleeping)",
  "VmRSS:\t   1024 kB",
  "VmSize:\t   2048 kB",
  "Threads:\t4",
].join("\n");
const io = [
  "rchar: 1000",
  "wchar: 2000",
  "syscr: 10",
  "syscw: 20",
  "read_bytes: 3000",
  "write_bytes: 4000",
].join("\n");
const netDev = [
  "Inter-|   Receive                                                |  Transmit",
  " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed",
  "    lo: 10000 100 0 0 0 0 0 0 10000 100 0 0 0 0 0 0",
  "  eth0:  5000  50 0 0 0 0 0 0  9000  90 0 0 0 0 0 0",
].join("\n");

function makeReader(): {
  reader: ProcReader;
  files: Record<string, string>;
  directories: Record<string, string[]>;
  links: Record<string, string>;
} {
  const files: Record<string, string> = {
    "/proc/123/stat": statLine(123, "bun (run)", 100, 50),
    "/proc/123/status": status,
    "/proc/123/io": io,
    "/proc/123/task/123/children": "",
    "/proc/net/dev": netDev,
  };
  const directories: Record<string, string[]> = { "/proc/123/fd": ["0", "1", "2"] };
  const links: Record<string, string> = {
    "/proc/123/fd/0": "socket:[123]",
    "/proc/123/fd/1": "pipe:[1]",
    "/proc/123/fd/2": "pipe:[2]",
  };

  return {
    files,
    directories,
    links,
    reader: {
      async text(path) {
        return files[path] ?? null;
      },
      async directory(path) {
        return directories[path] ?? [];
      },
      async link(path) {
        return links[path] ?? null;
      },
    },
  };
}

describe("process metrics", () => {
  it("should parse stat with parentheses in the comm field", () => {
    expect(parseProcStat(statLine(123, "bun (run)", 100, 50))).toEqual({
      state: "S",
      userCpuMs: 1000,
      systemCpuMs: 500,
    });
  });

  it("should read a Linux process from proc files", async () => {
    const { reader } = makeReader();
    const usage = await createLinuxMetricsSource(reader).readProcess(123);

    expect(usage).toEqual({
      pid: 123,
      state: "S",
      userCpuMs: 1000,
      systemCpuMs: 500,
      memoryBytes: 1024 * 1024,
      virtualMemoryBytes: 2048 * 1024,
      threads: 4,
      openFiles: 3,
      openSockets: 1,
      diskReadBytes: 1000,
      diskWriteBytes: 2000,
    });
  });

  it("should return null when a process has vanished", async () => {
    const { reader } = makeReader();
    expect(await createLinuxMetricsSource(reader).readProcess(999)).toBeNull();
  });

  it("should leave rates unset on the first sample", async () => {
    const { reader } = makeReader();
    const collector = new MetricsCollector(createLinuxMetricsSource(reader));
    const result = await collector.collect(123, undefined, 0);

    expect(result).not.toBeNull();
    expect(result!.sample.cpuPercent).toBeNull();
    expect(result!.sample.diskReadBytesPerSecond).toBeNull();
    expect(result!.sample.memoryBytes).toBe(1024 * 1024);
    expect(result!.sample.childProcesses).toBe(0);
  });

  it("should derive cpu percent and disk rates from deltas", async () => {
    const { reader, files } = makeReader();
    const collector = new MetricsCollector(createLinuxMetricsSource(reader));
    const first = await collector.collect(123, undefined, 0);
    expect(first).not.toBeNull();

    files["/proc/123/stat"] = statLine(123, "bun (run)", 200, 50);
    files["/proc/123/io"] = io.replace("rchar: 1000", "rchar: 2000");
    const second = await collector.collect(123, first!.state, 1000);

    expect(second!.sample.cpuPercent).toBe(100);
    expect(second!.sample.diskReadBytesPerSecond).toBe(1000);
  });

  it("should aggregate child processes in gauges and deltas", async () => {
    const { reader, files, directories, links } = makeReader();
    files["/proc/123/task/123/children"] = "456";
    files["/proc/456/stat"] = statLine(456, "child", 50, 0);
    files["/proc/456/status"] = status.replace("1024 kB", "512 kB").replace("2048 kB", "1024 kB");
    files["/proc/456/io"] = io;
    directories["/proc/456/fd"] = ["0"];
    links["/proc/456/fd/0"] = "socket:[456]";

    const collector = new MetricsCollector(createLinuxMetricsSource(reader));
    const result = await collector.collect(123, undefined, 0);

    expect(result!.sample.childProcesses).toBe(1);
    expect(result!.sample.memoryBytes).toBe(1536 * 1024);
    expect(result!.sample.threads).toBe(8);
    expect(result!.sample.openSockets).toBe(2);
  });

  it("should exclude loopback from host network counters", async () => {
    const { reader, files } = makeReader();
    const collector = new MetricsCollector(createLinuxMetricsSource(reader));

    const first = await collector.collectHost(undefined, 0);
    expect(first!.sample.rxBytes).toBe(5000);
    expect(first!.sample.txBytes).toBe(9000);
    expect(first!.sample.rxBytesPerSecond).toBe(0);

    files["/proc/net/dev"] = netDev.replace("eth0:  5000", "eth0:  7000");
    const second = await collector.collectHost(first!.state, 1000);
    expect(second!.sample.rxBytesPerSecond).toBe(2000);
  });

  it("should report unsupported platforms", async () => {
    const source = createMetricsSource("darwin");
    expect(source).toBe(nullMetricsSource);
    expect(source.supported).toBe(false);

    const collector = new MetricsCollector(source);
    expect(await collector.collect(123, undefined, 0)).toBeNull();
    expect(await collector.collectHost(undefined, 0)).toBeNull();
  });
});
