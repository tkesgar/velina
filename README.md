# velina

velina is a lightweight task runner built on top of Bun. I personally use it to allow running my local development apps:

```yaml
tasks:
  backend:dev:
    cmd: bun run dev
    cwd: ./apps/backend
  frontend:dev:
    cmd: bunx nuxi dev
    cwd: ./apps/frontend
  mock-oauth:start:
    cmd: bunx start
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
# Default: 2222
port: 2222
# Specifies the host velina-server runs at.
# Default: 127.0.0.1 (localhost)
host: 127.0.0.1
# Specify variables that will be available in templates.
var:
  VAR1: foo
  VAR2: bar
# Specify environment variables that will be added to all subprocesses.
# Templates are supported.
env:
  ENV1: foo
  ENV2: <%= it.var.VAR1 %>
  # Prevent velina environment variables from being added.
  SHELL: null
# Specifies files to be written.
# These files are written once when velina is started.
files:
  # If content type is string: run the template and write it to the path.
  - path: ./foo
    content:
      type: string
      value: Hello <%= it.var.VAR2 %>!
  # If content type is cmd: run the command and print its stdout to the path.
  - path: ./dev.key
    content:
      type: cmd
      cmd: openssl genpkey -algorithm ed25519
  # Shorthands for the forms above
  - path: ./foo
    content: >-
      Hello <%= it.var.VAR2 %>!
  - path: ./foo
    cmd: openssl genpkey -algorithm ed25519
# Path to root directory to scan for tasks.
# Set to null to disable scanning for tasks.
# Default: current working directory
rootDir: .
# Provide the list of tasks.
# Note that tasks with the same name defined here overrides scanned tasks.
tasks:
  # Prevent a scanned tasks from being added into the task list.
  norma:lint: null
  norma:start:
    # Specify the command to run.
    cmd: npm start
    # Specify the cwd for the command.
    cwd: ./apps/norma
    # Specify addtional/override environment variables for the command.
    env:
      NODE_ENV: development
      # Prevent root/velina environment variables from being added.
      NODE_ENV: null
    # Specify files to be written.
    # These files are written before the task is run.
    files:
      - path: ./foo
        content: >-
          Hello <%= it.var.VAR2 %>!
      - path: ./dev.key
        cmd: openssl genpkey -algorithm ed25519
```

### Values available in templates

- `it.var`: variables (example: `it.var.VAR1`)
- `it.env`: environment variables (example: `it.env.NODE_ENV`)

### Task scanning

- Read `<repositoryDir>/package.json` if exists.
- Add all `scripts` entries as tasks, with the `cwd` set to `<repositoryDir>`
- Look for `workspaces` entries, and read the subpackage `package.json` entries.
- Add all `scripts` entries as tasks with dirname as prefix.

## API

The `/api` path exposes a Cap'n Web RPC target with the following functions:

```ts
import { RpcTarget } from 'capnweb';

interface VelinaResolvedConfig {
  port: number
  host: string
  var: Record<string, unknown>;
  env: Record<string, string>;
  files: VelinaConfigFileEntry[];
  repositoryDir: string;
  tasks: Record<string, VelinaConfigTaskEntry>;
}

interface VelinaConfigFileEntry {
  path: string
  content: string
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
    cmd: string
    cwd: string;
    env: Record<string, string>;
  }
}

abstract class VelinaRPC extends RpcTarget {
  abstract getResolvedConfig(): VelinaResolvedConfig;

  abstract runTask(name: string): Promise<VelinaTaskRun>;

  abstract getAllTaskRuns(): VelinaTaskRun[];

  abstract getTaskRun(id: string): VelinaTaskRun;

  abstract streamTaskRun(id: string, type?: 'stdout' | 'stderr' | 'both'): ReadableStream;
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
