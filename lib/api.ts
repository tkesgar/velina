import type { LoadedConfig } from "./config";
import type { HostNetworkSample, MetricSample } from "./metrics";

export type LogType = "stdout" | "stderr";

export type ProcessState = "running" | "stopped";

// Hooks are tracked as processes too, so agents can distinguish them from the
// measured run when filtering results.
export type ProcessKind = "run" | "pre-hook" | "post-hook";

export interface LogEntry {
  type: LogType;
  line: string;
  timestamp: number;
}

export interface LogFiles {
  stdout: string;
  stderr: string;
}

export interface ProcessInfo {
  id: string;
  taskName: string;
  state: ProcessState;
  startedAt: number;
  stoppedAt?: number;
  exitCode?: number;
  cmd: string;
  args: string[];
  cwd: string;
  metrics: MetricSample | null;
  label?: string;
  kind?: ProcessKind;
  // Wall-clock duration from just before spawn to after log collection.
  // Meaningful only for processes that have stopped.
  durationMs?: number;
  // Absolute paths to the persisted logs, present once the process has
  // stopped and log persistence is enabled and succeeded.
  logFiles?: LogFiles;
}

export interface ProcessMetrics {
  processId: string;
  supported: boolean;
  latest: MetricSample | null;
  samples: MetricSample[];
}

export interface HostMetrics {
  supported: boolean;
  latest: HostNetworkSample | null;
  samples: HostNetworkSample[];
}

export interface TaskGroupInfo {
  name: string;
  tasks: string[];
}

export interface StartOptions {
  label?: string;
  kind?: ProcessKind;
}

export interface ProcessFilter {
  label?: string;
  taskName?: string;
  kind?: ProcessKind;
}

export interface DeleteProcessesOptions {
  label?: string;
  taskName?: string;
}

// Shared between the server target and the CLI client. Cap'n Web needs no
// generated interface: this is the API description.
export interface YamlConfig {
  provided: string;
  resolved: string;
}

export function isYamlConfig(value: LoadedConfig | YamlConfig): value is YamlConfig {
  return typeof value.provided === "string";
}

// Cap'n Web collapses overloads to the last signature in stubs, so every
// method here has a single signature with optional options instead.
export interface VelinaApi {
  getConfig(opts?: { format?: "yaml" }): LoadedConfig | YamlConfig;
  getAllTaskGroups(): TaskGroupInfo[];
  startTask(name: string, opts?: StartOptions): ProcessInfo;
  startTaskGroup(name: string, opts?: StartOptions): Promise<ProcessInfo[]>;
  getAllProcesses(opts?: ProcessFilter): ProcessInfo[];
  getProcess(id: string): ProcessInfo;
  waitForProcess(id: string): Promise<ProcessInfo>;
  getProcessMetrics(id: string): ProcessMetrics;
  getHostMetrics(): HostMetrics;
  streamProcessLogs(id: string, type: LogType): ReadableStream<LogEntry>;
  stopProcess(id: string): Promise<ProcessInfo>;
  stopTaskGroup(name: string): Promise<ProcessInfo[]>;
  deleteProcess(id: string): void;
  deleteProcesses(opts: DeleteProcessesOptions): number;
}
