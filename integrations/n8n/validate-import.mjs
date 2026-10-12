// Real CLI roundtrip shape check. It does not imply a credentialed live execution.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const expected=JSON.parse(readFileSync(new URL('./pulse-verity-quality-monitor.json',import.meta.url)));
const exports=JSON.parse(readFileSync(process.argv[2],'utf8'));
assert.equal(exports.length,1);
const actual=exports[0];
assert.equal(actual.active,false);
assert.equal(actual.name,expected.name);
assert.deepEqual(actual.nodes,expected.nodes);
assert.deepEqual(actual.connections,expected.connections);
for(const [key,value] of Object.entries(expected.settings))assert.deepEqual(actual.settings[key],value);
console.log('Pinned n8n CLI imported and exported the inactive monitor without graph or settings loss. Live credentials and execution were not tested.');
