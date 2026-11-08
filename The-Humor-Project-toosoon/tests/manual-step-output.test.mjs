import assert from 'node:assert/strict'
import test from 'node:test'
import { parseManualStepOutput } from '../src/utils/manual-step-output.ts'

test('preserves plain text verbatim for prompt substitution', () => {
  assert.equal(parseManualStepOutput('  reused answer\nsecond line  '), '  reused answer\nsecond line  ')
})

test('preserves list and object structure for downstream transforms and fan-out', () => {
  assert.deepEqual(parseManualStepOutput('[{"caption":"A","score":0.8}]'), [{ caption: 'A', score: 0.8 }])
  assert.deepEqual(parseManualStepOutput('{"items":[],"enabled":false}'), { items: [], enabled: false })
  assert.deepEqual(parseManualStepOutput('[]'), [])
})

test('accepts fenced JSON copied from another run', () => {
  assert.deepEqual(parseManualStepOutput('```json\n[{"text":"reuse me"}]\n```'), [{ text: 'reuse me' }])
})

test('rejects malformed JSON without activating it as a text value', () => {
  assert.throws(() => parseManualStepOutput('[{"caption":"unfinished"}'), /Invalid JSON/)
  assert.throws(() => parseManualStepOutput('{items: []}'), /Invalid JSON/)
})

test('rejects blank overrides', () => {
  assert.throws(() => parseManualStepOutput(' \n '), /Enter a value/)
})
