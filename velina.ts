#!/usr/bin/env bun

import { parseArgs } from "./lib/cli";
import { loadConfig } from "./lib/config";

const args = parseArgs(process.argv.slice(2));
const config = await loadConfig({
  configPath: args.configPath,
  overrideVars: args.vars,
});

export default {
  fetch() {
    return new Response("Hello world!");
  },
  port: config.port,
  hostname: config.host,
};
