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

### Requirements

- [Bun](https://bun.com/docs/installation). Velina's server, CLI, and scanned tasks all run on Bun; make sure `bun` is on your `PATH`.

### Install

Install via GitHub:

```
bun add -g github:tkesgar/velina
```

This installs both `velina` and `velina-cli` globally. Check with `velina --help`.

### Update

A GitHub install is pinned to the commit resolved when it was installed, so `bun update -g` alone may not pick up newer commits. Reinstall to get the latest version:

```
bun remove -g @tkesgar/velina
bun add -g github:tkesgar/velina
```

### Remove

```
bun remove -g @tkesgar/velina
```

This removes the global package and its two binaries. It does not touch project files — remove `.velina.yml` or files generated from your `files` config separately if you no longer need them.

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

# Scaffold .velina.yml and package.json scripts in a repository
velina init
velina init path/to/repo --agent-doc --json

# Validate a config, or print the config JSON Schema
velina config check
velina schema

# List processes through the CLI
velina-cli ps
```

Run `velina --help` for the full command list. The server always binds to `127.0.0.1`, so `velina-cli` and the web UI connect to the local instance; there is no remote mode.

### Startup output

From an interactive terminal, Velina prints an ASCII banner with its port, the web UI URL, and ready-to-run `velina-cli` commands. The CLI examples include `--port <port>` only when using a non-default port. The UI URL is copied to the clipboard when a helper (`pbcopy`, `wl-copy`, `xclip`, `clip.exe`) is available, or via the terminal's OSC 52 clipboard where supported; otherwise no copy notice is shown.

The banner is silent when stdout is not a TTY, `TERM` is `dumb`, or common CI/agent environment variables are set. Set `VELINA_BANNER=1` to force it or `VELINA_BANNER=0` to suppress it. The art is omitted only on terminals narrower than 56 columns, where it would wrap; a short terminal simply scrolls.

## Agent setup

Velina is designed for a global install, so a repository needs no local dependency. To set it up in another project:

```
cd ~/path/to/project
velina init --yes --agent-doc
velina config check
velina
```

`velina init` writes a commented `.velina.yml` if one does not exist and adds a `velina` script to `package.json` if it exists. It never overwrites existing config keys or scripts. `--dev` is only useful when developing Velina's own UI; consumer projects do not need it.

With `--agent-doc`, it also appends a short Velina pointer to `AGENTS.md` — but only if that file already exists. The pointer is idempotent: running `init` again replaces the marked section instead of duplicating it. Existing `AGENTS.md` content is otherwise preserved.

Use `--json` for a machine-readable result with the created config path, added scripts, and whether the agent pointer was added, updated, or skipped. Agents can use `velina schema` to see the accepted config fields and `velina config check` to validate before starting the server.

## Configuration

```yaml
# Specifies the port velina-server runs at.
# Must be an integer between 1 and 65535.
# Default: 2222
port: 2222
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
- Scanned tasks inherit the resolved root `env` (including `PATH` when `inheritEnv` is true) and have empty `files`.
- Tasks defined in the config override scanned tasks of the same name; a `null` entry removes one.

### Glob deletion

Keys containing `*`, or starting with `!` for tasks, are globs. A glob key must have a `null` value; any other value is a config error caught by `velina config check`.

```yaml
env:
  "NODE_*": null # Delete all NODE_* variables
  "NUXT_*": null # Delete all NUXT_* variables
tasks:
  "packages/*": null # Delete all packages tasks
  "!*:dev": null # Delete all non-dev tasks
  "apps/frontend/*": null # Delete all apps/frontend tasks
  "/*": null # Delete root tasks
```

- `*` matches any sequence of characters, including an empty one; every other character is literal. Env names are matched as written.
- Task names are matched as slash-separated paths: a `:` in a task name or pattern is treated as `/`, so `apps/frontend:dev` is matched as `apps/frontend/dev`. This lets `packages/*` and `apps/frontend/*` match tasks below those directories.
- `/*` matches only root tasks, those without a directory prefix.
- A leading `*/`, as in `*:dev`, also matches unprefixed names, so `*:dev` covers `dev`, `lint:dev`, and `apps/frontend:dev`.
- `!pattern` is valid only in `tasks`; it deletes every task that does _not_ match `pattern`. Negated env keys are rejected because they can silently erase inherited variables such as `PATH`.
- Env globs delete from the inherited environment and from variables defined earlier in the same map at the point where the glob appears; later entries can add variables back.
- Task globs follow declaration order too: a later explicit task can re-add a deleted one.

## Web UI

The web UI is served at `/ui/` on the server's port, for example `http://127.0.0.1:2222/ui/`. It redirects to `/ui/tasks`. Unknown paths return `404 Not Found`, except requests that accept `text/html` (typically browsers), which are redirected to `/ui/`.

- `/ui/tasks` lists all available tasks, shows whether one has a running process, and lets you start or stop a task and view its logs.
- `/ui/processes` lists running and stopped processes, shows details and logs, and lets you stop, restart, or clean them up.
- `/ui/config` shows both the provided and fully resolved configuration.

The UI is built by Bun directly from `web/index.html`; there is no separate frontend build or dev server. Run `velina --dev` to enable hot reloading while working on it. The header has a light/dark switcher whose choice is stored in local storage.

## API

The `/api` path exposes a Cap'n Web RPC target. HTTP batch handles one-shot calls; WebSocket is required for log streaming. The server always binds to `127.0.0.1`.

```ts
import { newWebSocketRpcSession } from "capnweb";
import type { VelinaApi } from "./lib/api";

using api = newWebSocketRpcSession<VelinaApi>("ws://127.0.0.1:2222/api");

const { provided, resolved } = await api.getConfig();
const yaml = await api.getConfig({ format: "yaml" }); // { provided: string, resolved: string }
const process = await api.startTask("backend:dev");

for await (const entry of await api.streamProcessLogs(process.id, "stdout")) {
  console.log(entry.line);
}

await api.stopProcess(process.id);
api.deleteProcess(process.id);
```

| Function                      | Description                                                                                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getConfig(opts?)`            | `{ provided, resolved }`: the parsed config and the fully resolved config, including all available tasks. Pass `{ format: "yaml" }` to receive both as YAML strings. |
| `startTask(name)`             | Starts a task as a new process. Only one running process is allowed per task.                                                                                        |
| `getAllProcesses()`           | All tracked processes, running and stopped.                                                                                                                          |
| `getProcess(id)`              | Details for one process.                                                                                                                                             |
| `streamProcessLogs(id, type)` | `ReadableStream` of `stdout` or `stderr` lines. Replays stored lines, follows live output, and closes when the process stops.                                        |
| `stopProcess(id)`             | Terminates a running process with SIGTERM, falling back to SIGKILL after 5 seconds. Logs remain available. Idempotent.                                               |
| `deleteProcess(id)`           | Removes a stopped process and its logs. Rejected while the process is running.                                                                                       |

A process has `id`, `taskName`, `state` (`running` or `stopped`), `startedAt`, `stoppedAt`, `exitCode`, `cmd`, `args`, and `cwd`. Environment variables are deliberately omitted from process details. A log entry has `type`, `line`, and `timestamp`; logs are buffered up to 5,000 lines per process.

The API runs local commands without authentication. Browser WebSocket connections from other origins are rejected, but do not expose the port through a proxy or tunnel.

## CLI

`velina-cli` is a thin client for the API. Every command prints JSON, except `logs`, which prints timestamped lines by default.

```
velina-cli config                       provided and resolved config
velina-cli config --format yaml         resolved config as YAML
velina-cli start <task>                 start a task
velina-cli ps                           list all processes
velina-cli process <id>                 show process details
velina-cli logs <id> [stdout|stderr]    stream logs (default stdout)
velina-cli stop <id>                    stop a process
velina-cli delete <id>                  delete a stopped process
```

Global options: `--port <port>` overrides the port from `.velina.yml`, `--json` makes `logs` emit one JSON object per line, and `--help` prints usage. Process ids may be abbreviated to any unique prefix. Errors are printed to stderr with exit code `1` for API failures and `2` for usage errors.
