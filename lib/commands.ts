import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs as nodeParseArgs } from "node:util";
import * as z from "zod";

import agentDocBody from "#/assets/agent-doc.txt";
import usage from "#/assets/velina-usage.txt";

import { readConfig, zConfig } from "./config";

const AGENT_MARKER_START = "<!-- velina:start -->";
const AGENT_MARKER_END = "<!-- velina:end -->";
const LOG_IGNORE_ENTRY = ".velina/logs/";

const AGENT_DOC = `${AGENT_MARKER_START}\n${agentDocBody.trimEnd()}\n${AGENT_MARKER_END}`;

const STARTER_CONFIG = `# Velina configuration.
# Tasks are discovered automatically from package.json scripts.
# See https://github.com/tkesgar/velina for all options.
port: 2222
`;

const USAGE = usage.trimEnd();

export interface InitOptions {
  cwd?: string;
  agentDoc?: boolean;
}

export interface InitResult {
  configPath: string;
  createdConfig: boolean;
  scriptsAdded: string[];
  agentDoc: "added" | "updated" | "skipped";
  gitignoreUpdated: boolean;
}

function updateGitignore(cwd: string): boolean {
  const gitignorePath = join(cwd, ".gitignore");
  const current = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  if (current.split(/\r?\n/).some((line) => line.trim() === LOG_IGNORE_ENTRY)) return false;

  const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  writeFileSync(gitignorePath, `${current}${separator}${LOG_IGNORE_ENTRY}\n`);
  return true;
}

export async function initProject(opts: InitOptions = {}): Promise<InitResult> {
  const cwd = opts.cwd ?? process.cwd();
  const configPath = join(cwd, ".velina.yml");
  let createdConfig = false;

  if (!existsSync(configPath)) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, STARTER_CONFIG);
    createdConfig = true;
  }

  const scriptsAdded: string[] = [];
  const manifestPath = join(cwd, "package.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = manifest.scripts ?? {};

    for (const [name, command] of [["velina", "velina"]]) {
      if (!(name in scripts)) {
        scripts[name] = command;
        scriptsAdded.push(name);
      }
    }

    manifest.scripts = scripts;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  let agentDoc: InitResult["agentDoc"] = "skipped";
  if (opts.agentDoc) {
    const agentsPath = join(cwd, "AGENTS.md");
    if (existsSync(agentsPath)) {
      const current = readFileSync(agentsPath, "utf8");
      const start = current.indexOf(AGENT_MARKER_START);
      const end = current.indexOf(AGENT_MARKER_END);

      if (start !== -1 && end !== -1) {
        const after = current.slice(end + AGENT_MARKER_END.length);
        writeFileSync(agentsPath, current.slice(0, start) + AGENT_DOC + after);
        agentDoc = "updated";
      } else {
        writeFileSync(agentsPath, `${current.trimEnd()}\n\n${AGENT_DOC}\n`);
        agentDoc = "added";
      }
    }
  }

  const gitignoreUpdated = updateGitignore(cwd);

  return { configPath, createdConfig, scriptsAdded, agentDoc, gitignoreUpdated };
}

export function getConfigSchema(): Record<string, unknown> {
  return z.toJSONSchema(zConfig);
}

export interface CheckResult {
  path: string;
  ok: boolean;
  errors: string[];
}

export async function checkConfig(
  opts: { configPath?: string; cwd?: string } = {},
): Promise<CheckResult> {
  const filePath = resolve(opts.cwd ?? process.cwd(), opts.configPath ?? ".velina.yml");

  try {
    await readConfig({ configPath: opts.configPath, cwd: opts.cwd });
    return { path: filePath, ok: true, errors: [] };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        path: filePath,
        ok: false,
        errors: error.issues.map(
          (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
        ),
      };
    }

    return {
      path: filePath,
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function handleCommand(argv: string[]): Promise<number | undefined> {
  const [command, ...rest] = argv;

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(USAGE);
    return 0;
  }

  if (command === "schema") {
    console.log(JSON.stringify(getConfigSchema(), null, 2));
    return 0;
  }

  if (command === "init") {
    const { values, positionals } = nodeParseArgs({
      args: rest,
      options: {
        "agent-doc": { type: "boolean" },
        json: { type: "boolean" },
        yes: { type: "boolean" },
      },
      allowPositionals: true,
    });

    const cwd = positionals[0] ? resolve(positionals[0]) : process.cwd();
    const result = await initProject({ cwd, agentDoc: values["agent-doc"] });

    if (values.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Initialized Velina in ${cwd}`);
      console.log(
        `  config: ${result.configPath} (${result.createdConfig ? "created" : "exists"})`,
      );
      console.log(
        `  scripts: ${result.scriptsAdded.length ? result.scriptsAdded.join(", ") : "none added"}`,
      );
      console.log(`  AGENTS.md: ${result.agentDoc}`);
      console.log(`  .gitignore: ${result.gitignoreUpdated ? "added logs entry" : "unchanged"}`);
      console.log("Start the server with `velina` and open http://127.0.0.1:2222/ui/");
    }

    return 0;
  }

  if (command === "config" && rest[0] === "check") {
    const { values } = nodeParseArgs({
      args: rest.slice(1),
      options: { "config-path": { type: "string" } },
    });
    const result = await checkConfig({ configPath: values["config-path"] });

    if (result.ok) {
      console.log(`Config is valid: ${result.path}`);
    } else {
      console.error(`Invalid config: ${result.path}`);
      for (const error of result.errors) {
        console.error(`  - ${error}`);
      }
    }

    return result.ok ? 0 : 1;
  }

  return undefined;
}
