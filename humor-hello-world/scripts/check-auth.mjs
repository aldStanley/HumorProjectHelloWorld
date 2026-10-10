import assert from 'node:assert/strict';

// Run against a local production build: npm run start, then npm run test:auth.
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
for (const path of ['/jokes/mine', '/jokes/trophies', '/profile', '/onboarding']) {
  const response = await fetch(base + path, { redirect: 'manual' });
  const body = await response.text();
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get('location'), base).pathname, '/login');
  assert(!body.includes('joke-card'));
  console.log('PASS signed-out gate:', path);
}
for (const path of ['/', '/jokes']) {
  const response = await fetch(base + path, { redirect: 'manual' });
  assert.equal(response.status, 200);
  assert((await response.text()).includes('The punchline board'));
  console.log('PASS public browsing:', path);
}
for (const path of ['/api/votes', '/api/captions', '/api/jury']) {
  const response = await fetch(base + path, { method: 'POST', headers: { origin: new URL(base).origin, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 401);
  console.log('PASS authenticated action:', path);
}
const login = await fetch(base + '/login');
assert.equal(login.status, 200);
const loginHtml = await login.text();
assert(loginHtml.includes('Sign in with Google to vote'));
assert(loginHtml.includes('Continue with Google'));
assert(!loginHtml.includes('accounts.google.com/gsi/client'));
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
console.log('PASS obsolete callback POST rejected');

for (const query of ['?code=invalid-code', '?error=access_denied', '?next=https://example.com', '?code=invalid-code&next=https://example.com']) {
  const response = await fetch(base + '/auth/callback' + query, { redirect: 'manual' });
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get('location'), base);
  assert.equal(location.origin, new URL(base).origin);
  assert.equal(location.pathname, '/login');
  assert.equal(location.search, '?error=signin');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  console.log('PASS OAuth callback rejection:', query);
}
