import { RpcTarget } from "capnweb";
import * as z from "zod";

import type {
  DeleteProcessesOptions,
  HostMetrics,
  LogEntry,
  LogType,
  ProcessFilter,
  ProcessInfo,
  ProcessMetrics,
  StartOptions,
  TaskGroupInfo,
  VelinaApi,
  YamlConfig,
} from "./api";
import type { LoadedConfig } from "./config";
import type { Velina } from "./velina";

// Cap'n Web performs no runtime type checks. Validate the boundary values
// that are used to look things up, select a stream, or filter a result set.
const zName = z.string().min(1);
const zLabel = z.string().min(1).max(200);
const zLogType = z.enum(["stdout", "stderr"]);
const zKind = z.enum(["run", "pre-hook", "post-hook"]);

const zStartOptions = z
  .object({ label: zLabel.optional(), kind: zKind.optional() })
  .strict()
  .optional();

const zProcessFilter = z
  .object({
    label: zLabel.optional(),
    taskName: zName.optional(),
    kind: zKind.optional(),
  })
  .strict()
  .optional();

const zDeleteOptions = z
  .object({ label: zLabel.optional(), taskName: zName.optional() })
  .strict()
  .refine((opts) => opts.label !== undefined || opts.taskName !== undefined, {
    message: "deleteProcesses requires a label or taskName filter",
  });

export class VelinaRpcTarget extends RpcTarget implements VelinaApi {
  readonly #velina: Velina;

  constructor(velina: Velina) {
    super();
    this.#velina = velina;
  }

  getConfig(opts?: { format?: "yaml" }): LoadedConfig | YamlConfig {
    if (opts?.format === "yaml") {
      return this.#velina.getConfig({ format: "yaml" });
    }

    return this.#velina.getConfig();
  }

  getAllTaskGroups(): TaskGroupInfo[] {
    return this.#velina.getAllTaskGroups();
  }

  startTask(name: string, opts?: StartOptions): ProcessInfo {
    return this.#velina.startTask(zName.parse(name), zStartOptions.parse(opts));
  }

  async startTaskGroup(name: string, opts?: StartOptions): Promise<ProcessInfo[]> {
    return this.#velina.startTaskGroup(zName.parse(name), zStartOptions.parse(opts));
  }

  getAllProcesses(opts?: ProcessFilter): ProcessInfo[] {
    return this.#velina.getAllProcesses(zProcessFilter.parse(opts));
  }

  getProcess(id: string): ProcessInfo {
    return this.#velina.getProcess(zName.parse(id));
  }

  async waitForProcess(id: string): Promise<ProcessInfo> {
    return this.#velina.waitForProcess(zName.parse(id));
  }

  getProcessMetrics(id: string): ProcessMetrics {
    return this.#velina.getProcessMetrics(zName.parse(id));
  }

  getHostMetrics(): HostMetrics {
    return this.#velina.getHostMetrics();
  }

  streamProcessLogs(id: string, type: LogType): ReadableStream<LogEntry> {
    return this.#velina.streamProcessLogs(zName.parse(id), zLogType.parse(type));
  }

  async stopProcess(id: string): Promise<ProcessInfo> {
    return this.#velina.stopProcess(zName.parse(id));
  }

  async stopTaskGroup(name: string): Promise<ProcessInfo[]> {
    return this.#velina.stopTaskGroup(zName.parse(name));
  }

  deleteProcess(id: string): void {
    this.#velina.deleteProcess(zName.parse(id));
  }

  deleteProcesses(opts: DeleteProcessesOptions): number {
    return this.#velina.deleteProcesses(zDeleteOptions.parse(opts));
  }
}
