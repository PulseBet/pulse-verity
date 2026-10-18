// Agent guidance surfaces: the cross-agent skill (.agents/skills/pulse-verity),
// the Cursor rule and the AGENTS.md section, plus the payment gate over every
// tracked file and the packed package: pay-per-request (x402) guidance appears
// only in the cleared surfaces, and says only what is live.
// Offline: reads repository files and runs `git ls-files` and
// `npm pack --dry-run` only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const pkg = JSON.parse(read("package.json"));

const SKILL_DIR = ".agents/skills/pulse-verity";
const SKILL = `${SKILL_DIR}/SKILL.md`;
const REFERENCES = [`${SKILL_DIR}/references/connect.md`];
const CURSOR_RULE = ".cursor/rules/pulse-verity.mdc";
const CLAUDE_PLUGIN_SKILL_DIR = "claude-skills/pulse-verity-price-check";
const AGENTS_START = "<!-- pulse-verity:start -->";
const AGENTS_END = "<!-- pulse-verity:end -->";
const THIS_FILE = "scripts/agent-skills-test.mjs";

// PAYMENT GATE (open, bounded). x402 pay-per-request went live in production on
// 18 Oct 2026 and the release owner cleared short guidance for 1.3.5: the
// cross-agent skill, the Cursor rule and AGENTS.md may carry it, and the
// release notes may name it. Every other file stays payment-free, because
// every file here is public, the Claude plugin is sourced from the repository
// root, and an npm tarball cannot be withdrawn. Adding a surface is a
// deliberate change to PAYMENT_SURFACES, made only when the release owner says
// so; never relax a pattern to let a file through.
const PAYMENT_TEXT = [
  [/x402/i, "x402"],
  [/\bPAYMENT-(?:SIGNATURE|REQUIRED|RESPONSE)\b/i, "x402 payment header"],
  [/\bX-PAYMENT\b/i, "x402 v1 payment header"],
  [/\bpayTo\b/, "payment recipient field"],
  [/transferWithAuthorization|EIP-3009/i, "stablecoin transfer signing"],
  [/\bpay[- ]per[- ](?:call|request)\b/i, "pay-per-call offer"],
  [/\bUSDC\s+on\s+(?:Base|Solana)\b/i, "stablecoin payment rail"],
  [/\bpaid\s+in\s+USDC\b|\b\d+(?:\.\d+)?\s*USDC\b/i, "an amount in USDC"]
];

/** Every line of `text` that carries payment guidance, as { label, line, rule, text }. */
function paymentHits(label, text) {
  const hits = [];
  text.split("\n").forEach((line, index) => {
    for (const [pattern, rule] of PAYMENT_TEXT) if (pattern.test(line)) hits.push({ label, line: index + 1, rule, text: line });
  });
  return hits;
}

/** The same hits, as "label:line: rule: text" for assertion messages. */
function paymentLines(label, text) {
  return paymentHits(label, text).map(({ line, rule, text: content }) => `${label}:${line}: ${rule}: ${content.trim().slice(0, 120)}`);
}

// Where payment text may appear: the file, and which of its lines.
const PAYMENT_SURFACES = new Map([
  [SKILL, () => true],
  [CURSOR_RULE, () => true],
  ["AGENTS.md", () => true],
  // The GitHub release notes describe the change; only the --notes line may name it.
  [".github/workflows/publish.yml", (line) => /^\s*--notes "/.test(line)]
]);

/** Payment hits in `path` that fall outside its cleared lines, as messages. */
function uncleared(path, text) {
  const allowed = PAYMENT_SURFACES.get(path);
  return paymentHits(path, text)
    .filter((hit) => !allowed || !allowed(hit.text))
    .map(({ line, rule, text: content }) => `${path}:${line}: ${rule}: ${content.trim().slice(0, 120)}`);
}

// What is live in production (18 Oct 2026): the x402 routes, networks and amounts.
const X402_DISCOVERY = "https://mcp.thepulse.markets/api/index/v1/x402";
const X402_PRICE = `${X402_DISCOVERY}/price?symbol=BTC`;
const X402_BATCH = `${X402_DISCOVERY}/batch?symbols=BTC,ETH`;
const X402_URLS = new Set([X402_DISCOVERY, X402_PRICE, X402_BATCH]);
const X402_AMOUNTS = new Set(["$0.01", "$0.05"]);

// Agent Skills spec (agentskills.io/specification) and the Claude skill rules:
// only these keys survive a claude.ai or Skills API upload.
const PORTABLE_SKILL_KEYS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);

/**
 * A strict parser for the YAML subset skill and rule frontmatter uses:
 * `key: plain scalar`, `key: "json string"`, `key: true|false`, an empty
 * value, and one level of two-space `child: scalar` lines under an empty key.
 * Anything a real YAML parser would read differently (block scalars, flow
 * collections, anchors, ": " or " #" inside a plain scalar, tabs, duplicate
 * keys) is rejected rather than guessed.
 */
export function parseFrontmatter(text, label = "frontmatter") {
  assert(text.startsWith("---\n"), `${label}: frontmatter must open on the first line`);
  const end = text.indexOf("\n---\n", 3);
  assert(end > 0, `${label}: frontmatter is not closed`);
  const data = {};
  const children = {};
  let parent = null;
  for (const line of text.slice(4, end).split("\n")) {
    assert(!line.includes("\t"), `${label}: tabs are not allowed`);
    if (line.trim() === "") continue;
    const child = line.match(/^ {2}([A-Za-z0-9_-]+):(?: (.*))?$/);
    if (child) {
      assert(parent, `${label}: indented line without a parent key: ${line}`);
      assert(!Object.hasOwn(parent, child[1]), `${label}: duplicate key ${child[1]}`);
      parent[child[1]] = scalar(child[2], label);
      continue;
    }
    const top = line.match(/^([A-Za-z0-9_-]+):(?: (.*))?$/);
    assert(top, `${label}: unsupported line: ${line}`);
    const [, key, raw] = top;
    assert(!Object.hasOwn(data, key), `${label}: duplicate key ${key}`);
    if (raw === undefined || raw.trim() === "") {
      data[key] = null;
      parent = children[key] = {};
    } else {
      data[key] = scalar(raw, label);
      parent = null;
    }
  }
  // An empty key followed by children is a map; without children it is null.
  for (const [key, map] of Object.entries(children)) if (Object.keys(map).length) data[key] = map;
  return { data, body: text.slice(end + 5) };
}

function scalar(raw, label) {
  const value = raw.trim();
  assert(value.length > 0, `${label}: empty scalar`);
  if (value.startsWith('"')) {
    const parsed = JSON.parse(value);
    assert.equal(typeof parsed, "string", `${label}: quoted value must be a string`);
    return parsed;
  }
  assert(!/^[[{|>&*!%@`'?-]/.test(value), `${label}: unsupported YAML value: ${value}`);
  assert(!/: |\s#/.test(value), `${label}: plain value contains ": " or " #": ${value}`);
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function markedAgentsSection() {
  const text = read("AGENTS.md");
  assert.equal(text.split(AGENTS_START).length, 2, "AGENTS.md needs exactly one start marker");
  assert.equal(text.split(AGENTS_END).length, 2, "AGENTS.md needs exactly one end marker");
  const start = text.indexOf(AGENTS_START);
  const end = text.indexOf(AGENTS_END);
  assert(start < end, "AGENTS.md markers are out of order");
  return text.slice(start + AGENTS_START.length, end);
}

/** Every agent-facing text this change adds, as [label, text]. */
function guidanceSurfaces() {
  return [
    [SKILL, read(SKILL)],
    ...REFERENCES.map((path) => [path, read(path)]),
    [CURSOR_RULE, read(CURSOR_RULE)],
    ["AGENTS.md (Pulse Verity section)", markedAgentsSection()]
  ];
}

/** Tracked and untracked-but-not-ignored files: what a push or a plugin install carries. */
function repositoryFiles() {
  const result = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", timeout: 30_000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split("\0").filter((path) => path && existsSync(join(root, path)) && statSync(join(root, path)).isFile());
}

const isText = (buffer) => !buffer.subarray(0, 8000).includes(0);

function packageToolNames() {
  const source = read("src/index.ts");
  return new Set([...source.matchAll(/registerTool\("([a-z_]+)"/g)].map((match) => match[1]));
}

test("the frontmatter parser reads the supported subset and refuses the rest", () => {
  const ok = parseFrontmatter("---\nname: a-b\ndescription: \"Quoted: yes\"\nflag: false\nmetadata:\n  author: Pulse\nempty:\n---\nbody\n");
  assert.deepEqual(ok.data, { name: "a-b", description: "Quoted: yes", flag: false, metadata: { author: "Pulse" }, empty: null });
  assert.equal(ok.body, "body\n");
  for (const bad of [
    "name: x\n---\n", "---\nname: x\n", "---\nname: x\nname: y\n---\n", "---\nname: a: b\n---\n",
    "---\nname: x # comment\n---\n", "---\ndescription: |\n  block\n---\n", "---\n  orphan: x\n---\n",
    "---\nlist: [a, b]\n---\n", "---\n\tname: x\n---\n", "---\n- item\n---\n"
  ]) assert.throws(() => parseFrontmatter(bad), `should refuse ${JSON.stringify(bad)}`);
});

test("the cross-agent skill follows the Agent Skills format", () => {
  const { data, body } = parseFrontmatter(read(SKILL), SKILL);
  for (const key of Object.keys(data)) assert(PORTABLE_SKILL_KEYS.has(key), `non-portable skill key: ${key}`);
  assert.equal(data.name, "pulse-verity");
  assert.equal(data.name, SKILL_DIR.split("/").pop(), "name must match the skill directory");
  assert.match(data.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert(data.name.length <= 64);
  assert(!/anthropic|claude/.test(data.name), "reserved word in skill name");
  assert.equal(typeof data.description, "string");
  assert(data.description.length > 0 && data.description.length <= 1024, `description is ${data.description.length} characters`);
  assert(!/[<>]/.test(data.description), "no XML tags in the description");
  for (const trigger of ["Pulse Verity", "verify_print"]) assert(data.description.includes(trigger), `description misses ${trigger}`);
  assert.equal(data.license, pkg.license);
  assert.equal(typeof data.compatibility, "string");
  assert(data.compatibility.length > 0 && data.compatibility.length <= 500);
  assert.equal(typeof data.metadata, "object");
  for (const value of Object.values(data.metadata)) assert.equal(typeof value, "string");
  assert.equal(data.metadata.repository, "https://github.com/PulseBet/pulse-verity");
  assert(body.trim().length > 0);
  assert(body.split("\n").length < 500, "keep SKILL.md under 500 lines");
});

test("the Claude plugin skill frontmatter still parses", () => {
  const dir = CLAUDE_PLUGIN_SKILL_DIR;
  const { data } = parseFrontmatter(read(`${dir}/SKILL.md`), dir);
  for (const key of Object.keys(data)) assert(PORTABLE_SKILL_KEYS.has(key), `non-portable skill key: ${key}`);
  assert.equal(data.name, dir.split("/").pop());
  assert(data.description.length > 0 && data.description.length <= 1024 && !/[<>]/.test(data.description));
});

test("skill references resolve, sit one level deep and are all linked", () => {
  const skill = read(SKILL);
  const linked = new Set([...skill.matchAll(/\]\((references\/[^)]+)\)/g)].map((match) => `${SKILL_DIR}/${match[1]}`));
  const present = readdirSync(join(root, SKILL_DIR, "references")).map((name) => `${SKILL_DIR}/references/${name}`);
  for (const path of present) assert(statSync(join(root, path)).isFile(), `${path} must be a file, not a directory`);
  assert.deepEqual([...linked].sort(), [...present].sort());
  assert.deepEqual([...present].sort(), [...REFERENCES].sort());
  assert.deepEqual(readdirSync(join(root, SKILL_DIR)).sort(), ["SKILL.md", "references"]);
});

test("guidance names only real tools and the package's own URLs", () => {
  const tools = packageToolNames();
  assert(tools.has("get_index_price") && tools.has("verify_print"), "could not read the package tool list");
  const known = new Set([...tools, "get_upgrade_options"]); // hosted-only tool
  for (const [label, text] of guidanceSurfaces()) {
    for (const [name] of text.matchAll(/\b(?:get_[a-z_]+|list_index_assets|verify_print|submit_verity_feedback)\b/g)) {
      assert(known.has(name), `${label} names an unknown tool: ${name}`);
    }
  }
  const skill = read(SKILL);
  for (const tool of tools) assert(skill.includes(`\`${tool}\``), `SKILL.md does not cover ${tool}`);
  const hosted = read("src/index.ts").match(/HOSTED_MCP_URL = "([^"]+)"/)[1];
  const upgrade = read("src/quotaError.ts").match(/DEVELOPER_UPGRADE_URL = "([^"]+)"/)[1];
  for (const text of [skill, read(CURSOR_RULE), markedAgentsSection()]) {
    assert(text.includes(hosted), "hosted MCP URL missing");
    assert(text.includes(upgrade), "plans URL missing");
  }
});

test("the payment gate catches pay-per-call guidance and passes ordinary Verity copy", () => {
  // Synthetic lines shaped like payment guidance, and ordinary copy that must
  // keep passing (USDC is also a ticker Verity prices).
  for (const line of [
    "`GET https://example.test/v1/x402/item`",
    "Send `PAYMENT-SIGNATURE` or `X-PAYMENT` with the request",
    "| `payTo` | `0x...` |",
    "Sign an EIP-3009 `transferWithAuthorization` for the amount",
    "The example shop accepts USDC on Solana.",
    "One item is 9.99 USDC",
    "Pay per request with no account"
  ]) assert.notDeepEqual(paymentLines("sample", line), [], `the gate misses: ${line}`);
  for (const line of [
    "const contractAsset = { assetId: \"contract:eip155:1:0x01\", symbol: \"USDC\" };",
    "Plans: `https://thepulse.markets/developers#/portal/pricing` (Developer plan: no charge).",
    "the account holder decides and pays in the portal.",
    "The tools read and verify data. They place no trades, move no funds and make no payments."
  ]) assert.deepEqual(paymentLines("sample", line), [], `the gate flags ordinary copy: ${line}`);
});

test("the gate's surface rules clear only the listed files and lines", () => {
  const sample = "Pay per request with x402";
  for (const path of [SKILL, CURSOR_RULE, "AGENTS.md"]) assert.deepEqual(uncleared(path, sample), [], path);
  assert.deepEqual(uncleared(".github/workflows/publish.yml", `            --notes "${sample}."`), []);
  assert.notDeepEqual(uncleared(".github/workflows/publish.yml", `      - run: echo ${sample}`), [], "publish.yml outside --notes");
  for (const path of ["README.md", REFERENCES[0], `${CLAUDE_PLUGIN_SKILL_DIR}/SKILL.md`, "manifest.json", "server.json", "dist/index.js"]) {
    assert.notDeepEqual(uncleared(path, sample), [], `${path} must stay payment-free`);
  }
});

test("PAYMENT GATE (open, bounded): pay-per-request guidance appears only in the cleared surfaces", () => {
  // The Claude plugin is sourced from the repository root (.claude-plugin/
  // plugin.json sits there), so a plugin install and a directory reviewer's
  // checkout carry every file, not only claude-skills/.
  assert(existsSync(join(root, ".claude-plugin/plugin.json")), "the Claude plugin manifest moved: re-check what its source tree ships");
  const files = repositoryFiles();
  assert(files.includes(SKILL) && files.includes("README.md"), "could not list the repository files");
  const outside = [];
  for (const path of files) {
    if (path === THIS_FILE) continue; // the gate's own patterns
    const buffer = readFileSync(join(root, path));
    if (isText(buffer)) outside.push(...uncleared(path, buffer.toString("utf8")));
  }
  assert.deepEqual(outside, [], "pay-per-request guidance belongs only in the skill, the Cursor rule and AGENTS.md");
  // The gate is open on purpose: each cleared guidance surface carries the guidance.
  for (const [label, text] of [[SKILL, read(SKILL)], [CURSOR_RULE, read(CURSOR_RULE)], ["AGENTS.md (Pulse Verity section)", markedAgentsSection()]]) {
    assert.notDeepEqual(paymentHits(label, text), [], `${label} is missing the x402 guidance`);
  }
  for (const [label, text] of guidanceSurfaces()) {
    assert(!/\b0x[0-9a-fA-F]{40}\b|\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/.test(text), `${label} carries a wallet or token address`);
  }
});

test("x402 guidance names only what is live and keeps the authorisation rule", () => {
  const notLive = [
    [/\b(?:polygon|matic|arbitrum|optimism|avalanche|sepolia|testnet|ethereum mainnet)\b/i, "a network that is not offered"],
    [/top[- ]?ups?\b/i, "top-ups are not live"],
    [/\bcredits?\b/i, "never call prepaid packs \"credits\""],
    [/transferWithAuthorization|EIP-3009|\bpayTo\b|PAYMENT-(?:SIGNATURE|REQUIRED|RESPONSE)|X-PAYMENT|facilitator/i, "protocol internals belong to the x402 client"]
  ];
  for (const [label, text] of [[SKILL, read(SKILL)], [CURSOR_RULE, read(CURSOR_RULE)], ["AGENTS.md (Pulse Verity section)", markedAgentsSection()]]) {
    const flat = text.replace(/\s+/g, " "); // wrapped lines read as one
    assert(text.includes(X402_PRICE), `${label} misses the price route`);
    assert(new RegExp(`${X402_DISCOVERY.replaceAll(".", "\\.")}(?![/?\\w])`).test(text), `${label} misses the discovery URL`);
    for (const [url] of text.matchAll(/https?:\/\/[^\s`)<>"']*x402[^\s`)<>"']*/g)) assert(X402_URLS.has(url), `${label} names an unknown x402 URL: ${url}`);
    for (const word of ["USDC", "Base", "Solana", "$0.01", "$0.05", "up to 100 symbols"]) assert(flat.includes(word), `${label} misses ${word}`);
    for (const [amount] of text.matchAll(/\$\d[\d,]*(?:\.\d+)?/g)) assert(X402_AMOUNTS.has(amount), `${label} names an amount that is not live: ${amount}`);
    assert(/only with the person's authorisation and within the spending limit they set/i.test(flat), `${label} misses the authorisation and spending-limit rule`);
    assert(/stop and ask/i.test(flat), `${label} misses the amount-mismatch stop`);
    assert(/never ask for a wallet's private key or recovery phrase/i.test(flat), `${label} misses the wallet-secret rule`);
    assert(/\bverify_print\b/.test(text), `${label} must send paid prints to verify_print`);
    const failures = [];
    text.split("\n").forEach((line, index) => {
      for (const [pattern, rule] of notLive) if (pattern.test(line)) failures.push(`${label}:${index + 1}: ${rule}: ${line.trim()}`);
    });
    assert.deepEqual(failures, []);
  }
});

test("guidance never asks for secrets and never buys for the person", () => {
  for (const [label, text] of [[SKILL, read(SKILL)], [CURSOR_RULE, read(CURSOR_RULE)], ["AGENTS.md", markedAgentsSection()]]) {
    assert(/never ask for an API key, password, private key or recovery phrase/i.test(text), `${label} misses the secrets rule`);
    assert(/never buy a plan/i.test(text), `${label} misses the no-purchase rule`);
    assert(!text.includes("pidx_"), `${label} must not show a key prefix`);
  }
});

test("the Cursor rule frontmatter is valid and agent-requested", () => {
  const { data, body } = parseFrontmatter(read(CURSOR_RULE), CURSOR_RULE);
  assert.deepEqual(Object.keys(data).sort(), ["alwaysApply", "description", "globs"]);
  assert.equal(typeof data.description, "string");
  assert(data.description.length > 20);
  assert.equal(data.alwaysApply, false);
  assert.equal(data.globs, null);
  assert(body.includes("verify_print"));
});

test("copy rules hold on every new agent-facing surface", () => {
  const banned = [
    [/\bfree\b/i, "say \"no charge\", never \"free\""],
    [/independent(?:ly)?\s+verif/i, "never \"independently verified\""],
    [/\boracle/i, "no oracle claims"],
    [/\battest/i, "no attestation claims"],
    [/settle/i, "no settlement claims (only the legacy tool name get_settlement_print)"],
    [/\b\d[\d,.]*\s*\+?\s*(?:assets|coins|tokens|cryptocurrencies|cryptoassets)\b/i, "no asset counts"],
    [/\b(bet|bets|betting|wager|wagers|wagered|wagering|gamble|gambles|gambling|gambler|casino|casinos|odds|punt|punts|bookie|bookies|jackpot|jackpots|stake|stakes|staked|staking)\b/i, "Pulse WORDS gate"]
  ];
  const failures = [];
  for (const [label, text] of guidanceSurfaces()) {
    text.replaceAll("get_settlement_print", "").split("\n").forEach((line, index) => {
      for (const [pattern, rule] of banned) if (pattern.test(line)) failures.push(`${label}:${index + 1}: ${rule}: ${line.trim()}`);
    });
  }
  assert.deepEqual(failures, []);
});

test("the Claude plugin skill stays payment-free", () => {
  // Anthropic Software Directory Policy 4(A): software that transfers
  // cryptocurrency needs Anthropic's written permission. The directory-bound
  // plugin skill must not teach x402 payment.
  const files = readdirSync(join(root, CLAUDE_PLUGIN_SKILL_DIR), { recursive: true })
    .map((name) => join(CLAUDE_PLUGIN_SKILL_DIR, String(name)))
    .filter((path) => statSync(join(root, path)).isFile());
  assert(files.length > 0);
  for (const path of files) assert(!/x402|USDC|PAYMENT-SIGNATURE|X-PAYMENT/i.test(read(path)), `${path} mentions payment`);
});

test("plugin roots stay isolated from the cross-agent skill and rule", () => {
  // Claude, Cursor and Grok plugin loaders scan these root directories by default.
  for (const path of ["skills", "rules", "agents", "commands", "hooks", "plugin.json", "SKILL.md"]) {
    assert(!existsSync(join(root, path)), `root ${path} would be loaded into a plugin`);
  }
  const cursor = JSON.parse(read(".cursor-plugin/plugin.json"));
  for (const key of ["skills", "rules", "agents", "commands", "hooks"]) assert(!Object.hasOwn(cursor, key), `Cursor manifest declares ${key}`);
  const claude = JSON.parse(read(".claude-plugin/plugin.json"));
  assert.equal(claude.skills, "./claude-skills/");
  assert.deepEqual(readdirSync(join(root, "claude-skills")), ["pulse-verity-price-check"]);
});

test("the npm package ships the skill with its x402 section, and no other payment text", () => {
  assert(pkg.files.includes(`${SKILL_DIR}/`), "package.json files must ship the cross-agent skill");
  for (const entry of pkg.files) assert(!/^(?:\.cursor|docs|AGENTS\.md|claude-skills)/.test(entry), `package.json files must not ship ${entry}`);
  const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8", timeout: 60_000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  // npm 11 prints [tarball]; npm 12 prints { [name]: tarball }.
  const report = JSON.parse(result.stdout);
  const packed = Array.isArray(report) ? report[0] : report[pkg.name];
  const files = packed.files.map(({ path }) => path);
  for (const path of [SKILL, ...REFERENCES]) assert(files.includes(path), `package is missing ${path}`);
  const skillFiles = files.filter((path) => path.startsWith(`${SKILL_DIR}/`)).sort();
  assert.deepEqual(skillFiles, [SKILL, ...REFERENCES].sort(), "the package ships exactly the skill and its references");
  const outside = [];
  for (const path of files) {
    assert(!path.startsWith(".cursor/") && !path.startsWith("docs/") && path !== "AGENTS.md", `package must not ship ${path}`);
    // A published tarball cannot be withdrawn: the payment gate covers it too.
    // Only the skill's SKILL.md may carry the x402 section.
    const buffer = readFileSync(join(root, path));
    if (isText(buffer)) outside.push(...(path === SKILL ? [] : paymentLines(`package:${path}`, buffer.toString("utf8"))));
  }
  assert.deepEqual(outside, []);
  assert.notDeepEqual(paymentHits(SKILL, read(SKILL)), [], "the packed skill carries the x402 section");
});
