import assert from 'node:assert/strict';

// Run against a local production build: npm run start, then npm run test:auth.
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
for (const path of ['/jokes', '/jokes?next=https://example.com']) {
  const response = await fetch(base + path, { redirect: 'manual' });
  const body = await response.text();
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get('location'), base).pathname, '/login');
  assert(!body.includes('joke-card'));
  console.log('PASS signed-out gate:', path);
}
const login = await fetch(base + '/login');
assert.equal(login.status, 200);
assert((await login.text()).includes('Sign in with Google to unlock'));
console.log('PASS login page');

const cases = [
  { method: 'GET' },
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
  { method: 'POST', body: new URLSearchParams({ credential: 'fake' }) },
  {
    method: 'POST', headers: { cookie: 'g_csrf_token=one' },
    body: new URLSearchParams({ credential: 'fake', g_csrf_token: 'two' }),
  },
];
for (const [index, options] of cases.entries()) {
  const response = await fetch(base + '/auth/callback', { ...options, redirect: 'manual' });
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get('location'), base);
  assert.equal(location.pathname, '/login');
  assert.equal(location.search, '?error=signin');
  assert(!response.headers.get('set-cookie')?.includes('auth-token'));
  console.log('PASS invalid callback:', index + 1);
}
const query = await fetch(base + '/auth/callback?next=/jokes', {
  method: 'POST', redirect: 'manual', headers: { cookie: 'g_csrf_token=one' },
  body: new URLSearchParams({ credential: 'fake', g_csrf_token: 'one' }),
});
assert.equal(query.status, 303);
assert.equal(new URL(query.headers.get('location'), base).pathname, '/login');
console.log('PASS callback query string rejected');
