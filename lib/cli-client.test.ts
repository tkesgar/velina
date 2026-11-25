import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import type { ProcessInfo, VelinaApi } from "./api";
import { DEFAULT_PORT } from "./config";
import { formatLogLine, resolvePort, resolveProcessId } from "./cli-client";

function processInfo(id: string, taskName = "greet"): ProcessInfo {
  return {
    id,
    taskName,
    state: "running",
    startedAt: 1,
    cmd: "bun",
    args: [],
    cwd: "/tmp",
    metrics: null,
  };
}

function fakeApi(processes: ProcessInfo[]): VelinaApi {
  return { getAllProcesses: () => processes } as unknown as VelinaApi;
}

describe("resolvePort", () => {
  it("should prefer an explicit port", async () => {
    expect(await resolvePort({ port: 3333 })).toBe(3333);
  });

  it("should read the port from a local config", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "velina-cli-client-"));
    try {
      writeFileSync(path.join(cwd, ".velina.yml"), "port: 4444\n");
      expect(await resolvePort({ cwd })).toBe(4444);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("should fall back to the default port", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "velina-cli-client-"));
    try {
      expect(await resolvePort({ cwd })).toBe(DEFAULT_PORT);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("resolveProcessId", () => {
  const processes = [
    processInfo("aaa11111-1111-1111-1111-111111111111"),
    processInfo("bbb22222-2222-2222-2222-222222222222"),
  ];

  it("should resolve an exact id", async () => {
    expect(await resolveProcessId(fakeApi(processes), processes[0].id)).toBe(processes[0].id);
  });

  it("should resolve a unique prefix", async () => {
    expect(await resolveProcessId(fakeApi(processes), "aaa1")).toBe(processes[0].id);
  });

  it("should reject unknown and ambiguous ids", async () => {
    await expect(resolveProcessId(fakeApi(processes), "zzz")).rejects.toThrow("Unknown process");
    await expect(resolveProcessId(fakeApi(processes), "")).rejects.toThrow("Ambiguous process id");
  });
});

describe("formatLogLine", () => {
  it("should include the timestamp and line", () => {
    const line = formatLogLine({ type: "stdout", line: "hello", timestamp: 0 });
    expect(line).toContain("1970-01-01T00:00:00.000Z");
    expect(line).toContain("hello");
  });
});
