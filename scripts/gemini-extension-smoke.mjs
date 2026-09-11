import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error("Pass the installed Gemini manifest path");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(manifest.version, pkg.version);
const config = manifest.mcpServers["pulse-verity"];
assert.deepEqual(config, { command: "npx", args: ["-y", `pulse-verity@${pkg.version}`] });

// Supply only standard process paths; never inherit developer or CI credentials.
const env = {};
for (const name of ["PATH", "HOME", "USERPROFILE", "SystemRoot", "TEMP", "TMP", "TMPDIR"])
  if (process.env[name]) env[name] = process.env[name];

// A clean working directory makes npx resolve the published package, not this checkout.
const cleanCwd = mkdtempSync(join(tmpdir(), "verity-gemini-smoke-"));
const transport = new StdioClientTransport({ ...config, env, cwd: cleanCwd, stderr: "inherit" });
const client = new Client({ name: "verity-gemini-check", version: pkg.version });
const deadline = setTimeout(() => {
  console.error("Gemini MCP smoke timed out");
  transport.close().finally(() => process.exit(1));
}, 90_000);

try {
  await client.connect(transport);
  assert.equal(client.getServerVersion()?.version, pkg.version);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(({ name }) => name).sort(), [
    "get_index_batch", "get_index_price", "get_settlement_print", "list_index_assets", "verify_print"
  ]);
  assert(tools.every(({ annotations }) => annotations?.readOnlyHint === true));
  const needsKey = await client.callTool({ name: "get_index_batch", arguments: { symbols: ["BTC", "ETH"] } });
  assert.match(JSON.stringify(needsKey), /free.*key|key.*free/i);
  assert.match(JSON.stringify(needsKey), /thepulse\.markets\/developers/);
  console.log("PASS: installed Gemini manifest starts npm release, exposes five read-only tools, and handles missing key");
  if (process.argv.includes("--live")) {
    const result = await client.callTool({ name: "get_index_price", arguments: { symbol: "BTC" } });
    assert.notEqual(result.isError, true);
    const text = result.content.find((item) => item.type === "text")?.text;
    const print = result.structuredContent ?? JSON.parse(text);
    assert.equal(print.symbol, "BTC");
    assert(Number.isFinite(Number(print.price)) && Number(print.price) > 0);
    assert.equal(typeof print.signature, "string");
    const verified = await client.callTool({ name: "verify_print", arguments: print });
    const verification = verified.structuredContent ?? JSON.parse(verified.content.find((item) => item.type === "text").text);
    assert.equal(verification.valid, true);
    console.log("PASS: keyless BTC sample returned and its signature verified");
  }
} finally {
  clearTimeout(deadline);
  await client.close();
  rmdirSync(cleanCwd);
}
