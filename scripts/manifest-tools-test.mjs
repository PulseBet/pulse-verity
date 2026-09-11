// THE MANIFEST MUST DESCRIBE THE SERVER IT SHIPS.
//
// Found 11 Sep, publishing to Smithery. Their API rejected the bundle with
//
//   400 Invalid input: expected object, received undefined  (x4)
//
// because manifest.json listed each tool as { name, description } and nothing
// else. The MCP specification requires inputSchema, an OBJECT, and Smithery's
// CLI copies the manifest's tools array into the serverCard it uploads. No
// inputSchema in the manifest, no inputSchema in the payload, rejected.
//
// It was never a Smithery problem. The manifest had been describing the tools
// incompletely since the bundle was first built, and nothing checked, because
// Claude Desktop installs the bundle and asks the RUNNING server what its tools
// are — so the manifest's copy was decorative there and load-bearing here.
//
// This compares the manifest against the tools the built server actually
// registers: same names, and a real object schema for each.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error('  FAIL: ' + name); } };

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

const live = await new Promise((resolve, reject) => {
  const env = { ...process.env };
  delete env.PULSE_API_KEY;
  const p = spawn('node', ['dist/index.js'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', d => (out += d));
  p.on('error', reject);
  const send = o => p.stdin.write(JSON.stringify(o) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize',
         params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  setTimeout(() => send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }), 600);
  setTimeout(() => {
    p.kill();
    for (const line of out.trim().split('\n')) {
      if (!line) continue;
      const m = JSON.parse(line);
      if (m.id === 2) return resolve(m.result.tools);
    }
    reject(new Error('server never answered tools/list'));
  }, 2600);
});

const liveNames = live.map(t => t.name).sort();
const manNames = (manifest.tools || []).map(t => t.name).sort();

ok('the manifest lists every tool the server registers, and no others',
  JSON.stringify(liveNames) === JSON.stringify(manNames));

for (const t of manifest.tools || []) {
  ok(`${t.name}: has a name`, typeof t.name === 'string' && t.name.length > 0);
  ok(`${t.name}: has a description`, typeof t.description === 'string' && t.description.length > 0);
  // The one that broke the publish. "expected object, received undefined".
  ok(`${t.name}: inputSchema is an object, not undefined`,
    !!t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema));
  ok(`${t.name}: inputSchema declares an object type`,
    t.inputSchema?.type === 'object');
  const liveTool = live.find(l => l.name === t.name);
  ok(`${t.name}: schema accepts the same arguments the server does`,
    JSON.stringify(Object.keys(t.inputSchema?.properties || {}).sort()) ===
    JSON.stringify(Object.keys(liveTool?.inputSchema?.properties || {}).sort()));
}

console.log(`manifest tools: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
