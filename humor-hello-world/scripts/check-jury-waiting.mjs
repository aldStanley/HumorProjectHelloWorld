import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Render the actual component in both cold-start states, without requiring Next's router.
const source = readFileSync(new URL('../src/app/jokes/jury-waiting.tsx', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} });
const exports = {};
new Function('require', 'exports', outputText)(createRequire(import.meta.url), exports);

const visitor = renderToStaticMarkup(createElement(exports.JuryWaiting, { signedIn: false }));
assert.match(visitor, /href="\/login"/);
assert.match(visitor, /Today’s round opens when a member signs in/);
assert.doesNotMatch(visitor, /We need three/);

const member = renderToStaticMarkup(createElement(exports.JuryWaiting, { signedIn: true }));
assert.match(member, /three published captions/);
assert.doesNotMatch(member, /href="\/login"/);
assert.match(visitor, /id="jury-title"/);
assert.match(member, /id="jury-title"/);
console.log('PASS signed-out jury cold start shows sign-in action; signed-in missing round shows caption requirement');
