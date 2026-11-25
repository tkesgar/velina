#!/usr/bin/env bun

import type { RpcStub } from "capnweb";

import { isYamlConfig, type VelinaApi } from "./lib/api";
import { parseCliArgs, type CliArgs } from "./lib/cli-args";
import { formatLogLine, openApi, printJson, resolvePort, resolveProcessId } from "./lib/cli-client";

const USAGE = `Usage:
  velina-cli config [--format yaml]       show provided and resolved config
  velina-cli groups                       list task groups and their tasks
  velina-cli start <task>                 start a task
  velina-cli start-group <group>          start every task in a group
  velina-cli ps                           list all processes
  velina-cli process <id>                 show process details
  velina-cli logs <id> [stdout|stderr]    stream process logs
  velina-cli stop <id>                    stop a process
  velina-cli stop-group <group>           stop running tasks in a group
  velina-cli delete <id>                  delete a stopped process

Options:
  --port <port>    server port (default: from .velina.yml, otherwise 2222)
  --json           log entries as JSON lines
  --help           show this message

Process ids may be abbreviated to any unique prefix.`;

async function run(args: CliArgs, api: RpcStub<VelinaApi>): Promise<void> {
  switch (args.command) {
    case "config": {
      if (args.format === "yaml") {
        const config = await Promise.resolve(api.getConfig({ format: "yaml" }));
        if (!isYamlConfig(config)) {
          throw new Error("Unexpected config format");
        }
        console.log(config.resolved.trimEnd());
        return;
      }

      printJson(await Promise.resolve(api.getConfig()));
      return;
    }
    case "groups":
      printJson(await Promise.resolve(api.getAllTaskGroups()));
      return;
    case "start":
      printJson(await Promise.resolve(api.startTask(args.target!)));
      return;
    case "start-group":
      printJson(await Promise.resolve(api.startTaskGroup(args.target!)));
      return;
    case "ps":
      printJson(await Promise.resolve(api.getAllProcesses()));
      return;
    case "process": {
      const id = await resolveProcessId(api, args.target!);
      printJson(await Promise.resolve(api.getProcess(id)));
      return;
    }
    case "logs": {
      const id = await resolveProcessId(api, args.target!);
      const stream = await Promise.resolve(api.streamProcessLogs(id, args.logType ?? "stdout"));
      const reader = stream.getReader();
      let cancelled = false;

      const onInterrupt = () => {
        cancelled = true;
        void reader.cancel().catch(() => {});
      };
      process.on("SIGINT", onInterrupt);

      try {
        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done || cancelled) break;
          if (args.json) console.log(JSON.stringify(value));
          else console.log(formatLogLine(value));
        }
      } finally {
        process.off("SIGINT", onInterrupt);
        try {
          reader.releaseLock();
        } catch {
          // The stream may already be closed after an interrupt.
        }
      }
      return;
    }
    case "stop": {
      const id = await resolveProcessId(api, args.target!);
      printJson(await Promise.resolve(api.stopProcess(id)));
      return;
    }
    case "stop-group":
      printJson(await Promise.resolve(api.stopTaskGroup(args.target!)));
      return;
    case "delete": {
      const id = await resolveProcessId(api, args.target!);
      await Promise.resolve(api.deleteProcess(id));
      printJson({ deleted: id });
      return;
    }
  }
}

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return 2;
  }

  if (args.command === "help") {
    console.log(USAGE);
    return 0;
  }

  let api: RpcStub<VelinaApi> | undefined;
  try {
    const port = await resolvePort({ port: args.port });
    api = openApi(port);
    await run(args, api);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Is Velina running? Start it with `velina`.");
    return 1;
  } finally {
    api?.[Symbol.dispose]();
  }
}

process.exit(await main());
