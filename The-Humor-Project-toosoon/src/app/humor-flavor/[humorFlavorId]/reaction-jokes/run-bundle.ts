// One run as one markdown document: everything a critic (or Lydia pasting
// into ChatGPT) needs to judge what is going well and what is not. The
// persona voice prompt in use, the step prompts as stored, the analysis and
// evaluator prompts, then each moment with its student read and its jokes
// from each source, each joke with its score, rating, flags, and whether it
// was hearted. Hearts are the ground truth the critic should weigh most.
// Built from the browser record and the server-loaded prompts; no model
// call. Used by the working page (the current run) and the past-runs page.
import type { PovStep } from '../pov-jokes/pov-jokes-client'
import type { AnalysisPrompt } from './analysis-prompts'
import type { EvaluatorPrompt } from './evaluator-prompts'
import { heartId, type HeartedJoke } from './hearted-jokes'
import type { PersonaPrompt } from './persona-pov-prompts'
import { SOURCE_LABEL, type Job, type Source } from './run-record'
import { studentReadAsText, type StudentReadJob } from './student-read'

export type RunBundleInput = {
  flavorId: number
  // "the current run" or "a past run", for the title.
  label: string
  personaName: string
  // The persona's file as it is NOW; for a past run that may be newer than
  // the version that wrote the jokes, and the bundle says so.
  persona: PersonaPrompt | null
  step1: PovStep | null
  step2: PovStep | null
  studentReadPrompt: AnalysisPrompt | null
  evaluator: EvaluatorPrompt | null
  jokeCount?: number
  moments: string[]
  studentReads: Record<number, StudentReadJob>
  jobs: Record<number, Job>
  readJobs: Record<number, Job>
  // Every hearted joke in the browser, across runs.
  hearted: HeartedJoke[]
  // For a past run: why it left the working page, and when.
  note?: string
}

const seconds = (ms?: number) => (ms == null ? '' : `${Math.round(ms / 1000)}s`)

const fence = (text: string) => {
  // A fence longer than any run of backticks inside the text.
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))
  const f = '`'.repeat(longest + 1)
  return `${f}text\n${text.trim()}\n${f}`
}

const jokeLines = (job: Job, heartedIds: Set<string>, allHearted: HeartedJoke[]): string[] => {
  const out: string[] = []
  ;(job.jokes ?? []).forEach((joke, i) => {
    const ev = job.evals?.[i]
    const hearted = heartedIds.has(heartId(job.persona, job.moment, joke))
    const bits: string[] = []
    if (ev?.status === 'done' && ev.data) {
      const d = ev.data
      if (typeof d.score === 'number') bits.push(`${d.score}%${d.rating ? ` ${d.rating}` : ''}`)
      if (d.criteria) {
        bits.push(
          Object.entries(d.criteria)
            .map(([k, c]) => `${k.replace(/_/g, ' ')} ${c.score ?? '?'}`)
            .join(', ')
        )
      }
      if (d.failure_flags?.length) bits.push(`flags: ${d.failure_flags.join(', ')}`)
    } else if (ev?.status === 'failed') bits.push('scoring failed')
    out.push(`${i + 1}. ${hearted ? '♥ HEARTED — ' : ''}${joke}`)
    if (bits.length) out.push(`   - ${bits.join(' · ')}`)
    if (ev?.status === 'done' && ev.data?.reason) out.push(`   - evaluator: ${ev.data.reason}`)
    const an = job.analyses?.[i]
    if (an?.status === 'done' && an.data) {
      const d = an.data
      const moves = [d.primary_move, ...(d.supporting_moves ?? [])].filter(Boolean).join(', ')
      out.push(`   - analysis: ${d.action ?? '?'}${an.backstop ? ` (${an.backstop})` : ''} · premise ${d.premise_quality ?? '?'}, execution ${d.execution_quality ?? '?'}, legibility ${d.connection_legibility ?? '?'}, persona fit ${d.persona_fit ?? '?'} · moves: ${moves || 'none'}`)
      if (d.premise) out.push(`   - premise: ${d.premise}`)
      if (d.unexplained_move) out.push(`   - not in the catalog: ${d.unexplained_move}`)
      if (d.specific_problem) out.push(`   - problem: ${d.specific_problem}`)
    } else if (an?.status === 'failed') out.push('   - analysis failed')
    const ws = job.workshops?.[i]
    if (ws?.messages?.length) {
      out.push(`   - workshop chat (${ws.messages.length} turns${ws.model ? `, ${ws.model}` : ''}):`)
      for (const m of ws.messages) out.push(`     - ${m.role === 'user' ? 'editor' : 'model'}: ${m.content.replace(/\s+/g, ' ').slice(0, 400)}`)
      for (const h of allHearted) if (h.origin === 'workshop' && h.refinedFrom === joke && h.moment === job.moment) out.push(`     - ♥ HEARTED from the chat: ${h.caption}${h.note ? ` (${h.note})` : ''}${h.askedFor ? ` — asked for: ${h.askedFor.slice(0, 120)}` : ''}`)
    }
    const rf = job.refinements?.[i]
    if (rf?.status === 'done' && rf.variants?.length) {
      rf.variants.forEach((v, k) => {
        const vh = heartedIds.has(heartId(job.persona, job.moment, v.joke))
        out.push(`   - variant ${k + 1}: ${vh ? '♥ HEARTED — ' : ''}${v.joke}${v.fix ? ` (fix: ${v.fix})` : ''}`)
      })
    }
  })
  return out
}

export function buildRunBundle(input: RunBundleInput): string {
  const {
    flavorId,
    label,
    personaName,
    persona,
    step1,
    step2,
    studentReadPrompt,
    evaluator,
    jokeCount,
    moments,
    studentReads,
    jobs,
    readJobs,
    hearted,
    note,
  } = input
  const heartedIds = new Set(hearted.map((h) => h.id))
  const indices = [...new Set([...Object.keys(jobs), ...Object.keys(readJobs), ...moments.map((_, i) => String(i))].map(Number))]
    .filter((i) => (moments[i] ?? '').trim() || jobs[i] || readJobs[i])
    .sort((a, b) => a - b)
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const L: string[] = []

  L.push(`# Reaction Joke Maker, ${label}: ${personaName || 'no persona'} on ${indices.length} moment${indices.length === 1 ? '' : 's'}`)
  L.push('')
  L.push(`- Flavor ${flavorId}, copied ${now}${note ? `. ${note}` : ''}`)
  const anyJob = Object.values(jobs)[0] ?? Object.values(readJobs)[0]
  L.push(
    `- Model: ${anyJob?.model ?? step1?.modelName ?? 'unknown'}${
      anyJob?.reasoningEffort ? ` at ${anyJob.reasoningEffort} reasoning effort` : ''
    }${jokeCount ? `. Jokes asked for per moment: ${jokeCount}` : ''}`
  )
  L.push(`- Sources: ${SOURCE_LABEL.persona} (step 1)${Object.keys(readJobs).length ? `, and ${SOURCE_LABEL['persona-read']} (step 2)` : ''}`)
  L.push(`- "♥ HEARTED" marks the jokes Lydia kept. Scores are from the persona's evaluator prompt, out of 100. "analysis" lines are the flavor's step 3 (premise, comic moves, keep | refine | reject) and "variant" lines its step 4, when the flavor has them.`)
  L.push('')

  L.push('## The persona voice prompt')
  L.push('')
  if (persona) {
    L.push(`From ${persona.file} (version of ${persona.date}${persona.versions > 1 ? `, ${persona.versions} on file` : ''}). This is the file as it is now; a past run may have used an older version.`)
    L.push('')
    L.push(fence(persona.text))
  } else L.push(`No persona file named "${personaName}" is on file now.`)
  L.push('')

  L.push('## Step 1 prompt, the persona alone (as stored, placeholders unfilled)')
  L.push('')
  L.push(step1 ? fence(step1.userPrompt) : 'This flavor has no step 1.')
  L.push('')
  if (step2 && Object.keys(readJobs).length) {
    L.push('## Step 2 prompt, the persona and the student read (as stored)')
    L.push('')
    L.push(fence(step2.userPrompt))
    L.push('')
  }
  if (studentReadPrompt && Object.keys(studentReads).length) {
    L.push(`## Student Read prompt (${studentReadPrompt.file})`)
    L.push('')
    L.push(fence(studentReadPrompt.text))
    L.push('')
  }
  if (evaluator) {
    L.push(`## Evaluator prompt (${evaluator.file})`)
    L.push('')
    L.push(fence(evaluator.text))
    L.push('')
  }

  L.push('## The moments and the jokes')
  L.push('')
  for (const i of indices) {
    const moment = (jobs[i] ?? readJobs[i])?.moment ?? moments[i] ?? ''
    L.push(`### Moment ${i + 1}`)
    L.push('')
    L.push(moment.trim())
    L.push('')
    const read = studentReads[i]
    if (read?.status === 'done' && read.data) {
      L.push('#### Student read')
      L.push('')
      L.push(studentReadAsText(read.data))
      L.push('')
    }
    for (const source of ['persona', 'persona-read'] as Source[]) {
      const job = (source === 'persona' ? jobs : readJobs)[i]
      if (!job) continue
      L.push(`#### Jokes ${SOURCE_LABEL[source]}${job.durationMs ? ` (written in ${seconds(job.durationMs)})` : ''}`)
      L.push('')
      if (job.status === 'failed') L.push(`The call failed: ${job.error ?? 'no error text'}`)
      else if (!job.jokes?.length) L.push('No jokes survived parsing.')
      else L.push(...jokeLines(job, heartedIds, hearted))
      L.push('')
    }
  }

  const others = hearted.filter((h) => !indices.some((i) => h.persona === personaName && h.moment === ((jobs[i] ?? readJobs[i])?.moment ?? moments[i])))
  if (others.length) {
    L.push('## Hearted jokes from other runs')
    L.push('')
    L.push('Also kept, by other personas or on other moments; more of what Lydia likes.')
    L.push('')
    for (const h of others) L.push(`- ${h.persona}, on "${h.moment.slice(0, 80).trim()}${h.moment.length > 80 ? '…' : ''}": ${h.caption}`)
    L.push('')
  }
  return L.join('\n')
}
