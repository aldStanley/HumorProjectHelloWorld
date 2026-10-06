import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as validation from '../src/lib/captions/validation.ts';

// Exercise the real provider module with a stubbed HTTP boundary: no paid calls.
const source = ts.transpileModule(readFileSync(new URL('../src/lib/captions/generate.ts', import.meta.url),'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;
const mod = {exports:{}};
new Function('require','module','exports',source)(name => {
  if (name === 'server-only') return {};
  if (name === './validation') return validation;
  throw new Error(`Unexpected import ${name}`);
}, mod, mod.exports);
const originalFetch = globalThis.fetch;
const originalKey = process.env.GEMINI_API_KEY;
const originalModel = process.env.GEMINI_MODEL;
process.env.GEMINI_API_KEY = 'test-key-not-real';
delete process.env.GEMINI_MODEL;
const calls = [];
const description = 'A cat sitting on a keyboard next to a coffee cup.';
try {
  globalThis.fetch = async (url, options) => {
    assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent');
    assert.equal(options.headers['x-goog-api-key'], 'test-key-not-real');
    const body = JSON.parse(options.body); calls.push(body);
    assert.equal(body.generationConfig.maxOutputTokens,1000);
    const text = calls.length === 1 ? description : JSON.stringify({captions:['Head of keyboard operations.','This meeting could have been a nap.','The intern has deleted gravity.']});
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'Internal reasoning',thought:true},{text}]}}]});
  };
  const result = await mod.exports.generateCaptions(Buffer.from([255,216,255]),'image/jpeg');
  assert.equal(calls.length,2);
  assert.equal(calls[0].contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
  assert.equal(calls[0].contents[0].parts[1].inlineData.data, Buffer.from([255,216,255]).toString('base64'));
  assert.equal(calls[1].generationConfig.responseMimeType, 'application/json');
  assert.equal(calls[1].generationConfig.responseJsonSchema.properties.captions.minItems,3);
  assert.equal(JSON.parse(calls[1].contents[0].parts[0].text).image_description,description);
  assert(!JSON.stringify(calls[1]).includes('inlineData'));
  assert.equal(result.captions.length,3);
  assert.equal(result.description,description);
  globalThis.fetch = async () => Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'partial'}]}}]});
  await assert.rejects(mod.exports.generateCaptions(Buffer.from('x'),'image/png'),/could not finish/);
  globalThis.fetch = async () => Response.json({promptFeedback:{blockReason:'SAFETY'}});
  await assert.rejects(mod.exports.generateCaptions(Buffer.from('x'),'image/png'),/could not caption/);
  globalThis.fetch = async () => new Response('', {status:429});
  await assert.rejects(mod.exports.generateCaptions(Buffer.from('x'),'image/png'),/request limit/);
  console.log('PASS two-call prompt chain, description-only handoff, incomplete output, and refusal handling');
} finally {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
  if (originalModel === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = originalModel;
}
