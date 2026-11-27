import { describe, expect, it } from "bun:test";

import { parseCliArgs } from "./cli-args";

describe("parseCliArgs", () => {
  it("should return help for no arguments or --help", () => {
    expect(parseCliArgs([])).toEqual({ command: "help", json: false });
    expect(parseCliArgs(["--help"])).toEqual({ command: "help", json: false });
  });

  it("should parse commands without targets", () => {
    expect(parseCliArgs(["config"])).toEqual({ command: "config", json: false });
    expect(parseCliArgs(["groups"])).toEqual({ command: "groups", json: false });
    expect(parseCliArgs(["ps"])).toEqual({ command: "ps", json: false });
  });

  it("should parse commands with a target", () => {
    expect(parseCliArgs(["start", "backend:dev"])).toEqual({
      command: "start",
      json: false,
      target: "backend:dev",
    });
    expect(parseCliArgs(["delete", "abc123"])).toEqual({
      command: "delete",
      json: false,
      target: "abc123",
    });
    expect(parseCliArgs(["start-group", "services-dev"])).toEqual({
      command: "start-group",
      json: false,
      target: "services-dev",
    });
    expect(parseCliArgs(["stop-group", "services-dev"])).toEqual({
      command: "stop-group",
      json: false,
      target: "services-dev",
    });
    expect(parseCliArgs(["metrics", "abc123"])).toEqual({
      command: "metrics",
      json: false,
      target: "abc123",
    });
  });

  it("should parse logs with an optional type", () => {
    expect(parseCliArgs(["logs", "abc123"])).toEqual({
      command: "logs",
      json: false,
      target: "abc123",
    });
    expect(parseCliArgs(["logs", "abc123", "stderr"])).toEqual({
      command: "logs",
      json: false,
      logType: "stderr",
      target: "abc123",
    });
  });

  it("should parse options", () => {
    expect(parseCliArgs(["config", "--format", "yaml", "--port", "3333", "--json"])).toEqual({
      command: "config",
      format: "yaml",
      json: true,
      port: 3333,
    });
  });

  it("should reject unknown commands and extra arguments", () => {
    expect(() => parseCliArgs(["unknown"])).toThrow("Unknown command");
    expect(() => parseCliArgs(["config", "extra"])).toThrow("takes no arguments");
    expect(() => parseCliArgs(["groups", "extra"])).toThrow("takes no arguments");
  });

  it("should reject missing targets", () => {
    expect(() => parseCliArgs(["start"])).toThrow("Missing argument");
    expect(() => parseCliArgs(["start-group"])).toThrow("Missing argument");
    expect(() => parseCliArgs(["stop-group"])).toThrow("Missing argument");
    expect(() => parseCliArgs(["metrics"])).toThrow("Missing argument");
    expect(() => parseCliArgs(["logs"])).toThrow("Missing process id");
  });

  it("should reject invalid options", () => {
    expect(() => parseCliArgs(["config", "--format", "json"])).toThrow("Invalid --format");
    expect(() => parseCliArgs(["ps", "--format", "yaml"])).toThrow("only valid for config");
    expect(() => parseCliArgs(["config", "--port", "0"])).toThrow("Invalid --port");
    expect(() => parseCliArgs(["logs", "abc", "both"])).toThrow("Invalid log type");
  });

  it("should parse labels on task commands", () => {
    expect(parseCliArgs(["start", "build", "--label", "bench"])).toEqual({
      command: "start",
      json: false,
      target: "build",
      label: "bench",
    });
    expect(parseCliArgs(["start-group", "dev", "--label", "bench"])).toEqual({
      command: "start-group",
      json: false,
      target: "dev",
      label: "bench",
    });
  });

  it("should parse process filters and cleanup", () => {
    expect(parseCliArgs(["ps", "--label", "bench", "--task", "build", "--kind", "run"])).toEqual({
      command: "ps",
      json: false,
      label: "bench",
      taskFilter: "build",
      kindFilter: "run",
    });
    expect(parseCliArgs(["cleanup", "--label", "bench"])).toEqual({
      command: "cleanup",
      json: false,
      label: "bench",
    });
  });

  it("should parse benchmark options with fractional wait in seconds", () => {
    expect(
      parseCliArgs([
        "bench",
        "build",
        "--repeat",
        "5",
        "--label",
        "benchmark",
        "--pre-hook",
        "clean",
        "--post-hook",
        "reset",
        "--wait",
        "0.5",
      ]),
    ).toEqual({
      command: "bench",
      json: false,
      target: "build",
      repeat: 5,
      label: "benchmark",
      preHook: "clean",
      postHook: "reset",
      waitSeconds: 0.5,
    });
    expect(parseCliArgs(["bench", "build"])).toEqual({
      command: "bench",
      json: false,
      target: "build",
    });
  });

  it("should reject invalid filters and benchmark options", () => {
    expect(() => parseCliArgs(["ps", "--kind", "unknown"])).toThrow("Invalid --kind");
    expect(() => parseCliArgs(["ps", "--repeat", "5"])).toThrow("only valid for bench");
    expect(() => parseCliArgs(["cleanup"])).toThrow("requires --label or --task");
    expect(() => parseCliArgs(["bench", "build", "--repeat", "0"])).toThrow("Invalid --repeat");
    expect(() => parseCliArgs(["bench", "build", "--repeat", "101"])).toThrow("Invalid --repeat");
    expect(() => parseCliArgs(["bench", "build", "--wait", "1m"])).toThrow("Invalid --wait");
    expect(() => parseCliArgs(["bench", "build", "--wait=-1"])).toThrow("Invalid --wait");
    expect(() => parseCliArgs(["bench", "build", "--wait", "1500ms"])).toThrow("Invalid --wait");
    expect(() => parseCliArgs(["bench", "build", "--pre-hook", "build"])).toThrow("different task");
    expect(() => parseCliArgs(["bench", "build", "--post-hook", "build"])).toThrow(
      "different task",
    );
  });
});
