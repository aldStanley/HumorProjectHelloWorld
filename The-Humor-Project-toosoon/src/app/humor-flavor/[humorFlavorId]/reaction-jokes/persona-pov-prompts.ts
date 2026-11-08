// Server-only reader for the persona voice prompts in docs/prompts/personas/.
//
// One FOLDER per persona, read in folder order (a two-digit prefix sets it).
// Inside, one markdown file per version, named <slug>-<YYYY-MM-DD>.md, and
// the system uses the newest one: the last file by name, which for ISO
// dates is the latest date. Older versions stay as history. Adding a
// persona is adding a folder with one dated file; revising one is adding a
// newer dated file beside the old.
//
// A file's first level-1 heading names the persona; anything after it,
// inner headings included, is the voice text and is sent as written.
import fs from 'node:fs/promises'
import path from 'node:path'

export const PERSONA_PROMPT_DIR = 'docs/prompts/personas'

export type PersonaPrompt = {
  name: string
  // The persona's folder name, e.g. "07-sad-girl"; evaluators match on it.
  folder: string
  // The heading line the text came from, so the page can say where it is.
  heading: string
  // The file in use, relative to the repo root.
  file: string
  // The date in that file's name, or '' if it has none.
  date: string
  // How many dated files the persona's folder holds, this one included.
  versions: number
  // What fills {{PERSONA}}: the name, then the file's text for it.
  text: string
}

// "Keke Palmer (flavor 55 `keke-palmer`, step 4)" → "Keke Palmer": the
// parenthetical is provenance, not part of the name.
const nameOf = (heading: string) => heading.replace(/\s*\(.*$/, '').trim()

// A letter after the date is the same-day tiebreak (2026-09-08b).
const dateOf = (file: string) => /(\d{4}-\d{2}-\d{2}[a-z]?)\.md$/.exec(file)?.[1] ?? ''

export async function loadPersonaPrompts(): Promise<PersonaPrompt[]> {
  const root = path.join(process.cwd(), PERSONA_PROMPT_DIR)
  const entries = await fs.readdir(root, { withFileTypes: true })
  const folders = entries
    .filter((e) => e.isDirectory() && !/^(readme|_)/i.test(e.name))
    .map((e) => e.name)
    .sort()
  const out: PersonaPrompt[] = []
  for (const folder of folders) {
    const versions = (await fs.readdir(path.join(root, folder)))
      .filter((f) => f.endsWith('.md') && !/^(readme|_)/i.test(f))
      .sort()
    const latest = versions[versions.length - 1]
    if (!latest) continue
    const raw = await fs.readFile(path.join(root, folder, latest), 'utf8')
    const lines = raw.split(/\r?\n/)
    const at = lines.findIndex((l) => /^# /.test(l))
    if (at < 0) continue
    const heading = lines[at].slice(2).trim()
    const name = nameOf(heading)
    const body = lines.slice(at + 1)
    while (body.length && !body[0].trim()) body.shift()
    while (body.length && !body[body.length - 1].trim()) body.pop()
    out.push({
      name,
      folder,
      heading,
      file: `${PERSONA_PROMPT_DIR}/${folder}/${latest}`,
      date: dateOf(latest),
      versions: versions.length,
      text: `${name}\n\n${body.join('\n')}`,
    })
  }
  return out
}
