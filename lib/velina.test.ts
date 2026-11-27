import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import type { LogEntry, ProcessState } from "./api";
import type { LoadedConfig, ResolvedConfig } from "./config";
import { nullMetricsSource, type MetricsSource } from "./metrics";
import { Velina } from "./velina";

const instances: Velina[] = [];
const tempDirs: string[] = [];

function createVelina(
  config: LoadedConfig,
  opts: { metricsSource?: MetricsSource; metricsIntervalMs?: number } = {},
): Velina {
  const velina = new Velina(config, opts);
  instances.push(velina);
  return velina;
}

function configWith(
  tasks: ResolvedConfig["tasks"],
  files: ResolvedConfig["files"] = [],
  taskGroup: ResolvedConfig["taskGroup"] = {},
): LoadedConfig {
  return {
    provided: {},
    resolved: {
      logs: { enabled: false, dir: "/tmp/velina-test-logs" },
      port: 2222,
      vars: {},
      env: {},
      files,
      tasks,
      taskGroup,
    },
  };
}

function evalTask(source: string): NonNullable<ResolvedConfig["tasks"]>[string] {
  return {
    cmd: process.execPath,
    args: ["-e", source],
    cwd: process.cwd(),
    env: {},
    files: [],
  };
}

async function collect(stream: ReadableStream<LogEntry>): Promise<LogEntry[]> {
  const entries: LogEntry[] = [];
  for await (const entry of stream) {
    entries.push(entry);
  }

  return entries;
}

async function waitForState(velina: Velina, id: string, state: ProcessState): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (velina.getProcess(id).state === state) return;
    await Bun.sleep(10);
  }

  throw new Error(`Process ${id} did not reach state ${state}`);
}

afterEach(async () => {
  await Promise.all(
    instances.map(async (velina) => {
      await Promise.all(velina.getAllProcesses().map((process) => velina.stopProcess(process.id)));
      velina[Symbol.dispose]();
    }),
  );
  instances.length = 0;

  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe("Velina", () => {
  describe("getConfig", () => {
    it("should return the provided and resolved config", () => {
      const config = configWith({});
      const velina = createVelina(config);

      expect(velina.getConfig()).toBe(config);
      expect(velina.getConfig().provided).toEqual({});
    });

    it("should return the config as YAML when requested", () => {
      const velina = createVelina({
        provided: { port: 1234, vars: { GREETING: "hello" } },
        resolved: {
          logs: { enabled: false, dir: "/tmp/velina-test-logs" },
          port: 1234,
          vars: {},
          env: {},
          files: [],
          tasks: {},
          taskGroup: {},
        },
      });

      const yaml = velina.getConfig({ format: "yaml" });

      expect(yaml.provided).toContain("port: 1234");
      expect(yaml.provided).toContain("GREETING: hello");
      expect(yaml.resolved).toContain("port: 1234");
    });
  });

  describe("startTask", () => {
    it("should throw for an unknown task", () => {
      const velina = createVelina(configWith({}));

      expect(() => velina.startTask("missing")).toThrow("Unknown task: missing");
    });

    it("should start a process and report it as running", async () => {
      const velina = createVelina(configWith({ loop: evalTask("setInterval(() => {}, 50)") }));

      const process = velina.startTask("loop");

      expect(process.id).toBeTruthy();
      expect(process.taskName).toBe("loop");
      expect(process.state).toBe("running");
      expect(process.cmd).toBe(globalThis.process.execPath);
      expect(process.args).toEqual(["-e", "setInterval(() => {}, 50)"]);
      expect(process.stoppedAt).toBeUndefined();
      expect(velina.getProcess(process.id)).toEqual(process);
      expect(velina.getAllProcesses()).toEqual([process]);
    });

    it("should not start the same task twice while it is running", async () => {
      const velina = createVelina(configWith({ loop: evalTask("setInterval(() => {}, 50)") }));
      const first = velina.startTask("loop");

      expect(() => velina.startTask("loop")).toThrow('Task "loop" is already running');
      expect(velina.getAllProcesses()).toHaveLength(1);

      await velina.stopProcess(first.id);
      const second = velina.startTask("loop");
      expect(second.id).not.toBe(first.id);
    });

    it("should write config files and task files before running", () => {
      const dir = mkdtempSync(path.join(tmpdir(), "velina-"));
      tempDirs.push(dir);

      const globalFile = path.join(dir, "global.txt");
      const taskFile = path.join(dir, "nested/task.txt");
      const task = evalTask("console.log('ok')");
      task.files = [{ path: taskFile, content: "task content" }];
      const velina = createVelina(
        configWith({ greet: task }, [{ path: globalFile, content: "global content" }]),
      );

      expect(readFileSync(globalFile, "utf8")).toBe("global content");
      expect(existsSync(taskFile)).toBe(false);

      velina.startTask("greet");

      expect(readFileSync(taskFile, "utf8")).toBe("task content");
    });
  });

  describe("task groups", () => {
    const loop = () => evalTask("setInterval(() => {}, 50)");

    it("should list groups with their tasks", () => {
      const velina = createVelina(configWith({ a: loop(), b: loop() }, [], { dev: ["a", "b"] }));

      expect(velina.getAllTaskGroups()).toEqual([{ name: "dev", tasks: ["a", "b"] }]);
    });

    it("should start every task in a group", async () => {
      const velina = createVelina(configWith({ a: loop(), b: loop() }, [], { dev: ["a", "b"] }));

      const processes = await velina.startTaskGroup("dev");

      expect(processes.map((process) => process.taskName)).toEqual(["a", "b"]);
      expect(processes.every((process) => process.state === "running")).toBe(true);
      expect(velina.getAllProcesses()).toHaveLength(2);
    });

    it("should reuse processes for members that are already running", async () => {
      const velina = createVelina(configWith({ a: loop(), b: loop() }, [], { dev: ["a", "b"] }));
      const existing = velina.startTask("a");

      const processes = await velina.startTaskGroup("dev");

      expect(processes[0].id).toBe(existing.id);
      expect(processes[1].taskName).toBe("b");
      expect(velina.getAllProcesses()).toHaveLength(2);
    });

    it("should throw for an unknown group", async () => {
      const velina = createVelina(configWith({ a: loop() }));

      await expect(velina.startTaskGroup("dev")).rejects.toThrow("Unknown task group: dev");
      await expect(velina.stopTaskGroup("dev")).rejects.toThrow("Unknown task group: dev");
    });

    it("should stop only the running members of a group", async () => {
      const velina = createVelina(
        configWith({ a: loop(), b: loop(), other: loop() }, [], { dev: ["a", "b"] }),
      );
      const processes = await velina.startTaskGroup("dev");
      const untouched = velina.startTask("other");

      const stopped = await velina.stopTaskGroup("dev");

      expect(stopped.map((process) => process.id).sort()).toEqual(
        processes.map((process) => process.id).sort(),
      );
      expect(stopped.every((process) => process.state === "stopped")).toBe(true);
      expect(velina.getProcess(untouched.id).state).toBe("running");
    });
  });

  describe("logs", () => {
    it("should capture stdout and stderr as separate line entries", async () => {
      const velina = createVelina(
        configWith({
          greet: evalTask("console.log('hello out'); console.error('hello err')"),
        }),
      );

      const process = velina.startTask("greet");
      await waitForState(velina, process.id, "stopped");

      const stdout = await collect(velina.streamProcessLogs(process.id, "stdout"));
      const stderr = await collect(velina.streamProcessLogs(process.id, "stderr"));

      expect(stdout.map((entry) => entry.line)).toEqual(["hello out"]);
      expect(stderr.map((entry) => entry.line)).toEqual(["hello err"]);
      expect(stdout[0].type).toBe("stdout");
      expect(stderr[0].type).toBe("stderr");
      expect(velina.getProcess(process.id).exitCode).toBe(0);
    });

    it("should replay logs of the requested type and close a stopped process stream", async () => {
      const velina = createVelina(
        configWith({ greet: evalTask("console.log('out'); console.error('err')") }),
      );

      const process = velina.startTask("greet");
      await waitForState(velina, process.id, "stopped");

      const stdout = await collect(velina.streamProcessLogs(process.id, "stdout"));
      expect(stdout.map((entry) => entry.line)).toEqual(["out"]);
    });

    it("should deliver live logs after replay and close when the process stops", async () => {
      const velina = createVelina(
        configWith({
          delayed: evalTask("console.log('one'); setTimeout(() => console.log('two'), 50)"),
        }),
      );

      const process = velina.startTask("delayed");
      const collected = collect(velina.streamProcessLogs(process.id, "stdout"));

      await waitForState(velina, process.id, "stopped");
      expect((await collected).map((entry) => entry.line)).toEqual(["one", "two"]);
    });

    it("should keep logs available after the process is stopped", async () => {
      const velina = createVelina(
        configWith({ loop: evalTask("console.log('tick'); setInterval(() => {}, 50)") }),
      );

      const process = velina.startTask("loop");
      await Bun.sleep(30);
      await velina.stopProcess(process.id);

      const logs = await collect(velina.streamProcessLogs(process.id, "stdout"));
      expect(logs.map((entry) => entry.line)).toEqual(["tick"]);
    });
  });

  describe("stopProcess", () => {
    it("should terminate a running process", async () => {
      const velina = createVelina(configWith({ loop: evalTask("setInterval(() => {}, 50)") }));

      const process = velina.startTask("loop");
      const stopped = await velina.stopProcess(process.id);

      expect(stopped.state).toBe("stopped");
      expect(stopped.stoppedAt).toBeGreaterThan(0);
    });

    it("should be idempotent for an already-stopped process", async () => {
      const velina = createVelina(configWith({ greet: evalTask("console.log('hi')") }));

      const process = velina.startTask("greet");
      await waitForState(velina, process.id, "stopped");

      const stopped = await velina.stopProcess(process.id);
      expect(stopped.state).toBe("stopped");
      expect(stopped.exitCode).toBe(0);
    });
  });

  describe("metrics", () => {
    const source: MetricsSource = {
      supported: true,
      async readProcess(pid) {
        return {
          pid,
          state: "S",
          userCpuMs: 1000,
          systemCpuMs: 500,
          memoryBytes: 1024 * 1024,
          threads: 2,
          openFiles: 4,
          openSockets: 1,
          diskReadBytes: 1000,
          diskWriteBytes: 2000,
        };
      },
      async readChildren() {
        return [];
      },
      async readHostNetwork() {
        return { rxBytes: 5000, txBytes: 9000 };
      },
    };
    const loop = () => evalTask("setInterval(() => {}, 50)");

    it("should sample running processes and host network", async () => {
      const velina = createVelina(configWith({ loop: loop() }), {
        metricsSource: source,
        metricsIntervalMs: 10,
      });
      const process = velina.startTask("loop");
      await Bun.sleep(80);

      const metrics = velina.getProcessMetrics(process.id);
      expect(metrics.supported).toBe(true);
      expect(metrics.samples.length).toBeGreaterThan(0);
      expect(metrics.latest?.memoryBytes).toBe(1024 * 1024);
      expect(velina.getProcess(process.id).metrics).toEqual(metrics.latest);
      expect(velina.getHostMetrics().latest?.rxBytes).toBe(5000);
    });

    it("should stop sampling on dispose", async () => {
      const velina = createVelina(configWith({ loop: loop() }), {
        metricsSource: source,
        metricsIntervalMs: 10,
      });
      velina.startTask("loop");
      await Bun.sleep(80);
      const before = velina.getProcessMetrics(velina.getAllProcesses()[0].id).samples.length;

      velina[Symbol.dispose]();
      await Bun.sleep(80);

      expect(velina.getProcessMetrics(velina.getAllProcesses()[0].id).samples.length).toBe(before);
    });

    it("should reject metrics for an unknown process", () => {
      const velina = createVelina(configWith({}), { metricsSource: source });

      expect(() => velina.getProcessMetrics("missing")).toThrow("Unknown process: missing");
    });

    it("should report unsupported platforms", () => {
      const velina = createVelina(configWith({}), { metricsSource: nullMetricsSource });

      expect(velina.getHostMetrics()).toEqual({ supported: false, latest: null, samples: [] });
    });
  });

  describe("shutdown", () => {
    it("should stop every running process", async () => {
      const velina = createVelina(
        configWith({
          first: evalTask("setInterval(() => {}, 50)"),
          second: evalTask("setInterval(() => {}, 50)"),
        }),
      );

      const first = velina.startTask("first");
      const second = velina.startTask("second");

      await velina.shutdown();

      expect(velina.getProcess(first.id).state).toBe("stopped");
      expect(velina.getProcess(second.id).state).toBe("stopped");
    });
  });

  describe("deleteProcess", () => {
    it("should reject deleting a running process", () => {
      const velina = createVelina(configWith({ loop: evalTask("setInterval(() => {}, 50)") }));

      const process = velina.startTask("loop");

      expect(() => velina.deleteProcess(process.id)).toThrow(
        `Cannot delete running process: ${process.id}`,
      );
    });

    it("should remove a stopped process and its logs", async () => {
      const velina = createVelina(configWith({ greet: evalTask("console.log('hi')") }));

      const process = velina.startTask("greet");
      await waitForState(velina, process.id, "stopped");
      velina.deleteProcess(process.id);

      expect(velina.getAllProcesses()).toEqual([]);
      expect(() => velina.getProcess(process.id)).toThrow(`Unknown process: ${process.id}`);
      expect(() => velina.streamProcessLogs(process.id, "stdout")).toThrow(
        `Unknown process: ${process.id}`,
      );
    });
  });

  describe("labels, kinds and filters", () => {
    const loop = () => evalTask("setInterval(() => {}, 50)");

    it("should store the label and kind of a started process", () => {
      const velina = createVelina(
        configWith({
          build: evalTask("console.log('ok')"),
          clean: evalTask("console.log('clean')"),
        }),
      );

      const run = velina.startTask("build", { label: "benchmark" });
      const hook = velina.startTask("clean", { label: "benchmark", kind: "pre-hook" });

      expect(run.label).toBe("benchmark");
      expect(run.kind).toBe("run");
      expect(hook.label).toBe("benchmark");
      expect(hook.kind).toBe("pre-hook");
    });

    it("should apply the same options to every member of a group", async () => {
      const velina = createVelina(configWith({ a: loop(), b: loop() }, [], { dev: ["a", "b"] }));

      const processes = await velina.startTaskGroup("dev", {
        label: "group-label",
        kind: "post-hook",
      });

      expect(processes).toHaveLength(2);
      expect(processes.every((p) => p.label === "group-label" && p.kind === "post-hook")).toBe(
        true,
      );
    });

    it("should filter processes by label, task and kind", () => {
      const velina = createVelina(configWith({ a: loop(), b: loop(), c: loop() }));
      velina.startTask("a", { label: "x" });
      velina.startTask("b", { label: "y" });
      velina.startTask("c", { label: "x", kind: "pre-hook" });

      expect(
        velina
          .getAllProcesses({ label: "x" })
          .map((p) => p.taskName)
          .sort(),
      ).toEqual(["a", "c"]);
      expect(velina.getAllProcesses({ label: "x", kind: "run" }).map((p) => p.taskName)).toEqual([
        "a",
      ]);
      expect(velina.getAllProcesses({ taskName: "b" }).map((p) => p.label)).toEqual(["y"]);
    });
  });

  describe("waitForProcess", () => {
    it("should resolve with the final details and a duration", async () => {
      const velina = createVelina(configWith({ greet: evalTask("console.log('hi')") }));

      const running = velina.startTask("greet", { label: "benchmark" });
      expect(running.durationMs).toBeUndefined();

      const finished = await velina.waitForProcess(running.id);

      expect(finished.state).toBe("stopped");
      expect(finished.exitCode).toBe(0);
      expect(finished.durationMs).toBeGreaterThanOrEqual(0);
      expect(finished.stoppedAt!).toBeGreaterThanOrEqual(finished.startedAt);
      expect((await velina.waitForProcess(running.id)).durationMs).toBe(finished.durationMs);
    });

    it("should reject an unknown process", async () => {
      const velina = createVelina(configWith({}));

      await expect(velina.waitForProcess("missing")).rejects.toThrow("Unknown process: missing");
    });
  });

  describe("deleteProcesses", () => {
    it("should require at least one filter", () => {
      const velina = createVelina(configWith({}));

      expect(() => velina.deleteProcesses({})).toThrow("requires a label or taskName filter");
    });

    it("should delete stopped matches and skip running ones", async () => {
      const velina = createVelina(
        configWith({
          loop: evalTask("setInterval(() => {}, 50)"),
          quick: evalTask("console.log(1)"),
        }),
      );
      const running = velina.startTask("loop", { label: "cleanup" });
      const finished = velina.startTask("quick", { label: "cleanup" });
      await waitForState(velina, finished.id, "stopped");

      expect(velina.deleteProcesses({ label: "cleanup" })).toBe(1);
      expect(velina.getAllProcesses().map((p) => p.id)).toEqual([running.id]);
      expect(() => velina.getProcess(finished.id)).toThrow("Unknown process");

      await velina.stopProcess(running.id);
      expect(velina.deleteProcesses({ taskName: "loop" })).toBe(1);
      expect(velina.getAllProcesses()).toEqual([]);
    });
  });

  describe("log persistence", () => {
    const tempLogs = (): string => {
      const dir = mkdtempSync(path.join(tmpdir(), "velina-logs-"));
      tempDirs.push(dir);
      return dir;
    };

    function withLogs(tasks: ResolvedConfig["tasks"], dir: string, enabled = true): LoadedConfig {
      const base = configWith(tasks);
      return { ...base, resolved: { ...base.resolved, logs: { enabled, dir } } };
    }

    it("should write separate stdout and stderr files for a finished process", async () => {
      const dir = tempLogs();
      const velina = createVelina(
        withLogs({ greet: evalTask("console.log('out'); console.error('err')") }, dir),
      );

      const running = velina.startTask("greet");
      expect(readdirSync(dir)).toEqual([]);

      const finished = await velina.waitForProcess(running.id);

      expect(finished.logFiles?.stdout).toMatch(/^.*[/\\]greet-[0-9a-f]{8}\.out\.log$/);
      expect(finished.logFiles?.stderr).toMatch(/^.*[/\\]greet-[0-9a-f]{8}\.err\.log$/);
      expect(readFileSync(finished.logFiles!.stdout, "utf8").trim()).toBe("out");
      expect(readFileSync(finished.logFiles!.stderr, "utf8").trim()).toBe("err");
      expect(readdirSync(dir).some((entry) => entry.endsWith(".part"))).toBe(false);
    });

    it("should normalize task names in log file names", async () => {
      const dir = tempLogs();
      const velina = createVelina(
        withLogs({ "apps/frontend:build": evalTask("console.log('ok')") }, dir),
      );

      const finished = await velina.waitForProcess(velina.startTask("apps/frontend:build").id);

      expect(path.basename(finished.logFiles!.stdout)).toMatch(
        /^apps-frontend-build-[0-9a-f]{8}\.out\.log$/,
      );
      expect(path.basename(finished.logFiles!.stderr)).toMatch(
        /^apps-frontend-build-[0-9a-f]{8}\.err\.log$/,
      );
    });

    it("should write nothing when persistence is disabled", async () => {
      const dir = tempLogs();
      const velina = createVelina(withLogs({ greet: evalTask("console.log('out')") }, dir, false));

      const process = velina.startTask("greet");
      const finished = await velina.waitForProcess(process.id);

      expect(readdirSync(dir)).toEqual([]);
      expect(finished.logFiles).toBeUndefined();
    });

    it("should persist more lines than the in-memory buffer keeps", async () => {
      const dir = tempLogs();
      const source = "for (let i = 0; i < 6000; i++) console.log('line ' + i)";
      const velina = createVelina(withLogs({ many: evalTask(source) }, dir));

      const process = velina.startTask("many");
      const finished = await velina.waitForProcess(process.id);
      const lines = readFileSync(finished.logFiles!.stdout, "utf8").trimEnd().split("\n");

      expect(lines).toHaveLength(6000);
      expect(lines.at(-1)).toBe("line 5999");
      expect(await collect(velina.streamProcessLogs(process.id, "stdout"))).toHaveLength(5000);
    });

    it("should remove stale partial files at startup", () => {
      const dir = tempLogs();
      writeFileSync(path.join(dir, "stale.stdout.part"), "unfinished");

      createVelina(withLogs({}, dir));

      expect(readdirSync(dir)).toEqual([]);
    });
  });

  it("should throw when getting an unknown process", () => {
    const velina = createVelina(configWith({}));

    expect(() => velina.getProcess("missing")).toThrow("Unknown process: missing");
  });
});
