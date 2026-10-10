import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require('next/server');
const { createServerClient } = require('@supabase/ssr');
function load(path, imports) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', source)(name => {
    if (!(name in imports)) throw new Error(`Unexpected import ${name}`);
    return imports[name];
  }, mod, mod.exports);
  return mod.exports;
}
let cookieJar = new Map();
const config = {
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabasePublishableKey: () => 'test-publishable-key',
};
const server = load('../src/lib/supabase/server.ts', {
  '@supabase/ssr': { createServerClient },
  'next/headers': { cookies: async () => ({
    getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
    set: (name, value) => cookieJar.set(name, value),
  }) },
  './config': config,
});
const profiles = load('../src/lib/supabase/profiles.ts', {
  'next/navigation': {}, './auth': {}, './server': server,
});
const route = load('../src/app/auth/callback/route.ts', {
  'next/server': { NextResponse },
  '@/lib/supabase/server': server,
  '@/lib/supabase/profiles': profiles,
});
const originalFetch = globalThis.fetch;
const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated' };
let complete = true;
let rejectCode = false;
let exchanges = 0;
try {
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url.includes('/auth/v1/token')) {
      exchanges++;
      const body = JSON.parse(options.body);
      assert.equal(body.auth_code, 'test-code');
      assert.equal(body.code_verifier, 'test-verifier');
      if (rejectCode) return Response.json({ error: 'invalid_grant', error_description: 'Invalid code' }, { status: 400 });
      const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
      return Response.json({ access_token: `e30.${payload}.test`, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, user });
    }
    assert(url.includes('/rest/v1/profiles'));
    assert(new URL(url).searchParams.get('id') === `eq.${user.id}`);
    return Response.json(complete ? { ...user, first_name: 'Sam', last_name: 'Test' } : null);
  };
  const origins = ['http://localhost:3000', 'https://humor-project-hello-world-test123-aldstanleys-projects.vercel.app'];
  for (const origin of origins) {
    for (complete of [true, false]) {
      cookieJar = new Map([['sb-test-auth-token-code-verifier', JSON.stringify('test-verifier')]]);
      const response = await route.GET(new NextRequest(`${origin}/auth/callback?code=test-code&next=https://example.com`));
      assert.equal(response.status, 303);
      assert.equal(response.headers.get('location'), origin + (complete ? '/' : '/onboarding'));
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert(cookieJar.get('sb-test-auth-token'), 'exchange must write session cookies');
      assert.equal(cookieJar.get('sb-test-auth-token-code-verifier'), '', 'verifier must be consumed');
    }
  }
  complete = true;
  const flowId = 'testflow12345678';
  cookieJar = new Map([
    ['sb-test-auth-token-code-verifier', JSON.stringify('other-verifier')],
    [`sb-test-auth-token-flow-${flowId}-code-verifier`, JSON.stringify('test-verifier')],
  ]);
  const isolated = await route.GET(new NextRequest(`https://example.test/auth/callback?code=test-code&sb_flow_id=${flowId}`));
  assert.equal(isolated.headers.get('location'), 'https://example.test/');
  assert.equal(cookieJar.get('sb-test-auth-token-code-verifier'), JSON.stringify('other-verifier'));
  assert.equal(cookieJar.get(`sb-test-auth-token-flow-${flowId}-code-verifier`), '');
  const exchangesBeforeMissing = exchanges;
  const missing = await route.GET(new NextRequest('https://example.test/auth/callback?code=test-code&sb_flow_id=missingflow123'));
  assert.equal(missing.headers.get('location'), 'https://example.test/login?error=signin');
  assert.equal(exchanges, exchangesBeforeMissing, 'must not use another flow’s verifier');
  rejectCode = true;
  cookieJar = new Map([['sb-test-auth-token-code-verifier', JSON.stringify('test-verifier')]]);
  const denied = await route.GET(new NextRequest('https://example.test/auth/callback?code=test-code'));
  assert.equal(denied.headers.get('location'), 'https://example.test/login?error=signin');
  assert(!cookieJar.get('sb-test-auth-token'));
  const before = exchanges;
  await route.GET(new NextRequest('https://example.test/auth/callback?code=test-code&error=access_denied'));
  assert.equal(exchanges, before, 'provider error must not exchange code');
  console.log('PASS PKCE exchange, session cookies, consumed verifier, deployment-local home/onboarding, open-redirect prevention, and invalid code');
} finally {
  globalThis.fetch = originalFetch;
}
