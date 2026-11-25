import { createLinuxMetricsSource } from "./metrics-linux";

export const DEFAULT_METRICS_INTERVAL_MS = 1000;
export const MAX_METRIC_SAMPLES = 600;

// Cumulative counters supplied by a platform. Rates are derived centrally so
// that each platform source only has to report raw values.
export interface RawProcessUsage {
  pid: number;
  state: string;
  userCpuMs: number;
  systemCpuMs: number;
  memoryBytes: number;
  virtualMemoryBytes?: number;
  threads?: number;
  openFiles?: number;
  openSockets?: number;
  diskReadBytes?: number;
  diskWriteBytes?: number;
}

export interface HostNetworkCounters {
  rxBytes: number;
  txBytes: number;
}

export interface MetricsSource {
  readonly supported: boolean;
  readProcess(pid: number): Promise<RawProcessUsage | null>;
  readChildren(pid: number): Promise<number[]>;
  readHostNetwork(): Promise<HostNetworkCounters | null>;
}

export interface MetricSample {
  timestamp: number;
  cpuPercent: number | null;
  memoryBytes: number;
  virtualMemoryBytes: number | null;
  threads: number | null;
  openFiles: number | null;
  openSockets: number | null;
  diskReadBytes: number | null;
  diskWriteBytes: number | null;
  diskReadBytesPerSecond: number | null;
  diskWriteBytesPerSecond: number | null;
  childProcesses: number;
  state: string;
}

export interface HostNetworkSample extends HostNetworkCounters {
  timestamp: number;
  rxBytesPerSecond: number;
  txBytesPerSecond: number;
}

export interface CollectorState {
  timestamp: number;
  root: RawProcessUsage;
  children: Map<number, RawProcessUsage>;
}

export interface HostState {
  timestamp: number;
  counters: HostNetworkCounters;
}

interface Entry {
  usage: RawProcessUsage;
  previous?: RawProcessUsage;
}

function cpuMs(usage: RawProcessUsage): number {
  return usage.userCpuMs + usage.systemCpuMs;
}

function sumDelta(
  entries: Entry[],
  get: (usage: RawProcessUsage) => number | undefined,
): number | null {
  let total = 0;
  let seen = false;
  for (const entry of entries) {
    if (!entry.previous) continue;
    const current = get(entry.usage);
    const previous = get(entry.previous);
    if (current === undefined || previous === undefined) continue;
    total += Math.max(0, current - previous);
    seen = true;
  }
  return seen ? total : null;
}

function sumGauge(
  entries: Entry[],
  get: (usage: RawProcessUsage) => number | undefined,
): number | null {
  let total = 0;
  let seen = false;
  for (const entry of entries) {
    const value = get(entry.usage);
    if (value === undefined) continue;
    total += value;
    seen = true;
  }
  return seen ? total : null;
}

export class MetricsCollector {
  readonly supported: boolean;
  readonly #source: MetricsSource;

  constructor(source: MetricsSource) {
    this.#source = source;
    this.supported = source.supported;
  }

  async collect(
    pid: number,
    previous: CollectorState | undefined,
    now: number,
  ): Promise<{ sample: MetricSample; state: CollectorState } | null> {
    const root = await this.#source.readProcess(pid);
    if (!root) return null;

    const children = new Map<number, RawProcessUsage>();
    for (const childPid of await this.#source.readChildren(pid)) {
      if (childPid === pid) continue;
      const usage = await this.#source.readProcess(childPid);
      if (usage) children.set(childPid, usage);
    }

    const entries: Entry[] = [
      { usage: root, previous: previous?.root },
      ...[...children].map(([childPid, usage]) => ({
        usage,
        previous: previous?.children.get(childPid),
      })),
    ];

    const elapsed = previous ? Math.max(0, (now - previous.timestamp) / 1000) : 0;
    const cpuDelta = sumDelta(entries, cpuMs);
    const readDelta = sumDelta(entries, (usage) => usage.diskReadBytes);
    const writeDelta = sumDelta(entries, (usage) => usage.diskWriteBytes);
    const perSecond = (delta: number | null) =>
      delta === null || elapsed === 0 ? null : delta / elapsed;

    return {
      sample: {
        timestamp: now,
        cpuPercent: cpuDelta === null || elapsed === 0 ? null : (cpuDelta / 1000 / elapsed) * 100,
        memoryBytes: sumGauge(entries, (usage) => usage.memoryBytes) ?? 0,
        virtualMemoryBytes: sumGauge(entries, (usage) => usage.virtualMemoryBytes),
        threads: sumGauge(entries, (usage) => usage.threads),
        openFiles: sumGauge(entries, (usage) => usage.openFiles),
        openSockets: sumGauge(entries, (usage) => usage.openSockets),
        diskReadBytes: sumGauge(entries, (usage) => usage.diskReadBytes),
        diskWriteBytes: sumGauge(entries, (usage) => usage.diskWriteBytes),
        diskReadBytesPerSecond: perSecond(readDelta),
        diskWriteBytesPerSecond: perSecond(writeDelta),
        childProcesses: children.size,
        state: root.state,
      },
      state: { timestamp: now, root, children },
    };
  }

  async collectHost(
    previous: HostState | undefined,
    now: number,
  ): Promise<{ sample: HostNetworkSample; state: HostState } | null> {
    const counters = await this.#source.readHostNetwork();
    if (!counters) return null;

    const elapsed = previous ? Math.max(0, (now - previous.timestamp) / 1000) : 0;
    const rate = (current: number, old: number | undefined) =>
      old === undefined || elapsed === 0 ? 0 : Math.max(0, current - old) / elapsed;

    return {
      sample: {
        timestamp: now,
        rxBytes: counters.rxBytes,
        txBytes: counters.txBytes,
        rxBytesPerSecond: rate(counters.rxBytes, previous?.counters.rxBytes),
        txBytesPerSecond: rate(counters.txBytes, previous?.counters.txBytes),
      },
      state: { timestamp: now, counters },
    };
  }
}

export const nullMetricsSource: MetricsSource = {
  supported: false,
  async readProcess() {
    return null;
  },
  async readChildren() {
    return [];
  },
  async readHostNetwork() {
    return null;
  },
};

// Adding macOS or Windows support means adding a source with the same shape
// and one case here; nothing above this line needs to know about the platform.
export function createMetricsSource(platform: string = process.platform): MetricsSource {
  return platform === "linux" ? createLinuxMetricsSource() : nullMetricsSource;
}
