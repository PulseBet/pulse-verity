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
const runtimeFiles = ["dist/index.js", "dist/quotaError.js"];

function command(executable, args, cwd = root) {
  const result = spawnSync(executable, args, { cwd, encoding: "utf8", timeout: 30_000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function packedFiles(cwd, destination) {
  const [packed] = JSON.parse(command("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], cwd));
  assert.equal(packed.version, pkg.version);
  const files = packed.files.map(({ path }) => path);
  for (const path of runtimeFiles) assert(files.includes(path), `Published package is missing ${path}`);
  assert(!files.includes("dist/selftest.js"));
  assert(!files.some((path) => path.startsWith("src/")));
  return files;
}

test("the packed npm release contains the entry point and its quota module", () => {
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

test("an alias preserves both runtime modules in its actual npm archive", () => {
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
  assert(workflow.includes('cp dist/index.js dist/quotaError.js "$MCPB_STAGE/dist/"'));
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
