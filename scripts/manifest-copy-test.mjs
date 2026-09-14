import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const registry = JSON.parse(read("server.json"));
const cursor = JSON.parse(read(".cursor-plugin/plugin.json"));
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

// Registry-only metadata versions may reference an unchanged npm release:
// https://modelcontextprotocol.io/registry/versioning
// Require either the exact stable package version or an explicit metadata
// prerelease with a higher core version, so it supersedes the stable listing.
function validRegistryVersion(registryVersion, packageVersion) {
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  const pkg = stable.exec(packageVersion);
  if (!pkg) return false;
  if (registryVersion === packageVersion) return true;
  const metadata = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-metadata\.([1-9]\d*)$/.exec(registryVersion);
  if (!metadata) return false;
  for (let i = 1; i <= 3; i++) {
    const difference = BigInt(metadata[i]) - BigInt(pkg[i]);
    if (difference !== 0n) return difference > 0n;
  }
  return false;
}

test("registry-only metadata versions must sort above the unchanged stable package", () => {
  for (const version of ["1.2.6", "1.2.7-metadata.1", "1.3.0-metadata.2", "2.0.0-metadata.1"]) {
    assert.equal(validRegistryVersion(version, "1.2.6"), true, version);
  }
  for (const version of ["1.2.5", "1.2.6-metadata.1", "1.2.6+metadata.1", "1.1.9-metadata.1", "0.9.9-metadata.1", "1.2.7", "1.2.7-rc.1", "01.2.7-metadata.1", "1.2.7-metadata.01", "^1.2.6", "latest"]) {
    assert.equal(validRegistryVersion(version, "1.2.6"), false, version);
  }
  assert.equal(validRegistryVersion("1.2.7-metadata.1", "invalid"), false);
});

test("registry and Cursor descriptions keep coverage and access bounded", () => {
  assert(registry.description.length <= 100);
  const descriptions = [registry.description, cursor.description,
    cursor.variables.properties.PULSE_API_KEY.description,
    ...registry.packages.flatMap((item) => item.environmentVariables.map(({ description }) => description))];
  for (const description of descriptions) {
    assert.doesNotMatch(description, /4,?800|60 requests|no card|unlocks|full catalogue|every price|offline|any signed print/i);
  }
  assert.match(cursor.description, /Catalogue rows and surrounding metadata are unsigned/);
  for (const description of [cursor.variables.properties.PULSE_API_KEY.description,
    registry.packages[0].environmentVariables[0].description]) {
    assert.match(description, /your own developer key/);
    assert.match(description, /allowances depend on your account/);
  }
});

test("runtime and package pins stay synchronized across registry metadata revisions", () => {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert(validRegistryVersion(registry.version, pkg.version));
  assert.equal(cursor.version, pkg.version);
  assert.equal(registry.packages.length, 1);
  for (const item of registry.packages) {
    assert.equal(item.registryType, "npm");
    assert.equal(item.identifier, pkg.name);
    assert.equal(item.version, pkg.version);
  }
  assert(read("src/index.ts").includes(`export const SERVER_VERSION = "${pkg.version}";`));
});
