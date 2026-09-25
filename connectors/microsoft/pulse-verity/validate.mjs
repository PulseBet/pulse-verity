#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, name));
const json = (name) => JSON.parse(read(name).toString("utf8"));

const api = json("apiDefinition.swagger.json");
const props = json("apiProperties.json");
const intro = read("intro.md").toString("utf8");
const reviewer = read("reviewer-evaluation.md").toString("utf8");
const checklist = read("submission-checklist.md").toString("utf8");

assert.equal(api.swagger, "2.0");
assert.equal(api.host, "mcp.thepulse.markets");
assert.equal(api.basePath, "/");
assert.deepEqual(api.schemes, ["https"]);
assert.equal(api.info.title, "Pulse Verity Index");
assert(api.info.title.length <= 30);
assert(!/\b(?:API|Connector|Copilot Studio|Power Apps|Power Automate)\b/i.test(api.info.title));
assert(api.info.description.length > 30 && api.info.description.length < 500);
assert.equal(api.info.contact.email, "support@thepulse.markets");

const paths = Object.keys(api.paths);
assert.deepEqual(paths, ["/api/index/mcp"]);
const operation = api.paths["/api/index/mcp"].post;
assert(operation && Object.keys(api.paths["/api/index/mcp"]).length === 1);
assert.equal(operation.operationId, "InvokeServer");
assert.equal(operation["x-ms-agentic-protocol"], "mcp-streamable-1.0");
assert.equal(operation["x-ms-visibility"], "advanced");
assert(operation.summary.length <= 80 && /^[A-Za-z0-9 ()]+$/.test(operation.summary));
assert(/[.!?]$/.test(operation.description));
assert.deepEqual(Object.keys(operation.responses), ["200", "400", "401", "405", "500"]);
for (const response of Object.values(operation.responses)) {
  assert(typeof response.description === "string" && /[.!?]$/.test(response.description));
  assert(!("schema" in response), "Dynamic MCP responses must not invent a fixed schema");
}

const accept = operation.parameters.find((item) => item.name === "Accept" && item.in === "header");
assert(accept);
assert.equal(accept.default, "application/json, text/event-stream");
assert.equal(accept["x-ms-visibility"], "internal");

assert.deepEqual(api.securityDefinitions, {
  api_key: { type: "apiKey", in: "header", name: "Authorization" }
});
assert.deepEqual(api.security, [{ api_key: [] }]);
const credentialPattern = /pidx_(?!your_key\b)[A-Za-z0-9_-]{16,}/;
assert(!JSON.stringify(api).match(credentialPattern), "OpenAPI must not contain a developer key");

const connection = props.properties.connectionParameters.api_key;
assert.equal(connection.type, "securestring");
assert.equal(connection.uiDefinition.constraints.clearText, false);
assert.equal(connection.uiDefinition.constraints.required, "true");
assert.equal(props.properties.iconBrandColor, "#080B12");
assert(!["#ffffff", "#007ee5"].includes(props.properties.iconBrandColor.toLowerCase()));
assert.equal(props.properties.publisher, "Pulse Labs OpCo LLC");
assert.equal(props.properties.stackOwner, "Pulse Labs OpCo LLC");

const metadata = Object.fromEntries(api["x-ms-connector-metadata"].map((item) => [item.propertyName, item.propertyValue]));
assert.equal(metadata.Website, "https://thepulse.markets/developers");
assert.equal(metadata["Privacy policy"], "https://thepulse.markets/developers/privacy");
assert.equal(metadata.Categories, "Data;Finance");

const expectedTools = [
  "get_index_price",
  "get_index_batch",
  "list_index_assets",
  "get_settlement_print",
  "verify_print"
];
for (const tool of expectedTools) {
  assert(intro.includes("`" + tool + "`"), `intro.md must document ${tool}`);
  assert(reviewer.includes("`" + tool + "`"), `reviewer-evaluation.md must test ${tool}`);
}
assert.match(intro, /All five tools are read-only/);
assert.match(intro, /never means that the price is zero/);
assert.match(reviewer, /Fail the review if any write, trade, wallet, transfer/);
assert.match(checklist, /do not assert Partner Center approval or certification/);

const allText = [intro, reviewer, checklist, read("README.md").toString("utf8"), JSON.stringify(props)].join("\n");
assert(!allText.match(credentialPattern), "Package must not contain a developer key");
assert(!allText.match(/Microsoft-certified|certified by Microsoft|approved by Microsoft|now certified|now listed/i), "Package must not claim approval");

const icon = read("icon.png");
assert.equal(icon.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
assert.equal(icon.subarray(12, 16).toString("ascii"), "IHDR");
assert.equal(icon.readUInt32BE(16), 200);
assert.equal(icon.readUInt32BE(20), 200);
assert.equal(icon[24], 8, "Icon must use 8-bit channels");
assert.equal(icon[25], 2, "Icon must be RGB without transparency");

console.log("PASS: Microsoft Pulse Verity connector source package is internally consistent");
