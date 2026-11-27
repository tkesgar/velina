import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { checkConfig, getConfigSchema, initProject } from "./commands";

const tempDirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "velina-commands-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe("initProject", () => {
  it("should create a starter config and package scripts", async () => {
    const cwd = makeDir();
    writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "example" }));

    const result = await initProject({ cwd });

    expect(result.createdConfig).toBe(true);
    expect(result.scriptsAdded).toEqual(["velina"]);
    expect(existsSync(result.configPath)).toBe(true);
    expect(readFileSync(result.configPath, "utf8")).toContain("port: 2222");

    const manifest = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"));
    expect(manifest.scripts).toEqual({ velina: "velina" });
  });

  it("should leave existing config and scripts untouched", async () => {
    const cwd = makeDir();
    writeFileSync(path.join(cwd, ".velina.yml"), "port: 3333\n");
    writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({ scripts: { velina: "custom command", build: "tsc" } }),
    );

    const result = await initProject({ cwd });

    expect(result.createdConfig).toBe(false);
    expect(result.scriptsAdded).toEqual([]);
    expect(readFileSync(path.join(cwd, ".velina.yml"), "utf8")).toBe("port: 3333\n");

    const manifest = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"));
    expect(manifest.scripts.velina).toBe("custom command");
    expect(manifest.scripts.build).toBe("tsc");
  });

  it("should add an AGENTS.md pointer only when the file exists", async () => {
    const cwd = makeDir();
    const agentsPath = path.join(cwd, "AGENTS.md");
    writeFileSync(agentsPath, "# Instructions\n");

    const first = await initProject({ cwd, agentDoc: true });
    expect(first.agentDoc).toBe("added");

    const content = readFileSync(agentsPath, "utf8");
    expect(content).toContain("## Velina");
    expect(content).toContain("http://127.0.0.1:2222/ui/");

    const second = await initProject({ cwd, agentDoc: true });
    expect(second.agentDoc).toBe("updated");
    expect(readFileSync(agentsPath, "utf8").match(/## Velina/g)).toHaveLength(1);
  });

  it("should skip the AGENTS.md pointer when the file does not exist", async () => {
    const cwd = makeDir();

    const result = await initProject({ cwd, agentDoc: true });

    expect(result.agentDoc).toBe("skipped");
    expect(existsSync(path.join(cwd, "AGENTS.md"))).toBe(false);
  });

  it("should add the log ignore entry once and preserve existing content", async () => {
    const cwd = makeDir();
    const ignorePath = path.join(cwd, ".gitignore");
    writeFileSync(ignorePath, "node_modules/\n");

    const first = await initProject({ cwd });
    expect(first.gitignoreUpdated).toBe(true);
    expect(readFileSync(ignorePath, "utf8")).toBe("node_modules/\n.velina/logs/\n");

    const second = await initProject({ cwd });
    expect(second.gitignoreUpdated).toBe(false);
    expect(readFileSync(ignorePath, "utf8")).toBe("node_modules/\n.velina/logs/\n");
  });

  it("should create a gitignore when none exists", async () => {
    const cwd = makeDir();

    const result = await initProject({ cwd });

    expect(result.gitignoreUpdated).toBe(true);
    expect(readFileSync(path.join(cwd, ".gitignore"), "utf8")).toBe(".velina/logs/\n");
  });
});

describe("getConfigSchema", () => {
  it("should expose the config shape as JSON Schema", () => {
    const schema = getConfigSchema() as {
      type: string;
      properties: Record<string, { minimum?: number; maximum?: number }>;
      additionalProperties: boolean;
    };

    expect(schema.type).toBe("object");
    expect(schema.properties.port.minimum).toBe(1);
    expect(schema.properties.port.maximum).toBe(65535);
    expect(schema.properties.logs).toBeDefined();
    expect(schema.additionalProperties).toBe(false);
  });
});

describe("checkConfig", () => {
  it("should accept a valid config", async () => {
    const cwd = makeDir();
    writeFileSync(path.join(cwd, ".velina.yml"), "port: 3333\n");

    const result = await checkConfig({ cwd });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("should report validation errors", async () => {
    const cwd = makeDir();
    writeFileSync(path.join(cwd, ".velina.yml"), 'port: "3333"\n');

    const result = await checkConfig({ cwd });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("port");
  });

  it("should report an explicitly provided missing config", async () => {
    const cwd = makeDir();

    const result = await checkConfig({ cwd, configPath: "missing.yml" });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("missing.yml");
  });
});
