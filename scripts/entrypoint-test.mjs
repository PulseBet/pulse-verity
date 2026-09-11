import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const entryUrl = new URL("../dist/index.js", import.meta.url);
const entry = fileURLToPath(entryUrl);
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).version;
const env = { ...process.env, PULSE_API_KEY: "" };
const expectedTools = ["get_index_price", "get_index_batch", "list_index_assets", "get_settlement_print", "verify_print"].sort();

async function handshake(path) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path], { env, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "", done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      child.kill();
      if (error) reject(error); else resolve();
    };
    const timeout = setTimeout(() => finish(new Error("MCP startup timed out")), 10000);
    const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");
    child.on("error", finish);
    child.stdin.on("error", finish);
    child.on("exit", () => { if (!done) finish(new Error("MCP exited before initialization")); });
    child.stderr.on("data", () => {});
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          assert.equal(message.error, undefined);
          if (message.id === 1) {
            assert.equal(message.result.serverInfo.version, version);
            send({ jsonrpc: "2.0", method: "notifications/initialized" });
            send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
          } else if (message.id === 2) {
            assert.deepEqual(message.result.tools.map((tool) => tool.name).sort(), expectedTools);
            finish();
          }
        } catch (error) { finish(error); }
      }
    });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2025-03-26", capabilities: {},
      clientInfo: { name: "entrypoint-regression", version: "1.0.0" }
    } });
  });
}

test("direct entry initializes and lists five tools without a key", () => handshake(entry));

test("npm-style executable symlink initializes without a key", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pulse-verity-entrypoint-"));
  try {
    const link = join(directory, "pulse-verity");
    symlinkSync(entry, link, "file");
    await handshake(link);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const argv of ["absent", "nonexistent", "caller"]) {
  test(`import with ${argv} argv does not start a transport`, () => {
    const preparation = argv === "absent" ? "delete process.argv[1];" :
      `process.argv[1] = ${JSON.stringify(argv === "caller" ? fileURLToPath(import.meta.url) : join(tmpdir(), "nonexistent-pulse-verity-entrypoint-file"))};`;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `${preparation} await import(${JSON.stringify(entryUrl.href)});`], {
      env, encoding: "utf8", timeout: 10000
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  });
}
