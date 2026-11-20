import { parseArgs as nodeParseArgs } from "node:util";

export interface CliArgs {
  configPath?: string;
  dev: boolean;
  vars: Record<string, string>;
}

export function parseArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  const { values } = nodeParseArgs({
    args: argv,
    options: {
      "config-path": { type: "string" },
      dev: { type: "boolean" },
      var: { type: "string", multiple: true },
    },
  });

  if (values["config-path"] === "") {
    throw new Error("Missing value for --config-path");
  }

  const vars: Record<string, string> = {};
  for (const raw of values.var ?? []) {
    const separator = raw.indexOf("=");
    if (separator < 1) {
      throw new Error(`Invalid --var value "${raw}": expected NAME=VALUE`);
    }

    vars[raw.slice(0, separator)] = raw.slice(separator + 1);
  }

  return { configPath: values["config-path"], dev: values.dev ?? false, vars };
}
