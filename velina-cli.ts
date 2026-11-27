#!/usr/bin/env bun

import type { RpcStub } from "capnweb";

import { isYamlConfig, type LogFiles, type ProcessKind, type VelinaApi } from "./lib/api";
import { parseCliArgs, type CliArgs } from "./lib/cli-args";
import { formatLogLine, openApi, printJson, resolvePort, resolveProcessId } from "./lib/cli-client";

const USAGE = `Usage:
  velina-cli config [--format yaml]       show provided and resolved config
  velina-cli groups                       list task groups and their tasks
  velina-cli start <task> [--label L]     start a task
  velina-cli start-group <group> [--label L]
                                          start every task in a group
  velina-cli ps [--label L] [--task T] [--kind K]
                                          list matching processes
  velina-cli process <id>                 show process details
  velina-cli metrics <id>                 show process metrics history
  velina-cli logs <id> [stdout|stderr]    stream process logs
  velina-cli stop <id>                    stop a process
  velina-cli stop-group <group>           stop running tasks in a group
  velina-cli delete <id>                  delete a stopped process
  velina-cli cleanup [--label L] [--task T]
                                          delete stopped processes matching a filter
  velina-cli bench <task> [--repeat N] [--label L] [--pre-hook T] [--post-hook T] [--wait S]
                                          run a task N times and report timing

Options:
  --label <label>     label for started processes, or a filter for ps/cleanup
  --task <task>       filter processes by task name (ps, cleanup)
  --kind <kind>       filter by run, pre-hook, or post-hook (ps)
  --repeat <n>        number of benchmark runs, 1-100 (default: 1)
  --pre-hook <task>   task to run before each measured run
  --post-hook <task>  task to run after each measured run
  --wait <seconds>    pause between iterations; fractional values allowed (default: 0)
  --port <port>       server port (default: from .velina.yml, otherwise 2222)
  --json              log entries as JSON lines
  --help              show this message

Benchmarking is designed for relatively long tasks (roughly > 100 ms), where
process-spawn overhead is negligible. For micro-benchmarks, use a dedicated
test harness.

Process ids may be abbreviated to any unique prefix.`;

interface BenchRun {
  id: string;
  taskName: string;
  label: string;
  kind: ProcessKind;
  durationMs?: number;
  exitCode?: number;
  logFiles?: LogFiles;
}

interface BenchSummary {
  minSeconds: number | null;
  maxSeconds: number | null;
  meanSeconds: number | null;
  medianSeconds: number | null;
  p95Seconds: number | null;
}

interface BenchResult {
  task: string;
  label: string;
  repeat: number;
  runs: BenchRun[];
  summary: BenchSummary;
  error?: string;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toSeconds(ms: number): number {
  return Math.round(ms) / 1000;
}

function summarize(runs: BenchRun[]): BenchSummary {
  const values = runs
    .map((run) => run.durationMs)
    .filter((value): value is number => value !== undefined);
  if (values.length === 0) {
    return {
      minSeconds: null,
      maxSeconds: null,
      meanSeconds: null,
      medianSeconds: null,
      p95Seconds: null,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  const mean = values.reduce((total, value) => total + value, 0) / values.length;

  return {
    minSeconds: toSeconds(sorted[0]),
    maxSeconds: toSeconds(sorted.at(-1)!),
    meanSeconds: toSeconds(mean),
    medianSeconds: toSeconds(median),
    p95Seconds: toSeconds(p95),
  };
}

async function sleep(ms: number, isCancelled: () => boolean): Promise<void> {
  let remaining = ms;
  while (remaining > 0 && !isCancelled()) {
    const slice = Math.min(50, remaining);
    await Bun.sleep(slice);
    remaining -= slice;
  }
}

async function runBench(args: CliArgs, api: RpcStub<VelinaApi>): Promise<BenchResult> {
  const task = args.target!;
  const label = args.label ?? "bench";
  const repeat = args.repeat ?? 1;
  const waitMs = Math.round((args.waitSeconds ?? 0) * 1000);
  const runs: BenchRun[] = [];

  let error: string | undefined;
  let cancelled = false;
  let activeId: string | undefined;

  const onInterrupt = () => {
    cancelled = true;
    if (activeId) void Promise.resolve(api.stopProcess(activeId)).catch(() => {});
  };
  process.on("SIGINT", onInterrupt);

  async function runHook(name: string, kind: ProcessKind): Promise<boolean> {
    const started = await Promise.resolve(api.startTask(name, { label, kind }));
    activeId = started.id;
    const finished = await Promise.resolve(api.waitForProcess(started.id));
    activeId = undefined;
    if (cancelled) return false;
    if (finished.exitCode !== 0) {
      const hookName = kind === "pre-hook" ? "Pre-hook" : "Post-hook";
      error = `${hookName} "${name}" exited with code ${finished.exitCode}`;
      return false;
    }
    return true;
  }

  try {
    for (let iteration = 1; iteration <= repeat && !cancelled; iteration++) {
      if (args.preHook && !(await runHook(args.preHook, "pre-hook"))) break;

      const started = await Promise.resolve(api.startTask(task, { label, kind: "run" }));
      activeId = started.id;
      const finished = await Promise.resolve(api.waitForProcess(started.id));
      activeId = undefined;

      runs.push({
        id: finished.id,
        taskName: finished.taskName,
        label,
        kind: "run",
        durationMs: finished.durationMs,
        exitCode: finished.exitCode,
        logFiles: finished.logFiles,
      });

      if (cancelled) break;
      if (finished.exitCode !== 0) {
        error = `Task "${task}" exited with code ${finished.exitCode}`;
        break;
      }

      if (args.postHook && !(await runHook(args.postHook, "post-hook"))) break;
      if (iteration < repeat && waitMs > 0) await sleep(waitMs, () => cancelled);
    }

    if (cancelled && !error) error = "Interrupted";
  } catch (cause) {
    error = error ?? describe(cause);
  } finally {
    process.off("SIGINT", onInterrupt);
  }

  const result: BenchResult = { task, label, repeat, runs, summary: summarize(runs) };
  if (error) result.error = error;
  return result;
}

async function run(args: CliArgs, api: RpcStub<VelinaApi>): Promise<number> {
  switch (args.command) {
    case "config": {
      if (args.format === "yaml") {
        const config = await Promise.resolve(api.getConfig({ format: "yaml" }));
        if (!isYamlConfig(config)) {
          throw new Error("Unexpected config format");
        }
        console.log(config.resolved.trimEnd());
        return 0;
      }

      printJson(await Promise.resolve(api.getConfig()));
      return 0;
    }
    case "groups":
      printJson(await Promise.resolve(api.getAllTaskGroups()));
      return 0;
    case "start": {
      const opts = args.label ? { label: args.label } : undefined;
      printJson(await Promise.resolve(api.startTask(args.target!, opts)));
      return 0;
    }
    case "start-group": {
      const opts = args.label ? { label: args.label } : undefined;
      printJson(await Promise.resolve(api.startTaskGroup(args.target!, opts)));
      return 0;
    }
    case "ps": {
      const filter = {
        ...(args.label !== undefined ? { label: args.label } : {}),
        ...(args.taskFilter !== undefined ? { taskName: args.taskFilter } : {}),
        ...(args.kindFilter !== undefined ? { kind: args.kindFilter } : {}),
      };
      const hasFilter = Object.keys(filter).length > 0;
      printJson(
        await Promise.resolve(hasFilter ? api.getAllProcesses(filter) : api.getAllProcesses()),
      );
      return 0;
    }
    case "process": {
      const id = await resolveProcessId(api, args.target!);
      printJson(await Promise.resolve(api.getProcess(id)));
      return 0;
    }
    case "metrics": {
      const id = await resolveProcessId(api, args.target!);
      printJson(await Promise.resolve(api.getProcessMetrics(id)));
      return 0;
    }
    case "logs": {
      const id = await resolveProcessId(api, args.target!);
      const stream = await Promise.resolve(api.streamProcessLogs(id, args.logType ?? "stdout"));
      const reader = stream.getReader();
      let cancelled = false;

      const onInterrupt = () => {
        cancelled = true;
        void reader.cancel().catch(() => {});
      };
      process.on("SIGINT", onInterrupt);

      try {
        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done || cancelled) break;
          if (args.json) console.log(JSON.stringify(value));
          else console.log(formatLogLine(value));
        }
      } finally {
        process.off("SIGINT", onInterrupt);
        try {
          reader.releaseLock();
        } catch {
          // The stream may already be closed after an interrupt.
        }
      }
      return 0;
    }
    case "stop": {
      const id = await resolveProcessId(api, args.target!);
      printJson(await Promise.resolve(api.stopProcess(id)));
      return 0;
    }
    case "stop-group":
      printJson(await Promise.resolve(api.stopTaskGroup(args.target!)));
      return 0;
    case "delete": {
      const id = await resolveProcessId(api, args.target!);
      await Promise.resolve(api.deleteProcess(id));
      printJson({ deleted: id });
      return 0;
    }
    case "cleanup": {
      const opts = {
        ...(args.label !== undefined ? { label: args.label } : {}),
        ...(args.taskFilter !== undefined ? { taskName: args.taskFilter } : {}),
      };
      const deleted = await Promise.resolve(api.deleteProcesses(opts));
      printJson({ deleted });
      return 0;
    }
    case "bench": {
      const result = await runBench(args, api);
      printJson(result);
      return result.error ? 1 : 0;
    }
    case "help":
      return 0;
  }
}

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return 2;
  }

  if (args.command === "help") {
    console.log(USAGE);
    return 0;
  }

  let api: RpcStub<VelinaApi> | undefined;
  try {
    const port = await resolvePort({ port: args.port });
    api = openApi(port);
    return await run(args, api);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Is Velina running? Start it with `velina`.");
    return 1;
  } finally {
    api?.[Symbol.dispose]();
  }
}

process.exit(await main());
