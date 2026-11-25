import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { Subprocess } from "bun";

import type { ProcessInfo } from "../lib/api";
import { DEFAULT_PORT } from "../lib/config";

const projectRoot = path.resolve(import.meta.dir, "..");

let tempDir: string;
let port: number;
let server: Subprocess | undefined;
let serverLog = "";
let serverOut = "";

function findFreePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const freePort = probe.port;
  probe.stop(true);

  if (!freePort) throw new Error("Could not find a free port");
  return freePort;
}

function cli(...args: string[]) {
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      path.join(projectRoot, "velina-cli.ts"),
      ...args,
      "--port",
      String(port),
    ],
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.status === 404) return;
    } catch {
      // Not listening yet.
    }

    await Bun.sleep(20);
  }

  throw new Error(`Server did not start: ${serverLog}`);
}

async function waitForBanner(): Promise<void> {
  for (let i = 0; i < 100 && !serverOut.includes("Velina is running"); i++) {
    await Bun.sleep(20);
  }
}

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), "velina-cli-test-"));
  port = findFreePort();

  writeFileSync(
    path.join(tempDir, "velina.json"),
    JSON.stringify({
      port,
      tasks: {
        greet: {
          cmd: process.execPath,
          args: ["-e", "console.log('cli hello'); setInterval(() => {}, 50)"],
          cwd: projectRoot,
          env: {},
          files: [],
        },
      },
      taskGroup: {
        greeters: ["greet"],
      },
    }),
  );

  server = Bun.spawn({
    cmd: [
      process.execPath,
      path.join(projectRoot, "velina.ts"),
      "--config-path",
      path.join(tempDir, "velina.json"),
    ],
    cwd: projectRoot,
    env: { ...process.env, VELINA_BANNER: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = server?.stdout;
  if (stdout && typeof stdout !== "number") {
    void (async () => {
      const reader = stdout.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        serverOut += decoder.decode(value, { stream: true });
      }
    })();
  }

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
});

afterAll(async () => {
  server?.kill();
  await server?.exited.catch(() => {});
  rmSync(tempDir, { recursive: true, force: true });
});

describe("velina-cli", () => {
  it("prints the startup banner instead of Bun's startup line", async () => {
    await waitForBanner();

    expect(serverOut).toContain(`Velina is running on port ${port}`);
    expect(serverOut).toContain(`http://127.0.0.1:${port}/ui/`);
    expect(serverOut).toContain("velina-cli ps");
    if (port !== DEFAULT_PORT) expect(serverOut).toContain(`--port ${port}`);
    expect(serverOut).not.toContain("Started server:");
  });

  it("redirects browser requests for unknown paths to the UI", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/does-not-exist`, {
      headers: { accept: "text/html,application/xhtml+xml" },
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`http://127.0.0.1:${port}/ui/`);
  });

  it("returns 404 for unknown non-browser requests", async () => {
    const json = await fetch(`http://127.0.0.1:${port}/does-not-exist`, {
      headers: { accept: "application/json" },
    });
    expect(json.status).toBe(404);
    expect(await json.text()).toBe("Not found");

    const plain = await fetch(`http://127.0.0.1:${port}/does-not-exist`);
    expect(plain.status).toBe(404);
  });

  it("should print usage for --help", () => {
    const result = cli("--help");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
  });

  it("should return the config as JSON", () => {
    const result = cli("config");

    expect(result.exitCode).toBe(0);
    const config = JSON.parse(result.stdout);
    expect(config.resolved.port).toBe(port);
  });

  it("should return the config as YAML", () => {
    const result = cli("config", "--format", "yaml");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`port: ${port}`);
  });

  it("should manage a process through its full lifecycle", () => {
    const started = cli("start", "greet");
    expect(started.exitCode).toBe(0);

    const process = JSON.parse(started.stdout) as ProcessInfo;
    expect(process.state).toBe("running");

    const metrics = cli("metrics", process.id.slice(0, 8));
    expect(metrics.exitCode).toBe(0);
    expect(JSON.parse(metrics.stdout).processId).toBe(process.id);

    const all = cli("ps");
    expect(all.exitCode).toBe(0);
    expect((JSON.parse(all.stdout) as ProcessInfo[]).map((p) => p.id)).toContain(process.id);

    const detail = cli("process", process.id.slice(0, 8));
    expect(detail.exitCode).toBe(0);
    expect((JSON.parse(detail.stdout) as ProcessInfo).id).toBe(process.id);

    const stopped = cli("stop", process.id.slice(0, 8));
    expect(stopped.exitCode).toBe(0);
    expect((JSON.parse(stopped.stdout) as ProcessInfo).state).toBe("stopped");

    const logs = cli("logs", process.id.slice(0, 8), "stdout", "--json");
    expect(logs.exitCode).toBe(0);
    expect(logs.stdout).toContain("cli hello");
    expect(JSON.parse(logs.stdout.trim().split("\n")[0]).line).toBe("cli hello");

    const deleted = cli("delete", process.id.slice(0, 8));
    expect(deleted.exitCode).toBe(0);
    expect(JSON.parse(deleted.stdout)).toEqual({ deleted: process.id });

    const remaining = cli("ps");
    expect((JSON.parse(remaining.stdout) as ProcessInfo[]).map((p) => p.id)).not.toContain(
      process.id,
    );
  });

  it("should manage a task group through the CLI", () => {
    const listed = cli("groups");
    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout)).toEqual([{ name: "greeters", tasks: ["greet"] }]);

    const started = cli("start-group", "greeters");
    expect(started.exitCode).toBe(0);
    const processes = JSON.parse(started.stdout) as ProcessInfo[];
    expect(processes.map((process) => process.taskName)).toEqual(["greet"]);
    expect(processes[0].state).toBe("running");

    const stopped = cli("stop-group", "greeters");
    expect(stopped.exitCode).toBe(0);
    expect((JSON.parse(stopped.stdout) as ProcessInfo[])[0].state).toBe("stopped");

    const deleted = cli("delete", processes[0].id);
    expect(deleted.exitCode).toBe(0);
  });

  it("should exit with code 2 on a usage error", () => {
    const result = cli("unknown");

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown command");
  });
});
