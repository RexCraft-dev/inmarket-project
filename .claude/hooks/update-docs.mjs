#!/usr/bin/env node
// .claude/hooks/update-docs.mjs
// Called by PostToolUse hook after every file Write or Edit.
// Reads the changed file path from stdin JSON, then invokes the docs subagent.

import { readFileSync } from "fs";
import { execSync } from "child_process";
import { extname, relative } from "path";

// ── Parse hook payload from stdin ───────────────────────────────────────────
let payload;
try {
  const raw = readFileSync("/dev/stdin", "utf8");
  payload = JSON.parse(raw);
} catch {
  process.exit(0); // non-blocking — never stall Claude
}

const filePath = payload?.tool_input?.file_path;
if (!filePath) process.exit(0);

// ── Skip files that don't need documentation ────────────────────────────────
const SKIP_PATTERNS = [
  /node_modules/,
  /\.env$/,
  /package-lock\.json$/,
  /^docs\//,              // don't trigger on doc file edits (avoid loops)
  /\.claude\/hooks\//,    // don't trigger on hook script edits
];

const relPath = relative(process.cwd(), filePath);
if (SKIP_PATTERNS.some((p) => p.test(relPath))) process.exit(0);

// ── Only trigger on file types we care about ─────────────────────────────────
const WATCHED_EXTENSIONS = new Set([".js", ".json", ".md", ".yml", ".yaml"]);
if (!WATCHED_EXTENSIONS.has(extname(filePath))) process.exit(0);

// ── Invoke the docs subagent via Claude Code headless mode ───────────────────
// Runs async (backgrounded) so it never blocks Claude's main session
try {
  execSync(
    `claude -p "Use the docs subagent to update documentation for the file that was just changed: ${relPath}" --async`,
    { stdio: "ignore", timeout: 5000 }
  );
} catch {
  // Silently fail — doc updates are best-effort, never blocking
}

process.exit(0);
