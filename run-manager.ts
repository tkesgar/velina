import path from "node:path";
import fs from "node:fs";
import type { NormalizedScript, VelinaConfig } from "./velina";

const MAX_LOG_CHARS = 256 * 1024;
const MAX_QUEUED_EVENT_CHARS = 512 * 1024;
const STOP_GRACE_PERIOD_MS = 1500;

export type RunStatus =
  | "starting"
  | "running"
  | "stopping"
  | "succeeded"
  | "failed"
  | "stopped";

export interface RunEnvironmentEntry {
  name: string;
  value: string;
  source: "process.env" | "config.env" | "app.env";
}

export interface RunSummary {
  id: string;
  appIndex: number;
  appName: string;
  scriptName: string;
  scriptType: NormalizedScript["type"];
  cwd: string;
  pid: number | null;
  status: RunStatus;
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  error: string | null;
}

export interface RunSnapshot extends RunSummary {
  environment: RunEnvironmentEntry[];
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export type RunEvent =
  | { type: "snapshot"; run: RunSnapshot }
  | {
      type: "output";
      stream: "stdout" | "stderr";
      chunk: string;
      truncated: boolean;
    }
  | { type: "status"; run: RunSummary };

type RunProcess = Bun.Subprocess<"ignore", "pipe", "pipe">;
type RunOutputStream = "stdout" | "stderr";

interface RunRecord extends RunSummary {
  environment: RunEnvironmentEntry[];
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  stopRequested: boolean;
  process: RunProcess | null;
  completion: Promise<void> | null;
  subscribers: Set<RunSubscriber>;
}

interface RunSubscriber {
  controller: ReadableStreamDefaultController<RunEvent> | null;
  pending: RunEvent[];
  pendingOutputChars: number;
  closed: boolean;
  run: RunRecord;
}

function isFinished(status: RunStatus) {
  return status === "succeeded" || status === "failed" || status === "stopped";
}

function isActive(status: RunStatus) {
  return status === "starting" || status === "running" || status === "stopping";
}

function resolveEnvironment(
  parent: Record<string, string>,
  shared: Record<string, string | null>,
  app: Record<string, string | null>,
): RunEnvironmentEntry[] {
  const values = new Map<string, RunEnvironmentEntry>();

  for (const [name, value] of Object.entries(parent)) {
    if (value !== undefined) {
      values.set(name, { name, value, source: "process.env" });
    }
  }

  function apply(
    variables: Record<string, string | null>,
    source: RunEnvironmentEntry["source"],
  ) {
    for (const [name, value] of Object.entries(variables)) {
      if (value === null) {
        values.delete(name);
      } else {
        values.set(name, { name, value, source });
      }
    }
  }

  apply(shared, "config.env");
  apply(app, "app.env");

  return [...values.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export class RunManager {
  private readonly runs = new Map<string, RunRecord>();

  constructor(
    private readonly projectRoot: string,
    private readonly config: VelinaConfig,
    private readonly processEnvironment: Record<string, string>,
  ) {}

  listRuns(): RunSummary[] {
    return [...this.runs.values()]
      .sort((left, right) => right.startedAt - left.startedAt)
      .map((run) => this.toSummary(run));
  }

  startRun(appIndex: number, scriptName: string): RunSummary {
    if (!Number.isInteger(appIndex) || appIndex < 0) {
      throw new Error("Invalid app selection");
    }

    const app = this.config.apps[appIndex];
    if (!app) {
      throw new Error("The selected app no longer exists");
    }
    if (!Object.hasOwn(app.scripts, scriptName)) {
      throw new Error("The selected script is not configured for this app");
    }
    const existingRun = [...this.runs.values()].find(
      (run) =>
        run.appIndex === appIndex &&
        run.scriptName === scriptName &&
        isActive(run.status),
    );
    if (existingRun) {
      throw new Error(
        `${app.name} / ${scriptName} is already running (run ${existingRun.id.slice(0, 8)})`,
      );
    }

    const script = app.scripts[scriptName];
    const cwd = path.resolve(this.projectRoot, app.path);
    if (!fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`App directory does not exist: ${cwd}`);
    }

    const environment = resolveEnvironment(
      this.processEnvironment,
      this.config.env,
      app.env,
    );
    const run: RunRecord = {
      id: crypto.randomUUID(),
      appIndex,
      appName: app.name,
      scriptName,
      scriptType: script.type,
      cwd,
      pid: null,
      status: "starting",
      startedAt: Date.now(),
      finishedAt: null,
      exitCode: null,
      error: null,
      environment,
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      stopRequested: false,
      process: null,
      completion: null,
      subscribers: new Set(),
    };
    this.runs.set(run.id, run);

    try {
      let commandLine: string[];
      if (script.type === "package-script") {
        const bunExecutable = Bun.which("bun");
        if (!bunExecutable) throw new Error("Could not find Bun to run this package script");
        commandLine = [bunExecutable, "run", scriptName];
      } else {
        commandLine = process.platform === "win32"
          ? [this.processEnvironment.ComSpec || "cmd.exe", "/d", "/s", "/c", script.value]
          : ["/bin/sh", "-c", script.value];
      }
      const child = Bun.spawn(commandLine, {
        cwd,
        env: Object.fromEntries(environment.map(({ name, value }) => [name, value])),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        detached: process.platform !== "win32",
      });

      run.process = child;
      run.pid = child.pid;
      run.status = "running";

      const stdout = this.readOutput(run, "stdout", child.stdout);
      const stderr = this.readOutput(run, "stderr", child.stderr);
      run.completion = this.finishRun(run, child, stdout, stderr);
    } catch (cause) {
      run.status = "failed";
      run.error = cause instanceof Error ? cause.message : String(cause);
      run.finishedAt = Date.now();
    }

    return this.toSummary(run);
  }

  watchRun(runId: string): ReadableStream<RunEvent> {
    const run = this.requireRun(runId);
    const subscriber: RunSubscriber = {
      controller: null,
      pending: [],
      pendingOutputChars: 0,
      closed: false,
      run,
    };

    return new ReadableStream<RunEvent>({
      start: (controller) => {
        subscriber.controller = controller;
        run.subscribers.add(subscriber);
        this.queueEvent(subscriber, { type: "snapshot", run: this.toSnapshot(run) });
        if (isFinished(run.status)) {
          subscriber.closed = true;
          this.flushSubscriber(subscriber);
        }
      },
      pull: () => this.flushSubscriber(subscriber),
      cancel: () => {
        run.subscribers.delete(subscriber);
        subscriber.pending = [];
        subscriber.pendingOutputChars = 0;
      },
    }, { highWaterMark: 1 });
  }

  async stopRun(runId: string): Promise<RunSummary> {
    const run = this.requireRun(runId);
    const child = run.process;
    if (!child || isFinished(run.status)) {
      return this.toSummary(run);
    }

    run.stopRequested = true;
    run.status = "stopping";
    this.publish(run, { type: "status", run: this.toSummary(run) });
    this.signalProcessTree(child, "SIGTERM");

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const exitedGracefully = await Promise.race([
      child.exited.then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), STOP_GRACE_PERIOD_MS);
      }),
    ]);
    if (timeout) clearTimeout(timeout);

    if (!exitedGracefully) {
      this.signalProcessTree(child, "SIGKILL");
    }

    await child.exited;
    await run.completion;
    return this.toSummary(run);
  }

  async stopAllRuns(): Promise<void> {
    const activeRuns = [...this.runs.values()]
      .filter((run) => !isFinished(run.status))
      .map((run) => run.id);
    await Promise.all(activeRuns.map((runId) => this.stopRun(runId)));
  }

  cleanRun(runId: string): boolean {
    const run = this.requireRun(runId);
    if (!isFinished(run.status)) {
      throw new Error("Stop the run before removing it");
    }

    this.disposeSubscribers(run);
    return this.runs.delete(runId);
  }

  cleanFinishedRuns(): number {
    let removed = 0;
    for (const [runId, run] of this.runs) {
      if (!isFinished(run.status)) continue;
      this.disposeSubscribers(run);
      this.runs.delete(runId);
      removed++;
    }
    return removed;
  }

  private requireRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    return run;
  }

  private toSummary(run: RunRecord): RunSummary {
    return {
      id: run.id,
      appIndex: run.appIndex,
      appName: run.appName,
      scriptName: run.scriptName,
      scriptType: run.scriptType,
      cwd: run.cwd,
      pid: run.pid,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      exitCode: run.exitCode,
      error: run.error,
    };
  }

  private toSnapshot(run: RunRecord): RunSnapshot {
    return {
      ...this.toSummary(run),
      environment: run.environment,
      stdout: run.stdout,
      stderr: run.stderr,
      stdoutTruncated: run.stdoutTruncated,
      stderrTruncated: run.stderrTruncated,
    };
  }

  private async readOutput(
    run: RunRecord,
    stream: RunOutputStream,
    source: ReadableStream<Uint8Array>,
  ) {
    const reader = source.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        this.appendOutput(run, stream, decoder.decode(value, { stream: true }));
      }
      this.appendOutput(run, stream, decoder.decode());
    } catch (cause) {
      this.appendOutput(
        run,
        stream,
        `\n[Velina could not continue reading ${stream}: ${cause instanceof Error ? cause.message : String(cause)}]\n`,
      );
    } finally {
      reader.releaseLock();
    }
  }

  private appendOutput(run: RunRecord, stream: RunOutputStream, chunk: string) {
    if (!chunk) return;

    const truncationKey = stream === "stdout" ? "stdoutTruncated" : "stderrTruncated";
    const next = run[stream] + chunk;
    if (next.length > MAX_LOG_CHARS) {
      run[stream] = next.slice(-MAX_LOG_CHARS);
      run[truncationKey] = true;
    } else {
      run[stream] = next;
    }

    this.publish(run, {
      type: "output",
      stream,
      chunk,
      truncated: run[truncationKey],
    });
  }

  private async finishRun(
    run: RunRecord,
    child: RunProcess,
    stdout: Promise<void>,
    stderr: Promise<void>,
  ) {
    const [exitCode] = await Promise.all([child.exited, stdout, stderr]);
    run.exitCode = exitCode;
    run.finishedAt = Date.now();
    run.status = run.stopRequested
      ? "stopped"
      : exitCode === 0
        ? "succeeded"
        : "failed";
    run.process = null;
    this.publish(run, { type: "status", run: this.toSummary(run) });
    this.closeSubscribers(run);
  }

  private signalProcessTree(child: RunProcess, signal: "SIGTERM" | "SIGKILL") {
    try {
      if (process.platform === "win32") {
        if (signal === "SIGTERM") {
          child.kill(signal);
        } else {
          const taskkill = Bun.spawn([
            "taskkill",
            "/pid",
            String(child.pid),
            "/t",
            "/f",
          ], { stdout: "ignore", stderr: "ignore" });
          void taskkill.exited;
        }
      } else {
        process.kill(-child.pid, signal);
      }
    } catch {
      try {
        child.kill(signal);
      } catch {
        // The process may have exited between the status check and signal.
      }
    }
  }

  private publish(run: RunRecord, event: RunEvent) {
    for (const subscriber of run.subscribers) {
      this.queueEvent(subscriber, event);
    }
  }

  private queueEvent(subscriber: RunSubscriber, event: RunEvent) {
    if (subscriber.closed) return;

    if (event.type === "output") {
      if (subscriber.pendingOutputChars + event.chunk.length > MAX_QUEUED_EVENT_CHARS) {
        subscriber.pending = [{ type: "snapshot", run: this.toSnapshot(subscriber.run) }];
        subscriber.pendingOutputChars = 0;
      } else {
        subscriber.pending.push(event);
        subscriber.pendingOutputChars += event.chunk.length;
      }
    } else {
      subscriber.pending.push(event);
    }

    this.flushSubscriber(subscriber);
  }

  private flushSubscriber(subscriber: RunSubscriber) {
    const controller = subscriber.controller;
    if (!controller) return;

    try {
      while (subscriber.pending.length && (controller.desiredSize ?? 0) > 0) {
        const event = subscriber.pending.shift()!;
        if (event.type === "output") {
          subscriber.pendingOutputChars -= event.chunk.length;
        }
        controller.enqueue(event);
      }

      if (subscriber.closed && subscriber.pending.length === 0) {
        controller.close();
        subscriber.run.subscribers.delete(subscriber);
      }
    } catch {
      subscriber.run.subscribers.delete(subscriber);
      subscriber.pending = [];
      subscriber.pendingOutputChars = 0;
    }
  }

  private closeSubscribers(run: RunRecord) {
    for (const subscriber of run.subscribers) {
      subscriber.closed = true;
      this.flushSubscriber(subscriber);
    }
  }

  private disposeSubscribers(run: RunRecord) {
    for (const subscriber of run.subscribers) {
      subscriber.closed = true;
      subscriber.pending = [];
      subscriber.pendingOutputChars = 0;
      try {
        subscriber.controller?.close();
      } catch {
        // The subscriber may already have cancelled its stream.
      }
    }
    run.subscribers.clear();
  }
}
