import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import type { LogEntry, ProcessState } from "./api";
import type { LoadedConfig, ResolvedConfig } from "./config";
import { Velina } from "./velina";

const instances: Velina[] = [];
const tempDirs: string[] = [];

function createVelina(config: LoadedConfig): Velina {
  const velina = new Velina(config);
  instances.push(velina);
  return velina;
}

function configWith(
  tasks: ResolvedConfig["tasks"],
  files: ResolvedConfig["files"] = [],
): LoadedConfig {
  return {
    provided: {},
    resolved: { port: 2222, vars: {}, env: {}, files, tasks },
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

  it("should throw when getting an unknown process", () => {
    const velina = createVelina(configWith({}));

    expect(() => velina.getProcess("missing")).toThrow("Unknown process: missing");
  });
});
