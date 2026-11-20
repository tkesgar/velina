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

# Enable frontend hot reloading for UI development
velina --dev

# List the available tasks
velina-cli tasks
```

The server always binds to `127.0.0.1`, so `velina-cli` and the web UI connect to the local instance; there is no remote mode.

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

## Web UI

The web UI is served at `/ui/` on the server's port, for example `http://127.0.0.1:2222/ui/`. It redirects to `/ui/tasks`.

- `/ui/tasks` lists all available tasks, shows whether one has a running process, and lets you start a task and view its logs.
- `/ui/processes` lists running and stopped processes, shows details and logs, and lets you restart or clean them up.
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

```
velina-cli config

velina-cli run

velina-cli run-info

velina-cli log

velina-cli log --stdout

velina-cli log --stderr
```
