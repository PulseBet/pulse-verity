import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const pkg = JSON.parse(read("package.json"));
const runtimeFiles = ["dist/index.js", "dist/quotaError.js", "dist/mcpContracts.js", "dist/feedbackContract.js"];

function command(executable, args, cwd = root) {
  const result = spawnSync(executable, args, { cwd, encoding: "utf8", timeout: 30_000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

// npm 11 emits [tarball]; npm 12 emits { [packageName]: tarball }.
// The npm 12.0.2 pack snapshot and logTar implementation document that key:
// https://github.com/npm/cli/blob/v12.0.2/tap-snapshots/test/lib/commands/pack.js.test.cjs
// https://github.com/npm/cli/blob/v12.0.2/lib/utils/tar.js
function parsePackedReport(output, expected) {
  const report = JSON.parse(output);
  let packed;
  if (Array.isArray(report)) {
    assert.equal(report.length, 1, "Expected exactly one packed package");
    [packed] = report;
  } else {
    assert(report && typeof report === "object", "Expected an npm pack JSON report");
    assert.deepEqual(Object.keys(report), [expected.name], "Expected one package-name-keyed npm pack report");
    packed = report[expected.name];
  }
  assert(packed && typeof packed === "object" && !Array.isArray(packed), "Expected a tarball record");
  assert.equal(packed.name, expected.name);
  assert.equal(packed.version, expected.version);
  assert.equal(packed.id, `${expected.name}@${expected.version}`);
  assert.equal(packed.filename, `${expected.name.replace('@', '').replace('/', '-')}-${expected.version}.tgz`);
  assert(Array.isArray(packed.files) && packed.files.length > 0, "Expected packed file entries");
  for (const file of packed.files) {
    assert(file && typeof file === "object" && !Array.isArray(file), "Expected a packed file record");
    assert(typeof file.path === "string" && file.path.length > 0, "Expected a packed file path");
    assert(Number.isSafeInteger(file.size) && file.size >= 0, "Expected a packed file size");
    assert(Number.isSafeInteger(file.mode) && file.mode >= 0, "Expected a packed file mode");
  }
  return packed;
}

function packedFiles(cwd, destination) {
  const expected = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  assert.equal(expected.version, pkg.version);
  const packed = parsePackedReport(command("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], cwd), expected);
  const files = packed.files.map(({ path }) => path);
  for (const path of runtimeFiles) assert(files.includes(path), `Published package is missing ${path}`);
  assert(!files.includes("dist/selftest.js"));
  assert(!files.some((path) => path.startsWith("src/")));
  return files;
}

const syntheticPackage = { name: "synthetic-package", version: "1.0.0" };
const syntheticTarball = {
  ...syntheticPackage,
  id: "synthetic-package@1.0.0",
  filename: "synthetic-package-1.0.0.tgz",
  files: [{ path: "package.json", size: 64, mode: 420 }]
};

test("npm 11 array JSON identifies the single expected packed package", () => {
  assert.deepEqual(parsePackedReport(JSON.stringify([syntheticTarball]), syntheticPackage), syntheticTarball);
});

test("npm 12 package-name-keyed JSON identifies the single expected packed package", () => {
  assert.deepEqual(parsePackedReport(JSON.stringify({ [syntheticPackage.name]: syntheticTarball }), syntheticPackage), syntheticTarball);
});

test("npm pack JSON rejects ambiguous containers and malformed package records", () => {
  for (const report of [
    null, [], [syntheticTarball, syntheticTarball], syntheticTarball,
    { unrelated: syntheticTarball },
    { [syntheticPackage.name]: syntheticTarball, unrelated: syntheticTarball },
    { [syntheticPackage.name]: null },
    { [syntheticPackage.name]: { ...syntheticTarball, name: "unrelated" } },
    [{ ...syntheticTarball, version: "2.0.0" }],
    [{ ...syntheticTarball, id: "unrelated@1.0.0" }],
    [{ ...syntheticTarball, filename: "unrelated.tgz" }],
    [{ ...syntheticTarball, files: {} }],
    [{ ...syntheticTarball, files: [] }],
    [{ ...syntheticTarball, files: [null] }],
    [{ ...syntheticTarball, files: [{ path: "", size: 64, mode: 420 }] }],
    [{ ...syntheticTarball, files: [{ path: "package.json", size: -1, mode: 420 }] }],
    [{ ...syntheticTarball, files: [{ path: "package.json", size: 64 }] }]
  ]) assert.throws(() => parsePackedReport(JSON.stringify(report), syntheticPackage));
  assert.throws(() => parsePackedReport("not json", syntheticPackage));
});

test("the packed npm release contains the entry point and all runtime modules", () => {
  const directory = mkdtempSync(join(tmpdir(), "verity-release-pack-"));
  try {
    const lock = JSON.parse(read("package-lock.json"));
    assert.equal(lock.version, pkg.version);
    assert.equal(lock.packages[""].version, pkg.version);
    assert.match(read("dist/index.js"), /from ["']\.\/quotaError\.js["']/);
    packedFiles(root, directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an alias preserves all runtime modules in its actual npm archive", () => {
  const directory = mkdtempSync(join(tmpdir(), "verity-alias-pack-"));
  const alias = join(directory, "alias");
  try {
    command(process.execPath, ["scripts/prepare-alias.mjs", "pulse-verity-index", alias]);
    for (const path of runtimeFiles) assert.equal(readFileSync(join(alias, path), "utf8"), read(path));
    packedFiles(alias, directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the desktop release stages the quota module and publishes all Gemini platforms together", () => {
  const workflow = read(".github/workflows/publish.yml");
  assert(workflow.includes('cp dist/index.js dist/quotaError.js dist/mcpContracts.js dist/feedbackContract.js "$MCPB_STAGE/dist/"'));
  const create = workflow.match(/gh release create[^]*?--notes [^\n]+/)?.[0];
  assert(create, "The release must be created with its full asset set");
  assert(create.includes('"$RUNNER_TEMP/pulse-verity-$MCPB_VERSION.mcpb"'));
  for (const platform of ["darwin", "linux", "win32"]) {
    assert(create.includes(`"$RUNNER_TEMP/verity-gemini/assets/${platform}.pulse-verity.tar.gz"`));
  }
  assert(!workflow.includes("--clobber"));
  const published = workflow.slice(workflow.indexOf("  verify-published-gemini:"));
  assert(published.includes("needs: publish-desktop-bundle"));
  assert(published.includes("@google/gemini-cli@0.59.0"));
  assert(published.includes('gemini extensions install "https://github.com/$GITHUB_REPOSITORY" --consent --skip-settings'));
  assert(published.includes('gemini-extension.json" --live'));
  assert(!published.includes("--candidate-tarball"));
});

// 1.3.8: every developer-portal link this repository ships says where a
// sign-up came from. The portal and the server keep ref as the source and
// utm_campaign as the campaign, so each reads mcp-npm/<campaign>. Left
// untagged on purpose: account and legal pages, and the plans URL the tools
// return as upgradeUrl (a fixed output contract the guidance must quote as is).
test("every shipped developer-portal link carries ref=mcp-npm and its surface's campaign", () => {
  const surfaces = {
    "README.md": "readme-npm", "package.json": "homepage-npm", "manifest.json": "mcpb-npm",
    ".claude-plugin/plugin.json": "claude-plugin-npm", ".cursor-plugin/plugin.json": "cursor-plugin-npm",
    ".grok-plugin/plugin.json": "grok-plugin-npm", "gemini-extension.json": "gemini-npm",
    "server.json": "registry-npm", "smithery.yaml": "smithery-npm",
    ".agents/skills/pulse-verity/SKILL.md": "skill-npm", ".agents/skills/pulse-verity/references/connect.md": "skill-npm",
    "claude-skills/pulse-verity-price-check/SKILL.md": "claude-skill-npm", "docs/grok.md": "grok-docs-npm"
  };
  const untagged = new Set(["https://thepulse.markets/developers/access", "https://thepulse.markets/developers/privacy",
    "https://thepulse.markets/developers/terms", "https://thepulse.markets/developers#/portal/pricing",
    "https://thepulse.markets/developers#/portal/reference"]);
  for (const [path, campaign] of Object.entries(surfaces)) {
    const links = [...read(path).matchAll(/https:\/\/thepulse\.markets\/developers[^\s"'`)<>]*/g)].map(([link]) => link);
    const tagged = links.filter((link) => !untagged.has(link));
    assert(tagged.length > 0, `${path} has no tagged portal link`);
    for (const link of tagged) {
      const url = new URL(link);
      assert.equal(url.pathname, "/developers", `${path}: ${link}`);
      assert.equal(url.searchParams.get("ref"), "mcp-npm", `${path}: ${link}`);
      assert.equal(url.searchParams.get("utm_campaign"), campaign, `${path}: ${link}`);
      assert.equal(url.searchParams.get("src"), null, `${path}: only the cap answer carries src=cap: ${link}`);
      assert(!/[.,;:]$/.test(link), `${path}: punctuation would be copied into ${link}`);
    }
  }
});

test("the README's first instruction is the hosted server with Google sign-in; the keyless try-out follows", () => {
  const readme = read("README.md");
  const headings = [...readme.matchAll(/^## (.+)$/gm)].map(([, heading]) => heading);
  assert.equal(headings[0], "Start here: connect the hosted server (sign in with Google, no key to copy)");
  const start = readme.slice(readme.indexOf("## " + headings[0]), readme.indexOf("## " + headings[1]));
  assert(start.includes("`https://mcp.thepulse.markets/api/index/mcp`"));
  assert(start.includes("claude mcp add --transport http pulse-verity https://mcp.thepulse.markets/api/index/mcp"));
  for (const client of ["**Claude**", "**Claude Code**", "**ChatGPT**", "**Claude plugin**", "**Grok Bot and the xAI API**"]) assert(start.includes(client), client);
  assert(headings.indexOf("Try without an account: first signed BTC sample") > 0);
  for (const anchor of [...readme.matchAll(/\]\(#([a-z0-9-]+)\)/g)].map(([, a]) => a)) {
    const slugs = headings.concat([...readme.matchAll(/^### (.+)$/gm)].map(([, h]) => h))
      .map((h) => h.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-"));
    assert(slugs.includes(anchor), `README links to a missing section: #${anchor}`);
  }
  assert(readme.includes(`npx -y ${pkg.name}@${pkg.version}`) && !/pulse-verity@1\.3\.7/.test(readme));
});
