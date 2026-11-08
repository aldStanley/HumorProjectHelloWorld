// Text stays verbatim. Structured outputs must remain structured for fan-out
// and code transforms, and malformed JSON must not silently become plain text.
export function parseManualStepOutput(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Enter a value first.')
  const cleaned = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  if (/^[\[{]/.test(cleaned)) {
    try { return JSON.parse(cleaned) }
    catch { throw new Error('Invalid JSON. Check the value before applying it.') }
  }
  return text
}
