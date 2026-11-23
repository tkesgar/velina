import { describe, expect, it } from "bun:test";

import {
  VELINA_ART,
  copyToClipboard,
  formatBanner,
  readBannerMode,
  shouldPrintBanner,
  shouldShowArt,
  type ClipboardDeps,
  type TerminalContext,
} from "./banner";
import { DEFAULT_PORT } from "./config";

function ctx(overrides: Partial<TerminalContext> = {}): TerminalContext {
  return {
    env: { TERM: "xterm-256color" },
    isTTY: true,
    ...overrides,
  };
}

function deps(overrides: Partial<ClipboardDeps> = {}): ClipboardDeps {
  return {
    which: () => null,
    spawn: () => false,
    write: () => {},
    ...overrides,
  };
}

describe("shouldPrintBanner", () => {
  it("prints only on interactive terminals", () => {
    expect(shouldPrintBanner(ctx())).toBe(true);
    expect(shouldPrintBanner(ctx({ isTTY: false }))).toBe(false);
  });

  it("suppresses known CI and agent environments", () => {
    const markers = [
      "CI",
      "GITHUB_ACTIONS",
      "GITLAB_CI",
      "AGENT",
      "AI_AGENT",
      "OPENCODE",
      "CLAUDECODE",
      "OPENCODE_SESSION_ID",
      "CLAUDE_CODE_SESSION_ID",
      "CODEX_THREAD_ID",
      "CURSOR_TRACE_ID",
      "AIDER_SESSION",
    ];

    for (const key of markers) {
      expect(shouldPrintBanner(ctx({ env: { TERM: "xterm-256color", [key]: "1" } }))).toBe(false);
    }
  });

  it("ignores unset markers and dumb terminals", () => {
    expect(shouldPrintBanner(ctx({ env: { CI: "0", AGENT: "false" } }))).toBe(true);
    expect(shouldPrintBanner(ctx({ env: { TERM: "dumb" } }))).toBe(false);
  });

  it("honors the override", () => {
    expect(readBannerMode({ VELINA_BANNER: "wat" })).toBe("auto");
    expect(shouldPrintBanner(ctx({ isTTY: false, env: { VELINA_BANNER: "1" } }))).toBe(true);
    expect(shouldPrintBanner(ctx({ env: { VELINA_BANNER: "0" } }))).toBe(false);
  });
});

describe("shouldShowArt", () => {
  it("requires enough columns regardless of height", () => {
    expect(shouldShowArt(ctx({ columns: 54 }))).toBe(false);
    expect(shouldShowArt(ctx({ columns: 100 }))).toBe(true);
    expect(shouldShowArt(ctx({ columns: 56 }))).toBe(true);
  });

  it("falls back to COLUMNS", () => {
    expect(shouldShowArt(ctx({ env: { COLUMNS: "80" } }))).toBe(true);
    expect(shouldShowArt(ctx({ env: { COLUMNS: "40" } }))).toBe(false);
  });

  it("shows the art when dimensions are unknown", () => {
    expect(shouldShowArt(ctx({ env: {} }))).toBe(true);
  });
});

describe("formatBanner", () => {
  it("includes the art, URL and CLI hint for the default port", () => {
    const banner = formatBanner({ port: DEFAULT_PORT, showArt: true, clipboard: "native" });

    expect(banner).toContain(VELINA_ART);
    expect(banner).toContain(`Velina is running on port ${DEFAULT_PORT} (127.0.0.1)`);
    expect(banner).toContain(`http://127.0.0.1:${DEFAULT_PORT}/ui/`);
    expect(banner).toContain("Copied to clipboard.");
    expect(banner).toContain("velina-cli ps");
    expect(banner).toContain("velina-cli logs <id>");
    expect(banner).not.toContain("--port");
  });

  it("adds --port only for a custom port", () => {
    const banner = formatBanner({ port: 3333, showArt: false, clipboard: "unsupported" });

    expect(banner).not.toContain(VELINA_ART);
    expect(banner).not.toContain("Copied to clipboard");
    expect(banner).toContain("velina-cli ps --port 3333");
    expect(banner).toContain("velina-cli logs <id> --port 3333");
  });

  it("labels the terminal clipboard fallback", () => {
    const banner = formatBanner({ port: DEFAULT_PORT, showArt: false, clipboard: "osc52" });
    expect(banner).toContain("Copied to clipboard (via terminal).");
  });
});

describe("copyToClipboard", () => {
  const url = "http://127.0.0.1:2222/ui/";

  it("prefers a native helper", () => {
    let written = "";
    const result = copyToClipboard(
      url,
      ctx(),
      deps({
        which: (command) => (command === "pbcopy" ? "/usr/bin/pbcopy" : null),
        spawn: (command, args, input) => {
          expect(command).toBe("/usr/bin/pbcopy");
          expect(args).toEqual([]);
          expect(input).toBe(url);
          return true;
        },
        write: (text) => {
          written = text;
        },
      }),
    );

    expect(result).toBe("native");
    expect(written).toBe("");
  });

  it("passes xclip its selection argument", () => {
    const result = copyToClipboard(
      url,
      ctx(),
      deps({
        which: (command) => (command === "xclip" ? "/usr/bin/xclip" : null),
        spawn: (_command, args) => {
          expect(args).toEqual(["-selection", "clipboard"]);
          return true;
        },
      }),
    );

    expect(result).toBe("native");
  });

  it("falls back to OSC 52 on a terminal", () => {
    let written = "";
    const result = copyToClipboard(
      url,
      ctx(),
      deps({
        which: (command) => (command === "pbcopy" ? "/usr/bin/pbcopy" : null),
        spawn: () => false,
        write: (text) => {
          written = text;
        },
      }),
    );

    expect(result).toBe("osc52");
    expect(written.startsWith("\x1b]52;c;")).toBe(true);
    expect(written.endsWith("\x1b\\")).toBe(true);
    expect(Buffer.from(written.slice(7, -2), "base64").toString()).toBe(url);
  });

  it("does nothing when no mechanism is available", () => {
    let written = "";
    const result = copyToClipboard(
      url,
      ctx({ isTTY: false }),
      deps({
        write: (text) => {
          written = text;
        },
      }),
    );

    expect(result).toBe("unsupported");
    expect(written).toBe("");
  });
});
