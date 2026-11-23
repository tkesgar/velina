import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { Subprocess } from "bun";

const projectRoot = path.resolve(import.meta.dir, "..");

let tempDir: string;
let port: number;
let server: Subprocess | undefined;
let childPid = 0;

function findFreePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const freePort = probe.port;
  probe.stop(true);

  if (!freePort) throw new Error("Could not find a free port");
  return freePort;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, message: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await Bun.sleep(20);
  }

  throw new Error(message);
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

  throw new Error("Server did not start");
}

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), "velina-shutdown-test-"));
  port = findFreePort();
  const pidFile = path.join(tempDir, "child.pid");

  writeFileSync(
    path.join(tempDir, "velina.json"),
    JSON.stringify({
      port,
      tasks: {
        sleeper: {
          cmd: process.execPath,
          args: [
            "-e",
            `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`,
          ],
          cwd: projectRoot,
          env: {},
          files: [],
        },
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
    stdout: "pipe",
    stderr: "pipe",
  });

  await waitForServer();

  const started = Bun.spawnSync({
    cmd: [
      process.execPath,
      path.join(projectRoot, "velina-cli.ts"),
      "start",
      "sleeper",
      "--port",
      String(port),
    ],
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(started.exitCode).toBe(0);

  await waitFor(() => existsSync(pidFile), "Child process did not write its pid");
  childPid = Number(readFileSync(pidFile, "utf8").trim());
});

afterAll(async () => {
  if (server && server.exitCode === null) server.kill("SIGKILL");
  await server?.exited.catch(() => {});
  if (childPid && alive(childPid)) process.kill(childPid, "SIGKILL");
  rmSync(tempDir, { recursive: true, force: true });
});

describe("graceful shutdown", () => {
  it("stops child processes before exiting on SIGTERM", async () => {
    expect(alive(childPid)).toBe(true);

    server!.kill("SIGTERM");
    const exitCode = await server!.exited;

    expect(exitCode).toBe(0);
    expect(alive(childPid)).toBe(false);
  });
});
