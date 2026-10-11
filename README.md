# velina

velina is a small UI to run commands, useful for monorepos.

## Install

```sh
bun add -g github:tkesgar/velina
```

## Usage

```sh
# Starts the web UI at http://localhost:2209/dashboard#/apps
$ velina

# Override the listening port
$ velina --port 3000
```

Development runs `server.ts` directly with Bun. `bun run build` creates the CLI
executable at `dist/velina`.

## Development

```sh
bun install
bun run dev
```

The UI lives at `/dashboard` and uses hash-based React Router navigation:
`/dashboard#/apps`, `/dashboard#/runs`, and `/dashboard#/config`. `/api` uses
Cap'n Web WebSocket RPC to expose Velina's API. Visiting `/` redirects to `/dashboard`.

## Apps and runs

When `apps` is omitted from `.velina.yml`, Velina discovers app directories under
`./apps` and reads their scripts from `package.json`. The demo apps are:

- `apps/backend`: serves `GET /api/hello` on port `3011` by default.
- `apps/frontend`: serves a page on port `3012` that calls the backend.

Run scripts from the **Apps** tab. The **Runs** tab streams stdout and stderr,
shows the effective environment, and lets you stop or remove runs. Only one
instance of an app's script can run at a time; finished runs can be restarted.
Inherited `process.env` values can be toggled in the environment view. Environment
values are merged in this order: Velina's `process.env`, top-level `env`, then
app-level `env`; a `null` value removes an inherited variable.

Run history and output are kept in memory only and disappear when Velina exits.
To keep memory bounded, each run retains up to the most recent 256 Ki characters
of stdout and stderr. Older runs can be removed individually or cleared together.

## Configuration

Velina reads `.velina.yml` from the current project directory. For example:

```yaml
# Where you want Velina to run
port: 2209

# Define variables

var:
  # Define a simple key-value string
  foo: abc123
  # Or define a static value explicitly
  bar_static:
    type: static
    value: abc123
  # Get value from script
  bar_script:
    type: script
    value: crypto.randomUUID()
  # Get values from shell
  baz_command:
    type: command
    value: openssl rand -base64 16

# Shared environment variables for all apps
# Refer to variables with <%= it.var.foo %>
# Refer to other envs with <%= it.env.ARIA_URL %>
env:
  SUNNA_URL: http://localhost:9001
  ARIA_URL: htpp://localhost:9002
  NANGONGYU_URL: http://localhost:9003
  # Prevent inheriting specific variables from process env
  NODE_ENV: null

# Specify apps
apps:
  - path: ./apps/sunna
  - path: ./apps/aria
    # name is the folder name by default
    name: aria
    # App-specific environment variables
    env:
      PORT: 9002
      BASE_URL: <%= it.env.ARIA_URL %>
      OAUTH_JWT_AUDIENCE: <%= it.env.SUNNA_URL %>
      OAUTH_REDIRECT_URL: <%= it.env.NANGONGYU_URL %>
      # Prevent inheriting specific variables from shared env
      NODE_ENV: null
    # Specify files to be written before running any of the scripts
    files:
      - path: ./config.json
        content: >
          Hello world! <%= it.env.ARIA_URL %>
    # scripts is read from package.json if exists in the path (pre* and post* is excluded)
    # Override scripts by specifying it here
    scripts:
      start: bun server.ts
```

Variables are evaluated once when Velina starts. Script values are JavaScript
expressions evaluated by Bun; command values run in a shell and use trimmed
stdout. Failures stop startup with the variable name in the error.

Environment values and file contents are rendered once with Eta. Templates use
`<%= it.var.foo %>` and `<%= it.env.NAME %>`. Top-level `env` templates see the
Velina process environment; app-level templates also see resolved top-level env.
File templates see the effective environment for their app.

Files declared in `files` are written at startup. Velina also finds `*.example`
files under each app and maps `config/.env.example` to `config/.env`, but only
when the generated target is ignored by the project’s `.gitignore`. Generated
files are overwritten at startup; explicitly declared files take precedence over
an example targeting the same path.

`script` variables execute JavaScript and `command` variables execute shell
commands automatically during startup. Treat `.velina.yml` and its Eta templates
as trusted code.
