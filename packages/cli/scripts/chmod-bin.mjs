import { chmodSync, existsSync } from "node:fs";

const binPath = new URL("../dist/bin.js", import.meta.url);

if (existsSync(binPath)) {
  chmodSync(binPath, 0o755);
}
