import { RpcTarget } from "capnweb";
import path from "node:path";
import fs from "node:fs";
import * as z from "zod";
import { Eta } from "eta";
import ignore from "ignore";
import { RunManager } from "./run-manager";

type VelinaVar =
  | { type: 'static'; value: string }
  | { type: "command"; value: string }
  | { type: "script"; value: string };

export interface NormalizedScript {
  type: "command" | "package-script";
  value: string;
}

interface ConfiguredFile {
  path: string;
  content: string;
}

interface NormalizedApp {
  path: string;
  name: string;
  env: Record<string, string | null>;
  scripts: Record<string, NormalizedScript>;
  files: ConfiguredFile[];
}

interface NormalizedConfig {
  port: number;
  var: Record<string, VelinaVar>;
  env: Record<string, string | null>;
  apps: NormalizedApp[];
}

export interface ResolvedFile {
  path: string;
  source: "config" | "example";
}

const configSchema = z.object({
  port: z.number().optional(),
  var: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.object({
          type: z.literal("static"),
          value: z.string(),
        }),
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
          })
        ).optional()
      })
    ])
  ).optional()
});

export interface PartialVelinaConfig {
  port?: number;
  var?: Record<string, string | VelinaVar>;
  env?: Record<string, string | null>;
  apps?: Array<string | {
    path: string
    name?: string
    env?: Record<string, string | null>;
    scripts?: Record<string, string>;
    files?: Array<{
      path: string
      content: string
    }>
  }>
}

export interface VelinaConfig {
  port: number;
  var: Record<string, string>;
  env: Record<string, string | null>;
  apps: Array<{
      path: string;
      name: string;
      env: Record<string, string | null>;
      scripts: Record<string, NormalizedScript>;
      files: ResolvedFile[];
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
    processEnv: Record<string, string>;
  },
) {
  const {
    partialConfig,
    cwd,
    processEnv,
  } = opts

  const resolvedConfig: NormalizedConfig = {
    port: Number(processEnv.PORT) || partialConfig?.port || 2209,
    var: Object.fromEntries(
      Object.entries(partialConfig?.var ?? {})
      .map(([key, value]) => {
        if (typeof value === 'string') {
          return [key, {
            type: 'static' as const,
            value,
          }]
        }

        return [key, value]
      })
    ),
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
        scripts: Object.fromEntries(
          Object.entries(partialApp.scripts ?? {}).map(([name, value]) => [
            name,
            { type: "command" as const, value },
          ]),
        ),
        env: { ...(partialApp.env ?? {}) },
        files: (partialApp.files ?? []).map((file) => ({ ...file })),
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
        const json = fs.readFileSync(path.resolve(cwd, app.path, "package.json"), "utf8");
        const { scripts } = JSON.parse(json);
        for (const [name, command] of Object.entries(scripts)) {
          if (name.startsWith('pre') || name.startsWith('post')) {
            continue
          }

          if (typeof command !== 'string') {
            continue
          }

          app.scripts[name] = { type: "package-script", value: command };
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new Error(`Failed to read scripts for app ${app.name}`, { cause: error });
        }
      }
    }
  }

  return {
    partial: partialConfig,
    resolved: resolvedConfig,
  };
}

const STARTUP_PROCESS_TIMEOUT_MS = 30_000;
const STARTUP_PROCESS_MAX_OUTPUT = 1024 * 1024;

interface CapturedProcessOutput {
  stdout: string;
  stderr: string;
}

interface FileToGenerate {
  appRoot: string;
  path: string;
  content: string;
  source: ResolvedFile["source"];
}

interface IgnoreScope {
  directory: string;
  matcher: ReturnType<typeof ignore>;
}

function snapshotProcessEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

function getShellCommand(command: string, environment: Record<string, string>) {
  if (process.platform === "win32") {
    return [environment.ComSpec || "cmd.exe", "/d", "/s", "/c", command];
  }
  return ["/bin/sh", "-c", command];
}

async function runStartupProcess(
  command: string[],
  cwd: string,
  environment: Record<string, string>,
  description: string,
): Promise<CapturedProcessOutput> {
  const child = Bun.spawn(command, {
    cwd,
    env: environment,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: STARTUP_PROCESS_TIMEOUT_MS,
    maxBuffer: STARTUP_PROCESS_MAX_OUTPUT,
    killSignal: "SIGKILL",
  });

  let stdout: string;
  let stderr: string;
  let exitCode: number;
  try {
    [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
  } catch (cause) {
    try {
      child.kill("SIGKILL");
    } catch {
      // The process may have already exited.
    }
    throw new Error(`${description} failed: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
  }

  if (exitCode !== 0) {
    const details = stderr.trim() || stdout.trim();
    throw new Error(
      `${description} exited with code ${exitCode}${details ? `: ${details}` : ""}`,
    );
  }

  return { stdout, stderr };
}

function serializeScriptResultProgram(expression: string) {
  return `
const expression = ${JSON.stringify(expression)};
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const value = await new AsyncFunction("return (" + expression + ")")();
if (value === undefined) {
  process.stdout.write("");
} else if (typeof value === "string") {
  process.stdout.write(value);
} else if (value === null) {
  process.stdout.write("null");
} else {
  process.stdout.write(JSON.stringify(value) ?? String(value));
}
`;
}

function applyEnvironment(
  base: Record<string, string>,
  overrides: Record<string, string | null>,
) {
  const environment = { ...base };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) {
      delete environment[name];
    } else {
      environment[name] = value;
    }
  }
  return environment;
}

function renderEnvironment(
  eta: Eta,
  variables: Record<string, string>,
  environment: Record<string, string | null>,
  contextEnvironment: Record<string, string>,
  description: string,
) {
  const rendered: Record<string, string | null> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (value === null) {
      rendered[name] = null;
      continue;
    }

    try {
      rendered[name] = eta.renderString(value, {
        var: variables,
        env: contextEnvironment,
      });
    } catch (cause) {
      throw new Error(
        `Failed to render ${description} environment variable ${name}: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
  }
  return rendered;
}

function normalizeRelativeFilePath(value: string) {
  if (!value || value.includes("\0") || path.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new Error(`Generated file path must be relative: ${value}`);
  }
  const normalizedSeparators = value.replace(/[\\/]/g, path.sep);
  if (normalizedSeparators.split(path.sep).some((part) => part === "..")) {
    throw new Error(`Generated file path cannot escape its app directory: ${value}`);
  }
  const normalized = path.normalize(normalizedSeparators);
  if (!normalized || normalized === ".") {
    throw new Error(`Generated file path must name a file: ${value}`);
  }
  return normalized;
}

function readIgnoreScope(directory: string, cache: Map<string, IgnoreScope | null>) {
  if (cache.has(directory)) return cache.get(directory) ?? null;
  const filePath = path.join(directory, ".gitignore");
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat?.isFile()) {
    cache.set(directory, null);
    return null;
  }

  try {
    const scope = {
      directory,
      matcher: ignore().add(fs.readFileSync(filePath, "utf8")),
    };
    cache.set(directory, scope);
    return scope;
  } catch (cause) {
    throw new Error(`Failed to parse ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
  }
}

function isGitIgnored(
  projectRoot: string,
  targetPath: string,
  ignoreCache: Map<string, IgnoreScope | null>,
) {
  const root = path.resolve(projectRoot);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return false;
  }

  const scopes: IgnoreScope[] = [];
  const rootScope = readIgnoreScope(root, ignoreCache);
  if (rootScope) scopes.push(rootScope);

  const parts = relative.split(path.sep);
  let current = root;
  let ignored = false;

  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const isDirectory = index < parts.length - 1;

    for (const scope of scopes) {
      const scopedPath = path.relative(scope.directory, current).split(path.sep).join("/");
      const result = scope.matcher.test(isDirectory ? `${scopedPath}/` : scopedPath);
      if (result.ignored) ignored = true;
      else if (result.unignored) ignored = false;
    }

    if (!isDirectory) continue;
    if (ignored) return true;

    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isDirectory() && !stat.isSymbolicLink()) {
      const nestedScope = readIgnoreScope(current, ignoreCache);
      if (nestedScope) scopes.push(nestedScope);
    }
  }

  return ignored;
}

function collectExampleFiles(
  appRoot: string,
  projectRoot: string,
  ignoreCache: Map<string, IgnoreScope | null>,
  reservedPaths: Set<string>,
) {
  const examples: Array<{ path: string; content: string }> = [];
  const appStat = fs.statSync(appRoot, { throwIfNoEntry: false });
  if (!appStat?.isDirectory()) return examples;

  function visit(directory: string, relativeDirectory: string) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        if (!isGitIgnored(projectRoot, absolutePath, ignoreCache)) {
          visit(absolutePath, relativePath);
        }
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".example")) continue;

      const outputPath = relativePath.slice(0, -".example".length);
      if (reservedPaths.has(normalizeRelativeFilePath(outputPath))) continue;
      const absoluteOutput = path.resolve(appRoot, outputPath);
      if (!isGitIgnored(projectRoot, absoluteOutput, ignoreCache)) {
        const projectRelative = path.relative(projectRoot, absoluteOutput).split(path.sep).join("/");
        console.warn(
          `[Velina] Skipping ${path.relative(appRoot, absolutePath)}: generated target ${projectRelative} is not ignored by .gitignore`,
        );
        continue;
      }

      examples.push({
        path: outputPath,
        content: fs.readFileSync(absolutePath, "utf8"),
      });
    }
  }

  visit(appRoot, "");
  return examples;
}

function writeGeneratedFile(appRoot: string, relativePath: string, content: string) {
  const safeRelativePath = normalizeRelativeFilePath(relativePath);
  const root = fs.realpathSync(appRoot);
  const target = path.resolve(root, safeRelativePath);
  const relativeToRoot = path.relative(root, target);
  if (
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new Error(`Generated file path escapes its app directory: ${relativePath}`);
  }

  const parts = safeRelativePath.split(path.sep);
  let directory = root;
  for (const part of parts.slice(0, -1)) {
    directory = path.join(directory, part);
    const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (!stat) {
      fs.mkdirSync(directory, { mode: 0o700 });
    } else if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Generated file parent is not a safe directory: ${directory}`);
    }
  }

  const targetStat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (targetStat?.isSymbolicLink() || (targetStat && !targetStat.isFile())) {
    throw new Error(`Generated file target is not a regular file: ${target}`);
  }
  if (targetStat) fs.chmodSync(target, 0o600);
  fs.writeFileSync(target, content, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(target, 0o600);
}

function renderTemplate(eta: Eta, template: string, data: object, label: string) {
  try {
    return eta.renderString(template, data);
  } catch (cause) {
    throw new Error(
      `Failed to render template for ${label}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

async function evaluateVariables(
  definitions: Record<string, VelinaVar>,
  cwd: string,
  processEnvironment: Record<string, string>,
) {
  const bunExecutable = Bun.which("bun");
  const variables: Record<string, string> = {};

  for (const [name, definition] of Object.entries(definitions)) {
    try {
      if (definition.type === "static") {
        variables[name] = definition.value;
        continue;
      }

      if (definition.type === "script" && !bunExecutable) {
        throw new Error("Could not find the Bun executable to evaluate this variable");
      }

      const command = definition.type === "script"
        ? [bunExecutable!, "-e", serializeScriptResultProgram(definition.value)]
        : getShellCommand(definition.value, processEnvironment);
      const output = await runStartupProcess(
        command,
        cwd,
        processEnvironment,
        `var.${name} ${definition.type}`,
      );
      variables[name] = definition.type === "command" ? output.stdout.trim() : output.stdout;
    } catch (cause) {
      throw new Error(
        `Failed to resolve var.${name} (${definition.type}): ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
  }

  return variables;
}

interface PreparedRuntimeConfig {
  resolved: VelinaConfig;
  fileWrites: FileToGenerate[];
}

async function prepareRuntimeConfig(
  normalized: NormalizedConfig,
  projectRoot: string,
  processEnvironment: Record<string, string>,
): Promise<PreparedRuntimeConfig> {
  const variables = await evaluateVariables(normalized.var, projectRoot, processEnvironment);
  const eta = new Eta({
    autoEscape: false,
    autoTrim: false,
    autoFilter: true,
    filterFunction(value) {
      if (value === undefined) {
        throw new Error("Template value is undefined; check its var or env name");
      }
      return value === null ? "" : String(value);
    },
  });
  const sharedEnv = renderEnvironment(
    eta,
    variables,
    normalized.env,
    processEnvironment,
    "top-level",
  );
  const sharedContext = applyEnvironment(processEnvironment, sharedEnv);
  const ignoreCache = new Map<string, IgnoreScope | null>();
  const fileWrites: FileToGenerate[] = [];
  const apps: VelinaConfig["apps"] = [];

  for (const app of normalized.apps) {
    const appRoot = path.resolve(projectRoot, app.path);
    const appEnv = renderEnvironment(
      eta,
      variables,
      app.env,
      sharedContext,
      `app ${app.name}`,
    );
    const appContext = applyEnvironment(sharedContext, appEnv);
    const fileDefinitions = new Map<string, { content: string; source: ResolvedFile["source"] }>();

    for (const file of app.files) {
      const relativePath = normalizeRelativeFilePath(file.path);
      fileDefinitions.set(relativePath, { content: file.content, source: "config" });
    }

    const explicitPaths = new Set(fileDefinitions.keys());
    for (const example of collectExampleFiles(
      appRoot,
      projectRoot,
      ignoreCache,
      explicitPaths,
    )) {
      const relativePath = normalizeRelativeFilePath(example.path);
      fileDefinitions.set(relativePath, { content: example.content, source: "example" });
    }

    const resolvedFiles: ResolvedFile[] = [];
    for (const [relativePath, file] of fileDefinitions) {
      const content = renderTemplate(
        eta,
        file.content,
        { var: variables, env: appContext },
        `${app.name}/${relativePath}`,
      );
      fileWrites.push({
        appRoot,
        path: relativePath,
        content,
        source: file.source,
      });
      resolvedFiles.push({ path: relativePath, source: file.source });
    }

    apps.push({
      path: app.path,
      name: app.name,
      env: appEnv,
      scripts: app.scripts,
      files: resolvedFiles,
    });
  }

  return {
    resolved: {
      port: normalized.port,
      var: variables,
      env: sharedEnv,
      apps,
    },
    fileWrites,
  };
}

export class Velina {
  readonly runs: RunManager;
  readonly config: {
    cwd: string;
    path: string;
    partial: PartialVelinaConfig | null;
    resolved: VelinaConfig;
  };

  private constructor(
    config: Velina["config"],
    processEnvironment: Record<string, string>,
  ) {
    this.config = config;
    this.runs = new RunManager(config.cwd, config.resolved, processEnvironment);
  }

  static async create(opts: {
    cwd?: string;
    configFile?: string;
  } = {}) {
    const cwd = path.resolve(opts.cwd ?? process.cwd());
    const configPath = path.resolve(cwd, opts.configFile ?? "./.velina.yml");
    let partialConfig: PartialVelinaConfig | undefined;

    try {
      partialConfig = readConfigFromFile(configPath);
    } catch (error) {
      const cause = error instanceof Error
        ? error.cause as NodeJS.ErrnoException | undefined
        : undefined;
      if (cause?.code !== "ENOENT") throw error;
    }

    const processEnvironment = snapshotProcessEnvironment();
    const normalized = resolveConfig({
      cwd,
      partialConfig,
      processEnv: processEnvironment,
    });
    const prepared = await prepareRuntimeConfig(
      normalized.resolved,
      cwd,
      processEnvironment,
    );

    for (const file of prepared.fileWrites) {
      try {
        writeGeneratedFile(file.appRoot, file.path, file.content);
      } catch (cause) {
        throw new Error(
          `Failed to write generated file for ${path.join(file.appRoot, file.path)}: ${cause instanceof Error ? cause.message : String(cause)}`,
          { cause },
        );
      }
    }

    return new Velina({
      cwd,
      path: configPath,
      partial: normalized.partial ?? null,
      resolved: prepared.resolved,
    }, processEnvironment);
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
