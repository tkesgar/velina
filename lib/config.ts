import * as z from "zod";
import { YAML } from "bun";
import * as path from "node:path";
import { Eta } from "eta";

const eta = new Eta({ useWith: true });

// Explicitly wrapped resolvables, used to recognize values that should not be
// normalized again by resolveValue.
const zResolvableObject = z.union([
  z.object({
    type: z.literal("value"),
    value: z.unknown(),
  }),
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("cmd"),
    cmd: z.string(),
    args: z.array(z.string()).optional(),
  }),
]);

// Config values may be raw strings, arbitrary values, or wrapped resolvables;
// resolveValue normalizes them at read time.
const zConfigResolvable = z.unknown();

const zConfigFileEntry = z
  .object({
    path: z.string(),
    content: zConfigResolvable,
  })
  .strict();

const zConfigEnv = z.record(z.string(), zConfigResolvable);

export const zConfig = z
  .object({
    port: z.number().int().min(1).max(65535),
    inheritEnv: z.boolean(),
    rootDir: z.string(),
    packageManager: z.string(),
    vars: z.record(z.string(), zConfigResolvable),
    env: zConfigEnv,
    files: z.array(zConfigFileEntry),
    tasks: z.record(
      z.string(),
      z
        .object({
          cmd: z.string(),
          args: z.array(z.string()).optional(),
          cwd: z.string().optional(),
          env: zConfigEnv.optional(),
          files: z.array(zConfigFileEntry).optional(),
        })
        .strict()
        .nullable(),
    ),
  })
  .partial()
  .strict();

export type Config = z.infer<typeof zConfig>;

export const DEFAULT_CONFIG_PATH = ".velina.yml";

export const DEFAULT_PORT = 2222;

export const DEFAULT_PACKAGE_MANAGER = "bun";

export const DEFAULT_INHERIT_ENV = true;

export async function readConfig(
  opts: { configPath?: string; cwd?: string } = {},
): Promise<Config> {
  const { configPath, cwd = process.cwd() } = opts;

  const filePath = path.resolve(cwd, configPath ?? DEFAULT_CONFIG_PATH);
  const file = Bun.file(filePath);

  let yaml: string;
  try {
    yaml = await file.text();
  } catch (error: any) {
    if (error.code === "ENOENT" && !configPath) {
      return {};
    }

    throw error;
  }

  const data = YAML.parse(yaml);
  return zConfig.parse(data ?? {});
}

// === resolve value

type ResolvableValue = z.infer<typeof zResolvableObject>;

function normalizeResolvable(value: unknown): ResolvableValue {
  if (typeof value === "string") {
    return { type: "text", text: value };
  }

  const parsed = zResolvableObject.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  return { type: "value", value };
}

export function resolveValue(
  ctx: { vars?: Record<string, unknown>; env?: Record<string, string> },
  value: unknown,
): unknown {
  const { vars, env } = ctx;
  const r = normalizeResolvable(value);

  switch (r.type) {
    case "value":
      return r.value;
    case "text":
      return eta.renderString(r.text, {
        ...(vars && { vars }),
        ...(env && { env }),
      });
    case "cmd": {
      const proc = Bun.spawnSync([r.cmd, ...(r.args ?? [])]);
      return proc.stdout.toString("utf-8").trim();
    }
  }
}

// === resolve vars

type ConfigVars = NonNullable<Config["vars"]>;

export function resolveVars(
  ctx: { overrideVars?: Record<string, unknown> },
  vars: ConfigVars,
): Record<string, unknown> {
  const { overrideVars } = ctx;

  const resolvedVars: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(vars)) {
    resolvedVars[key] = resolveValue({}, value);
  }

  return Object.assign(resolvedVars, overrideVars);
}

// === resolve env

type ConfigEnv = NonNullable<Config["env"]>;

export function resolveEnv(
  ctx: { vars: Record<string, unknown> },
  env: ConfigEnv,
  opts: {
    parentEnv?: Record<string, string>;
  } = {},
): Record<string, string> {
  const { vars } = ctx;
  const { parentEnv } = opts;

  const resolvedEnv: Record<string, string> = { ...parentEnv };

  for (const [key, value] of Object.entries(env)) {
    if (value === null) {
      delete resolvedEnv[key];
    } else {
      const resolved = resolveValue({ vars, env: parentEnv }, value);

      resolvedEnv[key] = typeof resolved === "string" ? resolved : String(resolved);
    }
  }

  return resolvedEnv;
}

// === resolve files

type ConfigFiles = NonNullable<Config["files"]>;

export function resolveFiles(
  ctx: {
    cwd: string;
    vars: Record<string, unknown>;
    env: Record<string, string>;
  },
  files: ConfigFiles,
): Array<{ path: string; content: string }> {
  const { cwd: rootDir, vars, env } = ctx;

  return files.map((entry) => {
    const filePath = path.join(rootDir, entry.path);

    const resolved = resolveValue({ vars, env }, entry.content);
    const content = typeof resolved === "string" ? resolved : String(resolved);

    return { path: filePath, content };
  });
}

// === scan tasks from package.json

async function scanTasks(ctx: {
  rootDir: string;
  packageManager: string;
  env: Record<string, string>;
}): Promise<ResolvedConfig["tasks"]> {
  const { rootDir, packageManager, env } = ctx;
  const tasks: ResolvedConfig["tasks"] = {};

  const manifestFile = Bun.file(path.join(rootDir, "package.json"));
  if (!(await manifestFile.exists())) {
    return tasks;
  }

  const manifest = await manifestFile.json();

  const addScripts = (
    cwd: string,
    prefix: string,
    scripts: Record<string, unknown> | undefined,
  ) => {
    for (const [name] of Object.entries(scripts ?? {})) {
      tasks[`${prefix}${name}`] = {
        cmd: packageManager,
        args: ["run", name],
        cwd,
        env: { ...env },
        files: [],
      };
    }
  };

  addScripts(rootDir, "", manifest.scripts);

  if (!Array.isArray(manifest.workspaces)) {
    return tasks;
  }

  const included = new Set<string>();
  const excluded = new Set<string>();

  for (const workspace of manifest.workspaces) {
    if (typeof workspace !== "string") continue;

    const negated = workspace.startsWith("!");
    const pattern = negated ? workspace.slice(1) : workspace;
    const glob = new Bun.Glob(path.join(pattern, "package.json").split(path.sep).join("/"));
    const target = negated ? excluded : included;

    for (const match of glob.scanSync({ cwd: rootDir })) {
      target.add(match.split(path.sep).join("/"));
    }
  }

  for (const manifestRelPath of included) {
    if (excluded.has(manifestRelPath)) continue;

    const dirRel = path.posix.dirname(manifestRelPath);
    if (dirRel === ".") continue;

    const cwd = path.join(rootDir, dirRel);
    const pkg = await Bun.file(path.join(cwd, "package.json")).json();
    addScripts(cwd, `${dirRel}:`, pkg.scripts);
  }

  return tasks;
}

// === resolve config

export interface ResolvedConfig {
  port: number;
  vars: Record<string, unknown>;
  env: Record<string, string>;
  files: Array<{
    path: string;
    content: string;
  }>;
  tasks: Record<
    string,
    {
      cmd: string;
      args: string[];
      cwd: string;
      env: Record<string, string>;
      files: Array<{
        path: string;
        content: string;
      }>;
    }
  >;
}

export async function resolveConfig(
  config: Config,
  opts: {
    overrideVars?: Record<string, string>;
  } = {},
): Promise<ResolvedConfig> {
  const { overrideVars = {} } = opts;

  const rootDir = path.resolve(config.rootDir ?? ".");

  const port = config.port ?? DEFAULT_PORT;
  const vars = resolveVars({ overrideVars }, config.vars ?? {});

  const parentEnv =
    (config.inheritEnv ?? DEFAULT_INHERIT_ENV)
      ? Object.fromEntries(
          Object.entries(process.env)
            .map(([key, value]) => [key, value || ""])
            .filter(([, value]) => Boolean(value)),
        )
      : {};

  const env = resolveEnv({ vars }, config.env ?? {}, { parentEnv });

  const files = resolveFiles({ cwd: rootDir, vars, env }, config.files ?? []);

  const tasks: ResolvedConfig["tasks"] = {
    ...(await scanTasks({
      rootDir,
      packageManager: config.packageManager ?? DEFAULT_PACKAGE_MANAGER,
      env,
    })),
  };

  for (const [name, task] of Object.entries(config.tasks ?? {})) {
    if (task === null) {
      delete tasks[name];
    } else {
      tasks[name] = {
        cmd: task.cmd,
        args: task.args ?? [],
        cwd: path.resolve(rootDir, task.cwd ?? "."),
        env: resolveEnv({ vars }, task.env ?? {}, { parentEnv: env }),
        files: resolveFiles({ cwd: rootDir, vars, env }, task.files ?? []),
      };
    }
  }

  return {
    port,
    vars,
    env,
    files,
    tasks,
  };
}

export interface LoadedConfig {
  provided: Config;
  resolved: ResolvedConfig;
}

export async function loadConfig(
  opts: {
    configPath?: string;
    overrideVars?: Record<string, string>;
    cwd?: string;
  } = {},
): Promise<LoadedConfig> {
  const { configPath, overrideVars, cwd } = opts;

  const provided = await readConfig({ configPath, cwd });
  const resolved = await resolveConfig(provided, { overrideVars });
  return { provided, resolved };
}
