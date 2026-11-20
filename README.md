# velina

velina is a lightweight task runner built on top of Bun. I personally use it to allow running my local development apps:

```yaml
tasks:
  backend:dev:
    cmd: bun
    args: [run, dev]
    cwd: ./apps/backend
  frontend:dev:
    cmd: bunx
    args: [nuxi, dev]
    cwd: ./apps/frontend
  mock-oauth:start:
    cmd: bunx
    args: [start]
    cwd: ./apps/mock-oauth-service
```

## Installation

Install via GitHub:

```
bun add -g github:tkesgar/velina
```

## Usage

The package exposes 2 binaries:

- `velina`
- `velina-cli`: a CLI for interfacing with the velina server

```
# Read config from .velina.yml by default
velina

# Provide a custom path
velina --config-path path/to/config.yml

# Provide variables from command line
# These variables override variables defined in configuration file
velina --var MY_VAR1=foo --var MY_VAR2=bar

# List the available tasks
velina-cli tasks

# Run against custom server location
velina-cli --server 8080 tasks
velina-cli --server http://192.168.0.200:2222 tasks
velina-cli --server https://homelab.tail1234.ts/velina tasks
```

## Configuration

```yaml
# Specifies the port velina-server runs at.
# Must be an integer between 1 and 65535.
# Default: 2222
port: 2222
# Specifies the host velina-server runs at.
# Default: 127.0.0.1 (localhost)
host: 127.0.0.1
# Inherit environment variables from the velina process.
# Default: true
inheritEnv: true
# Root directory for file paths, task cwd, and task scanning.
# Resolved against the current working directory.
# Default: current working directory
rootDir: .
# Package manager used for scanned tasks (for example bun, npm, pnpm).
# Default: bun
packageManager: bun
# Variables made available to templates.
vars:
  VAR1: foo
  VAR2: bar
  # Variables may also use the resolvable forms described below.
  GENERATED:
    type: cmd
    cmd: date
# Environment variables added to all subprocesses.
# A null value removes the variable from the inherited environment.
env:
  ENV1: foo
  ENV2: <%= vars.VAR1 %>
  SHELL: null
# Files written when velina starts. Paths are resolved against rootDir.
files:
  # A plain string is rendered as a template.
  - path: ./foo
    content: Hello <%= vars.VAR2 %>!
  # Explicit resolvable forms.
  - path: ./bar
    content:
      type: text
      text: Hello <%= vars.VAR2 %>!
  - path: ./dev.key
    content:
      type: cmd
      cmd: openssl
      args: [genpkey, -algorithm, ed25519]
  # Other values are used as-is and stringified when written.
  - path: ./count
    content: 42
# Tasks override scanned tasks with the same name.
# A null entry removes a scanned task.
tasks:
  norma:lint: null
  norma:start:
    cmd: npm
    args: [start]
    # Resolved against rootDir.
    cwd: ./apps/norma
    env:
      NODE_ENV: development
    # Written before the task is run.
    files:
      - path: ./foo
        content: Hello <%= vars.VAR2 %>!
```

Unknown keys are rejected. A missing `.velina.yml` or an empty one is treated as an empty configuration; an explicitly provided config path that does not exist is an error.

### Resolvable values

Values in `vars`, `env`, and file `content` accept three forms:

- `value`: used as-is.
- `text`: rendered as an Eta template.
- `cmd`: runs `cmd` with `args` and uses its trimmed standard output.

A plain string is shorthand for `text`; any other plain value is shorthand for `value`. Variables cannot reference other variables or environment variables.

### Values available in templates

- `vars`: variables (example: `<%= vars.VAR1 %>`)
- `env`: environment variables (example: `<%= env.NODE_ENV %>`)

Within `env` entries, `env` refers to the inherited environment; within files, it refers to the fully resolved environment.

### Task scanning

- If `rootDir` does not contain a `package.json`, no tasks are scanned.
- Each entry in the root `scripts` becomes a task named after the script. It runs `<packageManager> run <script>` with `cwd` set to `rootDir`.
- If `package.json` has a `workspaces` array, each matching workspace `package.json` is read. Its scripts become tasks prefixed with the workspace's relative directory, for example `apps/frontend:dev`, with `cwd` set to that directory.
- Workspace patterns beginning with `!` exclude matching packages. Only the array form of `workspaces` is supported.
- Scanned tasks have empty `env` and `files`.
- Tasks defined in the config override scanned tasks of the same name; a `null` entry removes one.

## API

The `/api` path exposes a Cap'n Web RPC target with the following functions:

```ts
import { RpcTarget } from "capnweb";

interface VelinaResolvedConfig {
  port: number;
  host: string;
  var: Record<string, unknown>;
  env: Record<string, string>;
  files: VelinaConfigFileEntry[];
  repositoryDir: string;
  tasks: Record<string, VelinaConfigTaskEntry>;
}

interface VelinaConfigFileEntry {
  path: string;
  content: string;
}

interface VelinaConfigTaskEntry {
  cmd: string;
  cwd: string;
  env: Record<string, string>;
  files: VelinaConfigFileEntry[];
}

interface VelinaTaskRun {
  id: string;
  task: {
    cmd: string;
    cwd: string;
    env: Record<string, string>;
  };
}

abstract class VelinaRPC extends RpcTarget {
  abstract getResolvedConfig(): VelinaResolvedConfig;

  abstract runTask(name: string): Promise<VelinaTaskRun>;

  abstract getAllTaskRuns(): VelinaTaskRun[];

  abstract getTaskRun(id: string): VelinaTaskRun;

  abstract streamTaskRun(id: string, type?: "stdout" | "stderr" | "both"): ReadableStream;
}
```

## CLI

```
velina-cli config

velina-cli run

velina-cli run-info

velina-cli log

velina-cli log --stdout

velina-cli log --stderr
```
