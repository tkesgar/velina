import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Subprocess } from "bun";

import type { LogEntry, LogType, ProcessInfo, VelinaApi, YamlConfig } from "./api";
import type { LoadedConfig, ResolvedConfig } from "./config";

const MAX_LOG_ENTRIES = 5000;
const STOP_TIMEOUT_MS = 5000;

type ConfigFile = NonNullable<ResolvedConfig["files"]>[number];

interface LogSubscriber {
  type: LogType;
  queue: LogEntry[];
  done: boolean;
  closed: boolean;
  controller?: ReadableStreamDefaultController<LogEntry>;
}

interface ManagedProcess {
  info: ProcessInfo;
  subprocess: Subprocess | null;
  logs: LogEntry[];
  subscribers: Set<LogSubscriber>;
  exit: Promise<void>;
}

function trimToLimit(entries: LogEntry[]): void {
  if (entries.length > MAX_LOG_ENTRIES) {
    entries.splice(0, entries.length - MAX_LOG_ENTRIES);
  }
}

function flushSubscriber(subscriber: LogSubscriber): void {
  const { controller } = subscriber;
  if (!controller || subscriber.closed) return;

  while (subscriber.queue.length > 0 && (controller.desiredSize ?? 0) > 0) {
    controller.enqueue(subscriber.queue.shift()!);
  }

  if (subscriber.done && subscriber.queue.length === 0) {
    subscriber.closed = true;
    controller.close();
  }
}

export class Velina implements VelinaApi {
  readonly #loaded: LoadedConfig;
  readonly #config: ResolvedConfig;
  readonly #processes = new Map<string, ManagedProcess>();

  constructor(loaded: LoadedConfig) {
    this.#loaded = loaded;
    this.#config = loaded.resolved;
    this.#writeFiles(this.#config.files ?? []);
  }

  getConfig(): LoadedConfig;
  getConfig(opts: { format: "yaml" }): YamlConfig;
  getConfig(opts?: { format?: "yaml" }): LoadedConfig | YamlConfig {
    if (opts?.format === "yaml") {
      return {
        provided: Bun.YAML.stringify(this.#loaded.provided, null, 2),
        resolved: Bun.YAML.stringify(this.#loaded.resolved, null, 2),
      };
    }

    return this.#loaded;
  }

  startTask(name: string): ProcessInfo {
    const task = this.#config.tasks[name];
    if (!task) {
      throw new Error(`Unknown task: ${name}`);
    }

    for (const managed of this.#processes.values()) {
      if (managed.info.taskName === name && managed.info.state === "running") {
        throw new Error(`Task "${name}" is already running`);
      }
    }

    this.#writeFiles(task.files);

    const info: ProcessInfo = {
      id: crypto.randomUUID(),
      taskName: name,
      state: "running",
      startedAt: Date.now(),
      cmd: task.cmd,
      args: [...task.args],
      cwd: task.cwd,
    };

    const managed: ManagedProcess = {
      info,
      subprocess: null,
      logs: [],
      subscribers: new Set(),
      exit: Promise.resolve(),
    };

    const subprocess = Bun.spawn({
      cmd: [task.cmd, ...task.args],
      cwd: task.cwd,
      env: task.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    managed.subprocess = subprocess;

    managed.exit = Promise.all([
      subprocess.exited,
      this.#readLogs(managed, subprocess.stdout, "stdout"),
      this.#readLogs(managed, subprocess.stderr, "stderr"),
    ])
      .then(([exitCode]) => {
        this.#finalize(managed, exitCode);
      })
      .catch((error: unknown) => {
        console.error(`Failed to collect logs for task "${name}":`, error);
        this.#finalize(managed, -1);
      });

    this.#processes.set(info.id, managed);
    return this.#snapshot(managed);
  }

  getAllProcesses(): ProcessInfo[] {
    return Array.from(this.#processes.values(), (managed) => this.#snapshot(managed));
  }

  getProcess(id: string): ProcessInfo {
    return this.#snapshot(this.#get(id));
  }

  streamProcessLogs(id: string, type: LogType): ReadableStream<LogEntry> {
    const managed = this.#get(id);
    const subscriber: LogSubscriber = {
      type,
      queue: [],
      done: managed.info.state === "stopped",
      closed: false,
    };

    return new ReadableStream<LogEntry>({
      start: (controller) => {
        subscriber.controller = controller;
        managed.subscribers.add(subscriber);

        // Register before replaying, with no await in between: no log entry
        // can slip into the gap between the snapshot and the live subscription.
        for (const entry of managed.logs) {
          if (entry.type === type) subscriber.queue.push(entry);
        }

        flushSubscriber(subscriber);
      },
      pull: () => flushSubscriber(subscriber),
      cancel: () => {
        managed.subscribers.delete(subscriber);
      },
    });
  }

  async stopProcess(id: string): Promise<ProcessInfo> {
    const managed = this.#get(id);
    await this.#terminate(managed);
    return this.#snapshot(managed);
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.#processes.values()].map((managed) => this.#terminate(managed)));
  }

  deleteProcess(id: string): void {
    const managed = this.#get(id);
    if (managed.info.state === "running") {
      throw new Error(`Cannot delete running process: ${id}`);
    }

    this.#closeSubscribers(managed);
    this.#processes.delete(id);
  }

  [Symbol.dispose](): void {
    for (const managed of this.#processes.values()) {
      if (managed.info.state === "running") {
        managed.subprocess?.kill("SIGTERM");
      }
    }
  }

  async #terminate(managed: ManagedProcess): Promise<void> {
    const subprocess = managed.subprocess;
    if (!subprocess || managed.info.state === "stopped") return;

    subprocess.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (managed.info.state === "running") {
        subprocess.kill("SIGKILL");
      }
    }, STOP_TIMEOUT_MS);

    try {
      await managed.exit;
    } finally {
      clearTimeout(timer);
    }
  }

  #get(id: string): ManagedProcess {
    const managed = this.#processes.get(id);
    if (!managed) {
      throw new Error(`Unknown process: ${id}`);
    }

    return managed;
  }

  #snapshot(managed: ManagedProcess): ProcessInfo {
    return { ...managed.info, args: [...managed.info.args] };
  }

  #appendLog(managed: ManagedProcess, type: LogType, line: string): void {
    const entry: LogEntry = { type, line, timestamp: Date.now() };
    managed.logs.push(entry);
    trimToLimit(managed.logs);

    for (const subscriber of managed.subscribers) {
      if (subscriber.type !== type) continue;

      subscriber.queue.push(entry);
      trimToLimit(subscriber.queue);
      flushSubscriber(subscriber);
    }
  }

  async #readLogs(
    managed: ManagedProcess,
    stream: ReadableStream<Uint8Array>,
    type: LogType,
  ): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let pending = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        pending += decoder.decode(value, { stream: true });
        const parts = pending.split("\n");
        pending = parts.pop() ?? "";

        for (const part of parts) {
          this.#appendLog(managed, type, part.replace(/\r$/, ""));
        }
      }

      pending += decoder.decode();
      if (pending) {
        this.#appendLog(managed, type, pending.replace(/\r$/, ""));
      }
    } finally {
      reader.releaseLock();
    }
  }

  #finalize(managed: ManagedProcess, exitCode: number): void {
    managed.info.state = "stopped";
    managed.info.stoppedAt = Date.now();
    managed.info.exitCode = exitCode;
    managed.subprocess = null;
    this.#closeSubscribers(managed);
  }

  #closeSubscribers(managed: ManagedProcess): void {
    for (const subscriber of managed.subscribers) {
      subscriber.done = true;
      flushSubscriber(subscriber);
    }
  }

  #writeFiles(files: ConfigFile[]): void {
    for (const file of files) {
      mkdirSync(dirname(file.path), { recursive: true });
      writeFileSync(file.path, file.content);
    }
  }
}
