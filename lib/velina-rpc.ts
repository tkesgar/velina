import { RpcTarget } from "capnweb";
import * as z from "zod";

import type {
  HostMetrics,
  LogEntry,
  LogType,
  ProcessInfo,
  ProcessMetrics,
  TaskGroupInfo,
  VelinaApi,
  YamlConfig,
} from "./api";
import type { LoadedConfig } from "./config";
import type { Velina } from "./velina";

// Cap'n Web performs no runtime type checks. Validate the boundary values
// that are used to look things up or select a stream.
const zName = z.string().min(1);
const zLogType = z.enum(["stdout", "stderr"]);

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

  startTask(name: string): ProcessInfo {
    return this.#velina.startTask(zName.parse(name));
  }

  async startTaskGroup(name: string): Promise<ProcessInfo[]> {
    return this.#velina.startTaskGroup(zName.parse(name));
  }

  getAllProcesses(): ProcessInfo[] {
    return this.#velina.getAllProcesses();
  }

  getProcess(id: string): ProcessInfo {
    return this.#velina.getProcess(zName.parse(id));
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
}
