import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, root)));
const manifest = json(".grok-plugin/plugin.json");
const pkg = json("package.json");

test("Grok identity and version match the released MCP package", () => {
  assert.equal(manifest.name, pkg.name);
  assert.match(manifest.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert(manifest.name.length <= 64);
  assert.equal(manifest.version, pkg.version);
  assert.deepEqual(manifest.author, { name: "Pulse" });
  assert.equal(manifest.repository, "https://github.com/PulseBet/pulse-verity");
  assert.equal(manifest.homepage, "https://thepulse.markets/developers");
  assert.equal(manifest.license, pkg.license);
});

test("Grok selects its explicit MCP path instead of the default root config", () => {
  // Grok loads root plugin.json before .grok-plugin/plugin.json. An added
  // root manifest must be reconciled with this integration before shipping.
  assert(!existsSync(new URL("plugin.json", root)));
  assert.equal(manifest.mcpServers, ".grok-plugin/mcp.json");
  const resolved = realpathSync(new URL(manifest.mcpServers, root));
  const path = relative(fileURLToPath(root), resolved);
  assert(!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
  assert(readFileSync(resolved).length > 0);
});

test("Grok starts only the pinned public package with one optional key", () => {
  const config = json(manifest.mcpServers);
  assert.deepEqual(config, {
    mcpServers: {
      "pulse-verity": {
        command: "npx",
        args: ["-y", `${pkg.name}@${pkg.version}`],
        env: { PULSE_API_KEY: "${PULSE_API_KEY}" }
      }
    }
  });
  // The published server treats an unset/unexpanded key as keyless access.
  // Do not replace this environment reference with a saved API key.
  assert(!JSON.stringify(config).includes("pidx_"));
});

test("the Grok plugin adds no hooks, skills, agents, or shell commands", () => {
  for (const key of ["hooks", "skills", "agents", "commands", "lspServers"]) {
    assert(!Object.hasOwn(manifest, key));
  }
  for (const path of ["hooks", "skills", "agents", "commands", ".lsp.json"]) {
    assert(!existsSync(new URL(path, root)));
  }
});
