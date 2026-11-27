import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";

import {
  DEFAULT_LOG_DIR,
  DEFAULT_LOG_PERSISTENCE,
  DEFAULT_PACKAGE_MANAGER,
  DEFAULT_PORT,
  type Config,
  loadConfig,
  readConfig,
  resolveConfig,
  resolveEnv,
  resolveValue,
  resolveVars,
  zConfig,
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

      it("should throw error if a glob env key has a non-null value", async () => {
        expect(
          readConfig({ configPath: path.join(fixturesDir, "invalid-glob-env.yml") }),
        ).rejects.toThrow("glob keys must have a null value");
      });

      it("should throw error if a glob task key has a non-null value", async () => {
        expect(
          readConfig({ configPath: path.join(fixturesDir, "invalid-glob-task.yml") }),
        ).rejects.toThrow("glob keys must have a null value");
      });

      it("should throw error if an env key uses negation", async () => {
        expect(
          readConfig({ configPath: path.join(fixturesDir, "invalid-glob-negated-env.yml") }),
        ).rejects.toThrow("negated glob keys are only supported for tasks");
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

    it("should remove every matching env key when the key is a glob", () => {
      const resolved = resolveEnv(
        { vars: {} },
        { "NODE_*": null, GREETING: "hello" },
        {
          parentEnv: {
            NODE_ENV: "old",
            NODE_OPTIONS: "--old",
            NUXT_ENV: "keep",
            PATH: "/usr/bin",
          },
        },
      );

      expect(resolved).toEqual({ NUXT_ENV: "keep", PATH: "/usr/bin", GREETING: "hello" });
    });

    it("should apply env globs to keys defined earlier in the same map", () => {
      const resolved = resolveEnv(
        { vars: {} },
        { NODE_ENV: "first", "NODE_*": null, NODE_OPTIONS: "second" },
      );

      expect(resolved).toEqual({ NODE_OPTIONS: "second" });
    });

    it("should reject a non-null value or negation for an env glob", () => {
      expect(() => resolveEnv({ vars: {} }, { "NODE_*": "value" })).toThrow();
      expect(() => resolveEnv({ vars: {} }, { "!NODE_*": null })).toThrow();
    });
  });

  describe("resolveConfig", () => {
    it("should use defaults for an empty config", async () => {
      const resolved = await resolveConfig({});

      expect(resolved.port).toBe(DEFAULT_PORT);
      expect(resolved.vars).toEqual({});
      expect(resolved.files).toEqual([]);
      expect(resolved.logs).toEqual({
        enabled: DEFAULT_LOG_PERSISTENCE,
        dir: path.resolve(DEFAULT_LOG_DIR),
      });
    });

    it("should resolve the log directory against rootDir", async () => {
      const resolved = await resolveConfig({
        rootDir: "/tmp/velina-root",
        logs: { enabled: false, dir: "./artifacts/logs" },
      });

      expect(resolved.logs).toEqual({
        enabled: false,
        dir: path.resolve("/tmp/velina-root/artifacts/logs"),
      });
    });

    it("should reject unknown log settings", () => {
      expect(() => zConfig.parse({ logs: { unknown: true } })).toThrow();
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
        const resolved = await resolveConfig({ rootDir, inheritEnv: false });

        expect(resolved.tasks).toEqual({
          dev: task(rootDir, "dev"),
          build: task(rootDir, "build"),
        });
      });

      it("should use the configured packageManager", async () => {
        const rootDir = path.join(tasksFixtures, "custom-pm");
        const resolved = await resolveConfig({ rootDir, packageManager: "npm", inheritEnv: false });

        expect(resolved.tasks.test).toEqual(task(rootDir, "test", "npm"));
      });

      it("should add workspace scripts with the relative directory as prefix", async () => {
        const rootDir = path.join(tasksFixtures, "workspaces");
        const resolved = await resolveConfig({ rootDir, inheritEnv: false });

        expect(resolved.tasks).toEqual({
          "apps/frontend:dev": task(path.join(rootDir, "apps/frontend"), "dev"),
          "apps/frontend:build": task(path.join(rootDir, "apps/frontend"), "build"),
          "packages/utils:test": task(path.join(rootDir, "packages/utils"), "test"),
        });
      });

      it("should exclude workspaces matched by a negated pattern", async () => {
        const rootDir = path.join(tasksFixtures, "workspaces-negated");
        const resolved = await resolveConfig({ rootDir, inheritEnv: false });

        expect(resolved.tasks).toEqual({
          "apps/frontend:dev": task(path.join(rootDir, "apps/frontend"), "dev"),
        });
      });

      it("should ignore a workspaces object", async () => {
        const rootDir = path.join(tasksFixtures, "workspace-object");
        const resolved = await resolveConfig({ rootDir, inheritEnv: false });

        expect(resolved.tasks).toEqual({});
      });

      it("should inherit the resolved env in scanned tasks", async () => {
        process.env.VELINA_TEST_TASK_ENV = "inherited";
        try {
          const rootDir = path.join(tasksFixtures, "root-scripts");
          const resolved = await resolveConfig({ rootDir });

          expect(resolved.tasks.dev.env.VELINA_TEST_TASK_ENV).toBe("inherited");
          expect(resolved.tasks.dev.env.PATH).toBeTruthy();
        } finally {
          delete process.env.VELINA_TEST_TASK_ENV;
        }
      });

      it("should not inherit env in scanned tasks when inheritEnv is false", async () => {
        const rootDir = path.join(tasksFixtures, "root-scripts");
        const resolved = await resolveConfig({ rootDir, inheritEnv: false });

        expect(resolved.tasks.dev.env).toEqual({});
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

      describe("glob deletion", () => {
        const mixedRoot = path.join(tasksFixtures, "mixed");
        const allTasks = () => ({
          dev: task(mixedRoot, "dev"),
          build: task(mixedRoot, "build"),
          "apps/frontend:dev": task(path.join(mixedRoot, "apps/frontend"), "dev"),
          "apps/frontend:build": task(path.join(mixedRoot, "apps/frontend"), "build"),
          "packages/utils:test": task(path.join(mixedRoot, "packages/utils"), "test"),
        });

        it("should delete tasks under a path prefix", async () => {
          const resolved = await resolveConfig({
            rootDir: mixedRoot,
            inheritEnv: false,
            tasks: { "packages/*": null, "apps/frontend/*": null },
          });

          expect(resolved.tasks).toEqual({ dev: allTasks().dev, build: allTasks().build });
        });

        it("should delete only root tasks for a leading slash pattern", async () => {
          const resolved = await resolveConfig({
            rootDir: mixedRoot,
            inheritEnv: false,
            tasks: { "/*": null },
          });

          expect(Object.keys(resolved.tasks)).toEqual([
            "apps/frontend:dev",
            "apps/frontend:build",
            "packages/utils:test",
          ]);
        });

        it("should delete all non-dev tasks with a negated glob", async () => {
          const resolved = await resolveConfig({
            rootDir: mixedRoot,
            inheritEnv: false,
            tasks: { "!*:dev": null },
          });

          expect(resolved.tasks).toEqual({
            dev: allTasks().dev,
            "apps/frontend:dev": allTasks()["apps/frontend:dev"],
          });
        });

        it("should apply globs in declaration order", async () => {
          const resolved = await resolveConfig({
            rootDir: mixedRoot,
            inheritEnv: false,
            tasks: {
              "packages/*": null,
              "!*:dev": null,
              "apps/frontend/*": null,
              "/*": null,
            },
          });

          expect(resolved.tasks).toEqual({});
        });

        it("should let a later exact task re-add a deleted task", async () => {
          const resolved = await resolveConfig({
            rootDir: mixedRoot,
            inheritEnv: false,
            tasks: { "/*": null, dev: { cmd: "echo" } },
          });

          expect(resolved.tasks.dev).toEqual({
            cmd: "echo",
            args: [],
            cwd: mixedRoot,
            env: {},
            files: [],
          });
        });

        it("should delete tasks defined earlier in the same config", async () => {
          const resolved = await resolveConfig({
            rootDir: mixedRoot,
            inheritEnv: false,
            tasks: { custom: { cmd: "echo" }, "*": null },
          });

          expect(resolved.tasks).toEqual({});
        });

        it("should reject a non-null value for a glob task key", async () => {
          expect(resolveConfig({ tasks: { "packages/*": { cmd: "echo" } } })).rejects.toThrow(
            "glob task keys must have a null value",
          );
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

      describe("multiple cwd", () => {
        const cwdRoot = path.join(fixturesDir, "empty");
        const generatedTask = (cwd: string) => ({
          cmd: "echo",
          args: [],
          cwd,
          env: {},
          files: [],
        });

        it("should keep the task name for a single cwd", async () => {
          const resolved = await resolveConfig({
            rootDir: cwdRoot,
            inheritEnv: false,
            tasks: { dev: { cmd: "echo", cwd: "./apps/alpha" } },
          });

          expect(resolved.tasks).toEqual({
            dev: generatedTask(path.join(cwdRoot, "apps/alpha")),
          });
        });

        it("should prefix array entries with the cwd basename", async () => {
          const resolved = await resolveConfig({
            rootDir: cwdRoot,
            inheritEnv: false,
            tasks: {
              dev: { cmd: "echo", cwd: ["./apps/alpha/baz", "./packages/beta/qux"] },
            },
          });

          expect(resolved.tasks).toEqual({
            "baz:dev": generatedTask(path.join(cwdRoot, "apps/alpha/baz")),
            "qux:dev": generatedTask(path.join(cwdRoot, "packages/beta/qux")),
          });
        });

        it("should number colliding prefixes in generation order", async () => {
          const resolved = await resolveConfig({
            rootDir: cwdRoot,
            inheritEnv: false,
            tasks: {
              dev: { cmd: "echo", cwd: ["./a/baz", "./b/baz", "./c/baz", "./d/baz"] },
            },
          });

          expect(Object.keys(resolved.tasks)).toEqual([
            "baz:dev",
            "baz-2:dev",
            "baz-3:dev",
            "baz-4:dev",
          ]);
          expect(resolved.tasks["baz-3:dev"].cwd).toBe(path.join(cwdRoot, "c/baz"));
        });

        it("should number full names independently across task definitions", async () => {
          const resolved = await resolveConfig({
            rootDir: cwdRoot,
            inheritEnv: false,
            tasks: {
              dev: { cmd: "echo", cwd: ["./a/baz", "./b/baz"] },
              build: { cmd: "echo", cwd: ["./c/baz", "./d/baz"] },
            },
          });

          expect(Object.keys(resolved.tasks)).toEqual([
            "baz:dev",
            "baz-2:dev",
            "baz:build",
            "baz-2:build",
          ]);
        });

        it("should use record keys as prefixes", async () => {
          const resolved = await resolveConfig({
            rootDir: cwdRoot,
            inheritEnv: false,
            tasks: {
              lint: {
                cmd: "echo",
                cwd: { frontend: "./apps/frontend", backend: "./apps/backend" },
              },
            },
          });

          expect(resolved.tasks).toEqual({
            "frontend:lint": generatedTask(path.join(cwdRoot, "apps/frontend")),
            "backend:lint": generatedTask(path.join(cwdRoot, "apps/backend")),
          });
        });

        it("should avoid clobbering an existing task name", async () => {
          const resolved = await resolveConfig({
            rootDir: cwdRoot,
            inheritEnv: false,
            tasks: {
              "baz:dev": { cmd: "echo", args: ["hand-written"] },
              dev: { cmd: "echo", cwd: ["./a/baz", "./b/baz"] },
            },
          });

          expect(Object.keys(resolved.tasks)).toEqual(["baz:dev", "baz-2:dev", "baz-3:dev"]);
          expect(resolved.tasks["baz:dev"].args).toEqual(["hand-written"]);
        });

        it("should let a later glob delete generated tasks", async () => {
          const resolved = await resolveConfig({
            rootDir: cwdRoot,
            inheritEnv: false,
            tasks: {
              dev: { cmd: "echo", cwd: ["./a/baz", "./b/qux"] },
              "baz:*": null,
            },
          });

          expect(resolved.tasks).toEqual({
            "qux:dev": generatedTask(path.join(cwdRoot, "b/qux")),
          });
        });

        it("should reuse a name freed by glob deletion", async () => {
          const resolved = await resolveConfig({
            rootDir: cwdRoot,
            inheritEnv: false,
            tasks: {
              "baz:dev": { cmd: "echo", args: ["hand-written"] },
              "baz:*": null,
              dev: { cmd: "echo", cwd: ["./a/baz", "./b/baz"] },
            },
          });

          expect(Object.keys(resolved.tasks)).toEqual(["baz:dev", "baz-2:dev"]);
          expect(resolved.tasks["baz:dev"].args).toEqual([]);
        });

        it("should share resolved env and files across generated tasks", async () => {
          const resolved = await resolveConfig({
            rootDir: cwdRoot,
            inheritEnv: false,
            vars: { NAME: { type: "value", value: "Vivian" } },
            tasks: {
              greet: {
                cmd: "echo",
                cwd: ["./a/baz", "./b/baz"],
                env: { MESSAGE: "Hi, <%= vars.NAME %>!" },
                files: [{ path: "greeting.txt", content: { type: "value", value: "hello" } }],
              },
            },
          });

          for (const name of ["baz:greet", "baz-2:greet"]) {
            expect(resolved.tasks[name].env).toEqual({ MESSAGE: "Hi, Vivian!" });
            expect(resolved.tasks[name].files).toEqual([
              { path: path.join(cwdRoot, "greeting.txt"), content: "hello" },
            ]);
          }
        });
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
      const loaded = await loadConfig({ cwd: path.join(fixturesDir, "default") });

      expect(loaded.provided).toEqual({ port: 1234 });
      expect(loaded.resolved.port).toBe(1234);
    });

    it("should read and resolve the provided config path", async () => {
      const loaded = await loadConfig({ configPath: path.join(fixturesDir, "vars.yml") });

      expect(loaded.provided).toEqual({ vars: { GREETING: "hello" } });
      expect(loaded.resolved.vars).toEqual({ GREETING: "hello" });
    });

    it("should apply override vars on top of the config vars", async () => {
      const loaded = await loadConfig({
        configPath: path.join(fixturesDir, "vars.yml"),
        overrideVars: { GREETING: "howdy", NAME: "Vivian" },
      });

      expect(loaded.provided).toEqual({ vars: { GREETING: "hello" } });
      expect(loaded.resolved.vars).toEqual({ GREETING: "howdy", NAME: "Vivian" });
    });

    it("should use defaults when the config file does not exist at the default path", async () => {
      const loaded = await loadConfig({ cwd: path.join(fixturesDir, "empty") });

      expect(loaded.provided).toEqual({});
      expect(loaded.resolved.port).toBe(DEFAULT_PORT);
      expect(loaded.resolved.vars).toEqual({});
      expect(loaded.resolved.files).toEqual([]);
    });
  });
});

describe("task cwd schema", () => {
  const parse = (cwd: unknown) => zConfig.safeParse({ tasks: { dev: { cmd: "echo", cwd } } });

  it("should accept string, array, and record cwd", () => {
    expect(parse("./apps/frontend").success).toBe(true);
    expect(parse(["./apps/frontend", "./apps/backend"]).success).toBe(true);
    expect(parse({ frontend: "./apps/frontend" }).success).toBe(true);
  });

  it("should reject empty arrays and records", () => {
    expect(parse([]).success).toBe(false);
    expect(parse({}).success).toBe(false);
  });

  it("should reject malformed entries", () => {
    expect(parse([1]).success).toBe(false);
    expect(parse({ frontend: 1 }).success).toBe(false);
  });
});

describe("task groups", () => {
  const rootDir = path.join(fixturesDir, "empty");
  const tasks = {
    "frontend:dev": { cmd: "echo" },
    "backend:dev": { cmd: "echo" },
    "frontend:e2e": { cmd: "echo" },
    "backend:e2e": { cmd: "echo" },
    e2e: { cmd: "echo" },
  };

  const resolve = (taskGroup: NonNullable<Config["taskGroup"]>) =>
    resolveConfig({ rootDir, inheritEnv: false, tasks: { ...tasks }, taskGroup });

  it("should resolve the simple form to concrete task names", async () => {
    const resolved = await resolve({ dev: ["frontend:dev", "backend:dev"] });

    expect(resolved.taskGroup).toEqual({ dev: ["frontend:dev", "backend:dev"] });
  });

  it("should resolve the canonical form", async () => {
    const resolved = await resolve({ dev: { tasks: ["frontend:dev", "backend:dev"] } });

    expect(resolved.taskGroup).toEqual({ dev: ["frontend:dev", "backend:dev"] });
  });

  it("should expand globs against the final task set", async () => {
    const resolved = await resolve({ all: ["*:e2e"] });

    expect(resolved.taskGroup).toEqual({ all: ["frontend:e2e", "backend:e2e", "e2e"] });
  });

  it("should deduplicate overlapping members in order", async () => {
    const resolved = await resolve({ dev: ["frontend:dev", "frontend:dev", "*:dev"] });

    expect(resolved.taskGroup.dev).toEqual(["frontend:dev", "backend:dev"]);
  });

  it("should include tasks generated by multiple cwd", async () => {
    const resolved = await resolveConfig({
      rootDir,
      inheritEnv: false,
      tasks: { dev: { cmd: "echo", cwd: ["./a/baz"] } },
      taskGroup: { generated: ["baz:dev"] },
    });

    expect(resolved.taskGroup.generated).toEqual(["baz:dev"]);
  });

  it("should reject an unknown task name", async () => {
    await expect(resolve({ dev: ["missing:dev"] })).rejects.toThrow(
      'Unknown task "missing:dev" in task group "dev"',
    );
  });

  it("should reject a task deleted in config", async () => {
    const resolving = resolveConfig({
      rootDir,
      inheritEnv: false,
      tasks: { ...tasks, "frontend:dev": null },
      taskGroup: { dev: ["frontend:dev"] },
    });

    await expect(resolving).rejects.toThrow('Unknown task "frontend:dev" in task group "dev"');
  });

  it("should reject a glob with no matches", async () => {
    await expect(resolve({ nope: ["*:nope"] })).rejects.toThrow(
      'Task group "nope" pattern "*:nope" matched no tasks',
    );
  });

  it("should reject negated patterns", async () => {
    await expect(resolve({ dev: ["!frontend:dev"] })).rejects.toThrow(
      "negated task patterns are not supported in task groups: !frontend:dev",
    );
  });

  it("should return an empty map when no groups are configured", async () => {
    const resolved = await resolveConfig({ rootDir, inheritEnv: false, tasks: { ...tasks } });

    expect(resolved.taskGroup).toEqual({});
  });
});

describe("task group schema", () => {
  const parse = (taskGroup: unknown) => zConfig.safeParse({ taskGroup });

  it("should accept both forms", () => {
    expect(parse({ dev: ["frontend:dev"] }).success).toBe(true);
    expect(parse({ dev: { tasks: ["frontend:dev"] } }).success).toBe(true);
  });

  it("should reject empty member lists", () => {
    expect(parse({ dev: [] }).success).toBe(false);
    expect(parse({ dev: { tasks: [] } }).success).toBe(false);
  });

  it("should reject unknown keys in the canonical form", () => {
    expect(parse({ dev: { tasks: ["frontend:dev"], extra: true } }).success).toBe(false);
  });
});
