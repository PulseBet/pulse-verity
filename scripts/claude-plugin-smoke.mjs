import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let live = false, candidateEntry;
const options = process.argv.slice(2);
while (options.length) {
  const option = options.shift();
  if (option === "--live" && !live) live = true;
  else if (option === "--candidate-entry" && !candidateEntry) {
    candidateEntry = options.shift();
    assert(candidateEntry && isAbsolute(candidateEntry) && candidateEntry.endsWith("/dist/index.js"), "Candidate entry must be an absolute built entry path");
  } else throw new Error("Unknown or repeated smoke option: " + option);
}
const manifest = JSON.parse(readFileSync(new URL("../.claude-plugin/plugin.json", import.meta.url), "utf8"));
const config = JSON.parse(readFileSync(new URL("../.mcp.json", import.meta.url), "utf8")).mcpServers["pulse-verity"];
assert.equal(config.env.PULSE_API_KEY, "${PULSE_API_KEY:-}");
assert.deepEqual(config.args, ["-y", `pulse-verity@${manifest.version}`]);

// The actual Claude manifest is separately validated with its official CLI.
// This SDK check deliberately exercises only the documented unset-key branch.
const env = {};
for (const name of ["PATH", "HOME", "USERPROFILE", "SystemRoot", "TEMP", "TMP", "TMPDIR"])
  if (process.env[name]) env[name] = process.env[name];
env.PULSE_API_KEY = "";
const cwd = mkdtempSync(join(tmpdir(), "verity-claude-smoke-"));
const launchConfig = candidateEntry ? { command: process.execPath, args: [candidateEntry] } : config;
const transport = new StdioClientTransport({ ...launchConfig, env, cwd, stderr: "inherit" });
const client = new Client({ name: "verity-claude-plugin-check", version: manifest.version });
const deadline = setTimeout(() => {
  console.error("Claude plugin stdio smoke timed out");
  transport.close().finally(() => process.exit(1));
}, 90_000);

try {
  await client.connect(transport);
  assert.equal(client.getServerVersion()?.version, manifest.version);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(({ name }) => name).sort(), [
    "get_index_batch", "get_index_price", "get_settlement_print", "list_index_assets", "submit_verity_feedback", "verify_print"
  ]);
  assert(tools.filter(({ name }) => name !== "submit_verity_feedback").every(({ annotations }) => annotations?.readOnlyHint === true));
  assert.equal(tools.find(({ name }) => name === "submit_verity_feedback").annotations.readOnlyHint, false);
  const missingKey = await client.callTool({ name: "get_index_batch", arguments: { symbols: ["BTC", "ETH"] } });
  assert.equal(missingKey.isError, true);
  assert.match(JSON.stringify(missingKey), /developer key/);
  console.log("PASS: package exposes five data tools and private feedback, and handles missing key");
  if (live) {
    const structured = (result) => result.structuredContent ?? JSON.parse(result.content.find(({ type }) => type === "text").text);
    const result = await client.callTool({ name: "get_index_price", arguments: { symbol: "BTC" } });
    assert.notEqual(result.isError, true);
    const print = structured(result);
    assert.equal(print.symbol, "BTC");
    assert.equal(print.sample, true);
    const check = await client.callTool({ name: "verify_print", arguments: print });
    assert.notEqual(check.isError, true);
    const verification = structured(check);
    assert.equal(verification.valid, true);
    assert.equal(verification.recordValid, true);
    assert.equal(verification.verificationScope, "full-record");
    console.log("PASS: one keyless BTC observation and its canonical receipt verified");
  }
} finally {
  clearTimeout(deadline);
  await client.close();
  rmdirSync(cwd);
}
