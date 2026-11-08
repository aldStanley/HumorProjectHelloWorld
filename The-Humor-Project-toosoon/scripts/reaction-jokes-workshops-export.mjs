#!/usr/bin/env node
// Dumps the saved workshop chats (table reaction_joke_workshops) to a JSON
// file and a readable markdown file, for the later analysis Lydia wants
// (2026-09-09): every conversation about a joke, with the joke's analysis
// at the time and the rewrites hearted from the chat (with what was asked
// for). Read-only.
//
//   node scripts/reaction-jokes-workshops-export.mjs [--flavor 1564] [--out scripts/runs/workshops-<date>]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createClient } from '@supabase/supabase-js'

import { loadEnv } from './meme-opt/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = loadEnv(ROOT)
const args = process.argv.slice(2)
const opt = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i === -1 ? fallback : args[i + 1] }
const flavor = opt('flavor')
const out = opt('out', path.join('scripts/runs', `workshops-${new Date().toISOString().slice(0, 10)}`))

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
let q = sb.from('reaction_joke_workshops').select('*').order('modified_datetime_utc', { ascending: false })
if (flavor) q = q.eq('flavor_id', Number(flavor))
const { data, error } = await q
if (error) { console.error(error.message); process.exit(1) }
fs.writeFileSync(`${out}.json`, JSON.stringify(data, null, 2))

const L = [`# Workshop chats${flavor ? ` for flavor ${flavor}` : ''}: ${data.length} conversations`, '']
for (const r of data) {
  L.push(`## "${r.joke}"`)
  L.push('')
  L.push(`- ${r.persona}, flavor ${r.flavor_id}, ${r.messages.length} turns on ${r.model ?? '?'}${r.reasoning_effort ? ` at ${r.reasoning_effort}` : ''}, last ${r.modified_datetime_utc.slice(0, 16).replace('T', ' ')}`)
  L.push(`- moment: ${r.moment.slice(0, 160)}${r.moment.length > 160 ? '…' : ''}`)
  if (r.analysis) L.push(`- analysis: ${[r.analysis.primary_move, ...(r.analysis.supporting_moves ?? [])].filter(Boolean).join(', ')} · ${r.analysis.action ?? '?'} · ${r.analysis.premise ?? ''}`)
  for (const h of r.hearted ?? []) L.push(`- ♥ hearted from the chat: "${h.caption}"${h.note ? ` — ${h.note}` : ''}${h.asked_for ? ` (asked for: ${h.asked_for.slice(0, 120)})` : ''}`)
  L.push('')
  for (const m of r.messages) { L.push(`**${m.role === 'user' ? 'Lydia' : r.model ?? 'model'}:** ${m.content.trim()}`); L.push('') }
}
fs.writeFileSync(`${out}.md`, L.join('\n'))
console.log(`${data.length} conversations → ${out}.json and ${out}.md`)
