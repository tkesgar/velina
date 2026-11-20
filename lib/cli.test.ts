import { describe, expect, it } from "bun:test";

import { parseArgs } from "./cli";

describe("parseArgs", () => {
  it("should return no config path and no vars for an empty argv", () => {
    expect(parseArgs([])).toEqual({ dev: false, vars: {} });
  });

  it("should read --config-path with a separate value", () => {
    expect(parseArgs(["--config-path", "config.yml"])).toEqual({
      configPath: "config.yml",
      dev: false,
      vars: {},
    });
  });

  it("should read --config-path with an inline value", () => {
    expect(parseArgs(["--config-path=config.yml"])).toEqual({
      configPath: "config.yml",
      dev: false,
      vars: {},
    });
  });

  it("should read multiple --var entries", () => {
    expect(parseArgs(["--var", "A=1", "--var", "B=two"])).toEqual({
      dev: false,
      vars: { A: "1", B: "two" },
    });
  });

  it("should read inline --var entries", () => {
    expect(parseArgs(["--var=A=1"])).toEqual({ dev: false, vars: { A: "1" } });
  });

  it("should preserve additional = characters in the value", () => {
    expect(parseArgs(["--var", "TOKEN=a=b"])).toEqual({ dev: false, vars: { TOKEN: "a=b" } });
  });

  it("should let a later --var override an earlier value with the same name", () => {
    expect(parseArgs(["--var", "A=1", "--var", "A=2"])).toEqual({
      dev: false,
      vars: { A: "2" },
    });
  });

  it("should read --config-path and --var together", () => {
    expect(parseArgs(["--config-path", "config.yml", "--var", "A=1"])).toEqual({
      configPath: "config.yml",
      dev: false,
      vars: { A: "1" },
    });
  });

  it("should read --dev", () => {
    expect(parseArgs(["--dev"])).toEqual({ dev: true, vars: {} });
    expect(parseArgs(["--dev", "--config-path", "config.yml"])).toEqual({
      configPath: "config.yml",
      dev: true,
      vars: {},
    });
  });

  it("should reject unknown arguments", () => {
    expect(() => parseArgs(["--hot"])).toThrow("Unknown option");
    expect(() => parseArgs(["extra"])).toThrow("Unexpected argument");
  });

  it("should throw when --config-path has no value", () => {
    expect(() => parseArgs(["--config-path"])).toThrow();
    expect(() => parseArgs(["--config-path", "--var", "A=1"])).toThrow();
    expect(() => parseArgs(["--config-path="])).toThrow("Missing value for --config-path");
  });

  it("should throw when --var has no value", () => {
    expect(() => parseArgs(["--var"])).toThrow();
    expect(() => parseArgs(["--var="])).toThrow("expected NAME=VALUE");
  });

  it("should throw when --var is not in NAME=VALUE form", () => {
    expect(() => parseArgs(["--var", "A"])).toThrow("expected NAME=VALUE");
    expect(() => parseArgs(["--var=A"])).toThrow("expected NAME=VALUE");
    expect(() => parseArgs(["--var", "=value"])).toThrow("expected NAME=VALUE");
  });
});
