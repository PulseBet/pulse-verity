import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error("Pass the installed Gemini manifest path");
let candidateTarball;
let live = false;
const options = process.argv.slice(3);
while (options.length) {
  const option = options.shift();
  if (option === "--live" && !live) {
    live = true;
  } else if (option === "--candidate-tarball" && !candidateTarball) {
    const path = options.shift();
    assert(path && isAbsolute(path) && path.endsWith(".tgz"), "Candidate tarball must be an absolute .tgz path");
    assert(statSync(path).isFile(), "Candidate tarball must be a regular file");
    candidateTarball = realpathSync(path);
  } else {
    throw new Error(`Unknown or repeated smoke option: ${option}`);
  }
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(manifest.version, pkg.version);
const config = manifest.mcpServers["pulse-verity"];
assert.deepEqual(config, { command: "npx", args: ["-y", `pulse-verity@${pkg.version}`] });

// Supply only standard process paths; never inherit developer or CI credentials.
const env = {};
for (const name of ["PATH", "HOME", "USERPROFILE", "SystemRoot", "TEMP", "TMP", "TMPDIR"])
  if (process.env[name]) env[name] = process.env[name];

// Validate the installed manifest above in both modes. Before publication only
// the launched package changes; the installable manifest stays pinned to npm.
const launchConfig = candidateTarball
  ? { command: "npx", args: ["--yes", "--package", candidateTarball, "pulse-verity"] }
  : config;
// A clean working directory prevents npx from resolving this checkout.
const cleanCwd = mkdtempSync(join(tmpdir(), "verity-gemini-smoke-"));
const transport = new StdioClientTransport({ ...launchConfig, env, cwd: cleanCwd, stderr: "inherit" });
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
  console.log(`PASS: installed Gemini manifest starts ${candidateTarball ? "candidate tarball" : "npm release"}, exposes five read-only tools, and handles missing key`);
  if (live) {
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
