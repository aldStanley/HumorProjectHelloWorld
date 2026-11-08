// Shared plumbing for the meme prompt optimizer: .env loading, Supabase REST
// reads (anon key), the OpenAI caller (mirrors runStepAction's OpenAI branch),
// prompt substitution, loose JSON parsing, and a concurrency limiter.
import fs from 'node:fs'
import path from 'node:path'

export const loadEnv = (rootDir) => {
  const file = path.join(rootDir, '.env')
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2]
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    out[m[1]] = v
  }
  return out
}

// Minimal Supabase REST reader. `pathAndQuery` is everything after /rest/v1/.
export const makeDb = (supabaseUrl, anonKey) => {
  return async (pathAndQuery) => {
    const res = await fetch(`${supabaseUrl}/rest/v1/${pathAndQuery}`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    })
    if (!res.ok) {
      throw new Error(
        `Supabase read failed (${res.status}) for ${pathAndQuery}: ${await res.text()}`
      )
    }
    return res.json()
  }
}

// Simple promise-concurrency limiter: const limit = pLimit(4); limit(() => ...)
export const pLimit = (max) => {
  let active = 0
  const queue = []
  const runNext = () => {
    if (active >= max || queue.length === 0) return
    active += 1
    const { fn, resolve, reject } = queue.shift()
    fn().then(resolve, reject).finally(() => {
      active -= 1
      runNext()
    })
  }
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject })
      runNext()
    })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// One OpenAI chat call, same request shape as runStepAction's OpenAI branch:
// system + user(+image_url), max_completion_tokens for o*/gpt-5*, temperature
// omitted for those models. Retries transient failures with backoff.
export async function callOpenAI({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  messages = null, // multi-turn chat: [{role, content}] used instead of userPrompt
  temperature = null,
  imageUrl = null,
  maxTokens = 2000,
  retries = 3,
  reasoningEffort = null, // 'low' | 'medium' | 'high' — gpt-5-style models only; the app sends 'high'
}) {
  const usesMaxCompletionTokens = /^o\d/.test(model) || model.startsWith('gpt-5')
  const userContent = [{ type: 'text', text: userPrompt }]
  if (imageUrl) userContent.push({ type: 'image_url', image_url: { url: imageUrl } })
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...(messages ?? [{ role: 'user', content: userContent }]),
    ],
    ...(temperature != null && !usesMaxCompletionTokens ? { temperature } : {}),
    ...(usesMaxCompletionTokens
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens }),
    ...(reasoningEffort && usesMaxCompletionTokens
      ? { reasoning_effort: reasoningEffort }
      : {}),
  }

  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(2000 * 2 ** (attempt - 1))
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errText = await res.text()
        let detail = errText
        try {
          const parsed = JSON.parse(errText)
          detail = parsed?.error?.message ?? errText
        } catch {
          // keep raw text
        }
        const retryable = res.status === 429 || res.status >= 500
        lastError = new Error(`openai ${res.status}: ${detail}`)
        lastError.status = res.status
        if (retryable && attempt < retries) continue
        throw lastError
      }
      const data = await res.json()
      const text = (data?.choices?.[0]?.message?.content ?? '').trim()
      if (!text) {
        // gpt-5-style models can burn the whole budget on reasoning; retry once.
        lastError = new Error('openai returned no readable output')
        if (attempt < retries) continue
        throw lastError
      }
      return text
    } catch (err) {
      lastError = err
      // Network-level failure: retry; explicit API error already handled above.
      if (err?.status == null && attempt < retries) continue
      throw lastError
    }
  }
  throw lastError
}

// ${name} substitution: fill from vars, leave unknown placeholders untouched
// (same contract as the app's substitute()).
const VARIABLE_PATTERN = /\$\{([^}]+)\}/g
export const substitute = (text, vars) =>
  text.replace(VARIABLE_PATTERN, (full, name) => {
    const key = name.trim()
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : full
  })

// Ported verbatim in behavior from ops-client.tsx parseJsonLoose.
export const parseJsonLoose = (value) => {
  if (value != null && typeof value !== 'string') return value
  if (typeof value !== 'string') return null
  const cleaned = value
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  const tryParse = (s) => {
    try {
      return JSON.parse(s)
    } catch {
      return undefined
    }
  }
  let out = tryParse(cleaned)
  if (out !== undefined) return out
  const start = cleaned.search(/[[{]/)
  const end = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'))
  const sub = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned
  out = tryParse(sub)
  if (out !== undefined) return out
  const repaired = sub.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
  out = tryParse(repaired)
  return out !== undefined ? out : null
}

export const asPromptString = (value) =>
  typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2)
