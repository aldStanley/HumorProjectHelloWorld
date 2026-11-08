'use server'

// Public server action for "Find Meme for Columbia Context": given one
// user-submitted context, pick the 3 best-fitting templates from the curated
// library, then write one caption per template. No auth — this powers the
// public home page — so it carries its own guards: input length cap and a
// best-effort in-memory rate limit (per IP + global).
//
// The selection prompt and the caption prompt mirror the validated versions in
// scripts/meme-opt/ (context-first.mjs and pipeline.mjs) — keep them in sync.
import { headers } from 'next/headers'

import { MEME_TEMPLATES } from './templates'

const SELECTION_MODEL = 'gpt-5.5'
const CAPTION_MODEL = 'gpt-4o-2024-08-06'
const MAX_CONTEXT_CHARS = 400

export type FoundMeme = {
  name: string
  url: string
  fit: number | null
  reason: string
  caption: string
}

export type FindMemesResult =
  | { ok: true; results: FoundMeme[] }
  | { ok: false; error: string }

// ---- best-effort rate limiting (per server instance) ----
const WINDOW_MS = 60_000
const PER_IP_LIMIT = 5
const GLOBAL_LIMIT = 30
const hitsByIp = new Map<string, number[]>()
const globalHits: number[] = []

const allow = (ip: string): boolean => {
  const now = Date.now()
  const prune = (arr: number[]) => {
    while (arr.length && now - arr[0] > WINDOW_MS) arr.shift()
  }
  prune(globalHits)
  if (globalHits.length >= GLOBAL_LIMIT) return false
  const mine = hitsByIp.get(ip) ?? []
  prune(mine)
  if (mine.length >= PER_IP_LIMIT) return false
  mine.push(now)
  hitsByIp.set(ip, mine)
  globalHits.push(now)
  return true
}

// ---- prompts (mirrors of the lab's validated prompts) ----
const SELECTION_SYSTEM =
  'You select meme templates for community moments. You only respond in JSON.'

const selectionPrompt = (context: string, catalog: string) =>
  'You are selecting meme templates for a specific community moment.\n\n' +
  'THE MOMENT:\n' +
  context +
  '\n\nTHE TEMPLATE LIBRARY (each entry is one meme image with its curated verdict):\n' +
  catalog +
  '\n\nPick the 3 templates whose FORMAT best fits this moment — the moment should slot\n' +
  'naturally into what the template requires (its setup, its snowclone, its\n' +
  'emotional shape). Judge fit by format compatibility, not topic similarity.\n\n' +
  'Output ONLY a JSON array of exactly 3, best first:\n' +
  '[\n' +
  '  { "image_id": "<id>", "template_name": "<name>", "fit": <0..1>,\n' +
  '    "reason": "<one sentence: why this moment fits this template\'s format>" }\n' +
  ']'

const CAPTION_SYSTEM = 'You are writing the text for a meme.'

// pipeline.mjs CAPTION_USER + MEME_FORMAT_CLAUSE with the two slots filled in.
const captionPrompt = (recognizedContent: string, moment: string) =>
  'You are writing the text for a meme. Come up with something that fits this ' +
  'template (use the recognized content below and the attached image).\n\n' +
  'Recognized content:\n' +
  recognizedContent +
  '\n\nFill this meme in using THIS ONE Columbia/Barnard (CU) moment (it is already ' +
  'selected for you — do NOT pick a different one):\n' +
  moment +
  '\n\nLean on this CU moment so the meme is specific to Columbia/Barnard.\n\n' +
  'Keep the caption under 60 characters.' +
  '\n\n--------------------------------------\n' +
  'MEME FORMAT (important). The recognized content below includes a "meme" verdict ' +
  '(is_meme, template_name, meaning, how_a_caption_should_use_it):\n' +
  recognizedContent +
  '\nIf meme.is_meme is true, the caption MUST fit that template: follow ' +
  'meme.how_a_caption_should_use_it and the template’s conventional FORMAT or ' +
  'snowclone (e.g. the "I am once again asking for ___" structure) so it ' +
  'unmistakably reads as that meme. A caption that does not read as the template is ' +
  'wrong even if it is funny.\n' +
  'IF meme.image_is_punchline is true, the IMAGE itself delivers the punchline — ' +
  'write ONLY the SETUP and let the image land the joke. Adding ' +
  'the punchline in text is redundant and ruins the joke.\n' +
  'If meme.is_meme is false, ignore this section.' +
  '\n\n--------------------------------------\n' +
  'Say WHICH specific part of the CU moment you leaned into to make the joke, ' +
  'and name that part in the reason.\n' +
  'Output ONLY strict JSON:\n' +
  '{\n' +
  '  "caption": "<the meme caption, under 60 chars>",\n' +
  '  "moment_part": "<the specific detail of the CU moment you leaned into>",\n' +
  '  "reason": "<one sentence: why it is funny — name the part of the moment you used>"\n' +
  '}'

// ---- helpers ----
const parseJsonLoose = (value: string): unknown => {
  const cleaned = value
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  const tryParse = (s: string): unknown => {
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
  return out === undefined ? null : out
}

const callOpenAI = async (opts: {
  model: string
  systemPrompt: string
  userPrompt: string
  temperature?: number
  imageUrl?: string
  maxTokens?: number
}): Promise<string> => {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured')
  const usesMaxCompletionTokens =
    /^o\d/.test(opts.model) || opts.model.startsWith('gpt-5')
  const userContent: unknown[] = [{ type: 'text', text: opts.userPrompt }]
  if (opts.imageUrl) {
    userContent.push({ type: 'image_url', image_url: { url: opts.imageUrl } })
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: 'system', content: opts.systemPrompt },
        { role: 'user', content: userContent },
      ],
      ...(opts.temperature != null && !usesMaxCompletionTokens
        ? { temperature: opts.temperature }
        : {}),
      ...(usesMaxCompletionTokens
        ? { max_completion_tokens: opts.maxTokens ?? 4000 }
        : { max_tokens: opts.maxTokens ?? 2000 }),
    }),
  })
  if (!res.ok) {
    throw new Error(`model call failed (${res.status})`)
  }
  const data = await res.json()
  const text = (data?.choices?.[0]?.message?.content ?? '').trim()
  if (!text) throw new Error('model returned no output')
  return text
}

export async function findMemesAction(contextInput: string): Promise<FindMemesResult> {
  const context = String(contextInput ?? '').trim()
  if (!context) return { ok: false, error: 'Write a context first.' }
  if (context.length > MAX_CONTEXT_CHARS) {
    return { ok: false, error: `Keep it under ${MAX_CONTEXT_CHARS} characters.` }
  }

  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!allow(ip)) {
    return { ok: false, error: 'Too many requests — try again in a minute.' }
  }

  try {
    const catalog = JSON.stringify(
      MEME_TEMPLATES.map((t) => {
        const meme = (t.recognize.meme ?? t.recognize) as Record<string, unknown>
        return {
          image_id: t.id,
          template_name: t.name,
          meaning: meme.meaning,
          how_a_caption_should_use_it: meme.how_a_caption_should_use_it,
          image_is_punchline: meme.image_is_punchline,
          image_delivers: meme.image_delivers,
        }
      }),
      null,
      2
    )
    const selectionText = await callOpenAI({
      model: SELECTION_MODEL,
      systemPrompt: SELECTION_SYSTEM,
      userPrompt: selectionPrompt(context, catalog),
      maxTokens: 4000,
    })
    const picks = parseJsonLoose(selectionText)
    if (!Array.isArray(picks) || picks.length === 0) {
      return { ok: false, error: 'Could not pick templates — try rephrasing the context.' }
    }

    const results = await Promise.all(
      picks.slice(0, 3).map(async (pick): Promise<FoundMeme | null> => {
        const p = pick as Record<string, unknown>
        const tpl = MEME_TEMPLATES.find((t) => t.id === p.image_id)
        if (!tpl) return null
        const moment = JSON.stringify({ moment: context }, null, 2)
        const recognized = JSON.stringify(tpl.recognize, null, 2)
        try {
          const captionText = await callOpenAI({
            model: CAPTION_MODEL,
            systemPrompt: CAPTION_SYSTEM,
            userPrompt: captionPrompt(recognized, moment),
            temperature: 0.7,
            imageUrl: tpl.url,
          })
          const parsed = parseJsonLoose(captionText) as Record<string, unknown> | null
          const caption =
            parsed && typeof parsed.caption === 'string' ? parsed.caption : captionText
          const fitNum = Number(p.fit)
          return {
            name: tpl.name,
            url: tpl.url,
            fit: Number.isFinite(fitNum) ? fitNum : null,
            reason: typeof p.reason === 'string' ? p.reason : '',
            caption,
          }
        } catch {
          return null
        }
      })
    )
    const kept = results.filter((r): r is FoundMeme => r != null)
    if (!kept.length) {
      return { ok: false, error: 'Caption writing failed — please try again.' }
    }
    return { ok: true, results: kept }
  } catch (err) {
    console.error('findMemesAction failed:', err)
    return { ok: false, error: 'Something went wrong — please try again.' }
  }
}
