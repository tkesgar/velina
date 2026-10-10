#!/usr/bin/env bun

import { RpcTarget, newHttpBatchRpcResponse } from "capnweb";
import index from "./index.html";

class VelinaApi extends RpcTarget {
  hello(name = "world") {
    return `Hello, ${name}!`;
  }
}

function getPort(args: string[]) {
  const portIndex = args.findIndex((arg) => arg === "--port" || arg === "-p");
  const portValue = portIndex === -1 ? undefined : args[portIndex + 1];
  const port = portValue === undefined ? 2209 : Number(portValue);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${portValue ?? ""}`);
  }

  return port;
}

const port = getPort(Bun.argv.slice(2));
Bun.serve({
  hostname: "127.0.0.1",
  port,
  routes: {
    "/api": async (request) =>
      newHttpBatchRpcResponse(request, new VelinaApi()),
    "/": index,
  },
  fetch() {
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Velina is running at http://localhost:${port}`);
