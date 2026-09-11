import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const json = (path) => JSON.parse(read(path));
const manifest = json(".cursor-plugin/plugin.json");
const pkg = json("package.json");
const config = json(manifest.mcpServers);

test("Cursor identity and version match the released MCP package", () => {
  assert.equal(manifest.name, pkg.name);
  assert.match(manifest.name, /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
  assert.equal(manifest.version, pkg.version);
  assert.deepEqual(manifest.author, { name: "Pulse" });
  assert.equal(manifest.repository, "https://github.com/PulseBet/pulse-verity");
  assert.equal(manifest.homepage, "https://thepulse.markets/developers");
});

test("manifest paths resolve inside this public repository", () => {
  for (const path of [manifest.mcpServers, manifest.logo]) {
    assert.equal(typeof path, "string");
    assert(!path.startsWith("/") && !path.includes(":") && !path.split("/").includes(".."));
    assert(read(path).length > 0);
  }
});

test("logo is a square 1024-pixel PNG", () => {
  const png = read(manifest.logo);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);
});

test("Cursor starts only the pinned public npm package", () => {
  assert.deepEqual(Object.keys(config.mcpServers), ["pulse-verity"]);
  assert.deepEqual(config.mcpServers["pulse-verity"], {
    command: "npx",
    args: ["-y", `${pkg.name}@${pkg.version}`],
    env: { PULSE_API_KEY: "${PULSE_API_KEY}" }
  });
});

test("the API key is optional and defaults to keyless access", () => {
  assert.equal(manifest.variables.type, "object");
  assert.deepEqual(manifest.variables.required, []);
  assert.deepEqual(Object.keys(manifest.variables.properties), ["PULSE_API_KEY"]);
  assert.equal(manifest.variables.properties.PULSE_API_KEY.type, "string");
  assert.equal(manifest.variables.properties.PULSE_API_KEY.default, "");
});

test("published package formats agree on version and optional-key access", () => {
  const registry = json("server.json");
  const desktop = json("manifest.json");
  assert.equal(registry.version, pkg.version);
  assert.equal(registry.packages[0].version, pkg.version);
  assert.equal(desktop.version, pkg.version);
  assert.equal(registry.packages[0].environmentVariables.find((item) => item.name === "PULSE_API_KEY").isRequired, false);
  assert.equal(desktop.user_config.pulse_api_key.required, false);
});

test("every substitution is declared and no key value is embedded", () => {
  const references = [...JSON.stringify(config).matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1]);
  assert.deepEqual(references, ["PULSE_API_KEY"]);
  for (const name of references) assert(Object.hasOwn(manifest.variables.properties, name));
  assert(!JSON.stringify({ manifest, config }).includes("pidx_"));
});
