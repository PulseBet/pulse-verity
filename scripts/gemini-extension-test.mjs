import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const json = (path) => JSON.parse(read(path));
const extension = json("gemini-extension.json");
const pkg = json("package.json");

test("Gemini identity and version match the public package", () => {
  assert.equal(extension.name, pkg.name);
  assert.match(extension.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal(extension.version, pkg.version);
  assert.equal(extension.description, json(".cursor-plugin/plugin.json").description);
});

test("Gemini starts only the pinned npm release, without a local build", () => {
  assert.deepEqual(extension.mcpServers, {
    "pulse-verity": {
      command: "npx",
      args: ["-y", `${pkg.name}@${pkg.version}`]
    }
  });
});

test("Gemini requests only the optional, sensitive Pulse key", () => {
  assert.equal(extension.settings.length, 1);
  const setting = extension.settings[0];
  assert.equal(setting.envVar, "PULSE_API_KEY");
  assert.equal(setting.sensitive, true);
  assert.match(setting.name, /optional/i);
  assert.match(setting.description, /Leave blank/);
  assert.deepEqual(Object.keys(setting).sort(), ["description", "envVar", "name", "sensitive"]);
});

test("no environment remapping can erase Gemini's resolved secret", () => {
  assert(!Object.hasOwn(extension.mcpServers["pulse-verity"], "env"));
  assert(!JSON.stringify(extension).includes("${"));
  assert(!JSON.stringify(extension).includes("pidx_"));
});

test("Gemini adds no hooks, context prompts, migrations or trust overrides", () => {
  assert.deepEqual(Object.keys(extension).sort(), ["description", "mcpServers", "name", "settings", "version"]);
});

test("installation instructions include keyless and secure optional configuration", () => {
  const readme = read("README.md");
  assert(readme.includes("gemini extensions install https://github.com/PulseBet/pulse-verity --skip-settings"));
  assert(readme.includes("gemini extensions config pulse-verity PULSE_API_KEY"));
  assert(readme.includes("not a listing in the consumer Gemini chat app"));
});

test("Gemini archives cover each supported platform without replacing the desktop bundle", () => {
  const workflow = read(".github/workflows/gemini-extension.yml");
  for (const platform of ["darwin", "linux", "win32"]) assert(workflow.includes(platform));
  assert(workflow.includes("gh release upload"));
  assert(!workflow.includes("--clobber"));
  assert(!workflow.includes("npm publish"));
  assert(workflow.includes("github.ref == 'refs/heads/main'"));
});

test("CI bounds installation waits and approves only its staged local extension", () => {
  const workflow = read(".github/workflows/gemini-extension.yml");
  assert(workflow.includes("timeout-minutes: 2"));
  assert(workflow.includes("printf 'y\\n' | gemini extensions install \"$RUNNER_TEMP/verity-gemini/stage\""));
  assert(!workflow.includes("folderTrust.enabled: false"));
});
