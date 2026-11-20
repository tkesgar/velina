import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { newHttpBatchRpcSession, newWebSocketRpcSession, type RpcStub } from "capnweb";
import type { Subprocess } from "bun";

import { isYamlConfig, type LogEntry, type VelinaApi } from "./api";

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

    expect(config.provided).toEqual({ port, tasks: expect.any(Object) });
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

  it("should validate arguments at the RPC boundary", async () => {
    await expectRejection(api.startTask(42 as unknown as string), "expected string");
  });

  it("should answer HTTP batch calls", async () => {
    const batch = newHttpBatchRpcSession<VelinaApi>(`http://127.0.0.1:${port}/api`);

    const config = await batch.getConfig();
    if (isYamlConfig(config)) throw new Error("Expected object config");

    expect(config.resolved.port).toBe(port);
  });
});
