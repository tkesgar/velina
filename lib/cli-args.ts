import { parseArgs as nodeParseArgs } from "node:util";

import type { LogType } from "./api";

export type CliCommand =
  | "help"
  | "config"
  | "start"
  | "ps"
  | "process"
  | "logs"
  | "stop"
  | "delete";

export interface CliArgs {
  command: CliCommand;
  format?: "yaml";
  json: boolean;
  logType?: LogType;
  port?: number;
  target?: string;
}

const commands: CliCommand[] = ["config", "start", "ps", "process", "logs", "stop", "delete"];

export function parseCliArgs(argv: string[]): CliArgs {
  const { values, positionals } = nodeParseArgs({
    args: argv,
    options: {
      format: { type: "string" },
      help: { type: "boolean" },
      json: { type: "boolean" },
      port: { type: "string" },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    return { command: "help", json: values.json ?? false };
  }

  const [name, target, logType] = positionals;
  if (!commands.includes(name as CliCommand)) {
    throw new Error(`Unknown command: ${name}`);
  }

  const command = name as CliCommand;
  const args: CliArgs = { command, json: values.json ?? false };

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

  switch (command) {
    case "config":
    case "ps":
      if (target !== undefined) {
        throw new Error(`${command} takes no arguments`);
      }
      break;
    case "start":
    case "process":
    case "stop":
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

  return args;
}
