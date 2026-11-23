# Velina

Velina is a local task runner built on Bun. It scans `package.json` scripts, runs tasks as background processes, exposes an RPC API over Cap'n Web, and provides a React web UI. The server binds only to `127.0.0.1`; there is no authentication and no remote mode.

## Layout

| Path                                   | Purpose                                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `velina.ts`                            | server entry and command dispatch (`init`, `config check`, `schema`, `--help`); default export is the Bun server object |
| `velina-cli.ts`                        | CLI client for the API                                                                                                  |
| `lib/config.ts`                        | Zod config schema, loading, resolution, `loadConfig()`                                                                  |
| `lib/glob.ts`                          | wildcard key detection and env/task glob matching used by config resolution                                             |
| `lib/velina.ts`                        | `Velina` process/log store (no Cap'n Web imports)                                                                       |
| `lib/velina-rpc.ts`                    | `VelinaRpcTarget`, thin adapter over `Velina`                                                                           |
| `lib/api.ts`                           | shared API types and `isYamlConfig()` guard                                                                             |
| `lib/commands.ts`                      | `velina init`, `config check`, `schema` implementations                                                                 |
| `assets/velina.txt`                    | ASCII art, imported as text by `lib/banner.ts`                                                                          |
| `lib/banner.ts`                        | startup banner, terminal/agent detection, clipboard fallback                                                            |
| `lib/cli-args.ts`, `lib/cli-client.ts` | CLI argument parsing and client helpers                                                                                 |
| `web/`                                 | Vite-free frontend built by Bun's HTML import                                                                           |
| `lib/tests/fixtures/`                  | config fixtures for tests                                                                                               |

## Commands

```
bun test                  # all tests
bunx tsc --noEmit         # type check
bun run lint              # oxlint
bun run format:check      # oxfmt
bun velina.ts             # start from this repo (uses .velina.yml)
bun velina.ts --dev       # frontend HMR, only for developing the UI
bun velina-cli.ts ps      # exercise the CLI
```

Always leave `bun test`, `tsc --noEmit`, `lint`, and `format:check` green. Integration tests spawn real servers on free ports; do not leave stray `velina.ts` processes behind.

## Architecture

### Configuration

- `zConfig` is strict: unknown keys are rejected. Missing `.velina.yml` is an empty config; an explicitly provided missing path is an error.
- `readConfig()` parses YAML; `resolveConfig()` applies defaults, vars, env, files, and task scanning; `loadConfig()` returns `{ provided, resolved }`.
- Wildcard keys delete env vars or tasks; they must be `null`, and negation (`!`) is tasks-only. Both maps are processed in declaration order, so a later explicit key can re-add or override a deleted entry.
- `getConfig({ format: "yaml" })` returns `{ provided: string, resolved: string }` using `Bun.YAML.stringify(value, null, 2)`.
- Scanned tasks receive the resolved root env. This is essential: `Bun.spawn` with `env: {}` has no `PATH`, so `bun` cannot be found.

### Process store

- `Velina` is plain TypeScript and unit-testable without a socket. One shared instance lives in `velina.ts`; a new `VelinaRpcTarget` wraps it per session, so processes survive client reconnects.
- A task has at most one running process; stopped tasks can be restarted.
- Logs are line entries with timestamps, bounded at 5,000 per process and per subscriber. `streamProcessLogs` replays stored lines then follows live ones, registering the subscriber before replay with no `await` in between. Every stream has a `cancel()` handler to unsubscribe.
- `stopProcess` sends SIGTERM with a SIGKILL fallback after five seconds, is idempotent, and keeps logs. `deleteProcess` only works on stopped processes.

### RPC and server

- `VelinaRpcTarget extends RpcTarget`. Only prototype methods are reachable over RPC; keep state in `#private` fields and use `#private` helpers, not TypeScript `private`.
- `/api` handles both HTTP batch and WebSocket. Streaming requires WebSocket.
- The server uses an explicit `Bun.serve()` call with `routes: { "/ui/*": ui }` and `logStartup: false` (suppresses Bun's own startup line; the option is missing from `@types/bun`). Bun generates and serves hashed asset URLs automatically — no Vite, no proxy, no manual static handler. capnweb's WebSocket handler predates Bun's `(error, ws)` callback order, so it is wrapped with a small adapter.
- `hostname` is hardcoded to `127.0.0.1`. Browser WebSocket upgrades from other origins are rejected.

### CLI

- One short subcommand per API method: `config`, `start`, `ps`, `process`, `logs`, `stop`, `delete`, plus `--help`.
- All structured output is JSON; `logs` prints timestamped lines by default and JSONL with `--json`.
- One WebSocket session per invocation, disposed on exit. Port comes from local `.velina.yml` unless `--port` is given. Process ids may be abbreviated to a unique prefix.
- Exit codes: `0` success, `1` API/runtime error, `2` usage error.

### Startup banner

- `lib/banner.ts` is pure and injectable; `velina.ts` supplies the terminal context and clipboard adapter. It is silenced unless stdout is a TTY, `TERM` is not `dumb`, and no CI/agent env marker is set. `VELINA_BANNER=1` forces it, `0` suppresses it.
- The art prints when the terminal is at least 56 columns wide; height is ignored because vertical scrolling is harmless. Narrower terminals get the informational lines only. The CLI hint includes `--port <port>` only for non-default ports.
- Clipboard support is best-effort: native helpers (`pbcopy`, `wl-copy`, `xclip`, `clip.exe`) first, OSC 52 on a TTY as a fallback, otherwise no notice.

### Web UI

- React 19, React Router 8 declarative mode with `basename="/ui"`, Chakra UI v3, Feather icons via `react-icons`, Geist variable fonts, and `react-shiki/core` for YAML/JSON highlighting.
- Color mode is a small local-storage provider in `web/src/lib/color-mode.tsx`; it applies `light`/`dark` to `<html>` and sets `colorScheme`.
- Data comes from one Cap'n Web session in `web/src/lib/velina-context.tsx`. `useProcesses()` polls every second; `useProcessLogs()` cancels its reader on unmount or selection change.

## Gotchas learned the hard way

- Cap'n Web stub types collapse overloaded method signatures to the last one. Use a single union return type plus a type guard (`isYamlConfig`) instead of overloads on `VelinaApi`.
- Cap'n Web stubs are callable. In React, `setState(stub)` is treated as an updater — use `setState(() => stub)`. StrictMode double-invokes state initializers, so the RPC session is created behind a `useRef` guard; do not dispose it in an effect cleanup. `useProcessLogs` cancels streams that arrive after cleanup so its double mount cannot leak a subscriber.
- `next-themes` renders its pre-hydration `<script>` as a React child, which Bun places inside `#root` and React warns about. Keep the custom color-mode provider.
- Chakra v3 font tokens are `heading`, `body`, and `mono` — there is no `sans` token.
- `--dev` only enables HMR for Velina's own UI. Consumer projects scaffolded with `velina init` get only the `velina` script.
