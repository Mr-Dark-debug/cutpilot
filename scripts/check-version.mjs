// Fails if package.json, Cargo.toml and tauri.conf.json disagree with each other
// or with the tag being released (e.g. "v1.2.0").
import { readFileSync } from "node:fs";

const tag = (process.argv[2] || "").replace(/^v/, "");
const pkg = JSON.parse(readFileSync("package.json", "utf8")).version;
const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
const cargo = readFileSync("src-tauri/Cargo.toml", "utf8").match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const versions = { "package.json": pkg, "tauri.conf.json": conf, "Cargo.toml": cargo };
const unique = new Set(Object.values(versions));
if (unique.size !== 1 || (tag && !unique.has(tag))) {
  console.error("Version mismatch:", versions, tag ? `tag: ${tag}` : "");
  process.exit(1);
}
console.log(`Version ${pkg} OK`);
