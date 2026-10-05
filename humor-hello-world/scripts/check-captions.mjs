import assert from 'node:assert/strict';
import { isSameOrigin } from '../src/lib/captions/request.ts';
import { imageExtension, parseCaptions, UUID } from '../src/lib/captions/validation.ts';

assert.equal(imageExtension(Uint8Array.from([255,216,255,224]), 'image/jpeg'), 'jpg');
assert.equal(imageExtension(Uint8Array.from([137,80,78,71,13,10,26,10]), 'image/png'), 'png');
assert.equal(imageExtension(Buffer.from('RIFFxxxxWEBP'), 'image/webp'), 'webp');
assert.equal(imageExtension(Buffer.from('<svg>'), 'image/png'), null);
assert.equal(imageExtension(Uint8Array.from([255,216,255]), 'image/png'), null);
assert.equal(imageExtension(new Uint8Array(), 'image/jpeg'), null);
assert.deepEqual(parseCaptions('{"captions":[" One ","Two","Three"]}'), ['One','Two','Three']);
for (const text of ['{}','{"captions":["One"]}','{"captions":["Same","Same","Other"]}','{"captions":["",null,23]}',JSON.stringify({captions:['a'.repeat(241),'b','c']})]) assert.throws(() => parseCaptions(text));
assert(UUID.test('7b6b88d7-bd62-4ec8-ae34-6a655fc201bd'));
assert(!UUID.test('not-a-caption'));
console.log('PASS image signatures, caption validation, duplicate rejection, and IDs');

assert(isSameOrigin(new Request('http://internal/api/votes', {headers:{origin:'https://app.example',host:'app.example'}})));
assert(!isSameOrigin(new Request('http://internal/api/votes', {headers:{origin:'https://evil.example',host:'app.example'}})));
assert(!isSameOrigin(new Request('http://internal/api/votes', {headers:{origin:'null',host:'app.example'}})));

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
for (const path of ['/api/votes','/api/captions']) {
  for (const origin of [undefined, 'https://untrusted.example']) {
    const res = await fetch(base + path, { method: 'POST', headers: origin ? { origin } : {} });
    assert.equal(res.status,403);
  }
  const res = await fetch(base + path, { method: 'POST', headers: { origin: new URL(base).origin, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status,401);
  assert((await res.json()).error.includes('Sign in'));
  console.log('PASS signed-out and cross-origin mutation rejection:',path);
}
