# velina

velina is a small UI to run commands, useful for monorepos.

## Install

```sh
bun add -g github:tkesgar/velina
```

## Usage

```sh
# Starts the web UI at http://localhost:2209
$ velina

# Override the listening port
$ velina --port 3000
```

The app is run directly from TypeScript by Bun; there is no build or publish step.

## Development

```sh
bun install
bun run dev
```

The `/api` endpoint uses Cap'n Web HTTP batch RPC. The initial `hello(name)` method
is a small end-to-end example; the UI is built with React and Ant Design.

## Configuration

The following is the planned configuration shape for managing multiple apps. It
is not read by the initial hello-world app yet.

```yaml
# Where you want Velina to run
port: 2209

# Define variables

var:
  # Define a simple key-value string
  foo: abc123
  # Get value from script
  bar:
    type: script
    value: crypto.randomUUID()
  # Get values from shell
  baz:
    type: command
    value: openssl rand -base64 16

# Shared environment variables for all apps
# Refer to vars with <%= var.foo %>
# Refer to other envs with <%= env.ARIA_URL %>
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
      BASE_URL: <%= env.ARIA_URL %>
      OAUTH_JWT_AUDIENCE: <%= env.SUNNA_URL %>
      OAUTH_REDIRECT_URL: <%= env.NANGONGYU_URL %>
      # Prevent inheriting specific variables from shared env
      NODE_ENV: null
    # Specify files to be written before running any of the scripts
    files:
      - path: ./config.json
        content: >
          Hello world! <%= env.ARIA_URL %>
    # scripts is read from package.json if exists in the path (pre* and post* is excluded)
    # Override scripts by specifying it here
    # Can use vars and envs here
    scripts:
      start: BASE_URL="<%= env.ARIA_URL %>" bun server.ts
```
