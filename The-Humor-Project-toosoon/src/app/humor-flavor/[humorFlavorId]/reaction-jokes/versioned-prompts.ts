// Server-only reader for a folder of versioned prompt folders:
//
//   <dir>/<folder>/<slug>-<YYYY-MM-DD>.md
//
// Each folder is one prompt; the newest file in it (last by name, which for
// ISO dates is the latest date, a trailing letter breaking same-day ties) is
// the version in use and the rest are history. The file's first level-1
// heading names the prompt; everything after it is the prompt text. Used for
// the evaluators (one folder per persona) and the analyses (one folder per
// analysis); the personas have their own reader with the same layout.
import fs from 'node:fs/promises'
import path from 'node:path'

export type VersionedPrompt = {
  folder: string
  name: string
  file: string
  date: string
  versions: number
  text: string
}

const dateOf = (file: string) => /(\d{4}-\d{2}-\d{2}[a-z]?)\.md$/.exec(file)?.[1] ?? ''

export async function loadVersionedPrompts(dir: string): Promise<VersionedPrompt[]> {
  const root = path.join(process.cwd(), dir)
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const folders = entries
    .filter((e) => e.isDirectory() && !/^(readme|_)/i.test(e.name))
    .map((e) => e.name)
    .sort()
  const out: VersionedPrompt[] = []
  for (const folder of folders) {
    const versions = (await fs.readdir(path.join(root, folder)))
      .filter((f) => f.endsWith('.md') && !/^(readme|_)/i.test(f))
      .sort()
    const latest = versions[versions.length - 1]
    if (!latest) continue
    const raw = await fs.readFile(path.join(root, folder, latest), 'utf8')
    const lines = raw.split(/\r?\n/)
    const at = lines.findIndex((l) => /^# /.test(l))
    const name = at >= 0 ? lines[at].slice(2).trim() : folder
    const body = at >= 0 ? lines.slice(at + 1) : lines
    out.push({
      folder,
      name,
      file: `${dir}/${folder}/${latest}`,
      date: dateOf(latest),
      versions: versions.length,
      text: body.join('\n').trim(),
    })
  }
  return out
}
