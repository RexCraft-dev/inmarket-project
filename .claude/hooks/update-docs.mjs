#!/usr/bin/env node
// .claude/hooks/update-docs.mjs
// Called by PostToolUse hook after every file Write or Edit.
// Reads the changed file path from stdin JSON, then invokes the docs subagent.

import { readFileSync } from "fs";
import { spawn } from "child_process";
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

// ── Resolve claude binary ────────────────────────────────────────────────────
// Use the known install path; fall back to PATH resolution via shell.
const CLAUDE_BIN = "/home/rcraft/.local/bin/claude";

// ── Invoke the docs subagent — fire-and-forget ───────────────────────────────
// spawn + detached + unref so the hook never blocks Claude's main session.
try {
  const child = spawn(
    CLAUDE_BIN,
    ["-p", `Use the docs subagent to update documentation for the file that was just changed: ${relPath}`],
    {
      detached: true,
      stdio: "ignore",
    }
  );
  child.unref();
} catch {
  // Silently fail — doc updates are best-effort, never blocking
}

process.exit(0);
