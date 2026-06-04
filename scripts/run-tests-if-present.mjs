import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (!existsSync("test")) {
  console.log("No test/ directory; skipping package tests.");
  process.exit(0);
}

const result = spawnSync(process.execPath, ["--test", "test/"], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
