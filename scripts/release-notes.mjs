// Prints the CHANGELOG.md section for a version (used as the GitHub release body
// and shown in the app's update prompt).
import { readFileSync } from "node:fs";

const version = process.argv[2];
const text = readFileSync("CHANGELOG.md", "utf8");
const lines = text.split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith(`## ${version}`) || l.startsWith(`## [${version}]`));
if (start < 0) {
  console.error(`CHANGELOG.md has no section for ${version}`);
  process.exit(1);
}
const rest = lines.slice(start + 1);
const end = rest.findIndex((l) => l.startsWith("## "));
console.log((end < 0 ? rest : rest.slice(0, end)).join("\n").trim());
