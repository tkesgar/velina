#!/usr/bin/env bun
import { newBunWebSocketRpcHandler } from "capnweb";
import dashboard from "./client/index.html";
import { Velina, VelinaApi } from "./velina";

function getPort(args: string[]) {
  const portIndex = args.findIndex((arg) => arg === "--port" || arg === "-p");
  const portValue = portIndex === -1 ? undefined : args[portIndex + 1];
  const port = portValue === undefined ? 2209 : Number(portValue);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${portValue ?? ""}`);
  }

  return port;
}

const velina = new Velina()
const rpcHandler = newBunWebSocketRpcHandler(() => new VelinaApi(velina))

const port = getPort(Bun.argv.slice(2));
Bun.serve({
  port,
  routes: {
    "/dashboard": dashboard,
    "/api": (request, server) => {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket upgrade required", {
          status: 426,
          headers: { Upgrade: "websocket" },
        })
      }

      if (
        server.upgrade(request, {
          // Cap'n Web initializes ws.data in its open callback.
          data: {} as Parameters<typeof rpcHandler.open>[0]["data"],
        })
      ) {
        return
      }

      return new Response("WebSocket upgrade failed", { status: 500 })
    },
    "/": (request) => {
      return Response.redirect(new URL("/dashboard", request.url), 307)
    }
  },
  websocket: rpcHandler,
});

console.log(`Velina is running at http://localhost:${port}`);
