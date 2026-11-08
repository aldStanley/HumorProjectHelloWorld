// The Quick Study export shape (/study-quick in chucklesome) and the rules for
// pulling the exported captions out of a pipeline's FINAL step.
//
// Contract: the last non-hidden op of an ops pipeline outputs the best captions
// — either an audit object `{ "selected": [{ "caption": ... }], "dropped": [...] }`
// (flavor 1544's S16), a bare array of caption strings, or an array/`{captions}`
// of caption objects. Anything else is exported on a best-effort basis WITH a
// warning, never silently.

export type QuickStudyRow = {
  // The image URL — Quick Study accepts a URL here and uploads it.
  image_id: string
  caption: string
  flavor_id: string
  flavor_name: string
  user_id: string
}

// One entry per image a batch attempted — including images that produced no
// captions, which contribute no export rows and would otherwise be invisible.
export type GalleryItem = {
  imageId: string
  imageUrl: string
  captions: string[]
  // Why this image came up short (the failed step, or the final step's output
  // problem). Null when it produced captions cleanly.
  problem: string | null
}

// Tolerant JSON parse: accepts an already-parsed value, or a string that may be
// wrapped in ```json fences / prose. Returns null when it can't parse.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const parseJsonLoose = (value: unknown): any => {
  if (value != null && typeof value !== 'string') return value
  if (typeof value !== 'string') return null
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
  if (out !== undefined) return out
  const repaired = sub.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
  out = tryParse(repaired)
  return out !== undefined ? out : null
}

const captionsFromList = (list: unknown[]): string[] => {
  const out: string[] = []
  for (const item of list) {
    if (typeof item === 'string' && item.trim()) {
      out.push(item.trim())
      continue
    }
    if (item && typeof item === 'object') {
      const c = (item as Record<string, unknown>).caption
      if (typeof c === 'string' && c.trim()) out.push(c.trim())
    }
  }
  return out
}

// Last-resort scrape: any { caption: "..." } anywhere in the value. Used only
// when the final output isn't one of the expected shapes — the caller warns.
const scrapeCaptions = (value: unknown): string[] => {
  const out: string[] = []
  const seen = new Set<unknown>()
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    const rec = node as Record<string, unknown>
    if (typeof rec.caption === 'string' && rec.caption.trim())
      out.push(rec.caption.trim())
    Object.values(rec).forEach(walk)
  }
  walk(value)
  return out
}

export type FinalCaptions = {
  captions: string[]
  // Human-readable problem with the final step's output, or null when it
  // matched one of the expected shapes and produced at least one caption.
  warning: string | null
}

// Pull the exported captions out of the final step's output.
export const finalCaptions = (value: unknown): FinalCaptions => {
  if (value == null || (typeof value === 'string' && !value.trim()))
    return { captions: [], warning: 'the final step produced no output' }

  const parsed = parseJsonLoose(value)

  // { selected: [...] } — the audited best-jokes shape.
  if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
    const rec = parsed as Record<string, unknown>
    for (const key of ['selected', 'captions', 'jokes', 'best']) {
      if (Array.isArray(rec[key])) {
        const captions = captionsFromList(rec[key] as unknown[])
        return captions.length
          ? { captions, warning: null }
          : {
              captions: [],
              warning: `the final step's "${key}" list held no captions`,
            }
      }
    }
  }

  // A bare array of caption strings or caption objects.
  if (Array.isArray(parsed)) {
    const captions = captionsFromList(parsed)
    if (captions.length) return { captions, warning: null }
    // A fan-out op's output: [{ label, text }] — each branch's captions are
    // inside its text. Exportable, but the final step should be a single call.
    const fromBranches = parsed.flatMap((item) => {
      const text = (item as Record<string, unknown> | null)?.text
      if (typeof text !== 'string') return []
      const inner = parseJsonLoose(text)
      return Array.isArray(inner) ? captionsFromList(inner) : scrapeCaptions(inner)
    })
    if (fromBranches.length)
      return {
        captions: fromBranches,
        warning:
          'the final step fanned out — captions were collected from each branch instead of one caption list',
      }
    return {
      captions: [],
      warning: 'the final step output a list with no captions in it',
    }
  }

  // Unexpected shape — export whatever captions we can find, but say so.
  const scraped = scrapeCaptions(parsed)
  if (scraped.length)
    return {
      captions: scraped,
      warning:
        'the final step did not output a caption list (no "selected"/"captions" array) — captions were scraped from its output instead',
    }
  return {
    captions: [],
    warning:
      'the final step did not output a JSON list of captions, and no captions could be found in it',
  }
}

export const quickStudyRows = (
  captions: string[],
  meta: { imageUrl: string; flavorId: number | string; flavorName: string; userId: string }
): QuickStudyRow[] =>
  captions.map((caption) => ({
    image_id: meta.imageUrl,
    caption,
    flavor_id: String(meta.flavorId),
    flavor_name: meta.flavorName,
    user_id: meta.userId,
  }))
