import velinaArt from "#/assets/velina.txt";

import { DEFAULT_PORT } from "./config";

// The text loader keeps the file's final newline; the banner adds its own spacing.
export const VELINA_ART = velinaArt.trimEnd();

export interface TerminalContext {
  env: Record<string, string | undefined>;
  isTTY: boolean;
  columns?: number;
}

export type BannerMode = "auto" | "always" | "never";

// Agents and CI runners frequently inherit a fully featured terminal, so
// terminal capabilities alone cannot distinguish them from a human.
const AUTOMATION_ENV_KEYS = [
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "AGENT",
  "AI_AGENT",
  "OPENCODE",
  "CLAUDECODE",
];

const AUTOMATION_ENV_PREFIXES = ["OPENCODE_", "CLAUDE_CODE_", "CODEX_", "CURSOR_", "AIDER_"];

function isSet(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false" && normalized !== "no";
}

export function readBannerMode(env: Record<string, string | undefined>): BannerMode {
  const value = env.VELINA_BANNER?.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "always") return "always";
  if (value === "0" || value === "false" || value === "never") return "never";
  return "auto";
}

export function shouldPrintBanner(ctx: TerminalContext): boolean {
  const mode = readBannerMode(ctx.env);
  if (mode === "always") return true;
  if (mode === "never") return false;

  if (!ctx.isTTY || ctx.env.TERM === "dumb") return false;

  for (const key of AUTOMATION_ENV_KEYS) {
    if (isSet(ctx.env[key])) return false;
  }
  for (const key of Object.keys(ctx.env)) {
    if (AUTOMATION_ENV_PREFIXES.some((prefix) => key.startsWith(prefix)) && isSet(ctx.env[key])) {
      return false;
    }
  }

  return true;
}

function dimension(value: number | undefined, envValue: string | undefined): number {
  if (value !== undefined && Number.isInteger(value) && value > 0) return value;

  const parsed = Number(envValue);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;

  // Unknown dimensions mean we cannot prove the art will not fit.
  return Number.POSITIVE_INFINITY;
}

export function shouldShowArt(ctx: TerminalContext): boolean {
  // Wrapping would destroy the art; scrolling vertically is harmless.
  return dimension(ctx.columns, ctx.env.COLUMNS) >= 56;
}

export type ClipboardResult = "native" | "osc52" | "unsupported";

interface ClipboardHelper {
  command: string;
  args?: string[];
}

// Native helpers first; OSC 52 is a terminal-level fallback with no binaries.
const CLIPBOARD_HELPERS: ClipboardHelper[] = [
  { command: "pbcopy" },
  { command: "wl-copy" },
  { command: "xclip", args: ["-selection", "clipboard"] },
  { command: "clip.exe" },
];

export interface ClipboardDeps {
  which(command: string): string | null;
  spawn(command: string, args: string[], input: string): boolean;
  write(text: string): void;
}

export function copyToClipboard(
  text: string,
  ctx: TerminalContext,
  deps: ClipboardDeps,
): ClipboardResult {
  for (const helper of CLIPBOARD_HELPERS) {
    const command = deps.which(helper.command);
    if (!command) continue;

    try {
      if (deps.spawn(command, helper.args ?? [], text)) return "native";
    } catch {
      // An installed helper may still fail; try the next one.
    }
  }

  if (!ctx.isTTY) return "unsupported";

  deps.write(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x1b\\`);
  return "osc52";
}

export function createClipboardDeps(): ClipboardDeps {
  return {
    which: (command) => Bun.which(command),
    spawn: (command, args, input) => {
      const result = Bun.spawnSync({
        cmd: [command, ...args],
        stdin: new Blob([input]),
        stdout: "ignore",
        stderr: "ignore",
      });
      return result.exitCode === 0;
    },
    write: (text) => {
      process.stdout.write(text);
    },
  };
}

export interface BannerOptions {
  port: number;
  showArt: boolean;
  clipboard: ClipboardResult;
}

export function formatBanner({ port, showArt, clipboard }: BannerOptions): string {
  const uiUrl = `http://127.0.0.1:${port}/ui/`;
  const portFlag = port === DEFAULT_PORT ? "" : ` --port ${port}`;

  const clipboardLine =
    clipboard === "native"
      ? "        Copied to clipboard."
      : clipboard === "osc52"
        ? "        Copied to clipboard (via terminal)."
        : undefined;

  const lines = [
    ...(showArt ? [VELINA_ART, ""] : []),
    `  Velina is running on port ${port} (127.0.0.1)`,
    "",
    `  UI    ${uiUrl}`,
    ...(clipboardLine ? [clipboardLine] : []),
    "",
    `  CLI   velina-cli ps${portFlag}`,
    `        velina-cli logs <id>${portFlag}`,
  ];

  return `${lines.join("\n")}\n`;
}
