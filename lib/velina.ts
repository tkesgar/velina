import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Subprocess } from "bun";

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
import type { LoadedConfig, ResolvedConfig } from "./config";
import {
  createMetricsSource,
  DEFAULT_METRICS_INTERVAL_MS,
  MAX_METRIC_SAMPLES,
  MetricsCollector,
  type CollectorState,
  type HostNetworkSample,
  type HostState,
  type MetricSample,
  type MetricsSource,
} from "./metrics";

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
  metrics: MetricSample[];
  metricState?: CollectorState;
}

function trimToLimit(entries: unknown[], max = MAX_LOG_ENTRIES): void {
  if (entries.length > max) {
    entries.splice(0, entries.length - max);
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
  readonly #metricsCollector: MetricsCollector;
  #metricTimer: ReturnType<typeof setInterval> | undefined;
  #hostMetrics: HostNetworkSample[] = [];
  #hostState: HostState | undefined;

  constructor(
    loaded: LoadedConfig,
    opts: { metricsSource?: MetricsSource; metricsIntervalMs?: number } = {},
  ) {
    this.#loaded = loaded;
    this.#config = loaded.resolved;
    this.#writeFiles(this.#config.files ?? []);

    this.#metricsCollector = new MetricsCollector(opts.metricsSource ?? createMetricsSource());
    if (this.#metricsCollector.supported) {
      this.#metricTimer = setInterval(
        () => void this.#sampleMetrics(),
        opts.metricsIntervalMs ?? DEFAULT_METRICS_INTERVAL_MS,
      );
    }
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

  startTask(name: string, opts: StartOptions = {}): ProcessInfo {
    return this.#snapshot(this.#start(name, opts));
  }

  getAllTaskGroups(): TaskGroupInfo[] {
    return Object.entries(this.#config.taskGroup ?? {}).map(([name, tasks]) => ({
      name,
      tasks: [...tasks],
    }));
  }

  async startTaskGroup(name: string, opts: StartOptions = {}): Promise<ProcessInfo[]> {
    const tasks = this.#groupTasks(name);
    const started: ManagedProcess[] = [];
    const processes: ProcessInfo[] = [];

    try {
      for (const taskName of tasks) {
        const running = this.#runningFor(taskName);
        if (running) {
          processes.push(this.#snapshot(running));
          continue;
        }

        const managed = this.#start(taskName, opts);
        started.push(managed);
        processes.push(this.#snapshot(managed));
      }
    } catch (error) {
      // Do not leave a half-started group behind.
      await Promise.all(started.map((managed) => this.#terminate(managed)));
      throw error;
    }

    return processes;
  }

  async stopTaskGroup(name: string): Promise<ProcessInfo[]> {
    const running = this.#groupTasks(name)
      .map((taskName) => this.#runningFor(taskName))
      .filter((managed): managed is ManagedProcess => managed !== undefined);

    return Promise.all(running.map((managed) => this.stopProcess(managed.info.id)));
  }

  #start(name: string, opts: StartOptions): ManagedProcess {
    const task = this.#config.tasks[name];
    if (!task) {
      throw new Error(`Unknown task: ${name}`);
    }

    if (this.#runningFor(name)) {
      throw new Error(`Task "${name}" is already running`);
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
      metrics: null,
      label: opts.label,
      kind: opts.kind ?? "run",
    };

    const managed: ManagedProcess = {
      info,
      subprocess: null,
      logs: [],
      subscribers: new Set(),
      exit: Promise.resolve(),
      metrics: [],
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
    return managed;
  }

  getAllProcesses(opts: ProcessFilter = {}): ProcessInfo[] {
    const matches = (info: ProcessInfo): boolean =>
      (opts.label === undefined || info.label === opts.label) &&
      (opts.taskName === undefined || info.taskName === opts.taskName) &&
      (opts.kind === undefined || info.kind === opts.kind);

    return Array.from(this.#processes.values())
      .filter((managed) => matches(managed.info))
      .map((managed) => this.#snapshot(managed));
  }

  getProcess(id: string): ProcessInfo {
    return this.#snapshot(this.#get(id));
  }

  async waitForProcess(id: string): Promise<ProcessInfo> {
    const managed = this.#get(id);
    await managed.exit;
    return this.#snapshot(managed);
  }

  getProcessMetrics(id: string): ProcessMetrics {
    const managed = this.#get(id);
    return {
      processId: id,
      supported: this.#metricsCollector.supported,
      latest: managed.metrics.at(-1) ?? null,
      samples: [...managed.metrics],
    };
  }

  getHostMetrics(): HostMetrics {
    return {
      supported: this.#metricsCollector.supported,
      latest: this.#hostMetrics.at(-1) ?? null,
      samples: [...this.#hostMetrics],
    };
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
    this.#stopSampling();
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

  deleteProcesses(opts: DeleteProcessesOptions): number {
    if (opts.label === undefined && opts.taskName === undefined) {
      throw new Error("deleteProcesses requires a label or taskName filter");
    }

    let deleted = 0;
    for (const [id, managed] of this.#processes) {
      if (opts.label !== undefined && managed.info.label !== opts.label) continue;
      if (opts.taskName !== undefined && managed.info.taskName !== opts.taskName) continue;
      // Running processes keep their slot until they are stopped explicitly.
      if (managed.info.state === "running") continue;

      this.#closeSubscribers(managed);
      this.#processes.delete(id);
      deleted++;
    }

    return deleted;
  }

  [Symbol.dispose](): void {
    this.#stopSampling();
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

  #stopSampling(): void {
    if (!this.#metricTimer) return;
    clearInterval(this.#metricTimer);
    this.#metricTimer = undefined;
  }

  async #sampleMetrics(): Promise<void> {
    try {
      const now = Date.now();
      for (const managed of this.#processes.values()) {
        if (managed.info.state !== "running" || !managed.subprocess?.pid) continue;

        const pid = managed.subprocess.pid;
        const result = await this.#metricsCollector.collect(pid, managed.metricState, now);
        if (!result) continue;

        managed.metricState = result.state;
        managed.metrics.push(result.sample);
        trimToLimit(managed.metrics, MAX_METRIC_SAMPLES);
      }

      const host = await this.#metricsCollector.collectHost(this.#hostState, now);
      if (host) {
        this.#hostState = host.state;
        this.#hostMetrics.push(host.sample);
        trimToLimit(this.#hostMetrics, MAX_METRIC_SAMPLES);
      }
    } catch (error) {
      console.error("Failed to collect process metrics:", error);
    }
  }

  #groupTasks(name: string): string[] {
    const tasks = this.#config.taskGroup?.[name];
    if (!tasks) {
      throw new Error(`Unknown task group: ${name}`);
    }

    return tasks;
  }

  #runningFor(taskName: string): ManagedProcess | undefined {
    for (const managed of this.#processes.values()) {
      if (managed.info.taskName === taskName && managed.info.state === "running") {
        return managed;
      }
    }

    return undefined;
  }

  #get(id: string): ManagedProcess {
    const managed = this.#processes.get(id);
    if (!managed) {
      throw new Error(`Unknown process: ${id}`);
    }

    return managed;
  }

  #snapshot(managed: ManagedProcess): ProcessInfo {
    return {
      ...managed.info,
      args: [...managed.info.args],
      metrics: managed.metrics.at(-1) ?? null,
    };
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
    managed.info.durationMs = Math.max(0, managed.info.stoppedAt - managed.info.startedAt);
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
