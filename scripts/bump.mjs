// Sets the app version everywhere: node scripts/bump.mjs 1.2.0
import { readFileSync, writeFileSync } from "node:fs";

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v || "")) {
  console.error("usage: node scripts/bump.mjs <major.minor.patch>");
  process.exit(1);
}
const edit = (file, fn) => writeFileSync(file, fn(readFileSync(file, "utf8")));
edit("package.json", (s) => s.replace(/"version":\s*"[^"]+"/, `"version": "${v}"`));
edit("src-tauri/tauri.conf.json", (s) => s.replace(/"version":\s*"[^"]+"/, `"version": "${v}"`));
edit("src-tauri/Cargo.toml", (s) => s.replace(/^version\s*=\s*"[^"]+"/m, `version = "${v}"`));
console.log(`Version set to ${v}. Add a "## ${v}" section to CHANGELOG.md, commit, then tag v${v}.`);
