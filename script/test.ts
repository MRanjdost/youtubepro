import { readdirSync, statSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

const roots = ["server", "shared", "client/src"];
const files: string[] = [];

function walk(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      walk(p);
    } else if (entry.endsWith(".test.ts")) {
      files.push(p);
    }
  }
}

for (const root of roots) walk(root);
files.sort();

// Run tests with an explicit file list (no shell globbing) so that the same
// suite runs on Windows, macOS, and Linux regardless of whether the test
// runner or the shell expands "**" patterns.
const watch = process.argv.includes("--watch");
const args = ["--import", "tsx", "--test", ...(watch ? ["--watch"] : []), ...files];
const result = spawnSync(process.execPath, args, { stdio: "inherit" });

process.exit(result.status ?? 1);