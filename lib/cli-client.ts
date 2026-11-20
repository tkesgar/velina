import { newWebSocketRpcSession, type RpcStub } from "capnweb";

import type { LogEntry, ProcessInfo, VelinaApi } from "./api";
import { DEFAULT_PORT, readConfig } from "./config";

export async function resolvePort(opts: { port?: number; cwd?: string } = {}): Promise<number> {
  if (opts.port !== undefined) return opts.port;

  const config = await readConfig({ cwd: opts.cwd });
  return config.port ?? DEFAULT_PORT;
}

export function openApi(port: number): RpcStub<VelinaApi> {
  return newWebSocketRpcSession<VelinaApi>(`ws://127.0.0.1:${port}/api`);
}

export async function resolveProcessId(
  api: { getAllProcesses(): PromiseLike<ProcessInfo[]> | ProcessInfo[] },
  id: string,
): Promise<string> {
  const processes = await Promise.resolve(api.getAllProcesses());
  const exact = processes.find((process) => process.id === id);
  if (exact) return exact.id;

  const matches = processes.filter((process) => process.id.startsWith(id));
  if (matches.length === 0) {
    throw new Error(`Unknown process: ${id}`);
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous process id: ${id}`);
  }

  return matches[0].id;
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function formatLogLine(entry: LogEntry): string {
  return `${new Date(entry.timestamp).toISOString()} ${entry.line}`;
}
