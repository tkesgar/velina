import { parseArgs as nodeParseArgs } from "node:util";

import type { LogType, ProcessKind } from "./api";

export type CliCommand =
  | "help"
  | "config"
  | "groups"
  | "start"
  | "start-group"
  | "ps"
  | "process"
  | "metrics"
  | "logs"
  | "stop"
  | "stop-group"
  | "delete"
  | "cleanup"
  | "bench";

export interface CliArgs {
  command: CliCommand;
  format?: "yaml";
  json: boolean;
  logType?: LogType;
  port?: number;
  target?: string;
  label?: string;
  taskFilter?: string;
  kindFilter?: ProcessKind;
  repeat?: number;
  preHook?: string;
  postHook?: string;
  waitSeconds?: number;
}

const commands: CliCommand[] = [
  "config",
  "groups",
  "start",
  "start-group",
  "ps",
  "process",
  "metrics",
  "logs",
  "stop",
  "stop-group",
  "delete",
  "cleanup",
  "bench",
];

// Flags are scoped to a few commands so a typo such as `ps --repeat 5` fails
// loudly instead of being silently ignored.
const optionScope: Record<string, CliCommand[]> = {
  label: ["start", "start-group", "bench", "ps", "cleanup"],
  task: ["ps", "cleanup"],
  kind: ["ps"],
  repeat: ["bench"],
  "pre-hook": ["bench"],
  "post-hook": ["bench"],
  wait: ["bench"],
};

const processKinds: ProcessKind[] = ["run", "pre-hook", "post-hook"];

function readString(
  values: Record<string, string | boolean | undefined>,
  key: string,
): string | undefined {
  const value = values[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid --${key}: expected a non-empty string`);
  }
  return value;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const { values: rawValues, positionals } = nodeParseArgs({
    args: argv,
    options: {
      format: { type: "string" },
      help: { type: "boolean" },
      json: { type: "boolean" },
      port: { type: "string" },
      label: { type: "string" },
      task: { type: "string" },
      kind: { type: "string" },
      repeat: { type: "string" },
      "pre-hook": { type: "string" },
      "post-hook": { type: "string" },
      wait: { type: "string" },
    },
    allowPositionals: true,
  });

  const values = rawValues as Record<string, string | boolean | undefined>;

  if (values.help || positionals.length === 0) {
    return { command: "help", json: values.json === true };
  }

  const [name, target, logType] = positionals;
  if (!commands.includes(name as CliCommand)) {
    throw new Error(`Unknown command: ${name}`);
  }

  const command = name as CliCommand;
  const args: CliArgs = { command, json: values.json === true };

  for (const [flag, allowed] of Object.entries(optionScope)) {
    if (values[flag] === undefined) continue;
    if (!allowed.includes(command)) {
      throw new Error(`--${flag} is only valid for ${allowed.join(", ")}`);
    }
  }

  if (values.port !== undefined) {
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Invalid --port: expected an integer between 1 and 65535");
    }
    args.port = port;
  }

  if (values.format !== undefined) {
    if (values.format !== "yaml") {
      throw new Error("Invalid --format: expected yaml");
    }
    if (command !== "config") {
      throw new Error("--format is only valid for config");
    }
    args.format = "yaml";
  }

  const label = readString(values, "label");
  if (label !== undefined) args.label = label;

  const taskFilter = readString(values, "task");
  if (taskFilter !== undefined) args.taskFilter = taskFilter;

  const kind = readString(values, "kind");
  if (kind !== undefined) {
    if (!processKinds.includes(kind as ProcessKind)) {
      throw new Error(`Invalid --kind: expected ${processKinds.join(", ")}`);
    }
    args.kindFilter = kind as ProcessKind;
  }

  const repeat = readString(values, "repeat");
  if (repeat !== undefined) {
    const parsed = Number(repeat);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      throw new Error("Invalid --repeat: expected an integer between 1 and 100");
    }
    args.repeat = parsed;
  }

  const wait = readString(values, "wait");
  if (wait !== undefined) {
    const parsed = Number(wait);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 3600) {
      throw new Error("Invalid --wait: expected a number of seconds between 0 and 3600");
    }
    args.waitSeconds = parsed;
  }

  const preHook = readString(values, "pre-hook");
  if (preHook !== undefined) args.preHook = preHook;

  const postHook = readString(values, "post-hook");
  if (postHook !== undefined) args.postHook = postHook;

  switch (command) {
    case "config":
    case "groups":
    case "ps":
    case "cleanup":
      if (target !== undefined) {
        throw new Error(`${command} takes no arguments`);
      }
      break;
    case "start":
    case "start-group":
    case "bench":
    case "process":
    case "metrics":
    case "stop":
    case "stop-group":
    case "delete":
      if (!target) {
        throw new Error(`Missing argument for ${command}`);
      }
      args.target = target;
      break;
    case "logs":
      if (!target) {
        throw new Error("Missing process id for logs");
      }
      args.target = target;
      if (logType !== undefined) {
        if (logType !== "stdout" && logType !== "stderr") {
          throw new Error("Invalid log type: expected stdout or stderr");
        }
        args.logType = logType;
      }
      break;
  }

  if (command === "bench") {
    if (args.preHook === args.target) {
      throw new Error("--pre-hook must be a different task from the measured task");
    }
    if (args.postHook === args.target) {
      throw new Error("--post-hook must be a different task from the measured task");
    }
  }

  if (command === "cleanup" && args.label === undefined && args.taskFilter === undefined) {
    throw new Error("cleanup requires --label or --task");
  }

  return args;
}
