// The visualizable words in a joke: the concrete action or thing a GIF can
// show. One small model call per joke, cached on the hearted joke.
//
// Lydia, 2026-09-07, with the examples the prompt carries:
//   "Congress endorsed the gates. Apparently freedom now needs a swipe card."
//     → swipe
//   "Vergil was meant to guide men through Hell, not become the Hell." → hell
//   "Move-in is not accumulation. It is a trial of what deserves to be
//     carried." → decision (or trial, judge)

export const buildVisualWordsPrompt = (caption: string): string =>
  `Read this joke and pick the words a GIF search should use: the concrete ACTION or THING in it that a moving picture can show.

JOKE:
${caption}

Rules:
- One to three entries, best first. Each is one word or a two-word phrase.
- Prefer the action the joke turns on (a verb someone can be seen doing) over its topic. A thing is fine when the joke's image is a thing.
- Use plain, common words a GIF site will have. No names, no campus terms, no abstractions unless a picture shows them.

These three are ILLUSTRATIONS of the kind of answer wanted. Never copy them into the output:
- "Congress endorsed the gates. Apparently freedom now needs a swipe card." → swipe
- "Vergil was meant to guide men through Hell, not become the Hell." → hell
- "Move-in is not accumulation. It is a trial of what deserves to be carried." → decision, trial, judge

Return ONLY valid JSON: {"words": ["<best>", "<next>", "<next>"]}`

export const parseVisualWords = (text: string): string[] | null => {
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
    const parsed = JSON.parse(cleaned) as { words?: unknown }
    if (!Array.isArray(parsed.words)) return null
    const words = parsed.words
      .map((w) => String(w).trim().toLowerCase())
      .filter((w) => w && w.split(/\s+/).length <= 3)
      .slice(0, 3)
    return words.length ? words : null
  } catch {
    return null
  }
}
