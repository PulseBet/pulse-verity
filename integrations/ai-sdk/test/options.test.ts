import assert from 'node:assert/strict';
import test from 'node:test';
import { pulseVerity, ExampleError } from '../index.ts';

test('hosted mode requires a key and never falls back to a sample', () => {
  assert.throws(() => pulseVerity({ apiKey: '' }), ExampleError);
  assert.throws(() => pulseVerity({ apiKey: 'synthetic key with whitespace' }), ExampleError);
  assert.equal(typeof pulseVerity({ apiKey: 'synthetic-not-a-live-key' }).execute, 'function');
});
test('sample mode is explicit and refuses a credential', () => {
  assert.equal(typeof pulseVerity({ mode: 'sample' }).execute, 'function');
  // @ts-expect-error exercise untyped JavaScript caller
  assert.throws(() => pulseVerity({ mode: 'sample', apiKey: 'synthetic' }), ExampleError);
  // @ts-expect-error exercise untyped JavaScript caller
  assert.throws(() => pulseVerity({ mode: 'other' }), ExampleError);
});
