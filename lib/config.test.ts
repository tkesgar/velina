import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";

import {
  DEFAULT_PACKAGE_MANAGER,
  DEFAULT_PORT,
  loadConfig,
  readConfig,
  resolveConfig,
  resolveEnv,
  resolveValue,
  resolveVars,
} from "./config";

const fixturesDir = path.join(import.meta.dir, "tests/fixtures");

describe("config", () => {
  describe("readConfig", () => {
    describe("configPath is not provided", () => {
      it("should read config from default path", async () => {
        expect(readConfig({ cwd: path.join(fixturesDir, "default") })).resolves.toEqual({
          port: 1234,
        });
      });

      it("should return empty config if config file does not exist", async () => {
        expect(readConfig({ cwd: path.join(fixturesDir, "empty") })).resolves.toEqual({});
      });

      it("should throw error if config file is not valid", async () => {
        expect(readConfig({ cwd: path.join(fixturesDir, "invalid") })).rejects.toThrow();
      });
    });

    describe("configPath is provided", () => {
      it("should read config from the provided path", async () => {
        expect(readConfig({ configPath: path.join(fixturesDir, "vars.yml") })).resolves.toEqual({
          vars: { GREETING: "hello" },
        });
      });

      it("should return empty config if config file is empty", async () => {
        expect(readConfig({ configPath: path.join(fixturesDir, "empty.yml") })).resolves.toEqual(
          {},
        );
      });

      it("should throw error if config file does not exist", async () => {
        expect(readConfig({ configPath: path.join(fixturesDir, "unknown.yml") })).rejects.toThrow();
      });

      it("should throw error if config file is not valid", async () => {
        expect(
          readConfig({ configPath: path.join(fixturesDir, "invalid-port.yml") }),
        ).rejects.toThrow();
      });

      it("should throw error if port is out of range", async () => {
        expect(
          readConfig({ configPath: path.join(fixturesDir, "invalid-port-range.yml") }),
        ).rejects.toThrow();
      });

      it("should throw error if port is not an integer", async () => {
        expect(
          readConfig({ configPath: path.join(fixturesDir, "invalid-port-float.yml") }),
        ).rejects.toThrow();
      });

      it("should throw error if config has an unknown key", async () => {
        expect(
          readConfig({ configPath: path.join(fixturesDir, "typo-key.yml") }),
        ).rejects.toThrow();
      });

      it("should throw error if task has an unknown key", async () => {
        expect(
          readConfig({ configPath: path.join(fixturesDir, "typo-task-key.yml") }),
        ).rejects.toThrow();
      });
    });
  });

  describe("resolveValue", () => {
    it("should return value as-is if type = value", () => {
      expect(resolveValue({}, { type: "value", value: "hello" })).toBe("hello");
      expect(resolveValue({}, { type: "value", value: 42 })).toBe(42);

      const objectValue = { nested: true };
      expect(resolveValue({}, { type: "value", value: objectValue })).toBe(objectValue);
    });

    it("should render text using vars and env if type = text", () => {
      const resolved = resolveValue(
        {
          vars: { name: "Vivian" },
          env: { GREETING: "hello" },
        },
        {
          type: "text",
          text: "<%= env.GREETING %>, <%= vars.name %>!",
        },
      );

      expect(resolved).toBe("hello, Vivian!");
    });

    it("should execute command and args if type = cmd", () => {
      expect(resolveValue({}, { type: "cmd", cmd: "echo", args: ["hello", "world"] })).toBe(
        "hello world",
      );
      expect(resolveValue({}, { type: "cmd", cmd: "echo", args: ["Vivian"] })).toBe("Vivian");
    });

    it("should treat a raw string as a text template", () => {
      expect(resolveValue({ vars: { NAME: "Vivian" } }, "Hi, <%= vars.NAME %>!")).toBe(
        "Hi, Vivian!",
      );
    });

    it("should treat raw values as-is", () => {
      expect(resolveValue({}, 42)).toBe(42);
      expect(resolveValue({}, true)).toBe(true);

      const objectValue = { nested: true };
      expect(resolveValue({}, objectValue)).toBe(objectValue);
    });

    it("should treat malformed resolvable-shaped objects as raw values", () => {
      const malformed = { type: "cmd" };

      expect(resolveValue({}, malformed)).toBe(malformed);
    });
  });

  describe("resolveVars", () => {
    it("should resolve values in the provided vars", () => {
      const resolved = resolveVars(
        {},
        {
          GREETING: { type: "value", value: "hello" },
          NAME: { type: "text", text: "Vivian" },
          ECHO: { type: "cmd", cmd: "echo", args: ["done"] },
        },
      );

      expect(resolved).toEqual({
        GREETING: "hello",
        NAME: "Vivian",
        ECHO: "done",
      });
    });

    it("should override values with the same name if overrideVars is provided", () => {
      const resolved = resolveVars(
        { overrideVars: { GREETING: "howdy" } },
        {
          GREETING: { type: "value", value: "hello" },
          NAME: { type: "value", value: "Vivian" },
        },
      );

      expect(resolved).toEqual({
        GREETING: "howdy",
        NAME: "Vivian",
      });
    });
  });

  describe("resolveEnv", () => {
    it("should resolve values in the provided env", () => {
      const resolved = resolveEnv(
        { vars: { NAME: "Vivian" } },
        {
          GREETING: { type: "value", value: "hello" },
          MESSAGE: "Hi, <%= vars.NAME %>!",
          ECHO: { type: "cmd", cmd: "echo", args: ["done"] },
        },
      );

      expect(resolved).toEqual({
        GREETING: "hello",
        MESSAGE: "Hi, Vivian!",
        ECHO: "done",
      });
    });

    it("should add values from parentEnv if parentEnv is provided", () => {
      const resolved = resolveEnv(
        { vars: {} },
        {},
        { parentEnv: { PATH: "/usr/bin", HOME: "/home/vivian" } },
      );

      expect(resolved).toEqual({
        PATH: "/usr/bin",
        HOME: "/home/vivian",
      });
    });

    it("should override parentEnv values with values from the provided env", () => {
      const resolved = resolveEnv(
        { vars: {} },
        { GREETING: { type: "value", value: "new" } },
        { parentEnv: { GREETING: "old", KEEP: "kept" } },
      );

      expect(resolved).toEqual({
        GREETING: "new",
        KEEP: "kept",
      });
    });

    it("should remove parentEnv values when env value is null", () => {
      const resolved = resolveEnv(
        { vars: {} },
        { GREETING: null },
        { parentEnv: { GREETING: "old", KEEP: "kept" } },
      );

      expect(resolved).toEqual({ KEEP: "kept" });
    });
  });

  describe("resolveConfig", () => {
    it("should use defaults for an empty config", async () => {
      const resolved = await resolveConfig({});

      expect(resolved.port).toBe(DEFAULT_PORT);
      expect(resolved.vars).toEqual({});
      expect(resolved.files).toEqual([]);
    });

    it("should use the provided port", async () => {
      const resolved = await resolveConfig({ port: 1234 });

      expect(resolved.port).toBe(1234);
    });

    it("should resolve vars", async () => {
      const resolved = await resolveConfig({
        vars: {
          GREETING: { type: "value", value: "hello" },
          NAME: { type: "text", text: "Vivian" },
          ECHO: { type: "cmd", cmd: "echo", args: ["done"] },
        },
      });

      expect(resolved.vars).toEqual({
        GREETING: "hello",
        NAME: "Vivian",
        ECHO: "done",
      });
    });

    it("should apply overrideVars to resolved vars", async () => {
      const resolved = await resolveConfig(
        {
          vars: {
            GREETING: { type: "value", value: "hello" },
            NAME: { type: "value", value: "Vivian" },
          },
        },
        { overrideVars: { GREETING: "howdy" } },
      );

      expect(resolved.vars).toEqual({
        GREETING: "howdy",
        NAME: "Vivian",
      });
    });

    it("should resolve env values", async () => {
      const resolved = await resolveConfig({
        env: {
          GREETING: { type: "value", value: "hello" },
          ECHO: { type: "cmd", cmd: "echo", args: ["done"] },
        },
      });

      expect(resolved.env.GREETING).toBe("hello");
      expect(resolved.env.ECHO).toBe("done");
    });

    it("should resolve env templates using the resolved vars", async () => {
      const resolved = await resolveConfig({
        vars: { NAME: { type: "value", value: "Vivian" } },
        env: { MESSAGE: "Hi, <%= vars.NAME %>!" },
      });

      expect(resolved.env.MESSAGE).toBe("Hi, Vivian!");
    });

    describe("inheritEnv", () => {
      beforeEach(() => {
        process.env.VELINA_TEST_PARENT_ENV = "inherited";
      });

      afterEach(() => {
        delete process.env.VELINA_TEST_PARENT_ENV;
      });

      it("should inherit process.env by default", async () => {
        const resolved = await resolveConfig({});

        expect(resolved.env.VELINA_TEST_PARENT_ENV).toBe("inherited");
      });

      it("should inherit process.env when inheritEnv is true", async () => {
        const resolved = await resolveConfig({ inheritEnv: true });

        expect(resolved.env.VELINA_TEST_PARENT_ENV).toBe("inherited");
      });

      it("should not inherit process.env when inheritEnv is false", async () => {
        const resolved = await resolveConfig({
          inheritEnv: false,
          env: { GREETING: { type: "value", value: "hello" } },
        });

        expect(resolved.env).toEqual({ GREETING: "hello" });
      });
    });

    it("should resolve file paths against rootDir and render content", async () => {
      const rootDir = path.join(fixturesDir, "empty");
      const resolved = await resolveConfig({
        rootDir,
        vars: { NAME: { type: "value", value: "Vivian" } },
        env: { GREETING: "hello" },
        files: [
          {
            path: "greeting.txt",
            content: { type: "text", text: "<%= env.GREETING %>, <%= vars.NAME %>!" },
          },
          {
            path: "count.txt",
            content: { type: "value", value: 42 },
          },
        ],
      });

      expect(resolved.files).toEqual([
        { path: path.join(rootDir, "greeting.txt"), content: "hello, Vivian!" },
        { path: path.join(rootDir, "count.txt"), content: "42" },
      ]);
    });

    describe("tasks", () => {
      const tasksFixtures = path.join(fixturesDir, "tasks");

      const task = (cwd: string, name: string, packageManager = DEFAULT_PACKAGE_MANAGER) => ({
        cmd: packageManager,
        args: ["run", name],
        cwd,
        env: {},
        files: [],
      });

      it("should return no tasks if rootDir has no package.json", async () => {
        const resolved = await resolveConfig({ rootDir: path.join(tasksFixtures, "no-manifest") });

        expect(resolved.tasks).toEqual({});
      });

      it("should add root scripts as tasks", async () => {
        const rootDir = path.join(tasksFixtures, "root-scripts");
        const resolved = await resolveConfig({ rootDir });

        expect(resolved.tasks).toEqual({
          dev: task(rootDir, "dev"),
          build: task(rootDir, "build"),
        });
      });

      it("should use the configured packageManager", async () => {
        const rootDir = path.join(tasksFixtures, "custom-pm");
        const resolved = await resolveConfig({ rootDir, packageManager: "npm" });

        expect(resolved.tasks.test).toEqual(task(rootDir, "test", "npm"));
      });

      it("should add workspace scripts with the relative directory as prefix", async () => {
        const rootDir = path.join(tasksFixtures, "workspaces");
        const resolved = await resolveConfig({ rootDir });

        expect(resolved.tasks).toEqual({
          "apps/frontend:dev": task(path.join(rootDir, "apps/frontend"), "dev"),
          "apps/frontend:build": task(path.join(rootDir, "apps/frontend"), "build"),
          "packages/utils:test": task(path.join(rootDir, "packages/utils"), "test"),
        });
      });

      it("should exclude workspaces matched by a negated pattern", async () => {
        const rootDir = path.join(tasksFixtures, "workspaces-negated");
        const resolved = await resolveConfig({ rootDir });

        expect(resolved.tasks).toEqual({
          "apps/frontend:dev": task(path.join(rootDir, "apps/frontend"), "dev"),
        });
      });

      it("should ignore a workspaces object", async () => {
        const rootDir = path.join(tasksFixtures, "workspace-object");
        const resolved = await resolveConfig({ rootDir });

        expect(resolved.tasks).toEqual({});
      });

      it("should not copy env into scanned tasks", async () => {
        process.env.VELINA_TEST_TASK_ENV = "leak";
        try {
          const rootDir = path.join(tasksFixtures, "root-scripts");
          const resolved = await resolveConfig({ rootDir });

          expect(resolved.tasks.dev.env).toEqual({});
        } finally {
          delete process.env.VELINA_TEST_TASK_ENV;
        }
      });

      it("should let config tasks override scanned tasks and null remove them", async () => {
        const rootDir = path.join(tasksFixtures, "root-scripts");
        const resolved = await resolveConfig({
          rootDir,
          inheritEnv: false,
          tasks: {
            dev: { cmd: "pnpm", args: ["run", "dev", "--watch"] },
            build: null,
            custom: { cmd: "echo", args: ["hi"] },
          },
        });

        expect(resolved.tasks).toEqual({
          dev: { cmd: "pnpm", args: ["run", "dev", "--watch"], cwd: rootDir, env: {}, files: [] },
          custom: { cmd: "echo", args: ["hi"], cwd: rootDir, env: {}, files: [] },
        });
      });

      it("should resolve a config task cwd against rootDir", async () => {
        const rootDir = path.join(fixturesDir, "empty");
        const resolved = await resolveConfig({
          rootDir,
          tasks: {
            build: { cmd: "echo", cwd: "packages/frontend" },
          },
        });

        expect(resolved.tasks.build.cwd).toBe(path.join(rootDir, "packages/frontend"));
      });

      it("should resolve env and files for config tasks", async () => {
        const rootDir = path.join(fixturesDir, "empty");
        const resolved = await resolveConfig({
          rootDir,
          vars: { NAME: { type: "value", value: "Vivian" } },
          tasks: {
            greet: {
              cmd: "echo",
              env: { MESSAGE: "Hi, <%= vars.NAME %>!" },
              files: [{ path: "greeting.txt", content: { type: "value", value: "hello" } }],
            },
          },
        });

        expect(resolved.tasks.greet.args).toEqual([]);
        expect(resolved.tasks.greet.env.MESSAGE).toBe("Hi, Vivian!");
        expect(resolved.tasks.greet.files).toEqual([
          { path: path.join(rootDir, "greeting.txt"), content: "hello" },
        ]);
      });
    });
  });

  describe("loadConfig", () => {
    it("should read and resolve the default config", async () => {
      const resolved = await loadConfig({ cwd: path.join(fixturesDir, "default") });

      expect(resolved.port).toBe(1234);
    });

    it("should read and resolve the provided config path", async () => {
      const resolved = await loadConfig({ configPath: path.join(fixturesDir, "vars.yml") });

      expect(resolved.vars).toEqual({ GREETING: "hello" });
    });

    it("should apply override vars on top of the config vars", async () => {
      const resolved = await loadConfig({
        configPath: path.join(fixturesDir, "vars.yml"),
        overrideVars: { GREETING: "howdy", NAME: "Vivian" },
      });

      expect(resolved.vars).toEqual({ GREETING: "howdy", NAME: "Vivian" });
    });

    it("should use defaults when the config file does not exist at the default path", async () => {
      const resolved = await loadConfig({ cwd: path.join(fixturesDir, "empty") });

      expect(resolved.port).toBe(DEFAULT_PORT);
      expect(resolved.vars).toEqual({});
      expect(resolved.files).toEqual([]);
    });
  });
});
