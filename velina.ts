#!/usr/bin/env bun

import { newBunWebSocketRpcHandler, newHttpBatchRpcResponse } from "capnweb";

import {
  copyToClipboard,
  createClipboardDeps,
  formatBanner,
  shouldPrintBanner,
  shouldShowArt,
  type TerminalContext,
} from "./lib/banner";
import { parseArgs } from "./lib/cli";
import { handleCommand } from "./lib/commands";
import { loadConfig } from "./lib/config";
import { Velina } from "./lib/velina";
import { VelinaRpcTarget } from "./lib/velina-rpc";
import ui from "./web/index.html";

// The API controls local processes and exposes their logs, so it is
// intentionally unreachable from other hosts.
const HOSTNAME = "127.0.0.1";
const API_PATH = "/api";

// Browser WebSockets are always cross-origin, and there is no authentication.
// Permit local pages, but refuse to let an arbitrary website drive the API.
function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;

  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

const commandExit = await handleCommand(process.argv.slice(2));
if (commandExit !== undefined) {
  process.exit(commandExit);
}

const args = parseArgs(process.argv.slice(2));
const loaded = await loadConfig({
  configPath: args.configPath,
  overrideVars: args.vars,
});

const velina = new Velina(loaded);
const rpcHandler = newBunWebSocketRpcHandler(() => new VelinaRpcTarget(velina));

const httpServer = Bun.serve({
  routes: { "/ui/*": ui },
  development: args.dev ? { hmr: true, console: true } : false,
  async fetch(req: Request, server: Bun.Server<undefined>) {
    const pathname = new URL(req.url).pathname;

    if (pathname === "/ui") {
      return Response.redirect(new URL("/ui/", req.url), 308);
    }

    if (pathname !== API_PATH) {
      // A browser following a stale link gets the UI; everything else gets a
      // plain 404. Temporary redirect so a typo is not cached permanently.
      if (req.headers.get("accept")?.toLowerCase().includes("text/html")) {
        return Response.redirect(new URL("/ui/", req.url), 302);
      }
      return new Response("Not found", { status: 404 });
    }

    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      if (!isAllowedOrigin(req)) {
        return new Response("Forbidden", { status: 403 });
      }
      if (server.upgrade(req)) return;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    return newHttpBatchRpcResponse(req, new VelinaRpcTarget(velina));
  },
  websocket: {
    ...rpcHandler,
    // capnweb predates Bun's (error, ws) callback order.
    error(error: Error, ws: Parameters<typeof rpcHandler.error>[0]) {
      rpcHandler.error(ws, error);
    },
  },
  port: loaded.resolved.port,
  hostname: HOSTNAME,
  // Bun's own startup line is replaced by the banner below.
  // @ts-expect-error logStartup works at runtime but is missing from @types/bun.
  logStartup: false,
});

let shuttingDown = false;
let forcedShutdown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) {
    // A second signal means the caller has lost patience; do not hang.
    if (!forcedShutdown) {
      forcedShutdown = true;
      process.exit(1);
    }
    return;
  }
  shuttingDown = true;
  httpServer.stop(true);
  try {
    await velina.shutdown();
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

const port = httpServer.port || loaded.resolved.port;
const terminal: TerminalContext = {
  env: process.env,
  isTTY: Boolean(process.stdout.isTTY),
  columns: process.stdout.columns,
};

if (shouldPrintBanner(terminal)) {
  const uiUrl = `http://127.0.0.1:${port}/ui/`;
  const clipboard = copyToClipboard(uiUrl, terminal, createClipboardDeps());
  process.stdout.write(formatBanner({ port, showArt: shouldShowArt(terminal), clipboard }));
}
