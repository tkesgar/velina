import type { LoadedConfig } from "./config";
import type { HostNetworkSample, MetricSample } from "./metrics";

export type LogType = "stdout" | "stderr";

export type ProcessState = "running" | "stopped";

export interface LogEntry {
  type: LogType;
  line: string;
  timestamp: number;
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

// Shared between the server target and the CLI client. Cap'n Web needs no
// generated interface: this is the API description.
export interface YamlConfig {
  provided: string;
  resolved: string;
}

export function isYamlConfig(value: LoadedConfig | YamlConfig): value is YamlConfig {
  return typeof value.provided === "string";
}

export interface VelinaApi {
  getConfig(opts?: { format?: "yaml" }): LoadedConfig | YamlConfig;
  getAllTaskGroups(): TaskGroupInfo[];
  startTask(name: string): ProcessInfo;
  startTaskGroup(name: string): Promise<ProcessInfo[]>;
  getAllProcesses(): ProcessInfo[];
  getProcess(id: string): ProcessInfo;
  getProcessMetrics(id: string): ProcessMetrics;
  getHostMetrics(): HostMetrics;
  streamProcessLogs(id: string, type: LogType): ReadableStream<LogEntry>;
  stopProcess(id: string): Promise<ProcessInfo>;
  stopTaskGroup(name: string): Promise<ProcessInfo[]>;
  deleteProcess(id: string): void;
}
