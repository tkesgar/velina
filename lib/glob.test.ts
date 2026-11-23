import { describe, expect, it } from "bun:test";

import { isGlobKey, isNegatedKey, matchesGlob, matchesTaskGlob } from "./glob";

describe("isGlobKey", () => {
  it("should recognize wildcards and negations", () => {
    expect(isGlobKey("NODE_*")).toBe(true);
    expect(isGlobKey("!*:dev")).toBe(true);
    expect(isGlobKey("dev")).toBe(false);
  });
});

describe("isNegatedKey", () => {
  it("should recognize a leading bang", () => {
    expect(isNegatedKey("!*:dev")).toBe(true);
    expect(isNegatedKey("*:dev")).toBe(false);
  });
});

describe("matchesGlob", () => {
  it("should match any sequence of characters, including an empty one", () => {
    expect(matchesGlob("NODE_OPTIONS", "NODE_*")).toBe(true);
    expect(matchesGlob("NODE_", "NODE_*")).toBe(true);
    expect(matchesGlob("NUXT_ENV", "NODE_*")).toBe(false);
  });

  it("should treat every other character literally", () => {
    expect(matchesGlob("NODE_ENV", "NODE_ENV")).toBe(true);
    expect(matchesGlob("NODE_ENV", "NODE.ENV")).toBe(false);
    expect(matchesGlob("NODE_ENV", "NODE+ENV")).toBe(false);
  });
});

describe("matchesTaskGlob", () => {
  const names = [
    "dev",
    "build",
    "apps/frontend:dev",
    "apps/frontend:build",
    "packages/utils:test",
    "lint:dev",
  ];

  it("should match tasks below a path prefix", () => {
    expect(names.filter((name) => matchesTaskGlob(name, "packages/*"))).toEqual([
      "packages/utils:test",
    ]);
    expect(names.filter((name) => matchesTaskGlob(name, "apps/frontend/*"))).toEqual([
      "apps/frontend:dev",
      "apps/frontend:build",
    ]);
  });

  it("should match only root tasks for a leading slash pattern", () => {
    expect(names.filter((name) => matchesTaskGlob(name, "/*"))).toEqual(["dev", "build"]);
  });

  it("should let a leading wildcard segment match unprefixed tasks", () => {
    expect(names.filter((name) => matchesTaskGlob(name, "*:dev"))).toEqual([
      "dev",
      "apps/frontend:dev",
      "lint:dev",
    ]);
  });
});
