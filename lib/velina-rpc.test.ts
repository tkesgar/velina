import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { newHttpBatchRpcSession, newWebSocketRpcSession, type RpcStub } from "capnweb";
import type { Subprocess } from "bun";

import { isYamlConfig, type LogEntry, type ProcessKind, type VelinaApi } from "./api";

const projectRoot = path.join(import.meta.dir, "..");

let tempDir: string;
let port: number;
let server: Subprocess | undefined;
let api: RpcStub<VelinaApi>;
let serverLog = "";

function findFreePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const freePort = probe.port;
  probe.stop(true);

  if (!freePort) throw new Error("Could not find a free port");
  return freePort;
}

async function expectRejection(call: unknown, message: string): Promise<void> {
  let error: unknown;
  try {
    await Promise.resolve(call);
  } catch (caught) {
    error = caught;
  }

  expect(error).toBeDefined();
  expect(String(error)).toContain(message);
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.status === 404) return;
    } catch {
      // The server has not started listening yet.
    }

    await Bun.sleep(20);
  }

  throw new Error(`Server did not start: ${serverLog}`);
}

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), "velina-rpc-"));
  port = findFreePort();

  const configPath = path.join(tempDir, "velina.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      port,
      logs: { enabled: false },
      tasks: {
        greet: {
          cmd: process.execPath,
          args: ["-e", "console.log('hello rpc'); console.error('error rpc')"],
          cwd: projectRoot,
          env: {},
          files: [],
        },
        loop: {
          cmd: process.execPath,
          args: ["-e", "setInterval(() => {}, 50)"],
          cwd: projectRoot,
          env: {},
          files: [],
        },
      },
      taskGroup: {
        loops: ["loop"],
      },
    }),
  );

  server = Bun.spawn({
    cmd: [process.execPath, path.join(projectRoot, "velina.ts"), "--config-path", configPath],
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = server?.stderr;
  if (stderr && typeof stderr !== "number") {
    void (async () => {
      const reader = stderr.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        serverLog += decoder.decode(value, { stream: true });
      }
    })();
  }

  await waitForServer();
  api = newWebSocketRpcSession<VelinaApi>(`ws://127.0.0.1:${port}/api`);
});

afterAll(async () => {
  api?.[Symbol.dispose]();
  server?.kill();
  await server?.exited.catch(() => {});
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Velina RPC", () => {
  it("should return the provided and resolved config over WebSocket", async () => {
    const config = await api.getConfig();
    if (isYamlConfig(config)) throw new Error("Expected object config");

    expect(config.provided).toEqual({
      port,
      logs: { enabled: false },
      tasks: expect.any(Object),
      taskGroup: { loops: ["loop"] },
    });
    expect(config.resolved.port).toBe(port);
    expect(Object.keys(config.resolved.tasks)).toContain("greet");
  });

  it("should return the config as YAML over RPC", async () => {
    const config = await api.getConfig({ format: "yaml" });
    if (!isYamlConfig(config)) throw new Error("Expected YAML config");

    expect(config.provided).toContain("port:");
    expect(config.resolved).toContain("port:");
  });

  it("should start a task, stream its logs, then stop and delete it", async () => {
    const process = await api.startTask("greet");

    expect(process.state).toBe("running");
    expect(process.taskName).toBe("greet");
    expect((await api.getAllProcesses()).map((entry) => entry.id)).toContain(process.id);
    expect((await api.getProcess(process.id)).id).toBe(process.id);

    const stdout: LogEntry[] = [];
    for await (const entry of await api.streamProcessLogs(process.id, "stdout")) {
      stdout.push(entry);
    }
    expect(stdout.map((entry) => entry.line)).toEqual(["hello rpc"]);

    const stopped = await api.stopProcess(process.id);
    expect(stopped.state).toBe("stopped");

    api.deleteProcess(process.id);
    expect((await api.getAllProcesses()).map((entry) => entry.id)).not.toContain(process.id);
  });

  it("should reject starting the same task twice", async () => {
    const first = await api.startTask("loop");
    try {
      await expectRejection(api.startTask("loop"), "already running");
    } finally {
      await api.stopProcess(first.id);
      api.deleteProcess(first.id);
    }
  });

  it("should list task groups over RPC", async () => {
    const groups = await api.getAllTaskGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("loops");
    expect(groups[0].tasks).toEqual(["loop"]);
  });

  it("should start and stop a task group over RPC", async () => {
    const processes = await api.startTaskGroup("loops");
    expect(processes.map((process) => process.taskName)).toEqual(["loop"]);

    try {
      const stopped = await api.stopTaskGroup("loops");
      expect(stopped).toHaveLength(1);
      expect(stopped[0].state).toBe("stopped");
    } finally {
      for (const process of await api.getAllProcesses()) {
        if (process.taskName !== "loop") continue;
        await api.stopProcess(process.id);
        api.deleteProcess(process.id);
      }
    }
  });

  it("should return host and process metrics over RPC", async () => {
    const host = await api.getHostMetrics();
    expect(host.supported).toBe(true);

    const process = await api.startTask("loop");
    try {
      await Bun.sleep(1100);
      const metrics = await api.getProcessMetrics(process.id);
      expect(metrics.processId).toBe(process.id);
      expect(metrics.samples.length).toBeGreaterThan(0);
      expect(metrics.latest).not.toBeNull();
    } finally {
      await api.stopProcess(process.id);
      api.deleteProcess(process.id);
    }
  });

  it("should validate arguments at the RPC boundary", async () => {
    await expectRejection(api.startTask(42 as unknown as string), "expected string");
    await expectRejection(api.getProcessMetrics(42 as unknown as string), "expected string");
    await expectRejection(api.startTaskGroup(42 as unknown as string), "expected string");
    await expectRejection(api.stopTaskGroup(42 as unknown as string), "expected string");
  });

  it("should support labels, filters and waiting over RPC", async () => {
    const process = await api.startTask("greet", { label: "rpc-label", kind: "run" });
    try {
      expect(process.label).toBe("rpc-label");
      expect(process.kind).toBe("run");
      expect((await api.getAllProcesses({ label: "rpc-label" })).map((p) => p.id)).toEqual([
        process.id,
      ]);
      expect((await api.getAllProcesses({ label: "missing-label" })).length).toBe(0);

      const finished = await api.waitForProcess(process.id);
      expect(finished.state).toBe("stopped");
      expect(finished.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await api.stopProcess(process.id);
      api.deleteProcesses({ label: "rpc-label" });
    }
  });

  it("should validate options for the new methods at the RPC boundary", async () => {
    await expectRejection(api.startTask("greet", { label: 42 as unknown as string }), "string");
    await expectRejection(
      api.getAllProcesses({ kind: "unknown" as ProcessKind }),
      "expected one of",
    );
    await expectRejection(api.deleteProcesses({}), "requires a label or taskName filter");
  });

  it("should answer HTTP batch calls", async () => {
    const batch = newHttpBatchRpcSession<VelinaApi>(`http://127.0.0.1:${port}/api`);

    const config = await batch.getConfig();
    if (isYamlConfig(config)) throw new Error("Expected object config");

    expect(config.resolved.port).toBe(port);
  });

  it("should answer HTTP batch calls for task groups", async () => {
    const batch = newHttpBatchRpcSession<VelinaApi>(`http://127.0.0.1:${port}/api`);
    const groups = await batch.getAllTaskGroups();

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("loops");
    expect(groups[0].tasks).toEqual(["loop"]);
  });
});
