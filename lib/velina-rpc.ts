import { RpcTarget } from "capnweb";
import * as z from "zod";

import type { LogEntry, LogType, ProcessInfo, VelinaApi } from "./api";
import type { ResolvedConfig } from "./config";
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

  getConfig(): ResolvedConfig {
    return this.#velina.getConfig();
  }

  startTask(name: string): ProcessInfo {
    return this.#velina.startTask(zName.parse(name));
  }

  getAllProcesses(): ProcessInfo[] {
    return this.#velina.getAllProcesses();
  }

  getProcess(id: string): ProcessInfo {
    return this.#velina.getProcess(zName.parse(id));
  }

  streamProcessLogs(id: string, type: LogType): ReadableStream<LogEntry> {
    return this.#velina.streamProcessLogs(zName.parse(id), zLogType.parse(type));
  }

  async stopProcess(id: string): Promise<ProcessInfo> {
    return this.#velina.stopProcess(zName.parse(id));
  }

  deleteProcess(id: string): void {
    this.#velina.deleteProcess(zName.parse(id));
  }
}
