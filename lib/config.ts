import * as z from "zod";
import { YAML } from "bun";
import * as path from "node:path";
import { Eta } from "eta";

import { isGlobKey, isNegatedKey, matchesGlob, matchesTaskGlob } from "./glob";

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

const zConfigEnv = z
  .record(z.string(), zConfigResolvable)
  .superRefine((env, ctx) => {
    for (const [key, value] of Object.entries(env)) {
      if (!isGlobKey(key)) continue;

      if (isNegatedKey(key)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "negated glob keys are only supported for tasks",
        });
      } else if (value !== null) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "glob keys must have a null value",
        });
      }
    }
  })
  .describe("Environment values; wildcard keys delete matching variables.");

const zConfigTaskCwd = z.union([
  z.string(),
  z.array(z.string()).min(1, "cwd must have at least one entry"),
  z
    .record(z.string(), z.string())
    .refine((cwd) => Object.keys(cwd).length > 0, "cwd must have at least one entry"),
]);

const zConfigTaskGroupMembers = z.array(z.string()).min(1);

const zConfigTaskGroup = z.union([
  zConfigTaskGroupMembers,
  z.object({ tasks: zConfigTaskGroupMembers }).strict(),
]);

const zConfigTasks = z
  .record(
    z.string(),
    z
      .object({
        cmd: z.string(),
        args: z.array(z.string()).optional(),
        cwd: zConfigTaskCwd.optional(),
        env: zConfigEnv.optional(),
        files: z.array(zConfigFileEntry).optional(),
      })
      .strict()
      .nullable(),
  )
  .superRefine((tasks, ctx) => {
    for (const [key, task] of Object.entries(tasks)) {
      if (isGlobKey(key) && task !== null) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "glob keys must have a null value",
        });
      }
    }
  })
  .describe("Task definitions; wildcard keys with null values delete tasks.");

export const zConfig = z
  .object({
    port: z.number().int().min(1).max(65535),
    inheritEnv: z.boolean(),
    rootDir: z.string(),
    packageManager: z.string(),
    vars: z.record(z.string(), zConfigResolvable),
    env: zConfigEnv,
    files: z.array(zConfigFileEntry),
    tasks: zConfigTasks,
    taskGroup: z.record(z.string(), zConfigTaskGroup),
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
    if (isGlobKey(key)) {
      if (isNegatedKey(key)) {
        throw new Error(`negated glob keys are not supported in env: ${key}`);
      }
      if (value !== null) {
        throw new Error(`glob env keys must have a null value: ${key}`);
      }

      for (const existing of Object.keys(resolvedEnv)) {
        if (matchesGlob(existing, key)) {
          delete resolvedEnv[existing];
        }
      }
      continue;
    }

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
  taskGroup: Record<string, string[]>;
}

// === resolve task groups

// Groups are resolved after all tasks, so globs see the final task set.
function resolveTaskGroups(
  groups: NonNullable<Config["taskGroup"]>,
  tasks: ResolvedConfig["tasks"],
): ResolvedConfig["taskGroup"] {
  const resolved: ResolvedConfig["taskGroup"] = {};

  for (const [name, group] of Object.entries(groups)) {
    const members = Array.isArray(group) ? group : group.tasks;
    const taskNames: string[] = [];
    const seen = new Set<string>();

    const add = (taskName: string) => {
      if (seen.has(taskName)) return;
      seen.add(taskName);
      taskNames.push(taskName);
    };

    for (const member of members) {
      if (isNegatedKey(member)) {
        throw new Error(`negated task patterns are not supported in task groups: ${member}`);
      }

      if (!member.includes("*")) {
        if (!Object.hasOwn(tasks, member)) {
          throw new Error(`Unknown task "${member}" in task group "${name}"`);
        }
        add(member);
        continue;
      }

      const matches = Object.keys(tasks).filter((taskName) => matchesTaskGlob(taskName, member));
      if (matches.length === 0) {
        throw new Error(`Task group "${name}" pattern "${member}" matched no tasks`);
      }
      for (const match of matches) add(match);
    }

    resolved[name] = taskNames;
  }

  return resolved;
}

// === expand task cwd

type ConfigTask = NonNullable<NonNullable<Config["tasks"]>[string]>;
type ConfigTaskCwd = ConfigTask["cwd"];

interface TaskCwdEntry {
  prefix: string;
  cwd: string;
}

// A single cwd keeps the task name as-is. Multiple cwds get a prefix so that
// each generated task has a distinct name.
function taskCwdEntries(cwd: ConfigTaskCwd, rootDir: string): TaskCwdEntry[] {
  if (cwd === undefined) {
    return [{ prefix: "", cwd: rootDir }];
  }

  if (typeof cwd === "string") {
    return [{ prefix: "", cwd: path.resolve(rootDir, cwd) }];
  }

  const entries = Array.isArray(cwd)
    ? cwd.map((value) => ({ prefix: undefined, value }))
    : Object.entries(cwd).map(([prefix, value]) => ({ prefix, value }));

  return entries.map(({ prefix, value }) => {
    const resolved = path.resolve(rootDir, value);
    return {
      prefix: prefix ?? (path.basename(resolved) || resolved),
      cwd: resolved,
    };
  });
}

// Numbering is keyed by the full name, so `baz:dev` and `baz:build` do not
// compete. Names already in the map are never clobbered by a generated task.
function claimTaskName(prefix: string, name: string, tasks: ResolvedConfig["tasks"]): string {
  if (!prefix) return name;

  let claimed = `${prefix}:${name}`;
  let index = 1;
  while (Object.hasOwn(tasks, claimed)) {
    index += 1;
    claimed = `${prefix}-${index}:${name}`;
  }
  return claimed;
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

  for (const [key, task] of Object.entries(config.tasks ?? {})) {
    if (isGlobKey(key)) {
      if (task !== null) {
        throw new Error(`glob task keys must have a null value: ${key}`);
      }

      const negated = isNegatedKey(key);
      const pattern = negated ? key.slice(1) : key;
      for (const name of Object.keys(tasks)) {
        if (matchesTaskGlob(name, pattern) !== negated) {
          delete tasks[name];
        }
      }
      continue;
    }

    if (task === null) {
      delete tasks[key];
    } else {
      const args = task.args ?? [];
      const resolvedEnv = resolveEnv({ vars }, task.env ?? {}, { parentEnv: env });
      const resolvedFiles = resolveFiles({ cwd: rootDir, vars, env }, task.files ?? []);

      for (const { prefix, cwd } of taskCwdEntries(task.cwd, rootDir)) {
        tasks[claimTaskName(prefix, key, tasks)] = {
          cmd: task.cmd,
          args: [...args],
          cwd,
          env: { ...resolvedEnv },
          files: resolvedFiles.map((file) => ({ ...file })),
        };
      }
    }
  }

  return {
    port,
    vars,
    env,
    files,
    tasks,
    taskGroup: resolveTaskGroups(config.taskGroup ?? {}, tasks),
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
