import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const manifest = JSON.parse(read(".claude-plugin/plugin.json"));
const pkg = JSON.parse(read("package.json"));
const config = JSON.parse(read(".mcp.json"));
const skill = read("claude-skills/pulse-verity-price-check/SKILL.md");

assert.equal(manifest.name, "pulse-verity");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.version, pkg.version, "Claude plugin and package release must stay aligned");
assert.equal(manifest.repository, "https://github.com/PulseBet/pulse-verity");
assert.equal(manifest.license, "MIT");
assert.equal(manifest.skills, "./claude-skills/");
assert.deepEqual(config, {
  mcpServers: {
    "pulse-verity": {
      command: "npx",
      args: ["-y", `pulse-verity@${manifest.version}`],
      env: { PULSE_API_KEY: "${PULSE_API_KEY:-}" }
    }
  }
});
assert.match(skill, /^---\nname: pulse-verity-price-check\ndescription: .+\n---\n/);
assert(skill.includes(`pulse-verity@${manifest.version}`), "Skill setup and MCP runtime must agree");
assert(skill.includes("verify_print"));
assert(skill.includes("get_index_price"));
assert(read("docs/claude-code.md").includes(`pulse-verity@${manifest.version}`));
assert.deepEqual(readdirSync(new URL("../.claude-plugin", import.meta.url)), ["plugin.json"]);
assert.deepEqual(readdirSync(new URL("../claude-skills", import.meta.url)), ["pulse-verity-price-check"]);
for (const extra of ["skills", "hooks", "agents", "commands", "monitors", ".claude-plugin/marketplace.json"])
  assert(!existsSync(new URL(`../${extra}`, import.meta.url)), `Unexpected capability: ${extra}`);
for (const field of ["hooks", "agents", "commands", "monitors", "dependencies", "experimental", "userConfig"])
  assert(!(field in manifest), `Unexpected manifest capability: ${field}`);
console.log("PASS: Claude plugin metadata, pinned stdio config, optional key and bounded skill");

// The official CLI may wrap plugin rows in an object or return an array.
// Inspect JSON objects, never a text substring that could match an error message.
function pluginRows(value) {
  if (!value || typeof value !== "object") return [];
  const nested = Object.values(value).flatMap(pluginRows);
  const isOurIdentity = [value.id, value.name, value.pluginId].some((name) =>
    typeof name === "string" && (name === manifest.name || name.startsWith(`${manifest.name}@`)));
  return isOurIdentity ? [value, ...nested] : nested;
}
assert.equal(pluginRows([]).length, 0);
assert.equal(pluginRows({ error: "pulse-verity could not load" }).length, 0);
assert.equal(pluginRows([{ id: "pulse-verity-other@inline" }]).length, 0);
assert.equal(pluginRows({ plugins: [{ id: "pulse-verity@inline", version: manifest.version }] }).length, 1);

const args = process.argv.slice(2);
if (args.length) {
  assert.equal(args.length, 2);
  assert(["--cli-list", "--cli-details"].includes(args[0]), "Unknown CLI assertion");
}
if (args[0] === "--cli-list") {
  const listing = JSON.parse(readFileSync(args[1], "utf8"));
  const rows = pluginRows(listing);
  assert(rows.length > 0, "Official Claude CLI did not list the Pulse Verity plugin");
  assert(rows.some((row) => row.version === manifest.version), "Loaded plugin version does not match the candidate");
  for (const row of rows) {
    assert(!row.errors || row.errors.length === 0, "Claude reported plugin load errors");
    assert(!row.errorDetails || row.errorDetails.length === 0, "Claude reported detailed plugin load errors");
  }
  console.log("PASS: official Claude CLI actually lists the intended plugin/version without load errors");
}
if (args[0] === "--cli-details") {
  // The documented component inventory reports discovered skills, not only
  // manifest metadata. A missing/unsupported custom path must fail this gate.
  const details = readFileSync(args[1], "utf8").replace(/\u001b\[[0-9;]*m/g, "");
  assert.match(details, /^\s*Skills\s+\(1\)[^\n]*\bpulse-verity-price-check\b/m,
    "Claude did not discover the sole skill from the custom Claude-only path");
  console.log("PASS: official Claude component inventory discovers the isolated price-check skill");
}
