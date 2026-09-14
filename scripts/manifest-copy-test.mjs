import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const copy = [manifest.description, manifest.long_description,
  manifest.user_config.pulse_api_key.description,
  ...manifest.tools.map(({ description }) => description)].join("\n");

test("desktop author links to the publisher profile while homepage stays the developer portal", () => {
  assert.equal(manifest.author.url, "https://github.com/PulseBet");
  assert.equal(manifest.homepage, "https://thepulse.markets/developers");
});

test("desktop copy distinguishes signed receipts from unsigned catalogue metadata", () => {
  assert.match(manifest.long_description, /successful rows in batch responses/);
  assert.match(manifest.long_description, /canonical symbol, exact price, at and grade fields/);
  assert.match(manifest.long_description, /Catalogue rows and surrounding metadata are unsigned/);
  assert.match(manifest.long_description, /not price accuracy or freshness/);
  assert.doesNotMatch(copy, /every price|every answer/i);
});

test("desktop copy does not equate catalogue size or a key with guaranteed price access", () => {
  assert.doesNotMatch(copy, /4,?800|60 requests|no card|unlocks|full catalogue/i);
  assert.match(manifest.long_description, /catalogue entry does not guarantee a current price/);
  assert.match(manifest.long_description, /your developer account's allowance/);
  assert.match(manifest.user_config.pulse_api_key.description, /your own key/);
  assert.equal(manifest.user_config.pulse_api_key.required, false);
  assert.equal(manifest.user_config.pulse_api_key.sensitive, true);
});

test("desktop copy discloses verification's public-key dependency", () => {
  assert.doesNotMatch(copy, /offline|any signed print/i);
  assert.match(manifest.long_description, /retrieving the published public-key ring/);
  assert.match(manifest.long_description, /matching key remaining published/);
  assert.match(manifest.long_description, /key is no longer in that ring/);
});

test("release metadata and server version remain synchronized", () => {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  const registry = JSON.parse(read("server.json"));
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.equal(registry.version, pkg.version);
  for (const item of registry.packages) assert.equal(item.version, pkg.version);
  assert(read("src/index.ts").includes(`export const SERVER_VERSION = "${pkg.version}";`));
});
