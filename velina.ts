#!/usr/bin/env bun

import { newBunWebSocketRpcHandler, newHttpBatchRpcResponse } from "capnweb";

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

export default {
  routes: { "/ui/*": ui },
  development: args.dev ? { hmr: true, console: true } : false,
  async fetch(req: Request, server: Bun.Server<undefined>) {
    const pathname = new URL(req.url).pathname;

    if (pathname === "/ui") {
      return Response.redirect(new URL("/ui/", req.url), 308);
    }

    if (pathname !== API_PATH) {
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
  websocket: rpcHandler,
  port: loaded.resolved.port,
  hostname: HOSTNAME,
};
