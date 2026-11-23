// Glob keys are opt-in: an ordinary name without a wildcard (or a leading `!`)
// stays a literal key with today's behavior.
export function isGlobKey(key: string): boolean {
  return key.includes("*") || key.startsWith("!");
}

export function isNegatedKey(key: string): boolean {
  return key.startsWith("!");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Only `*` is special; everything else is matched literally.
function patternBody(pattern: string): string {
  return pattern.split("*").map(escapeRegExp).join(".*");
}

export function matchesGlob(name: string, pattern: string): boolean {
  return new RegExp(`^${patternBody(pattern)}$`).test(name);
}

export function matchesTaskGlob(name: string, pattern: string): boolean {
  const taskName = name.replaceAll(":", "/");
  const taskPattern = pattern.replaceAll(":", "/");

  if (taskPattern.startsWith("/")) {
    // A leading slash marks root tasks, so only unprefixed names are eligible.
    if (taskName.includes("/")) return false;
    return matchesGlob(taskName, taskPattern.slice(1));
  }

  if (taskPattern.startsWith("*/") && !taskPattern.startsWith("**")) {
    // A leading wildcard segment also covers unprefixed names:
    // `*/dev` matches both `dev` and `apps/frontend/dev`.
    return new RegExp(`^(?:.*/)?${patternBody(taskPattern.slice(2))}$`).test(taskName);
  }

  return matchesGlob(taskName, taskPattern);
}
