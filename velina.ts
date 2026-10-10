import { RpcTarget } from "capnweb";
import path from "node:path";
import fs from "node:fs";
import * as z from "zod";
import { RunManager } from "./run-manager";

type VelinaVar =
  | string
  | { type: "command"; value: string }
  | { type: "script"; value: string };

const configSchema = z.object({
  port: z.number().optional(),
  var: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.object({
          type: z.literal("command"),
          value: z.string(),
        }),
        z.object({
          type: z.literal("script"),
          value: z.string(),
        }),
      ]),
    )
    .optional(),
  env: z.record(
    z.string(),
    z.string().nullable()
  ).optional(),
  apps: z.array(
    z.union([
      z.string(),
      z.object({
        path: z.string(),
        name: z.string().optional(),
        env: z.record(z.string(), z.string().nullable()).optional(),
        scripts: z.record(z.string(), z.string()).optional(),
        files: z.array(
          z.object({
            path: z.string(),
            content: z.string(),
            writeOn: z.union([z.literal('script-run'), z.literal('init')]).optional()
          })
        ).optional()
      })
    ])
  ).optional()
});

export interface PartialVelinaConfig {
  port?: number;
  var?: Record<string, VelinaVar>;
  env?: Record<string, string | null>;
  apps?: Array<string | {
    path: string
    name?: string
    env?: Record<string, string | null>;
    scripts?: Record<string, string>;
    files?: Array<{
      path: string
      content: string
      writeOn?: 'script-run' | 'init'
    }>
  }>
}

export interface VelinaConfig {
  port: number;
  var: Record<string, VelinaVar>;
  env: Record<string, string | null>;
  apps: Array<{
      path: string;
      name: string;
      env: Record<string, string | null>;
      scripts: Record<string, string>;
      files: Array<{
        path: string
        content: string
        writeOn: 'script-run' | 'init'
      }>
    }>;
}

export function readConfigFromFile(configPath: string): PartialVelinaConfig {
  let yaml: string;
  try {
    yaml = fs.readFileSync(configPath, "utf-8");
  } catch (error) {
    throw new Error(`Failed to read config file from ${configPath}`, { cause: error });
  }

  let data: unknown
  try {
    data = Bun.YAML.parse(yaml);
  } catch (error) {
    throw new Error(`Failed to parse YAML from config file: ${configPath}`, { cause: error })
  }

  try {
    return configSchema.parse(data);
  } catch (error) {
    throw new Error(`Configuration does not match schema`, { cause: error });
  }
}

export function resolveConfig(
  opts: {
    partialConfig?: PartialVelinaConfig;
    cwd: string;
  },
) {
  const {
    partialConfig,
    cwd,
  } = opts

  const resolvedConfig: VelinaConfig = {
    port: Number(Bun.env.PORT) || partialConfig?.port || 2209,
    var: partialConfig?.var || {},
    env: partialConfig?.env || {},
    apps: (partialConfig?.apps ?? []).map(partialApp => {
      if (typeof partialApp === 'string') {
        return {
          path: partialApp,
          name: path.basename(partialApp),
          env: {},
          scripts: {},
          files: []
        }
      }

      return {
        path: partialApp.path,
        name: partialApp.name || path.basename(partialApp.path),
        scripts: { ...(partialApp.scripts ?? {}) },
        env: { ...(partialApp.env ?? {}) },
        files: (partialApp.files ?? []).map(file => {
          return {
            ...file,
            writeOn: file.writeOn ?? 'script-run'
          }
        })
      }
    })
  };

  const appsDir = path.join(cwd, './apps');

  if (Object.keys(resolvedConfig.apps).length === 0) {
    const stat = fs.statSync(appsDir, { throwIfNoEntry: false })
    if (stat?.isDirectory()) {
      const entries = fs.readdirSync(appsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue
        }

        const appPath = path.join(appsDir, entry.name);
        resolvedConfig.apps.push({
          path: appPath,
          name: path.basename(appPath),
          scripts: {},
          env: {},
          files: []
        })
      }
    }
  }

  for (const app of resolvedConfig.apps) {
    if (Object.entries(app.scripts).length === 0) {
      try {
        const json = fs.readFileSync(path.join(app.path, 'package.json'), 'utf-8')
        const { scripts } = JSON.parse(json);
        for (const [name, command] of Object.entries(scripts)) {
          if (name.startsWith('pre') || name.startsWith('post')) {
            continue
          }

          if (typeof command !== 'string') {
            continue
          }

          app.scripts[name] = command;
        }
      } catch (error) {
        // TODO Skip if error is file does not exist
        console.warn(error);
        // do nothing (keep app.scripts empty)
      }
    }
  }

  return {
    partial: partialConfig,
    resolved: resolvedConfig,
  };
}

export class Velina {
  readonly runs: RunManager;
  readonly config: {
    cwd: string
    path: string
    partial: PartialVelinaConfig | null
    resolved: VelinaConfig
  }

  constructor(opts: {
    cwd?: string
    configFile?: string
  } = {}) {
    const {
      cwd = process.cwd(),
      configFile = './.velina.yml',
    } = opts

    const configPath = path.join(cwd, configFile)

    let configFromFile: PartialVelinaConfig | undefined = undefined
    try {
      configFromFile = readConfigFromFile(configPath)
    } catch (error: any) {
      if (error.cause.code !== 'ENOENT') {
        throw error
      }

      // Do nothing (file does not exist)
    }

    const { partial, resolved } = resolveConfig({
      cwd,
      partialConfig: configFromFile,
    })

    this.config = {
      cwd,
      path: configPath,
      partial: partial || null,
      resolved,
    }
    this.runs = new RunManager(cwd, resolved)
  }
}

export class VelinaApi extends RpcTarget {
  readonly velina: Velina

  constructor(velina: Velina) {
    super()
    this.velina = velina;
  }

  getConfig() {
    return this.velina.config;
  }

  getRuns() {
    return this.velina.runs.listRuns();
  }

  startRun(appIndex: number, scriptName: string) {
    return this.velina.runs.startRun(appIndex, scriptName);
  }

  watchRun(runId: string) {
    return this.velina.runs.watchRun(runId);
  }

  stopRun(runId: string) {
    return this.velina.runs.stopRun(runId);
  }

  cleanRun(runId: string) {
    return this.velina.runs.cleanRun(runId);
  }

  cleanFinishedRuns() {
    return this.velina.runs.cleanFinishedRuns();
  }
}
