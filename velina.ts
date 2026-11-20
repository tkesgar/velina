#!/usr/bin/env bun

import { newBunWebSocketRpcHandler, newHttpBatchRpcResponse } from "capnweb";

import { parseArgs } from "./lib/cli";
import { loadConfig } from "./lib/config";
import { Velina } from "./lib/velina";
import { VelinaRpcTarget } from "./lib/velina-rpc";

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

const args = parseArgs(process.argv.slice(2));
const config = await loadConfig({
  configPath: args.configPath,
  overrideVars: args.vars,
});

const velina = new Velina(config);
const rpcHandler = newBunWebSocketRpcHandler(() => new VelinaRpcTarget(velina));

export default {
  async fetch(req: Request, server: Bun.Server<undefined>) {
    if (new URL(req.url).pathname !== API_PATH) {
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
  port: config.port,
  hostname: HOSTNAME,
};
