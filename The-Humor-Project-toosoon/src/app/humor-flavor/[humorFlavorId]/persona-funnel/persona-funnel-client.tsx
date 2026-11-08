'use client'

// Persona Premise Funnel (/persona-funnel) — the moment-only surface, run as
// a funnel instead of a single roster.
//
// This is a sibling of /pov-jokes, not a replacement. That page's step 1
// returns one selected persona per point of view, and each persona is one unit
// of work. Here step 1 returns a whole derivation — event moments, persona
// candidates scanned cheaply against every moment, a shortlist, strong
// activations, distinct processing paths, a pool of raw comic premises, and a
// semantic deduplication pass — and the unit of work that comes out of it is a
// PREMISE, not a persona. One persona carries three to five premises, and each
// one is a separate step-2 call.
//
// That difference is the reason for a second page: the premise is what keeps
// five captions from being five wordings of the same joke, so it has to be
// visible and separately runnable rather than something step 2 rediscovers.
//
// Step 2 never fans out on its own. Step 1 returns far more premises than you
// want to pay for, so nothing runs until you pick and press.
//
// Prompts are stored in the DB with {{EVENT}}-style placeholders, which this
// surface fills before handing the finished text to the shared runStepAction.
// The shared ${...} resolver never sees them, and no image is involved.
//
// The KLIPY search and the browser-storage wrapper are imported from the
// /pov-jokes folder rather than copied: they are infrastructure, identical for
// both surfaces, and a bug fixed in one should not need fixing twice.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { promptHash } from '@/utils/prompt-hash'

import { runStepAction } from '../chiltrix/actions'
import { searchKlipyAction } from '../pov-jokes/klipy-actions'
import type { KlipyResult, KlipySearchResult } from '../pov-jokes/klipy-types'
import {
  deleteRecord,
  describeQuota,
  loadRecord,
  migrateFromLocalStorage,
  saveRecord,
} from '../pov-jokes/pov-jokes-store'

export type PovStep = {
  id: number
  orderBy: number
  description: string
  systemPrompt: string
  userPrompt: string
  modelName: string
  providerModelId: string
  isTemperatureSupported: boolean
  temperature: number | null
}

// Both steps run on the model the flavor's steps name, at this reasoning
// effort. Effort has no per-step column yet — it is a property of this
// surface, so changing it here changes it for both steps.
const REASONING_EFFORT = 'high' as const
// Step 1 evaluates every supplied persona plus 5-10 event-native and 3-5
// narrow-lens discoveries, each with ten prose fields — the 16k default cuts
// the JSON off mid-object once hidden reasoning is paid for too.
const MAX_OUTPUT_TOKENS = 60000
// How many per-premise step-2 calls are in flight at once.
const CONCURRENCY = 3

// The recurring persona library step 1 scores the moment against. Editable on
// the page; this is only what the box starts with.
const DEFAULT_PERSONA_LIBRARY = `* the sad girl: everyone's good news is her bad night — what does the celebration take away from HER?
* the social justice warrior: a discrete issue immediately expands into a larger systemic problem
* the grind-mode premed: everything is measured in lost Butler hours and broken focus
* the broke student: everything is measured in money they don't have
* the international student: a baffled anthropologist of American campus rituals
* the wannabe finance bro: every moment is networking, clout, money, or an asset class
* the hard-core Republican: the moment proves capitalism, meritocracy, and personal responsibility
* the CC professor: interprets everything through the Contemporary Civilization syllabus
* the gamer: reads reality through game mechanics`

// ---------------------------------------------------------------------------
// Step 1's output. Every substantive object lives in exactly one canonical
// array and is referenced elsewhere by id, so most of the work this surface
// does is resolving those ids back into objects.
// ---------------------------------------------------------------------------

// Persona scores are 0-3 each, five of them, so 15 is the ceiling.
type PersonaScores = {
  event_activation?: number
  persona_specificity?: number
  event_specificity?: number
  potential_premise_diversity?: number
  visual_runway?: number
  persona_total_score?: number
}

// Premise scores are 0-5 each, five of them, so 25 is the ceiling. Only the
// representative of a semantic cluster is scored; duplicates come back null.
type IdeaScores = {
  persona_specificity?: number
  event_specificity?: number
  comic_tension?: number
  behavioral_concreteness?: number
  joke_runway?: number
  total_score?: number
}

type EventMoment = {
  moment_id?: string
  moment?: string
  moment_type?: string
  concrete_features?: string[]
  comic_affordances?: string[]
}

// The cheap pass: one line per persona per moment, before anything is expanded.
type MomentScanEntry = {
  moment_id?: string
  activation_strength?: number
  activation_reason?: string | null
}

type FunnelPersona = {
  persona_id?: string
  persona?: string
  source?: string
  persona_baseline?: string
  general_processing_rule?: string
  moment_scan?: MomentScanEntry[]
  persona_scores?: PersonaScores
  // Filled in only after the premises exist, so it can disagree with the
  // potential_premise_diversity guess made before them.
  actual_premise_diversity?: number | null
  evaluation_notes?: string
}

type Activation = {
  activation_id?: string
  persona_id?: string
  moment_id?: string
  trigger_feature?: string
  activated_concerns?: string[]
  persona_translation?: string
  activation_strength?: number
}

type ProcessingPath = {
  path_id?: string
  activation_id?: string
  concern?: string
  processing_path?: string
  why_distinct?: string
}

type Idea = {
  idea_id?: string
  persona_id?: string
  activation_id?: string
  path_id?: string
  comic_role?: string
  comic_translation?: string
  comic_contradiction?: string
  core_comic_idea?: string
  likely_joke_target?: string
  visual_primitives?: string[]
  semantic_cluster?: string
  is_cluster_representative?: boolean
  scores?: IdeaScores
}

type DedupEntry = {
  persona_id?: string
  semantic_cluster?: string
  kept_idea_id?: string
  duplicate_idea_ids?: string[]
}

type PremiseSelection = {
  persona_id?: string
  selected_idea_ids?: string[]
  actual_premise_diversity?: number
  selection_reason?: string
}

type Step1Output = {
  event?: {
    event_core?: string
    event_arc?: string
    event_moments?: EventMoment[]
  }
  personas?: FunnelPersona[]
  shortlisted_persona_ids?: string[]
  activations?: Activation[]
  processing_paths?: ProcessingPath[]
  ideas?: Idea[]
  semantic_deduplication?: DedupEntry[]
  persona_premise_selections?: PremiseSelection[]
  selected_persona_ids?: string[]
  diversity_check?: {
    personas_with_insufficient_range?: {
      persona_id?: string
      problem?: string
    }[]
    potentially_redundant_personas?: {
      persona_id_1?: string
      persona_id_2?: string
      overlap?: string
    }[]
    selected_persona_lenses?: {
      persona_id?: string
      distinct_lens?: string
    }[]
    overall_assessment?: string
  }
}

// One unit of work for step 2: a selected comic premise with every id step 1
// used to reach it already resolved. This is what the page runs, checks,
// counts, and links to — the persona is only how they are grouped on screen.
type Premise = {
  ideaId: string
  idea: Idea
  persona: FunnelPersona
  personaName: string
  personaId: string
  // Each of these is null when step 1 emitted an id with no matching object,
  // which is worth showing rather than hiding: it means a broken reference.
  activation: Activation | null
  moment: EventMoment | null
  path: ProcessingPath | null
}

type JokeCandidate = {
  angle_name?: string
  setup?: string
  joke_mechanism?: string
  image_situation?: string
  caption?: string
  scores?: {
    persona_specificity?: number
    event_specificity?: number
    comic_tension?: number
    naturalness?: number
    target_clarity?: number
  }
}

type Step2Output = {
  persona?: { persona_baseline?: string }
  comic_relationship?: {
    comic_role?: string
    why_this_role_fits?: string
    joke_target?: string
  }
  persona_processing?: {
    persona_processing_rule?: string
    trigger_feature?: string
  }
  response?: {
    public_or_surface_response?: string
    unfiltered_response?: string
  }
  stakes?: {
    material_stake?: string | null
    downstream_burden?: string | null
    persona_opportunity?: string | null
  }
  humor_engine?: {
    comic_contradiction?: string
    comic_move?: string
    comic_move_explanation?: string
  }
  persona_material?: {
    persona_specific_vocabulary?: string[]
    visual_behaviors?: string[]
  }
  joke_candidates?: JokeCandidate[]
  best?: { best_caption?: string; why_best?: string }
}

type ImageConcept = {
  rank?: number
  concept?: string
  visual_description?: string
  why_it_works?: string
  search_terms?: string[]
  scores?: {
    searchability?: number
    caption_compatibility?: number
    simplicity?: number
  }
}

type Step3Output = {
  caption?: string
  visual_analysis?: {
    caption_carries?: string
    image_needs_to_carry?: string
    core_visual_dynamic?: string
    original_image_issue?: string | null
  }
  image_concepts?: ImageConcept[]
  recommended_concept?: {
    rank?: number
    concept?: string
    visual_description?: string
    reason?: string
    best_search_terms?: string[]
  }
}

type SimplifiedVersion = {
  id?: number
  simplification_level?: string
  caption?: string
  word_count?: number
  what_was_simplified?: string
  scores?: {
    simplicity?: number
    punchiness?: number
    persona_specificity?: number
    event_specificity?: number
    preservation_of_core?: number
  }
}

type SimplifyRecommendation = {
  id?: number
  caption?: string
  reason?: string
}

type Step4Output = {
  original_caption?: string
  analysis?: {
    comic_core?: string
    persona_hook?: string
    essential_context?: string[]
    removable_complexity?: string[]
  }
  simplified_versions?: SimplifiedVersion[]
  recommendations?: {
    best_overall?: SimplifyRecommendation
    simplest_that_still_works?: SimplifyRecommendation
    best_if_image_carries_context?: SimplifyRecommendation
  }
}

// One saved caption. Favorites outlive the run that produced them — they are
// the point of the whole page — so they live under their own storage key and
// record the moment they came from, which will not be on screen any more.
type Favorite = {
  id: string
  caption: string
  persona: string
  angleName: string
  moment: string
  totalScore: number
  savedAt: string
  // Which step wrote this caption. Absent on favorites saved before the
  // simplify step existed, which were all step 2's.
  source?: 'step2' | 'simplified'
  // The GIF paired with this caption: the src pulled out of a pasted embed,
  // never the pasted markup itself. See parseEmbed.
  embedSrc?: string
  embedTitle?: string
  embedKind?: 'iframe' | 'image' | 'video'
}

// Hosts whose embeds this page will render. An allowlist rather than "any
// URL": the value comes from a paste, and an <iframe> pointing anywhere is a
// good way to get something unpleasant onto the page.
const EMBED_HOSTS = [
  'klipy.com',
  'giphy.com',
  'tenor.com',
  'gfycat.com',
  'imgur.com',
]

const MEDIA_EXTENSIONS = /\.(gif|webp|mp4|webm|png|jpe?g)(\?|$)/i
const VIDEO_EXTENSIONS = /\.(mp4|webm)(\?|$)/i

// Pages that send X-Frame-Options and therefore cannot be shown in an iframe
// here, however valid the URL is. klipy.com's own pages (including
// /gifs/<slug>/player) answer 403 with x-frame-options: SAMEORIGIN — verified
// against the live site. Their static.klipy.com FILE urls are fine, and are
// what the search returns, so the host check is deliberately narrow.
const isUnframeable = (src: string): boolean => {
  try {
    const host = new URL(src).hostname.replace(/^www\./, '')
    return host === 'klipy.com'
  } catch {
    return false
  }
}

// Reads one HTML attribute out of a pasted snippet. Double- and single-quoted
// forms are matched separately, because a single pattern of [^"']* stops at
// the first apostrophe inside a value — which silently truncated titles like
// title="Family Guy: Peter Griffin's Living Room Mayhem".
const readAttribute = (text: string, name: string): string | null => {
  const doubleQuoted = text.match(
    new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i')
  )
  if (doubleQuoted) return doubleQuoted[1]
  const singleQuoted = text.match(
    new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i')
  )
  return singleQuoted ? singleQuoted[1] : null
}

// Accepts either a full <iframe …> snippet or a bare URL, and returns only
// the pieces we will actually use. The pasted markup is NEVER rendered — we
// take the src, verify its host, and build our own element around it, so a
// paste cannot bring scripts, handlers, or attributes along with it.
const parseEmbed = (
  input: string
):
  | { src: string; title: string; kind: 'iframe' | 'image' | 'video' }
  | { error: string } => {
  const text = input.trim()
  if (!text) return { error: 'Paste an embed code or a link first.' }

  const srcAttribute = readAttribute(text, 'src')
  const titleAttribute = readAttribute(text, 'title')
  const candidate = srcAttribute ?? text.split(/\s+/)[0]

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return {
      error:
        'Could not find a link in that. Paste the whole <iframe …> embed code, or just the URL.',
    }
  }
  if (url.protocol !== 'https:') {
    return { error: 'Only https links can be embedded.' }
  }
  const host = url.hostname.replace(/^www\./, '')
  const allowed = EMBED_HOSTS.some(
    (permitted) => host === permitted || host.endsWith(`.${permitted}`)
  )
  if (!allowed) {
    return {
      error: `${host} is not one of the sites this page will embed (${EMBED_HOSTS.join(', ')}).`,
    }
  }
  if (isUnframeable(url.toString())) {
    return {
      error:
        'klipy.com pages refuse to be shown inside another site, so this embed would display as “refused to connect”. Use the KLIPY search above instead — it returns direct image links that do display.',
    }
  }
  return {
    src: url.toString(),
    title: titleAttribute?.trim() || 'Embedded GIF',
    kind: VIDEO_EXTENSIONS.test(url.pathname)
      ? 'video'
      : MEDIA_EXTENSIONS.test(url.pathname)
        ? 'image'
        : 'iframe',
  }
}

// Step 3 and step 4 are both optional per-caption calls with the same shape:
// one caption in, one JSON blob out, cached under the caption's id.
type CaptionJob = {
  captionId: string
  status: 'running' | 'done' | 'failed'
  text?: string
  error?: string
  promptHash?: string
  finishedAt?: string
}

// One step-2 call. Keyed by premise (idea_id), not by persona: a persona has
// three to five premises and each is run, cached, and re-run on its own.
type JokeJob = {
  premiseId: string
  personaName: string
  status: 'not-run' | 'queued' | 'running' | 'done' | 'failed'
  text?: string
  error?: string
  durationMs?: number
  // Fingerprint of the step-2 prompt that produced this output, so a cached
  // result can say so when the prompt has since been edited in the DB.
  promptHash?: string
  finishedAt?: string
}

type SavedState = {
  moment: string
  eventContext: string
  personaLibrary: string
  step1Raw: string
  step1PromptHash: string
  step1FinishedAt: string
  jobs: Record<string, JokeJob>
  imageTerms: Record<string, CaptionJob>
  simplified: Record<string, CaptionJob>
}

// A caption's stable identity across renders and reloads: which PREMISE wrote
// it and which of that premise's five executions it was. Keying on the premise
// rather than the persona matters here — one persona produces several premises
// and every one of them writes an execution 1, so a persona-keyed id would
// collide and let one premise's caption overwrite another's saved work.
const captionId = (premiseId: string, index: number): string =>
  `${slugify(premiseId)}#${index + 1}`

// A simplified caption saved out of step 4 keeps the id of the caption it was
// simplified from, so it is obvious which original it replaces.
const simplifiedCaptionId = (sourceId: string, versionId: number): string =>
  `${sourceId}~simplified-${versionId}`

// One caption handed to an optional per-caption step, with whatever step 2
// said around it. A caption reached from section 4 has only the first fields.
type CaptionInput = {
  id: string
  caption: string
  personaName: string
  angleName?: string
  jokeMechanism?: string
  originalImage?: string
  analysis?: Step2Output
}

// The {{JOKE_OUTPUT}} both optional steps read. Missing pieces are sent as
// null rather than dropped, so the prompt sees which context it did not get.
const jokeOutputFor = (input: CaptionInput, moment: string) => ({
  caption: input.caption,
  persona: input.personaName,
  event: moment.trim(),
  angle_name: input.angleName ?? null,
  joke_mechanism: input.jokeMechanism ?? null,
  original_image_concept: input.originalImage ?? null,
  why_the_joke_is_funny:
    input.analysis?.humor_engine?.comic_contradiction ?? null,
  comic_move: input.analysis?.humor_engine?.comic_move ?? null,
  intended_reaction: input.analysis?.comic_relationship?.joke_target ?? null,
  persona_baseline: input.analysis?.persona?.persona_baseline ?? null,
})

// Fills {{EVENT}}-style placeholders. An unknown placeholder is left visible
// rather than blanked, so a missing binding shows up in the sent prompt.
const fillTemplate = (
  template: string,
  values: Record<string, string>
): string =>
  template.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole
  )

// Models sometimes wrap JSON in a fence despite being told not to.
const stripFence = (text: string): string => {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
}

const parseJson = <T,>(text: string): T | null => {
  try {
    return JSON.parse(stripFence(text)) as T
  } catch {
    return null
  }
}

// Step 2 scores each candidate 1-5 on five dimensions.
const CANDIDATE_SCORE_LABELS: [keyof NonNullable<JokeCandidate['scores']>, string][] = [
  ['persona_specificity', 'only this persona'],
  ['event_specificity', 'uses this event'],
  ['comic_tension', 'real tension'],
  ['naturalness', 'sounds like a post'],
  ['target_clarity', 'clear target'],
]

const candidateTotal = (candidate: JokeCandidate): number =>
  CANDIDATE_SCORE_LABELS.reduce(
    (sum, [key]) => sum + (Number(candidate.scores?.[key]) || 0),
    0
  )

// Step 4 scores each simplified version 1-5 on its own five dimensions.
const SIMPLIFIED_SCORE_LABELS: [
  keyof NonNullable<SimplifiedVersion['scores']>,
  string,
][] = [
  ['simplicity', 'instantly clear'],
  ['punchiness', 'lands fast'],
  ['persona_specificity', 'only this persona'],
  ['event_specificity', 'uses this event'],
  ['preservation_of_core', 'keeps the original idea'],
]

const simplifiedTotal = (version: SimplifiedVersion): number =>
  SIMPLIFIED_SCORE_LABELS.reduce(
    (sum, [key]) => sum + (Number(version.scores?.[key]) || 0),
    0
  )

// The prompt's four levels, said in words rather than in its enum.
const SIMPLIFICATION_LEVELS: Record<string, string> = {
  light: 'lightly compressed',
  strong: 'strongly compressed',
  meme_native: 'rewritten as meme syntax',
  minimal: 'as short as it can get',
}

// Counted here rather than trusting the model's own word_count field.
const wordCount = (caption: string): number =>
  caption.trim() ? caption.trim().split(/\s+/).length : 0

// Persona names become anchor ids, so they have to survive punctuation.
const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed'

// Rendered only after mount (the timestamp comes out of the local database), so
// there is no server/client formatting mismatch to worry about.
const formatWhen = (iso: string): string => {
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return 'Saved earlier'
  return `Generated ${when.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })}`
}

// Step 1 scores a persona 0-3 on five things, and a premise 0-5 on five other
// things. Said in words here rather than in the prompt's field names.
const PERSONA_SCORE_LABELS: [keyof PersonaScores, string][] = [
  ['event_activation', 'moments it activates on'],
  ['persona_specificity', 'unmistakably this persona'],
  ['event_specificity', 'uses this event'],
  ['potential_premise_diversity', 'range of premises'],
  ['visual_runway', 'visual potential'],
]

const IDEA_SCORE_LABELS: [keyof IdeaScores, string][] = [
  ['persona_specificity', 'only this persona'],
  ['event_specificity', 'uses this event'],
  ['comic_tension', 'real tension'],
  ['behavioral_concreteness', 'something you could see'],
  ['joke_runway', 'more than one caption in it'],
]

const personaScoreLine = (scores?: PersonaScores): string => {
  const parts = PERSONA_SCORE_LABELS.filter(
    ([key]) => typeof scores?.[key] === 'number'
  ).map(([key, label]) => `${label} ${scores[key]}/3`)
  return parts.length ? parts.join(' · ') : 'no scores returned'
}

const ideaScoreLine = (scores?: IdeaScores): string => {
  const parts = IDEA_SCORE_LABELS.filter(
    ([key]) => typeof scores?.[key] === 'number'
  ).map(([key, label]) => `${label} ${scores[key]}/5`)
  return parts.length ? parts.join(' · ') : 'no scores returned'
}

// The prompt asks for a total that is the SUM of the five components, and
// getting that arithmetic wrong is a known model failure — the version of this
// prompt that shipped first even wrote the formula with `*` between the
// components. So the total shown on the page is always recomputed here, and
// the model's own number is kept only so a disagreement can be said out loud.
const personaTotal = (
  scores?: PersonaScores
): { total: number; disagreesWith: number | null } => {
  const total = PERSONA_SCORE_LABELS.reduce(
    (sum, [key]) => sum + (Number(scores?.[key]) || 0),
    0
  )
  const claimed = scores?.persona_total_score
  return {
    total,
    disagreesWith:
      typeof claimed === 'number' && claimed !== total ? claimed : null,
  }
}

const ideaTotal = (
  scores?: IdeaScores
): { total: number; disagreesWith: number | null } => {
  const total = IDEA_SCORE_LABELS.reduce(
    (sum, [key]) => sum + (Number(scores?.[key]) || 0),
    0
  )
  const claimed = scores?.total_score
  return {
    total,
    disagreesWith:
      typeof claimed === 'number' && claimed !== total ? claimed : null,
  }
}

// The prompt's three persona sources and eight moment types, in words.
const PERSONA_SOURCES: Record<string, string> = {
  recurring_trope: 'the recurring persona library you supplied',
  event_native: 'roles this event itself creates',
  narrow_lens: 'the search for comically narrow concerns',
}

const MOMENT_TYPES: Record<string, string> = {
  setup: 'the setup',
  escalation: 'an escalation',
  reversal: 'a reversal',
  decision: 'a decision',
  peak: 'the peak',
  resolution: 'the resolution',
  aftermath: 'the immediate aftermath',
  downstream_consequence: 'a downstream consequence',
  other: 'an unclassified moment',
}

const describeSource = (source?: string): string =>
  PERSONA_SOURCES[source ?? ''] ?? `an unrecognized source (${source})`

const describeMomentType = (type?: string): string =>
  MOMENT_TYPES[type ?? ''] ?? `an unrecognized type (${type})`

const diversityWords = (value?: number | null): string => {
  if (value === 0) return 'all of its premises collapsed into one'
  if (value === 1) return 'mostly one note'
  if (value === 2) return 'several genuinely different premises'
  if (value === 3) return 'a broad range of distinct premises'
  return 'not rated'
}

const SECTION =
  'scroll-mt-6 rounded-2xl bg-[rgb(var(--panel)/0.55)] p-8 dark:bg-[rgb(var(--panel)/0.2)]'
const SECTION_NUMBER =
  'text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))]'
const SECTION_TITLE = 'mt-2 text-2xl font-semibold'
const GOAL_TEXT = 'mt-3 max-w-3xl text-sm leading-relaxed text-[rgb(var(--muted))]'
const BIG_BUTTON =
  'rounded-lg bg-[rgb(var(--accent-strong))] px-7 py-3.5 text-base font-bold text-white shadow-md transition hover:brightness-110 disabled:opacity-40'
const SMALL_BUTTON =
  'rounded-lg border border-[rgb(var(--gloss)/0.5)] px-3.5 py-2 text-sm font-semibold transition hover:bg-[rgb(var(--panel)/0.8)] disabled:opacity-40 dark:border-[rgb(var(--gloss)/0.2)]'
const TEXTAREA =
  'w-full rounded-lg border border-[rgb(var(--gloss)/0.5)] bg-transparent p-3 text-sm leading-relaxed dark:border-[rgb(var(--gloss)/0.2)]'
const FIELD_LABEL = 'block text-sm font-semibold'
const FIELD_HELP = 'mt-1 text-xs text-[rgb(var(--muted))]'

// Renders nothing when the model omitted the field or returned null — the
// composite children (value plus an " — explanation" tail) are flattened
// first, so a field whose parts are all missing disappears entirely rather
// than leaving a dangling label.
function Field({
  term,
  children,
}: {
  term: string
  children?: React.ReactNode
}) {
  const parts = (Array.isArray(children) ? children : [children]).filter(
    (part) => typeof part === 'string' || typeof part === 'number'
  )
  const text = parts.join('').trim()
  if (!text) return null
  // The label is the quiet part and the value is the dark part — the reverse
  // reads as a wall of identical bold-then-grey lines with nothing standing
  // out, which is what these blocks looked like before.
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
        {term}
      </dt>
      <dd className="mt-0.5 text-sm leading-relaxed">{text}</dd>
    </div>
  )
}

type NavEntry = { id: string; label: string; note?: string; children: NavEntry[] }

// Sticky table of contents for a page that runs far past one screen. This one
// recurses to any depth, because the funnel has three levels worth jumping
// between: the numbered sections, the personas inside them, and the individual
// premises inside each persona. Hidden below lg, where the page is a single
// narrow column and scrolling is the nav.
//
// Depth is carried by weight and size rather than colour, so the hierarchy
// survives in grayscale.
const NAV_DEPTH_STYLES = [
  'block text-sm font-semibold leading-snug hover:text-[rgb(var(--accent-strong))]',
  'block text-[13px] font-medium leading-snug text-[rgb(var(--ink))] hover:text-[rgb(var(--accent-strong))]',
  'block text-[12px] leading-snug text-[rgb(var(--muted))] hover:text-[rgb(var(--accent-strong))]',
]

function NavList({ entries, depth }: { entries: NavEntry[]; depth: number }) {
  const linkClass =
    NAV_DEPTH_STYLES[Math.min(depth, NAV_DEPTH_STYLES.length - 1)]
  return (
    <ul
      className={
        depth === 0
          ? 'mt-4 space-y-4'
          : 'mt-2 space-y-1.5 border-l border-[rgb(var(--gloss)/0.4)] pl-3 dark:border-[rgb(var(--gloss)/0.15)]'
      }
    >
      {entries.map((entry) => (
        <li key={entry.id}>
          <a href={`#${entry.id}`} className={linkClass}>
            {entry.label}
          </a>
          {entry.note ? (
            <p className="mt-0.5 text-[11px] text-[rgb(var(--muted))]">
              {entry.note}
            </p>
          ) : null}
          {entry.children.length ? (
            <NavList entries={entry.children} depth={depth + 1} />
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function PageNav({
  entries,
  onClear,
  canClear,
}: {
  entries: NavEntry[]
  // Clears the last run from the page and the browser cache. It lives in the
  // outline as well as at the top of the page because the outline is always
  // on screen, and the in-section link was at the end of a very long section.
  onClear: () => void
  canClear: boolean
}) {
  return (
    <nav
      aria-label="Sections of this page"
      className="sticky top-6 hidden max-h-[calc(100vh-3rem)] w-64 shrink-0 self-start overflow-y-auto pb-8 lg:block"
    >
      <button
        type="button"
        className={`${SMALL_BUTTON} w-full text-left`}
        disabled={!canClear}
        onClick={onClear}
        title="Removes the moment, the premises, and every set of captions from this page and from this browser's saved run. Saved captions in step 4 stay."
      >
        {canClear ? 'Clear the last run and start a new moment' : 'Nothing from a past run to clear'}
      </button>
      <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
        Jump to a section
      </p>
      <NavList entries={entries} depth={0} />
    </nav>
  )
}

// Step 3's output for one caption. The search terms are the deliverable —
// they are what gets pasted into an image search — so they are set apart as
// copyable chips rather than buried in the prose that justifies them.
function ImageTermsBlock({ job }: { job: CaptionJob }) {
  if (job.status === 'running') {
    return (
      <p className="mt-3 text-sm text-[rgb(var(--muted))]">
        Looking for image concepts that are actually searchable…
      </p>
    )
  }
  if (job.status === 'failed') {
    return (
      <p className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
        {job.error}
      </p>
    )
  }

  const parsed = job.text ? parseJson<Step3Output>(job.text) : null
  if (!parsed) {
    return (
      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-[rgb(var(--panel)/0.6)] p-3 text-xs dark:bg-[rgb(var(--panel)/0.3)]">
        {job.text}
      </pre>
    )
  }

  const concepts = [...(parsed.image_concepts ?? [])].sort(
    (a, b) => (a.rank ?? 99) - (b.rank ?? 99)
  )
  const recommended = parsed.recommended_concept

  return (
    <div className="mt-5 space-y-8 border-l-2 border-[rgb(var(--gloss)/0.5)] pl-6 dark:border-[rgb(var(--gloss)/0.2)]">
      {recommended?.concept ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">
            The image concept to search for first
          </p>
          <p className="mt-2 text-xl font-semibold leading-snug">
            {recommended.concept}
          </p>
          {recommended.visual_description ? (
            <p className="mt-1.5 text-sm leading-relaxed">
              {recommended.visual_description}
            </p>
          ) : null}
          {recommended.best_search_terms?.length ? (
            <TermChips terms={recommended.best_search_terms} strong />
          ) : null}
          {recommended.reason ? (
            <p className="mt-3 text-sm leading-relaxed text-[rgb(var(--muted))]">
              {recommended.reason}
            </p>
          ) : null}
        </div>
      ) : null}

      {concepts.length ? (
        <div>
          <p className="text-sm font-semibold">
            All {concepts.length} image concepts, strongest first
          </p>
          <ul className="mt-5 space-y-8">
            {concepts.map((concept, i) => (
              <li
                key={i}
                className="grid grid-cols-[1.75rem_1fr] gap-x-4 sm:grid-cols-[2.25rem_1fr]"
              >
                <p className="text-2xl font-bold leading-none tabular-nums text-[rgb(var(--muted)/0.35)]">
                  {concept.rank ?? i + 1}
                </p>
                <div className="min-w-0">
                  <p className="text-base font-semibold leading-snug">
                    {concept.concept}
                  </p>
                  {concept.visual_description ? (
                    <p className="mt-1 text-sm leading-relaxed">
                      {concept.visual_description}
                    </p>
                  ) : null}
                  {concept.search_terms?.length ? (
                    <TermChips terms={concept.search_terms} />
                  ) : null}
                  {concept.why_it_works ? (
                    <p className="mt-2.5 text-sm leading-relaxed text-[rgb(var(--muted))]">
                      {concept.why_it_works}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-[rgb(var(--muted))]">
                    easy to find {concept.scores?.searchability ?? '?'}/5 · fits
                    the caption {concept.scores?.caption_compatibility ?? '?'}/5
                    · one simple beat {concept.scores?.simplicity ?? '?'}/5
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {parsed.visual_analysis ? (
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-[rgb(var(--accent-strong))] hover:underline">
            Show why these concepts — what the caption already carries and what
            the image has to add
          </summary>
          <dl className="mt-3 space-y-3">
            <Field term="What the caption already says on its own">
              {parsed.visual_analysis.caption_carries}
            </Field>
            <Field term="What the image has to contribute">
              {parsed.visual_analysis.image_needs_to_carry}
            </Field>
            <Field term="The one simple beat to look for">
              {parsed.visual_analysis.core_visual_dynamic}
            </Field>
            <Field term="Why step 2&rsquo;s own image idea was hard to search for">
              {parsed.visual_analysis.original_image_issue}
            </Field>
          </dl>
        </details>
      ) : null}
    </div>
  )
}

// Search queries, click to copy. These are the things that get pasted into a
// GIF/image search, so they are chips rather than a comma-joined sentence.
function TermChips({ terms, strong }: { terms: string[]; strong?: boolean }) {
  const [copied, setCopied] = useState<string | null>(null)
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {terms.map((term) => (
        <button
          key={term}
          type="button"
          title="Copy this search term"
          onClick={() => {
            navigator.clipboard.writeText(term)
            setCopied(term)
            window.setTimeout(() => setCopied(null), 1200)
          }}
          className={`rounded-full border border-[rgb(var(--gloss)/0.6)] px-3 py-1.5 transition hover:bg-[rgb(var(--panel)/0.9)] dark:border-[rgb(var(--gloss)/0.25)] dark:hover:bg-[rgb(var(--panel)/0.4)] ${
            strong ? 'text-sm font-semibold' : 'text-[13px]'
          }`}
        >
          {copied === term ? 'copied' : term}
        </button>
      ))}
    </div>
  )
}

// A copy button that says it copied. Used wherever a caption is the thing
// being taken away from the page.
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={SMALL_BUTTON}
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  )
}

// Step 4's output for one caption: eight shorter versions of the same joke.
// The three picks lead, because they are the answer — the full list of eight
// and the reasoning about what was cut sit underneath them.
function SimplifiedBlock({
  job,
  onSaveVersion,
  isVersionSaved,
}: {
  job: CaptionJob
  onSaveVersion: (version: SimplifiedVersion) => void
  isVersionSaved: (versionId: number) => boolean
}) {
  if (job.status === 'running') {
    return (
      <p className="mt-3 text-sm text-[rgb(var(--muted))]">
        Writing shorter versions of this caption…
      </p>
    )
  }
  if (job.status === 'failed') {
    return (
      <p className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
        {job.error}
      </p>
    )
  }

  const parsed = job.text ? parseJson<Step4Output>(job.text) : null
  if (!parsed) {
    return (
      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-[rgb(var(--panel)/0.6)] p-3 text-xs dark:bg-[rgb(var(--panel)/0.3)]">
        {job.text}
      </pre>
    )
  }

  const versions = parsed.simplified_versions ?? []
  // A recommendation names a version by id; fall back to the caption it
  // carries itself when the id does not resolve.
  const versionFor = (rec?: SimplifyRecommendation): SimplifiedVersion | null => {
    if (!rec) return null
    const found = versions.find((v) => v.id === rec.id)
    if (found) return found
    return rec.caption ? { id: rec.id, caption: rec.caption } : null
  }
  const picks: [string, SimplifyRecommendation | undefined][] = [
    ['The one to use', parsed.recommendations?.best_overall],
    ['The simplest that still works', parsed.recommendations?.simplest_that_still_works],
    ['The shortest if the image carries the reaction', parsed.recommendations?.best_if_image_carries_context],
  ]

  return (
    <div className="mt-5 space-y-8 border-l-2 border-[rgb(var(--gloss)/0.5)] pl-6 dark:border-[rgb(var(--gloss)/0.2)]">
      {picks.some(([, rec]) => versionFor(rec)) ? (
        <div className="space-y-7">
          {picks.map(([label, rec], i) => {
            const version = versionFor(rec)
            if (!version) return null
            const caption = (version.caption ?? '').trim()
            const saved =
              typeof version.id === 'number' && isVersionSaved(version.id)
            return (
              <div key={label}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">
                  {label}
                  {typeof version.id === 'number'
                    ? ` · version ${version.id} below`
                    : ''}
                </p>
                {/* The first pick is the answer, so it is the biggest thing
                    in the block; the other two are alternates. */}
                <p
                  className={`mt-2 font-semibold leading-snug ${
                    i === 0 ? 'text-2xl' : 'text-lg'
                  }`}
                >
                  &ldquo;{caption}&rdquo;
                </p>
                <p className="mt-1.5 text-xs text-[rgb(var(--muted))]">
                  {wordCount(caption)} words
                  {rec?.reason ? ` — ${rec.reason}` : ''}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <CopyButton text={caption} label="Copy this caption" />
                  {typeof version.id === 'number' ? (
                    <button
                      type="button"
                      className={SMALL_BUTTON}
                      disabled={saved}
                      onClick={() => onSaveVersion(version)}
                    >
                      {saved
                        ? 'Already saved'
                        : 'Save this simplified caption'}
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {versions.length ? (
        <div>
          <p className="text-sm font-semibold">
            All {versions.length} simplified version
            {versions.length === 1 ? '' : 's'}, least simplified first
          </p>
          <ul className="mt-5 space-y-8">
            {versions.map((version, i) => {
              const caption = (version.caption ?? '').trim()
              const total = simplifiedTotal(version)
              const saved =
                typeof version.id === 'number' && isVersionSaved(version.id)
              return (
                <li
                  key={version.id ?? i}
                  className="grid grid-cols-[1.75rem_1fr] gap-x-4 sm:grid-cols-[2.25rem_1fr]"
                >
                  <p className="text-2xl font-bold leading-none tabular-nums text-[rgb(var(--muted)/0.35)]">
                    {version.id ?? i + 1}
                  </p>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
                      {SIMPLIFICATION_LEVELS[
                        version.simplification_level ?? ''
                      ] ?? version.simplification_level}
                      {' · '}
                      {wordCount(caption)} words
                    </p>
                    <p className="mt-1.5 text-base font-semibold leading-snug">
                      &ldquo;{caption}&rdquo;
                    </p>
                    {version.what_was_simplified ? (
                      <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--muted))]">
                        {version.what_was_simplified}
                      </p>
                    ) : null}
                    <p className="mt-2.5 text-xs text-[rgb(var(--muted))]">
                      <span className="text-sm font-bold text-[rgb(var(--ink))] tabular-nums">
                        {total}
                      </span>
                      <span className="font-semibold"> / 25</span>
                      {'  '}
                      {SIMPLIFIED_SCORE_LABELS.filter(
                        ([key]) => typeof version.scores?.[key] === 'number'
                      )
                        .map(([key, label]) => `${label} ${version.scores?.[key]}`)
                        .join(' · ')}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <CopyButton text={caption} label="Copy this caption" />
                      {typeof version.id === 'number' ? (
                        <button
                          type="button"
                          className={SMALL_BUTTON}
                          disabled={saved}
                          onClick={() => onSaveVersion(version)}
                        >
                          {saved ? 'Already saved' : 'Save this one'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {parsed.analysis ? (
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-[rgb(var(--accent-strong))] hover:underline">
            Show what step 4 decided was the joke and what it decided was
            machinery
          </summary>
          <dl className="mt-3 space-y-3">
            <Field term="The one thing that makes this joke funny">
              {parsed.analysis.comic_core}
            </Field>
            <Field term="The detail that makes it this persona">
              {parsed.analysis.persona_hook}
            </Field>
            <Field term="What had to stay">
              {parsed.analysis.essential_context?.join('; ')}
            </Field>
            <Field term="What could go">
              {parsed.analysis.removable_complexity?.join('; ')}
            </Field>
          </dl>
        </details>
      ) : null}
    </div>
  )
}

// The finished thing: the caption sitting above the GIF it was paired with.
// This is what the whole page has been building toward, so it is composed as
// an artifact — caption large, image directly beneath, nothing else inside
// the frame competing with it.
function MemePreview({
  caption,
  embedSrc,
  embedTitle,
  embedKind,
  onRemove,
}: {
  caption: string
  embedSrc: string
  embedTitle?: string
  embedKind?: 'iframe' | 'image' | 'video'
  onRemove: () => void
}) {
  // A GIF saved before the page knew klipy.com refuses framing is still on the
  // favorite, and would render as a dead "refused to connect" box on every
  // reload. Say what happened and offer the way out, rather than showing the
  // broken frame again.
  if (embedKind !== 'image' && embedKind !== 'video' && isUnframeable(embedSrc)) {
    return (
      <figure className="mt-5 max-w-[640px] rounded-xl bg-[rgb(var(--panel)/0.7)] p-6 dark:bg-[rgb(var(--panel)/0.3)]">
        <figcaption className="text-xl font-semibold leading-snug">
          {caption}
        </figcaption>
        <div className="mt-4 rounded-lg bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-700 dark:text-amber-400">
          <p>
            This caption was paired with a klipy.com page, which refuses to be
            shown inside another site — that is the &ldquo;refused to
            connect&rdquo; box. Remove it and use the KLIPY search below, which
            returns direct image links that do display.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className={SMALL_BUTTON} onClick={onRemove}>
              Remove this GIF from the caption
            </button>
            <a
              href={embedSrc}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-semibold underline"
            >
              Open it on klipy.com →
            </a>
          </div>
        </div>
      </figure>
    )
  }

  return (
    <figure className="mt-5 max-w-[640px] rounded-xl bg-[rgb(var(--panel)/0.7)] p-6 dark:bg-[rgb(var(--panel)/0.3)]">
      <figcaption className="text-xl font-semibold leading-snug">
        {caption}
      </figcaption>
      <div className="mt-4 overflow-hidden rounded-lg">
        {embedKind === 'video' ? (
          <video
            src={embedSrc}
            className="h-auto w-full"
            autoPlay
            loop
            muted
            playsInline
          />
        ) : embedKind === 'image' ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={embedSrc}
            alt={embedTitle ?? 'The GIF paired with this caption'}
            className="h-auto w-full"
            loading="lazy"
          />
        ) : (
          <iframe
            src={embedSrc}
            title={embedTitle ?? 'The GIF paired with this caption'}
            className="aspect-video w-full border-0"
            allowFullScreen
            loading="lazy"
            sandbox="allow-scripts allow-same-origin allow-presentation"
            referrerPolicy="no-referrer"
          />
        )}
      </div>
    </figure>
  )
}

// Search KLIPY for a GIF to pair with one caption. The suggested queries are
// step 3's own search terms for this caption, so the two steps join up: step 3
// works out what to search for, this searches for it.
function GifSearch({
  favoriteId,
  suggestedTerms,
  onChoose,
}: {
  favoriteId: string
  suggestedTerms: string[]
  onChoose: (result: KlipyResult) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<KlipyResult[]>([])
  const [status, setStatus] = useState<'idle' | 'searching' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState('')

  const run = useCallback(async (term: string) => {
    const trimmed = term.trim()
    if (!trimmed) return
    setStatus('searching')
    setError(null)
    setSearched(trimmed)
    const res: KlipySearchResult = await searchKlipyAction({
      query: trimmed,
      perPage: 24,
    })
    setStatus('done')
    if (res.ok) {
      setResults(res.results ?? [])
      return
    }
    setError(res.error ?? 'The image search failed.')
    setResults([])
  }, [])

  return (
    <div className="mt-6 max-w-3xl">
      <p className="text-sm font-semibold">
        Search KLIPY for a GIF to put under this caption
      </p>
      {suggestedTerms.length ? (
        <>
          <p className="mt-1 text-xs text-[rgb(var(--muted))]">
            Step 3&rsquo;s search terms for this caption — click one to search
            for it.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestedTerms.map((term) => (
              <button
                key={term}
                type="button"
                className="rounded-full border border-[rgb(var(--gloss)/0.6)] px-3 py-1.5 text-[13px] transition hover:bg-[rgb(var(--panel)/0.9)] dark:border-[rgb(var(--gloss)/0.25)] dark:hover:bg-[rgb(var(--panel)/0.4)]"
                onClick={() => {
                  setQuery(term)
                  void run(term)
                }}
              >
                {term}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-1 text-xs text-[rgb(var(--muted))]">
          Run &ldquo;Find images to search for this caption&rdquo; first and
          step 3&rsquo;s search terms appear here as one-click buttons.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          id={`gif-search-${favoriteId}`}
          type="search"
          className="min-w-0 flex-1 rounded-lg border border-[rgb(var(--gloss)/0.5)] bg-transparent px-3 py-2 text-sm dark:border-[rgb(var(--gloss)/0.2)]"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void run(query)
            }
          }}
          placeholder="or type your own search, e.g. frantic phone call"
        />
        <button
          type="button"
          className={SMALL_BUTTON}
          disabled={status === 'searching' || !query.trim()}
          onClick={() => void run(query)}
        >
          {status === 'searching' ? 'Searching KLIPY…' : 'Search KLIPY'}
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {status === 'done' && !error ? (
        <p className="mt-3 text-xs text-[rgb(var(--muted))]">
          {results.length
            ? `${results.length} results for “${searched}” — click one to put it under the caption.`
            : `KLIPY returned nothing for “${searched}”. Try a simpler, more common phrase.`}
        </p>
      ) : null}

      {results.length ? (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {results.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                title={result.title}
                onClick={() => onChoose(result)}
                className="block w-full overflow-hidden rounded-lg border border-transparent transition hover:border-[rgb(var(--accent-strong))]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.previewUrl}
                  alt={result.title}
                  className="h-28 w-full object-cover"
                  loading="lazy"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

// The paste box for pairing a GIF with a saved caption.
function EmbedInput({
  favoriteId,
  value,
  onChange,
  onAttach,
  error,
  hasEmbed,
}: {
  favoriteId: string
  value: string
  onChange: (next: string) => void
  onAttach: () => void
  error?: string
  hasEmbed: boolean
}) {
  return (
    <div className="mt-5 max-w-2xl">
      <label
        className="block text-sm font-semibold"
        htmlFor={`embed-${favoriteId}`}
      >
        {hasEmbed
          ? 'Replace the GIF paired with this caption'
          : 'Pair a GIF with this caption'}
      </label>
      <p className="mt-1 text-xs leading-relaxed text-[rgb(var(--muted))]">
        Paste a direct image link — one ending in <code>.gif</code>,{' '}
        <code>.webp</code> or <code>.mp4</code> — or an embed code. Only the
        address inside it is used; the markup itself is never put on the page.{' '}
        <strong>
          A klipy.com <code>/player</code> embed will not display here
        </strong>{' '}
        — KLIPY refuses to be shown inside another site, which is what
        &ldquo;klipy.com refused to connect&rdquo; means. Use the search above
        instead: it returns direct file links, which do display.
      </p>
      <textarea
        id={`embed-${favoriteId}`}
        className={`${TEXTAREA} mt-2 font-mono text-xs`}
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder='<iframe src="https://klipy.com/gifs/…/player" …></iframe>'
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" className={SMALL_BUTTON} onClick={onAttach}>
          Show this GIF under the caption
        </button>
        {error ? (
          <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
        ) : null}
      </div>
    </div>
  )
}

// One premise's step-2 output. The caption the model picked leads,
// because that is the thing being judged; the five candidates follow; the
// machinery that produced them is collapsed underneath.
function JokeResult({
  analysis,
  personaName,
  rawText,
  isOpen,
  onToggle,
  isFavorite,
  onToggleFavorite,
  termsJobs,
  onFindTerms,
  canFindTerms,
  simplifyJobs,
  onSimplify,
  canSimplify,
  onSaveSimplified,
}: {
  analysis: Step2Output
  personaName: string
  rawText: string
  isOpen: boolean
  onToggle: () => void
  isFavorite: (id: string) => boolean
  onToggleFavorite: (candidate: JokeCandidate, index: number) => void
  termsJobs: Record<string, CaptionJob>
  onFindTerms: (candidate: JokeCandidate, index: number) => void
  canFindTerms: boolean
  simplifyJobs: Record<string, CaptionJob>
  onSimplify: (candidate: JokeCandidate, index: number) => void
  canSimplify: boolean
  onSaveSimplified: (
    candidate: JokeCandidate,
    index: number,
    version: SimplifiedVersion
  ) => void
}) {
  const candidates = analysis.joke_candidates ?? []
  const bestCaption = (analysis.best?.best_caption ?? '').trim()

  return (
    <div className="mt-4 space-y-8">
      {bestCaption ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
            The caption step 2 picked as its best for this premise
          </p>
          <p className="mt-3 text-3xl font-semibold leading-snug">
            &ldquo;{bestCaption}&rdquo;
          </p>
          {analysis.best?.why_best ? (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[rgb(var(--muted))]">
              {analysis.best.why_best}
            </p>
          ) : null}
        </div>
      ) : null}

      {candidates.length ? (
        <div>
          <h4 className="text-sm font-semibold">
            All {candidates.length} caption
            {candidates.length === 1 ? '' : 's'} step 2 wrote for this premise, with
            the angle each one takes
          </h4>
          {/* One numbered row per caption. The numeral gutter and the large
              gap between rows do the separating; inside a row the caption is
              far the largest thing, and the explanation is demoted under
              quiet labels so it cannot compete with what it explains. */}
          <ul className="mt-6 space-y-12">
            {candidates.map((candidate, i) => {
              const caption = (candidate.caption ?? '').trim()
              const isBest = Boolean(bestCaption) && caption === bestCaption
              const total = candidateTotal(candidate)
              return (
                <li
                  key={i}
                  className="grid grid-cols-[2.25rem_1fr] gap-x-5 sm:grid-cols-[3rem_1fr]"
                >
                  <p
                    className={`text-4xl font-bold leading-none tabular-nums ${
                      isBest
                        ? 'text-[rgb(var(--ink))]'
                        : 'text-[rgb(var(--muted)/0.35)]'
                    }`}
                  >
                    {i + 1}
                  </p>

                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">
                      {candidate.angle_name || `Angle ${i + 1}`}
                      {isBest ? ' · picked as best' : ''}
                    </p>

                    <p className="mt-2.5 text-xl font-semibold leading-snug">
                      &ldquo;{caption}&rdquo;
                    </p>

                    <dl className="mt-5 space-y-3">
                      {candidate.image_situation ? (
                        <div>
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
                            Image it wants
                          </dt>
                          <dd className="mt-1 text-sm leading-relaxed">
                            {candidate.image_situation}
                          </dd>
                        </div>
                      ) : null}
                      {candidate.joke_mechanism ? (
                        <div>
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
                            Why it should be funny
                          </dt>
                          <dd className="mt-1 text-sm leading-relaxed">
                            {candidate.joke_mechanism}
                          </dd>
                        </div>
                      ) : null}
                    </dl>

                    <p className="mt-5 text-xs text-[rgb(var(--muted))]">
                      <span className="text-base font-bold text-[rgb(var(--ink))] tabular-nums">
                        {total}
                      </span>
                      <span className="font-semibold"> / 25</span>
                      {'  '}
                      {CANDIDATE_SCORE_LABELS.filter(
                        ([key]) => typeof candidate.scores?.[key] === 'number'
                      )
                        .map(
                          ([key, label]) =>
                            `${label} ${candidate.scores?.[key]}`
                        )
                        .join(' · ')}
                    </p>

                    {(() => {
                      const id = captionId(personaName, i)
                      const saved = isFavorite(id)
                      const termsJob = termsJobs[id]
                      const simplifyJob = simplifyJobs[id]
                      return (
                        <>
                          <div className="mt-4 flex flex-wrap items-center gap-3">
                            <button
                              type="button"
                              className={SMALL_BUTTON}
                              onClick={() => onToggleFavorite(candidate, i)}
                            >
                              {saved
                                ? 'Remove this caption from the saved ones'
                                : 'Save this caption'}
                            </button>
                            <button
                              type="button"
                              className={SMALL_BUTTON}
                              disabled={
                                !canSimplify ||
                                simplifyJob?.status === 'running'
                              }
                              onClick={() => onSimplify(candidate, i)}
                            >
                              {simplifyJob?.status === 'running'
                                ? 'Simplifying this caption…'
                                : simplifyJob
                                  ? 'Simplify this caption, again'
                                  : 'Simplify this caption'}
                            </button>
                            <button
                              type="button"
                              className={SMALL_BUTTON}
                              disabled={
                                !canFindTerms || termsJob?.status === 'running'
                              }
                              onClick={() => onFindTerms(candidate, i)}
                            >
                              {termsJob?.status === 'running'
                                ? 'Finding images to search for…'
                                : termsJob
                                  ? 'Find images to search for, again'
                                  : 'Find images to search for this caption'}
                            </button>
                          </div>
                          {simplifyJob ? (
                            <SimplifiedBlock
                              job={simplifyJob}
                              onSaveVersion={(version) =>
                                onSaveSimplified(candidate, i, version)
                              }
                              isVersionSaved={(versionId) =>
                                isFavorite(simplifiedCaptionId(id, versionId))
                              }
                            />
                          ) : null}
                          {termsJob ? <ImageTermsBlock job={termsJob} /> : null}
                        </>
                      )
                    })()}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      <div>
        <button type="button" className={SMALL_BUTTON} onClick={onToggle}>
          {isOpen ? 'Hide' : 'Show'} the comic machinery behind these captions
        </button>
        {isOpen ? (
          <div className="mt-4">
            <dl className="grid gap-x-10 gap-y-4 sm:grid-cols-2">
            <Field term="How students recognize this persona">
              {analysis.persona?.persona_baseline}
            </Field>
            <Field term="Its role in the joke">
              {analysis.comic_relationship?.comic_role}
              {analysis.comic_relationship?.why_this_role_fits
                ? ` — ${analysis.comic_relationship.why_this_role_fits}`
                : ''}
            </Field>
            <Field term="What the joke makes ridiculous">
              {analysis.comic_relationship?.joke_target}
            </Field>
            <Field term="What it converts events into">
              {analysis.persona_processing?.persona_processing_rule}
            </Field>
            <Field term="What in this moment set it off">
              {analysis.persona_processing?.trigger_feature}
            </Field>
            <Field term="What it would say out loud">
              {analysis.response?.public_or_surface_response}
            </Field>
            <Field term="What it actually thinks">
              {analysis.response?.unfiltered_response}
            </Field>
            <Field term="The tension powering the jokes">
              {analysis.humor_engine?.comic_contradiction}
            </Field>
            <Field term="The comic move it used">
              {analysis.humor_engine?.comic_move}
              {analysis.humor_engine?.comic_move_explanation
                ? ` — ${analysis.humor_engine.comic_move_explanation}`
                : ''}
            </Field>
            <Field term="What actually changes for it">
              {analysis.stakes?.material_stake}
            </Field>
            <Field term="The new work it lands">
              {analysis.stakes?.downstream_burden}
            </Field>
            <Field term="The opening it gets">
              {analysis.stakes?.persona_opportunity}
            </Field>
            <Field term="Words and references it reaches for">
              {analysis.persona_material?.persona_specific_vocabulary?.join(
                ', '
              )}
            </Field>
            <Field term="Things it would visibly be doing">
              {analysis.persona_material?.visual_behaviors?.join('; ')}
            </Field>
            </dl>
            <div className="pt-5">
              <button
                type="button"
                className={SMALL_BUTTON}
                onClick={() => navigator.clipboard.writeText(rawText)}
              >
                Copy this premise&rsquo;s raw JSON
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function PersonaFunnelClient({
  flavorId,
  steps,
}: {
  flavorId: number
  steps: PovStep[]
}) {
  const findPovsStep = steps.find((s) => s.orderBy === 1) ?? null
  const writeJokesStep = steps.find((s) => s.orderBy === 2) ?? null
  const imageTermsStep = steps.find((s) => s.orderBy === 3) ?? null
  const simplifyStep = steps.find((s) => s.orderBy === 4) ?? null

  const [moment, setMoment] = useState('')
  const [eventContext, setEventContext] = useState('')
  const [personaLibrary, setPersonaLibrary] = useState(DEFAULT_PERSONA_LIBRARY)
  const [showPersonaLibrary, setShowPersonaLibrary] = useState(false)

  const [step1Running, setStep1Running] = useState(false)
  const [step1Raw, setStep1Raw] = useState('')
  const [step1Error, setStep1Error] = useState<string | null>(null)
  const [showStep1Raw, setShowStep1Raw] = useState(false)
  const [showRejected, setShowRejected] = useState(false)

  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [jobs, setJobs] = useState<Record<string, JokeJob>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [restored, setRestored] = useState(false)
  const [step1PromptHash, setStep1PromptHash] = useState('')
  const [step1FinishedAt, setStep1FinishedAt] = useState('')
  const [imageTerms, setImageTerms] = useState<Record<string, CaptionJob>>({})
  const [simplified, setSimplified] = useState<Record<string, CaptionJob>>({})
  const [favorites, setFavorites] = useState<Favorite[]>([])
  // What the browser storage actually did, so a cache that is not working is
  // visible instead of looking like a page that was never run.
  const [storageNote, setStorageNote] = useState<string | null>(null)
  const saveTimer = useRef<number | null>(null)
  // What is currently typed in each saved caption's embed box, and what went
  // wrong with the last paste. Drafts are per-session; only the parsed src
  // ends up on the favorite and in storage.
  const [embedDrafts, setEmbedDrafts] = useState<Record<string, string>>({})
  const [embedErrors, setEmbedErrors] = useState<Record<string, string>>({})

  const attachEmbed = useCallback(
    (favoriteId: string) => {
      const result = parseEmbed(embedDrafts[favoriteId] ?? '')
      if ('error' in result) {
        setEmbedErrors((prev) => ({ ...prev, [favoriteId]: result.error }))
        return
      }
      setEmbedErrors((prev) => {
        const next = { ...prev }
        delete next[favoriteId]
        return next
      })
      setFavorites((prev) =>
        prev.map((favorite) =>
          favorite.id === favoriteId
            ? {
                ...favorite,
                embedSrc: result.src,
                embedTitle: result.title,
                embedKind: result.kind,
              }
            : favorite
        )
      )
      setEmbedDrafts((prev) => ({ ...prev, [favoriteId]: '' }))
    },
    [embedDrafts]
  )

  const chooseKlipyResult = useCallback(
    (favoriteId: string, result: KlipyResult) => {
      setFavorites((prev) =>
        prev.map((favorite) =>
          favorite.id === favoriteId
            ? {
                ...favorite,
                embedSrc: result.fullUrl,
                embedTitle: result.title,
                embedKind: result.fullKind,
              }
            : favorite
        )
      )
      setEmbedErrors((prev) => {
        const next = { ...prev }
        delete next[favoriteId]
        return next
      })
    },
    []
  )

  // Step 3's search terms for one caption, flattened for the GIF search — the
  // recommended concept's best queries first, then the rest.
  const suggestedTermsFor = useCallback(
    (favoriteId: string): string[] => {
      const job = imageTerms[favoriteId]
      if (job?.status !== 'done' || !job.text) return []
      const parsed = parseJson<Step3Output>(job.text)
      if (!parsed) return []
      const best = parsed.recommended_concept?.best_search_terms ?? []
      const rest = (parsed.image_concepts ?? []).flatMap(
        (concept) => concept.search_terms ?? []
      )
      return Array.from(new Set([...best, ...rest])).slice(0, 12)
    },
    [imageTerms]
  )

  const removeEmbed = useCallback((favoriteId: string) => {
    setFavorites((prev) =>
      prev.map((favorite) =>
        favorite.id === favoriteId
          ? {
              ...favorite,
              embedSrc: undefined,
              embedTitle: undefined,
              embedKind: undefined,
            }
          : favorite
      )
    )
  }, [])

  const storageKey = `persona-funnel:${flavorId}`
  // Favorites are deliberately NOT in the run cache: they survive "Clear the
  // saved run" and accumulate across different moments.
  const favoritesKey = `persona-funnel-favorites:${flavorId}`

  // The prompts actually stored in the DB right now. A cached output whose
  // hash no longer matches was produced by a prompt that has since been
  // edited — worth saying out loud rather than silently showing stale work.
  const currentStep1Hash = useMemo(
    () =>
      findPovsStep
        ? promptHash([findPovsStep.systemPrompt, findPovsStep.userPrompt])
        : '',
    [findPovsStep]
  )
  const currentStep2Hash = useMemo(
    () =>
      writeJokesStep
        ? promptHash([writeJokesStep.systemPrompt, writeJokesStep.userPrompt])
        : '',
    [writeJokesStep]
  )
  const currentStep3Hash = useMemo(
    () =>
      imageTermsStep
        ? promptHash([imageTermsStep.systemPrompt, imageTermsStep.userPrompt])
        : '',
    [imageTermsStep]
  )
  const currentStep4Hash = useMemo(
    () =>
      simplifyStep
        ? promptHash([simplifyStep.systemPrompt, simplifyStep.userPrompt])
        : '',
    [simplifyStep]
  )

  // Restore the last run for this flavor: step 1 and the per-premise step 2 calls
  // are expensive enough that losing them to a reload is a real cost.
  //
  // Every storage failure here used to be swallowed by a bare catch, which
  // made "the browser refused to store this" and "you never ran anything"
  // look identical on screen. Both paths now record what happened.
  useEffect(() => {
    let cancelled = false
    const restore = async () => {
      try {
        // IndexedDB is the store; anything still in localStorage from before
        // the switch is migrated in and deleted, which also hands its space
        // back to the origin's shared 5 MB budget.
        let saved = await loadRecord<Partial<SavedState>>(storageKey)
        if (!saved) {
          const legacy = migrateFromLocalStorage<Partial<SavedState>>(storageKey)
          if (legacy) {
            saved = legacy
            if (legacy.step1Raw) await saveRecord(storageKey, legacy)
          }
        }
        if (cancelled) return
        if (!saved) {
          setStorageNote(
            'No saved run found in this browser for this flavor. A run is saved automatically once step 1 finishes.'
          )
        }
        if (saved) {
        setStorageNote(
          saved.step1Raw
            ? null
            : 'A saved run was found but it contained no step 1 output.'
        )
        if (saved.moment) setMoment(saved.moment)
        if (saved.eventContext) setEventContext(saved.eventContext)
        if (saved.personaLibrary) setPersonaLibrary(saved.personaLibrary)
        if (saved.step1Raw) setStep1Raw(saved.step1Raw)
        if (saved.step1PromptHash) setStep1PromptHash(saved.step1PromptHash)
        if (saved.step1FinishedAt) setStep1FinishedAt(saved.step1FinishedAt)
        if (saved.imageTerms) {
          setImageTerms(
            Object.fromEntries(
              Object.entries(saved.imageTerms).filter(
                ([, job]) => job.status !== 'running'
              )
            )
          )
        }
        if (saved.simplified) {
          setSimplified(
            Object.fromEntries(
              Object.entries(saved.simplified).filter(
                ([, job]) => job.status !== 'running'
              )
            )
          )
        }
        if (saved.jobs) {
          // A call that was still in flight when the page went away can never
          // report back. Restoring it as "running" would disable every button
          // on the page forever, so it is restored as an explicit failure the
          // user can retry.
          setJobs(
            Object.fromEntries(
              Object.entries(saved.jobs).map(([name, job]) => [
                name,
                job.status === 'running' || job.status === 'queued'
                  ? {
                      ...job,
                      status: 'failed' as const,
                      error:
                        'This call was still running when the page reloaded, so its result was lost. Run this premise again.',
                    }
                  : job,
              ])
            )
          )
        }
        }
      } catch (err) {
        if (!cancelled) {
          setStorageNote(
            `A saved run exists but could not be read back: ${
              err instanceof Error ? err.message : String(err)
            }. It will be replaced by your next run.`
          )
        }
      }
      try {
        const savedFavorites =
          (await loadRecord<Favorite[]>(favoritesKey)) ??
          migrateFromLocalStorage<Favorite[]>(favoritesKey)
        if (!cancelled && savedFavorites?.length) setFavorites(savedFavorites)
      } catch {
        // A bad favorites record should not take the page down with it.
      }
      if (!cancelled) setRestored(true)
    }
    void restore()
    return () => {
      cancelled = true
    }
  }, [storageKey, favoritesKey])

  useEffect(() => {
    if (!restored) return
    void saveRecord(favoritesKey, favorites).catch(() => {
      // Favorites are tiny; a failure here is not worth a page-level message.
    })
  }, [restored, favoritesKey, favorites])

  useEffect(() => {
    if (!restored) return
    // Never let empty in-memory state overwrite a stored run. Without this, a
    // single failed restore (corrupt blob, a read that threw) is immediately
    // followed by a write of blank state — turning a recoverable glitch into
    // permanent loss of an expensive run. Clearing is explicit, via
    // clearSavedRun, which removes the key itself.
    const hasSomethingToSave =
      Boolean(step1Raw) || Boolean(moment.trim()) || Object.keys(jobs).length > 0
    if (!hasSomethingToSave) return

    // Typing in the moment box fires this on every keystroke; IndexedDB writes
    // are async and the payload is large, so coalesce them.
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          // The rule that matters: a payload WITHOUT step-1 output must never
          // replace a stored one that HAS it. This is what destroyed a run —
          // the stored record was overwritten by a stub holding only the
          // moment and the persona library. Explicit clearing still works,
          // because clearSavedRun deletes the record first, leaving nothing
          // to protect.
          if (!step1Raw) {
            const existing = await loadRecord<Partial<SavedState>>(storageKey)
            if (existing?.step1Raw) return
          }
          const payload: SavedState = {
            moment,
            eventContext,
            personaLibrary,
            step1Raw,
            step1PromptHash,
            step1FinishedAt,
            jobs,
            imageTerms,
            simplified,
          }
          await saveRecord(storageKey, payload)
          setStorageNote(null)
        } catch (err) {
          // The page keeps working when this fails, so the only symptom would
          // otherwise be a reload that silently loses the run.
          const quota = await describeQuota()
          setStorageNote(
            `This run could NOT be saved in your browser, so reloading will lose it: ${
              err instanceof Error ? err.message : String(err)
            }${quota ? ` (${quota})` : ''}`
          )
        }
      })()
    }, 400)
  }, [
    restored,
    storageKey,
    moment,
    eventContext,
    personaLibrary,
    step1Raw,
    step1PromptHash,
    step1FinishedAt,
    jobs,
    imageTerms,
    simplified,
  ])

  const clearSavedRun = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    void deleteRecord(storageKey).catch(() => {
      // Nothing to do — the in-memory reset below is what matters.
    })
    setStep1Raw('')
    setStep1PromptHash('')
    setStep1FinishedAt('')
    setStep1Error(null)
    setChecked({})
    setJobs({})
    setExpanded({})
    setImageTerms({})
    setSimplified({})
    // The moment and its context go too: "clear the last run" means the
    // page is ready for a NEW moment, not a re-run of the old one.
    setMoment('')
    setEventContext('')
    // Favorites are intentionally left alone — they are the keepers.
  }, [storageKey])

  // Whether there is anything from a past run on the page to clear.
  const hasRunToClear =
    Boolean(step1Raw) || Boolean(moment.trim()) || Boolean(eventContext.trim()) || Object.keys(jobs).length > 0

  const toggleFavorite = useCallback(
    (premise: Premise, candidate: JokeCandidate, index: number) => {
      const id = captionId(premise.ideaId, index)
      setFavorites((prev) => {
        if (prev.some((f) => f.id === id)) {
          return prev.filter((f) => f.id !== id)
        }
        return [
          {
            id,
            caption: (candidate.caption ?? '').trim(),
            persona: premise.personaName,
            // The premise is recorded in the angle name, because a saved
            // caption outlives the run and the persona alone no longer says
            // which of that persona's several jokes this one was.
            angleName: `${candidate.angle_name ?? `Angle ${index + 1}`} · ${
              premise.path?.concern ?? premise.idea.core_comic_idea ?? ''
            }`,
            moment: moment.trim(),
            totalScore: candidateTotal(candidate),
            savedAt: new Date().toISOString(),
            source: 'step2',
          },
          ...prev,
        ]
      })
    },
    [moment]
  )

  // Saves one of step 4's shorter rewrites alongside the originals. It keeps
  // the id of the caption it came from, so section 4 can say which caption it
  // is a simplification of.
  const saveSimplified = useCallback(
    (
      sourceId: string,
      personaName: string,
      angleName: string,
      version: SimplifiedVersion
    ) => {
      const caption = (version.caption ?? '').trim()
      if (!caption || typeof version.id !== 'number') return
      const id = simplifiedCaptionId(sourceId, version.id)
      setFavorites((prev) => {
        if (prev.some((f) => f.id === id)) return prev
        return [
          {
            id,
            caption,
            persona: personaName,
            angleName: `${angleName} · simplified (${
              SIMPLIFICATION_LEVELS[version.simplification_level ?? ''] ??
              version.simplification_level ??
              'shorter'
            })`,
            moment: moment.trim(),
            totalScore: simplifiedTotal(version),
            savedAt: new Date().toISOString(),
            source: 'simplified',
          },
          ...prev,
        ]
      })
    },
    [moment]
  )

  // Both optional per-caption steps take the same {{JOKE_OUTPUT}}: the caption
  // plus whatever step 2 said around it — the persona, the mechanism, and step
  // 2's own image idea (which step 3 is asked to critique and step 4 is told
  // not to touch). Step 4 is also handed the moment, since it is asked to keep
  // the joke event-specific.
  const runCaptionStep = useCallback(
    async (
      step: PovStep,
      input: CaptionInput,
      setJobs: React.Dispatch<React.SetStateAction<Record<string, CaptionJob>>>,
      hash: string,
      failureLabel: string
    ) => {
      if (!input.caption) return
      setJobs((prev) => ({
        ...prev,
        [input.id]: { captionId: input.id, status: 'running' },
      }))
      const filled = fillTemplate(step.userPrompt, {
        JOKE_OUTPUT: JSON.stringify(jokeOutputFor(input, moment), null, 2),
      })
      const res = await runStepAction({
        imageId: null,
        systemPrompt: step.systemPrompt,
        userPrompt: filled,
        providerModelId: step.providerModelId,
        temperature: step.temperature,
        includeImage: false,
        isTemperatureSupported: step.isTemperatureSupported,
        priorOutputs: {},
        reasoningEffort: REASONING_EFFORT,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      })
      setJobs((prev) => ({
        ...prev,
        [input.id]: {
          captionId: input.id,
          status: res.ok ? 'done' : 'failed',
          text: res.ok ? res.text ?? '' : undefined,
          error: res.ok ? undefined : res.error ?? failureLabel,
          promptHash: hash,
          finishedAt: new Date().toISOString(),
        },
      }))
    },
    [moment]
  )

  // Step 3, for ONE caption: searchable image concepts.
  const findImageTerms = useCallback(
    async (input: CaptionInput) => {
      if (!imageTermsStep) return
      await runCaptionStep(
        imageTermsStep,
        input,
        setImageTerms,
        currentStep3Hash,
        'Step 3 failed.'
      )
    },
    [imageTermsStep, runCaptionStep, currentStep3Hash]
  )

  // Step 4, for ONE caption: eight shorter versions of the same joke.
  const simplifyCaption = useCallback(
    async (input: CaptionInput) => {
      if (!simplifyStep) return
      await runCaptionStep(
        simplifyStep,
        input,
        setSimplified,
        currentStep4Hash,
        'Step 4 failed.'
      )
    },
    [simplifyStep, runCaptionStep, currentStep4Hash]
  )

  const step1Parsed = useMemo(
    () => (step1Raw ? parseJson<Step1Output>(step1Raw) : null),
    [step1Raw]
  )
  // Step 1 emits ids everywhere and objects in one place each, so every id has
  // to be resolved before anything can be rendered. These are the lookups.
  const byId = useMemo(() => {
    const index = <T,>(rows: T[] | undefined, key: keyof T) => {
      const map = new Map<string, T>()
      ;(rows ?? []).forEach((row) => {
        const id = row?.[key]
        if (typeof id === 'string' && id) map.set(id, row)
      })
      return map
    }
    return {
      moments: index(step1Parsed?.event?.event_moments, 'moment_id'),
      personas: index(step1Parsed?.personas, 'persona_id'),
      activations: index(step1Parsed?.activations, 'activation_id'),
      paths: index(step1Parsed?.processing_paths, 'path_id'),
      ideas: index(step1Parsed?.ideas, 'idea_id'),
    }
  }, [step1Parsed])

  // The personas step 1 finally chose, in the order it listed them. A selected
  // id with no matching persona object is dropped rather than rendered as a
  // blank row — the broken-reference count in section 1 is what reports it.
  const selectedPersonas = useMemo(
    () =>
      (step1Parsed?.selected_persona_ids ?? [])
        .map((id) => byId.personas.get(id))
        .filter((p): p is FunnelPersona => Boolean(p?.persona?.trim())),
    [step1Parsed, byId]
  )

  // The page's real unit of work: every premise selected for every selected
  // persona, flattened, with its activation, moment, and processing path
  // resolved. Selections for personas that did not make the final cut are
  // skipped — step 1 selects premises for the whole shortlist, but only the
  // selected personas are offered for joke-writing.
  const premises = useMemo(() => {
    const selectionsByPersona = new Map<string, PremiseSelection>()
    ;(step1Parsed?.persona_premise_selections ?? []).forEach((selection) => {
      if (selection.persona_id) {
        selectionsByPersona.set(selection.persona_id, selection)
      }
    })
    const rows: Premise[] = []
    selectedPersonas.forEach((persona) => {
      const personaId = persona.persona_id ?? ''
      const selection = selectionsByPersona.get(personaId)
      ;(selection?.selected_idea_ids ?? []).forEach((ideaId) => {
        const idea = byId.ideas.get(ideaId)
        if (!idea) return
        const activation = byId.activations.get(idea.activation_id ?? '') ?? null
        rows.push({
          ideaId,
          idea,
          persona,
          personaName: persona.persona ?? '',
          personaId,
          activation,
          moment: byId.moments.get(activation?.moment_id ?? '') ?? null,
          path: byId.paths.get(idea.path_id ?? '') ?? null,
        })
      })
    })
    return rows
  }, [step1Parsed, selectedPersonas, byId])

  // The same premises grouped for display: one block per persona, in the order
  // step 1 selected the personas.
  const premisesByPersona = useMemo(
    () =>
      selectedPersonas.map((persona) => ({
        persona,
        selection:
          (step1Parsed?.persona_premise_selections ?? []).find(
            (s) => s.persona_id === persona.persona_id
          ) ?? null,
        rows: premises.filter((p) => p.personaId === persona.persona_id),
      })),
    [selectedPersonas, premises, step1Parsed]
  )

  // References step 1 emitted that resolve to nothing. Counted rather than
  // silently dropped: a broken id means part of the derivation is unreadable,
  // and that is a prompt problem worth seeing on the page.
  const brokenReferences = useMemo(() => {
    if (!step1Parsed) return [] as string[]
    const problems: string[] = []
    ;(step1Parsed.selected_persona_ids ?? []).forEach((id) => {
      if (!byId.personas.has(id)) {
        problems.push(`selected_persona_ids names "${id}", which is not in personas`)
      }
    })
    ;(step1Parsed.persona_premise_selections ?? []).forEach((selection) => {
      ;(selection.selected_idea_ids ?? []).forEach((id) => {
        if (!byId.ideas.has(id)) {
          problems.push(
            `${selection.persona_id ?? 'a selection'} names premise "${id}", which is not in ideas`
          )
        }
      })
    })
    ;(step1Parsed.ideas ?? []).forEach((idea) => {
      if (idea.activation_id && !byId.activations.has(idea.activation_id)) {
        problems.push(
          `premise "${idea.idea_id}" names activation "${idea.activation_id}", which does not exist`
        )
      }
      if (idea.path_id && !byId.paths.has(idea.path_id)) {
        problems.push(
          `premise "${idea.idea_id}" names path "${idea.path_id}", which does not exist`
        )
      }
    })
    return problems
  }, [step1Parsed, byId])

  const checkedPremises = useMemo(
    () => premises.filter((p) => checked[p.ideaId]),
    [premises, checked]
  )

  const runFindPovs = useCallback(async () => {
    if (!findPovsStep || !moment.trim()) return
    setStep1Running(true)
    setStep1Error(null)
    const filled = fillTemplate(findPovsStep.userPrompt, {
      EVENT: moment.trim(),
      EVENT_CONTEXT: eventContext.trim() || 'None provided.',
      PERSONAS: personaLibrary.trim(),
    })
    const res = await runStepAction({
      imageId: null,
      systemPrompt: findPovsStep.systemPrompt,
      userPrompt: filled,
      providerModelId: findPovsStep.providerModelId,
      temperature: findPovsStep.temperature,
      includeImage: false,
      isTemperatureSupported: findPovsStep.isTemperatureSupported,
      priorOutputs: {},
      reasoningEffort: REASONING_EFFORT,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    })
    setStep1Running(false)
    if (!res.ok) {
      setStep1Error(res.error ?? 'Step 1 failed.')
      return
    }
    setStep1Raw(res.text ?? '')
    setStep1PromptHash(currentStep1Hash)
    setStep1FinishedAt(new Date().toISOString())
    // A fresh roster invalidates the old picks and the old jokes.
    setChecked({})
    setJobs({})
    setExpanded({})
  }, [findPovsStep, moment, eventContext, personaLibrary, currentStep1Hash])

  const runOnePremise = useCallback(
    async (premise: Premise) => {
      const name = premise.personaName.trim()
      if (!writeJokesStep || !premise.ideaId) return
      setJobs((prev) => ({
        ...prev,
        [premise.ideaId]: {
          premiseId: premise.ideaId,
          personaName: name,
          status: 'running',
        },
      }))
      // Two separate bindings, because step 2 treats them differently. The
      // persona context is the REUSABLE half — who this is across any event —
      // and the comic idea is the FIXED half that this call has to execute.
      // Flattening them into one blob is what lets step 2 quietly drift onto a
      // different premise, which is the whole failure this pipeline exists to
      // stop.
      const context = {
        persona_baseline: premise.persona.persona_baseline ?? null,
        general_processing_rule: premise.persona.general_processing_rule ?? null,
        source: premise.persona.source ?? null,
        persona_scores: premise.persona.persona_scores ?? null,
      }
      const comicIdea = {
        core_comic_idea: premise.idea.core_comic_idea ?? null,
        comic_translation: premise.idea.comic_translation ?? null,
        comic_contradiction: premise.idea.comic_contradiction ?? null,
        likely_joke_target: premise.idea.likely_joke_target ?? null,
        comic_role: premise.idea.comic_role ?? null,
        visual_primitives: premise.idea.visual_primitives ?? [],
        // The moment and concern this premise came out of, so step 2 can be
        // concrete about the event without going looking for a new angle.
        event_moment: premise.moment?.moment ?? null,
        moment_concrete_features: premise.moment?.concrete_features ?? [],
        what_triggers_this_persona: premise.activation?.trigger_feature ?? null,
        persona_translation: premise.activation?.persona_translation ?? null,
        persona_concern: premise.path?.concern ?? null,
        processing_path: premise.path?.processing_path ?? null,
      }
      const filled = fillTemplate(writeJokesStep.userPrompt, {
        EVENT: moment.trim(),
        PERSONA: name,
        PERSONA_CONTEXT: JSON.stringify(context, null, 2),
        COMIC_IDEA: JSON.stringify(comicIdea, null, 2),
      })
      const startedAt = Date.now()
      const res = await runStepAction({
        imageId: null,
        systemPrompt: writeJokesStep.systemPrompt,
        userPrompt: filled,
        providerModelId: writeJokesStep.providerModelId,
        temperature: writeJokesStep.temperature,
        includeImage: false,
        isTemperatureSupported: writeJokesStep.isTemperatureSupported,
        priorOutputs: {},
        reasoningEffort: REASONING_EFFORT,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      })
      const durationMs = Date.now() - startedAt
      const finishedAt = new Date().toISOString()
      setJobs((prev) => ({
        ...prev,
        [premise.ideaId]: res.ok
          ? {
              premiseId: premise.ideaId,
              personaName: name,
              status: 'done',
              text: res.text ?? '',
              durationMs,
              promptHash: currentStep2Hash,
              finishedAt,
            }
          : {
              premiseId: premise.ideaId,
              personaName: name,
              status: 'failed',
              error: res.error ?? 'Step 2 failed.',
              durationMs,
              promptHash: currentStep2Hash,
              finishedAt,
            },
      }))
      // The captions render on their own; only the machinery behind them is
      // collapsible, and it stays collapsed until asked for.
    },
    [writeJokesStep, moment, currentStep2Hash]
  )

  // Runs the picked premises a few at a time. Nothing here starts on its own —
  // every call into this comes from a button press.
  const runManyPremises = useCallback(
    async (queue: Premise[]) => {
      if (!queue.length) return
      setJobs((prev) => {
        const next = { ...prev }
        queue.forEach((p) => {
          next[p.ideaId] = {
            premiseId: p.ideaId,
            personaName: p.personaName,
            status: 'queued',
          }
        })
        return next
      })
      let cursor = 0
      const worker = async (): Promise<void> => {
        while (cursor < queue.length) {
          const index = cursor
          cursor += 1
          await runOnePremise(queue[index])
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker)
      )
    },
    [runOnePremise]
  )

  const anyRunning = Object.values(jobs).some(
    (j) => j.status === 'running' || j.status === 'queued'
  )
  const step1Stale = Boolean(
    step1Raw && step1PromptHash && step1PromptHash !== currentStep1Hash
  )

  const ranPremises = premises.filter((p) => jobs[p.ideaId])

  const statusNote = (premiseId: string): string => {
    const status = jobs[premiseId]?.status ?? 'not-run'
    if (status === 'done') return 'captions written'
    if (status === 'failed') return 'failed'
    if (status === 'running' || status === 'queued') return 'running'
    return 'not run yet'
  }

  // A premise is too long to be a nav label, so the label is its persona
  // concern where step 1 gave one and the first few words of the premise
  // otherwise — either way it says which of the persona's premises this is.
  const premiseLabel = (premise: Premise): string => {
    const concern = premise.path?.concern?.trim()
    if (concern) return concern
    const idea = premise.idea.core_comic_idea?.trim() ?? ''
    return idea.length > 52 ? `${idea.slice(0, 52)}…` : idea || premise.ideaId
  }

  const navEntries: NavEntry[] = [
    {
      id: 'describe-the-moment',
      label: '1. Describe the moment you want jokes about',
      note: moment.trim() ? undefined : 'Nothing typed yet',
      children: [],
    },
    {
      id: 'choose-premises',
      label: '2. Choose which comic premises get written into captions',
      note: premises.length
        ? `${premises.length} premise${
            premises.length === 1 ? '' : 's'
          } across ${selectedPersonas.length} persona${
            selectedPersonas.length === 1 ? '' : 's'
          }, ${checkedPremises.length} checked`
        : 'Run step 1 first',
      children: premisesByPersona.map(({ persona, rows }) => ({
        id: `choose-${slugify(persona.persona_id ?? persona.persona ?? '')}`,
        label: persona.persona ?? '',
        note: `${rows.length} premise${rows.length === 1 ? '' : 's'}`,
        children: rows.map((premise) => ({
          id: `choose-premise-${slugify(premise.ideaId)}`,
          label: premiseLabel(premise),
          note: statusNote(premise.ideaId),
          children: [],
        })),
      })),
    },
    {
      id: 'read-the-jokes',
      label: '3. Read the captions each premise produced',
      note: ranPremises.length
        ? `${ranPremises.length} premise${
            ranPremises.length === 1 ? '' : 's'
          } run`
        : 'Nothing run yet',
      children: premisesByPersona
        .filter(({ rows }) => rows.some((p) => jobs[p.ideaId]))
        .map(({ persona, rows }) => ({
          id: `jokes-persona-${slugify(
            persona.persona_id ?? persona.persona ?? ''
          )}`,
          label: persona.persona ?? '',
          children: rows
            .filter((p) => jobs[p.ideaId])
            .map((premise) => ({
              id: `jokes-${slugify(premise.ideaId)}`,
              label: premiseLabel(premise),
              children: [],
            })),
        })),
    },
    {
      id: 'saved-captions',
      label: '4. Keep the captions worth using',
      note: favorites.length
        ? `${favorites.length} caption${favorites.length === 1 ? '' : 's'} saved`
        : 'Nothing saved yet',
      children: favorites.map((favorite) => ({
        id: `saved-${favorite.id.replace('#', '-')}`,
        label: favorite.caption.slice(0, 48) + (favorite.caption.length > 48 ? '…' : ''),
        note:
          [
            simplified[favorite.id]?.status === 'done'
              ? 'simplified'
              : null,
            imageTerms[favorite.id]?.status === 'done'
              ? 'image concepts found'
              : null,
          ]
            .filter(Boolean)
            .join(' · ') || undefined,
        children: [],
      })),
    },
    ...(step1Parsed
      ? [
          {
            id: 'how-step-1-narrowed-down',
            label: 'Reference: how step 1 narrowed the moment down',
            note: 'moments, every persona it scanned, and what it threw away',
            children: [
              {
                id: 'reference-moments',
                label: 'The moments it broke the event into',
                children: [],
              },
              {
                id: 'reference-personas',
                label: 'Every persona it scanned and scored',
                children: [],
              },
              {
                id: 'reference-duplicates',
                label: 'The premises it threw away as duplicates',
                children: [],
              },
            ],
          },
        ]
      : []),
  ]

  const modelLine = findPovsStep
    ? `${findPovsStep.modelName} (${findPovsStep.providerModelId}) at ${REASONING_EFFORT} reasoning effort`
    : 'no model set'

  if (!findPovsStep || !writeJokesStep) {
    return (
      <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-400">
        This flavor needs at least two steps — step 1 to funnel the moment down
        to comic premises and step 2 to write captions executing one premise.
        Two further steps are optional and their buttons stay disabled without
        them: step 3 finds searchable image concepts for one caption, and step 4
        simplifies one caption into shorter versions. This flavor currently has{' '}
        {steps.length}.
      </div>
    )
  }

  return (
    <div className="flex gap-10">
      <PageNav entries={navEntries} onClear={clearSavedRun} canClear={hasRunToClear} />

      <div className="min-w-0 flex-1 space-y-10">
      {/* The one page-wide action, above the numbered steps: wipe the last run.
          Duplicated in the outline, which is hidden at narrow widths. */}
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          className={SMALL_BUTTON}
          disabled={!hasRunToClear}
          onClick={clearSavedRun}
        >
          Clear the last run and start a new moment
        </button>
        <span className="text-xs text-[rgb(var(--muted))]">
          {hasRunToClear
            ? 'Removes the moment, the premises, and every set of captions from this page and from this browser’s saved run. Saved captions in step 4 stay.'
            : 'Nothing from a past run is on the page.'}
        </span>
      </div>

      {/* 1 — the only input */}
      <section className={SECTION} id="describe-the-moment">
        <p className={SECTION_NUMBER}>Step 1 of 4</p>
        <h2 className={SECTION_TITLE}>Describe the moment you want jokes about</h2>
        <p className={GOAL_TEXT}>
          This is the page&rsquo;s only real input. Everything below is derived
          from the moment you type here. Step 1 breaks the moment into
          individual moments, works out which personas each one activates, and
          turns the strong pairings into separate comic premises — so what comes
          back is not a list of personas but a list of premises, three to five
          per persona, each of which can be written into captions on its own.
          The persona library underneath is a starting roster the model scans
          against the moment; it does not decide the answer, and the model
          invents personas of its own alongside it.
        </p>

        <div className="mt-6 max-w-3xl space-y-5">
          <div>
            <label className={FIELD_LABEL} htmlFor="pov-moment">
              The campus moment
            </label>
            <p className={FIELD_HELP}>
              One event, in as much detail as you have. Fills{' '}
              <code>{'{{EVENT}}'}</code> in both prompts.
            </p>
            <textarea
              id="pov-moment"
              className={`${TEXTAREA} mt-2`}
              rows={5}
              value={moment}
              onChange={(e) => setMoment(e.target.value)}
              placeholder="Columbia agrees to a $200M federal settlement…"
            />
          </div>

          <div>
            <label className={FIELD_LABEL} htmlFor="pov-context">
              Extra context about the moment (optional)
            </label>
            <p className={FIELD_HELP}>
              Background the model would not know. Fills{' '}
              <code>{'{{EVENT_CONTEXT}}'}</code> in the step-1 prompt; left
              empty it sends &ldquo;None provided.&rdquo;
            </p>
            <textarea
              id="pov-context"
              className={`${TEXTAREA} mt-2`}
              rows={3}
              value={eventContext}
              onChange={(e) => setEventContext(e.target.value)}
            />
          </div>

          <div>
            <button
              type="button"
              className="text-sm font-semibold text-[rgb(var(--accent-strong))] hover:underline"
              onClick={() => setShowPersonaLibrary((v) => !v)}
            >
              {showPersonaLibrary ? 'Hide' : 'Show'} the recurring persona
              library the model scores against (
              {personaLibrary.split('\n').filter((l) => l.trim()).length}{' '}
              personas)
            </button>
            {showPersonaLibrary ? (
              <>
                <p className={FIELD_HELP}>
                  One persona per line, each with its recurring comic logic.
                  Fills <code>{'{{PERSONAS}}'}</code> in the step-1 prompt.
                </p>
                <textarea
                  className={`${TEXTAREA} mt-2 font-mono text-xs`}
                  rows={10}
                  value={personaLibrary}
                  onChange={(e) => setPersonaLibrary(e.target.value)}
                />
                <button
                  type="button"
                  className={`${SMALL_BUTTON} mt-2`}
                  onClick={() => setPersonaLibrary(DEFAULT_PERSONA_LIBRARY)}
                >
                  Reset the library to the nine defaults
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <button
            type="button"
            className={BIG_BUTTON}
            disabled={step1Running || !moment.trim()}
            onClick={runFindPovs}
          >
            {step1Running
              ? 'Working out the premises…'
              : 'Find the comic premises worth writing'}
          </button>
          <span className="text-xs text-[rgb(var(--muted))]">
            One call to {modelLine}. This does not write any captions.
          </span>
        </div>

        {storageNote ? (
          <p className="mt-4 max-w-3xl rounded-lg bg-amber-500/10 p-3 text-sm leading-relaxed text-amber-700 dark:text-amber-400">
            <span className="font-semibold">Saved-run status: </span>
            {storageNote}
          </p>
        ) : null}

        {step1Error ? (
          <p className="mt-4 max-w-3xl rounded-lg bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
            Step 1 failed: {step1Error}
          </p>
        ) : null}
        {step1Raw && !step1Parsed ? (
          <p className="mt-4 max-w-3xl rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            Step 1 returned text that is not valid JSON, so no premises could be
            listed. This is the failure to watch for on this prompt: its output
            is large, and a run that gets cut off mid-object lands here. The raw
            output is below — if it ends mid-string, it was truncated rather
            than malformed.
          </p>
        ) : null}
        {step1Raw ? (
          <div className="mt-4">
            <button
              type="button"
              className="text-sm font-semibold text-[rgb(var(--accent-strong))] hover:underline"
              onClick={() => setShowStep1Raw((v) => !v)}
            >
              {showStep1Raw ? 'Hide' : 'Show'} the raw JSON step 1 returned
            </button>
            {showStep1Raw ? (
              <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-[rgb(var(--panel)/0.6)] p-3 text-xs dark:bg-[rgb(var(--panel)/0.3)]">
                {step1Raw}
              </pre>
            ) : null}
          </div>
        ) : null}

        {step1Parsed ? (
          <div className="mt-8 max-w-3xl space-y-4">
            {step1Stale ? (
              <p className="rounded-lg bg-amber-500/10 p-3 text-sm leading-relaxed text-amber-700 dark:text-amber-400">
                Step 1&rsquo;s prompt in the database has changed since these
                premises were generated, so what you see below came from
                an older version of the prompt. Run step 1 again to use the
                current one.
              </p>
            ) : null}

            {/* The answer, stated before any of step 1's working-out. */}
            <p className="text-lg font-semibold">
              {premises.length
                ? `Step 1 came out with ${premises.length} comic premise${
                    premises.length === 1 ? '' : 's'
                  } across ${selectedPersonas.length} persona${
                    selectedPersonas.length === 1 ? '' : 's'
                  }.`
                : 'Step 1 came out with no comic premises for this moment.'}{' '}
              {premises.length ? (
                <a
                  href="#choose-premises"
                  className="font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                >
                  Pick which premises get written into captions in section 2
                  below →
                </a>
              ) : null}
            </p>

            {/* How much was considered to get there — the funnel in one line. */}
            <p className="text-sm leading-relaxed text-[rgb(var(--muted))]">
              To get there it broke the moment into{' '}
              <span className="font-semibold text-[rgb(var(--ink))]">
                {step1Parsed.event?.event_moments?.length ?? 0} moments
              </span>
              , scanned{' '}
              <span className="font-semibold text-[rgb(var(--ink))]">
                {step1Parsed.personas?.length ?? 0} persona candidates
              </span>{' '}
              against every one of them, expanded{' '}
              {step1Parsed.shortlisted_persona_ids?.length ?? 0} of those into{' '}
              {step1Parsed.activations?.length ?? 0} strong moment activations
              and {step1Parsed.processing_paths?.length ?? 0} distinct concerns,
              wrote{' '}
              <span className="font-semibold text-[rgb(var(--ink))]">
                {step1Parsed.ideas?.length ?? 0} raw premises
              </span>
              , and threw away{' '}
              <span className="font-semibold text-[rgb(var(--ink))]">
                {(step1Parsed.semantic_deduplication ?? []).reduce(
                  (sum, entry) => sum + (entry.duplicate_idea_ids?.length ?? 0),
                  0
                )}{' '}
                of them
              </span>{' '}
              as different wordings of a premise it already had.{' '}
              <a
                href="#how-step-1-narrowed-down"
                className="font-semibold text-[rgb(var(--accent-strong))] hover:underline"
              >
                See that working-out at the bottom of the page →
              </a>
            </p>

            {brokenReferences.length ? (
              <div className="rounded-lg bg-amber-500/10 p-3 text-sm leading-relaxed text-amber-700 dark:text-amber-400">
                <p className="font-semibold">
                  {brokenReferences.length} reference
                  {brokenReferences.length === 1 ? '' : 's'} in step 1&rsquo;s
                  output point at something it never wrote down, so that much of
                  the derivation could not be read:
                </p>
                <ul className="mt-2 space-y-1">
                  {brokenReferences.slice(0, 8).map((problem, i) => (
                    <li key={i}>{problem}</li>
                  ))}
                </ul>
                {brokenReferences.length > 8 ? (
                  <p className="mt-2">
                    …and {brokenReferences.length - 8} more.
                  </p>
                ) : null}
              </div>
            ) : null}

            {step1FinishedAt ? (
              <p className="text-xs text-[rgb(var(--muted))]">
                {formatWhen(step1FinishedAt)}. This page keeps your latest run
                — the moment, the premises, and every set of captions — in this
                browser, so a reload does not cost you a re-run.{' '}
                <button
                  type="button"
                  className="font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                  onClick={clearSavedRun}
                >
                  Clear the saved run
                </button>
                .
              </p>
            ) : null}

            <details>
              <summary className="cursor-pointer text-sm font-semibold text-[rgb(var(--accent-strong))] hover:underline">
                Show what step 1 decided the event actually was, before it
                considered any persona — background, not the premises
              </summary>
              <div className="mt-3 space-y-3">
                {step1Parsed.event?.event_core ? (
                  <p className="text-sm leading-relaxed text-[rgb(var(--muted))]">
                    {step1Parsed.event.event_core}
                  </p>
                ) : null}
                {step1Parsed.event?.event_arc ? (
                  <div>
                    <p className="text-sm font-semibold">
                      How it read the event as unfolding
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-[rgb(var(--muted))]">
                      {step1Parsed.event.event_arc}
                    </p>
                  </div>
                ) : null}
              </div>
            </details>
          </div>
        ) : null}
      </section>

      {/* 2 — pick premises, then fan out */}
      <section className={SECTION} id="choose-premises">
        <p className={SECTION_NUMBER}>Step 2 of 4</p>
        <h2 className={SECTION_TITLE}>
          Choose which comic premises get written into captions
        </h2>
        <p className={GOAL_TEXT}>
          This is step 1&rsquo;s real answer: not a list of personas but a list
          of premises, grouped under the persona that produced them. A premise
          is one funny observation — the mismatch the joke runs on — and step 1
          has already checked that a persona&rsquo;s premises are genuinely
          different from each other rather than four wordings of one idea. Each
          premise you run is one separate call that writes five captions
          executing THAT premise, so picking two premises from one persona gets
          you two different jokes, not ten variations of the same one. Step 1
          returns more premises than you usually want to pay for, so nothing is
          written until you pick here.
        </p>

        {!premises.length ? (
          <p className="mt-6 max-w-3xl text-sm leading-relaxed text-[rgb(var(--muted))]">
            {!step1Raw
              ? 'No premises yet — run step 1 above first.'
              : !step1Parsed
                ? 'Step 1 returned text that is not valid JSON, so no premises could be read out of it. The raw output is in section 1.'
                : !selectedPersonas.length
                  ? 'Step 1 returned valid JSON, but its selected_persona_ids array was empty — it chose no personas for this moment. Check the raw output in section 1.'
                  : 'Step 1 selected personas but no premises for them: its persona_premise_selections array named no ideas that exist. Check the raw output in section 1.'}
          </p>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                type="button"
                className={BIG_BUTTON}
                disabled={anyRunning || !checkedPremises.length}
                onClick={() => runManyPremises(checkedPremises)}
              >
                Write captions for the {checkedPremises.length} premise
                {checkedPremises.length === 1 ? '' : 's'} I checked
              </button>
              <button
                type="button"
                className={SMALL_BUTTON}
                disabled={anyRunning}
                onClick={() =>
                  setChecked(
                    Object.fromEntries(premises.map((p) => [p.ideaId, true]))
                  )
                }
              >
                Check all {premises.length}
              </button>
              <button
                type="button"
                className={SMALL_BUTTON}
                disabled={anyRunning}
                onClick={() =>
                  // The highest-scoring premise for each persona: the cheapest
                  // run that still covers every lens step 1 selected.
                  setChecked(
                    Object.fromEntries(
                      premisesByPersona
                        .map(({ rows }) =>
                          rows
                            .slice()
                            .sort(
                              (a, b) =>
                                ideaTotal(b.idea.scores).total -
                                ideaTotal(a.idea.scores).total
                            )[0]
                        )
                        .filter(Boolean)
                        .map((p) => [p.ideaId, true])
                    )
                  )
                }
              >
                Check the best premise from each persona
              </button>
              <button
                type="button"
                className={SMALL_BUTTON}
                disabled={anyRunning}
                onClick={() => setChecked({})}
              >
                Uncheck all
              </button>
              <span className="text-xs text-[rgb(var(--muted))]">
                {CONCURRENCY} calls at a time, to {modelLine}.
              </span>
            </div>

            <div className="mt-10 space-y-14">
              {premisesByPersona.map(({ persona, selection, rows }) => {
                const personaKey = slugify(
                  persona.persona_id ?? persona.persona ?? ''
                )
                const { total, disagreesWith } = personaTotal(
                  persona.persona_scores
                )
                return (
                  <div
                    key={personaKey}
                    id={`choose-${personaKey}`}
                    className="max-w-3xl scroll-mt-6"
                  >
                    <h3 className="text-xl font-semibold">
                      {persona.persona}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--muted))]">
                      Step 1 scored this persona{' '}
                      <span className="font-semibold text-[rgb(var(--ink))]">
                        {total} out of 15
                      </span>{' '}
                      ({personaScoreLine(persona.persona_scores)})
                      {disagreesWith !== null ? (
                        <span>
                          {' '}
                          — step 1 reported {disagreesWith}, which is not the
                          sum of its own components, so the recomputed total is
                          shown
                        </span>
                      ) : null}
                      . It came from {describeSource(persona.source)}, and after
                      writing its premises step 1 judged it to have{' '}
                      {diversityWords(
                        persona.actual_premise_diversity ??
                          selection?.actual_premise_diversity
                      )}
                      .
                    </p>
                    {persona.general_processing_rule ? (
                      <p className="mt-2 text-sm leading-relaxed">
                        <span className="font-semibold">
                          What events become for this persona:{' '}
                        </span>
                        <span className="text-[rgb(var(--muted))]">
                          {persona.general_processing_rule}
                        </span>
                      </p>
                    ) : null}
                    {selection?.selection_reason ? (
                      <p className="mt-2 text-sm leading-relaxed">
                        <span className="font-semibold">
                          Why step 1 chose these {rows.length} premises:{' '}
                        </span>
                        <span className="text-[rgb(var(--muted))]">
                          {selection.selection_reason}
                        </span>
                      </p>
                    ) : null}

                    <ul className="mt-6 space-y-8">
                      {rows.map((premise) => {
                        const job = jobs[premise.ideaId]
                        const status = job?.status ?? 'not-run'
                        const idea = ideaTotal(premise.idea.scores)
                        return (
                          <li
                            key={premise.ideaId}
                            id={`choose-premise-${slugify(premise.ideaId)}`}
                            className="scroll-mt-6"
                          >
                            <div className="flex items-start gap-4">
                              <input
                                type="checkbox"
                                id={`premise-${premise.ideaId}`}
                                className="mt-1.5 h-4 w-4 shrink-0"
                                checked={Boolean(checked[premise.ideaId])}
                                disabled={anyRunning}
                                onChange={(e) =>
                                  setChecked((prev) => ({
                                    ...prev,
                                    [premise.ideaId]: e.target.checked,
                                  }))
                                }
                              />
                              <div className="min-w-0 flex-1 space-y-3">
                                {/* The premise itself is the thing being
                                    chosen, so it is the biggest text here —
                                    bigger than the persona's own fields. */}
                                <label
                                  htmlFor={`premise-${premise.ideaId}`}
                                  className="block text-base font-semibold leading-relaxed"
                                >
                                  {premise.idea.core_comic_idea ??
                                    '(step 1 returned this premise with no core_comic_idea)'}
                                </label>

                                <p className="text-sm text-[rgb(var(--muted))]">
                                  Scored{' '}
                                  <span className="font-semibold text-[rgb(var(--ink))]">
                                    {idea.total} out of 25
                                  </span>{' '}
                                  ({ideaScoreLine(premise.idea.scores)})
                                  {idea.disagreesWith !== null ? (
                                    <span>
                                      {' '}
                                      — step 1 reported {idea.disagreesWith},
                                      which is not the sum of its own components
                                    </span>
                                  ) : null}
                                  .
                                </p>

                                <dl className="space-y-3 pt-1">
                                  <Field term="The moment it comes out of">
                                    {premise.moment
                                      ? `${premise.moment.moment} — ${describeMomentType(
                                          premise.moment.moment_type
                                        )} of the event.`
                                      : null}
                                  </Field>
                                  <Field term="The persona concern it runs through">
                                    {premise.path?.processing_path ??
                                      premise.path?.concern}
                                  </Field>
                                  <Field term="The tension powering the joke">
                                    {premise.idea.comic_contradiction}
                                  </Field>
                                  <Field term="What ends up ridiculous">
                                    {premise.idea.likely_joke_target}
                                  </Field>
                                </dl>

                                {premise.idea.visual_primitives?.length ? (
                                  <div className="pt-1">
                                    <p className="text-sm font-semibold">
                                      Simple things you could see, for finding
                                      an image later
                                    </p>
                                    <TermChips
                                      terms={premise.idea.visual_primitives}
                                    />
                                  </div>
                                ) : null}

                                <div className="flex flex-wrap items-center gap-3 pt-3">
                                  <button
                                    type="button"
                                    className={SMALL_BUTTON}
                                    disabled={anyRunning}
                                    onClick={() => runOnePremise(premise)}
                                  >
                                    {status === 'done'
                                      ? 'Write captions for this premise again'
                                      : 'Write captions for this premise'}
                                  </button>
                                  <span className="text-xs text-[rgb(var(--muted))]">
                                    {status === 'not-run'
                                      ? 'Not run yet.'
                                      : status === 'queued'
                                        ? 'Waiting for a free slot…'
                                        : status === 'running'
                                          ? 'Writing captions…'
                                          : status === 'failed'
                                            ? `Failed: ${job?.error}`
                                            : `Captions written in ${Math.round(
                                                (job?.durationMs ?? 0) / 1000
                                              )}s — read them in section 3 below.`}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </section>

      {/* 3 — the captions */}
      <section className={SECTION} id="read-the-jokes">
        <p className={SECTION_NUMBER}>Step 3 of 4</p>
        <h2 className={SECTION_TITLE}>
          Read the captions each premise produced
        </h2>
        <p className={GOAL_TEXT}>
          One block per premise you ran, grouped under the persona it belongs
          to. Every block restates the premise it was asked to execute, so you
          can judge the five captions against it: all five are meant to be
          different executions of that one premise — different speaker, entry
          point, or image — rather than five different jokes. A caption that has
          wandered onto a different premise is a step-2 failure worth knowing
          about. Each block leads with the caption step 2 picked as its best,
          then all five with the angle and score of each. Any caption can be
          saved to section 4, or handed to either optional step: simplify, which
          keeps the comic idea and writes eight shorter versions of it, and
          image search, which turns it into simple GIF-searchable concepts and
          the queries to find them. The reasoning behind the captions is
          collapsed underneath.
        </p>

        {!Object.keys(jobs).length ? (
          <p className="mt-6 text-sm text-[rgb(var(--muted))]">
            No captions yet — pick premises in section 2 and press one of the
            write buttons.
          </p>
        ) : (
          <div className="mt-8 space-y-16">
            {premisesByPersona
              .filter(({ rows }) => rows.some((p) => jobs[p.ideaId]))
              .map(({ persona, rows }) => {
                const personaKey = slugify(
                  persona.persona_id ?? persona.persona ?? ''
                )
                const ran = rows.filter((p) => jobs[p.ideaId])
                return (
                  <div
                    key={personaKey}
                    id={`jokes-persona-${personaKey}`}
                    className="scroll-mt-6"
                  >
                    <h3 className="text-2xl font-semibold">
                      {persona.persona}
                    </h3>
                    <p className="mt-1 text-sm text-[rgb(var(--muted))]">
                      {ran.length} of this persona&rsquo;s {rows.length}{' '}
                      premise{rows.length === 1 ? '' : 's'} written into
                      captions.
                    </p>

                    <div className="mt-8 space-y-14">
                      {ran.map((premise) => {
                        const job = jobs[premise.ideaId]
                        const parsed = job.text
                          ? parseJson<Step2Output>(job.text)
                          : null
                        const isOpen = expanded[premise.ideaId] ?? false
                        // Everything downstream of a caption — saving it,
                        // simplifying it, searching an image for it — is keyed
                        // on the premise, so two premises from one persona
                        // never share a caption id.
                        const idFor = (index: number) =>
                          captionId(premise.ideaId, index)
                        const captionInput = (
                          candidate: JokeCandidate,
                          index: number
                        ): CaptionInput => ({
                          id: idFor(index),
                          caption: (candidate.caption ?? '').trim(),
                          personaName: premise.personaName,
                          angleName: candidate.angle_name,
                          jokeMechanism: candidate.joke_mechanism,
                          originalImage: candidate.image_situation,
                          analysis: parsed,
                        })
                        return (
                          <div
                            key={premise.ideaId}
                            id={`jokes-${slugify(premise.ideaId)}`}
                            className="max-w-3xl scroll-mt-6"
                          >
                            {/* The premise these five captions were supposed
                                to execute, restated so they can be judged
                                against it without scrolling back to
                                section 2. */}
                            <div className="border-l-2 border-[rgb(var(--gloss)/0.5)] pl-4 dark:border-[rgb(var(--gloss)/0.2)]">
                              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
                                The premise these captions execute
                              </p>
                              <p className="mt-2 text-base font-semibold leading-relaxed">
                                {premise.idea.core_comic_idea}
                              </p>
                              {premise.moment?.moment ? (
                                <p className="mt-1 text-sm text-[rgb(var(--muted))]">
                                  Out of {premise.moment.moment}
                                  {premise.path?.concern
                                    ? `, through this persona's concern with ${premise.path.concern}`
                                    : ''}
                                  .
                                </p>
                              ) : null}
                            </div>

                            <p className="mt-3 text-xs text-[rgb(var(--muted))]">
                              {job.status === 'done'
                                ? `${
                                    job.finishedAt
                                      ? `${formatWhen(job.finishedAt).toLowerCase()}, `
                                      : ''
                                  }in ${Math.round(
                                    (job.durationMs ?? 0) / 1000
                                  )}s`
                                : job.status === 'failed'
                                  ? 'failed'
                                  : job.status === 'running'
                                    ? 'writing…'
                                    : 'queued'}
                            </p>

                            {job.status === 'failed' ? (
                              <p className="mt-2 rounded-lg bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
                                {job.error}
                              </p>
                            ) : null}

                            {job.status === 'done' &&
                            job.promptHash &&
                            job.promptHash !== currentStep2Hash ? (
                              <p className="mt-2 rounded-lg bg-amber-500/10 p-3 text-sm leading-relaxed text-amber-700 dark:text-amber-400">
                                Step 2&rsquo;s prompt in the database has changed
                                since these captions were written. Run this
                                premise again to use the current prompt.
                              </p>
                            ) : null}

                            {job.text ? (
                              parsed ? (
                                <JokeResult
                                  analysis={parsed}
                                  personaName={premise.personaName}
                                  rawText={job.text}
                                  isOpen={isOpen}
                                  onToggle={() =>
                                    setExpanded((prev) => ({
                                      ...prev,
                                      [premise.ideaId]: !isOpen,
                                    }))
                                  }
                                  isFavorite={(id) =>
                                    favorites.some((f) => f.id === id)
                                  }
                                  onToggleFavorite={(candidate, index) =>
                                    toggleFavorite(premise, candidate, index)
                                  }
                                  termsJobs={imageTerms}
                                  onFindTerms={(candidate, index) =>
                                    findImageTerms(captionInput(candidate, index))
                                  }
                                  canFindTerms={Boolean(imageTermsStep)}
                                  simplifyJobs={simplified}
                                  onSimplify={(candidate, index) =>
                                    simplifyCaption(captionInput(candidate, index))
                                  }
                                  canSimplify={Boolean(simplifyStep)}
                                  onSaveSimplified={(candidate, index, version) =>
                                    saveSimplified(
                                      idFor(index),
                                      premise.personaName,
                                      candidate.angle_name ?? `Angle ${index + 1}`,
                                      version
                                    )
                                  }
                                />
                              ) : (
                                <>
                                  <p className="mt-3 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                                    This premise returned text that is not valid
                                    JSON, so the captions could not be laid out.
                                    The raw output is below.
                                  </p>
                                  <pre className="mt-3 max-h-[42rem] overflow-auto whitespace-pre-wrap rounded-lg bg-[rgb(var(--panel)/0.6)] p-4 text-xs leading-relaxed dark:bg-[rgb(var(--panel)/0.3)]">
                                    {job.text}
                                  </pre>
                                </>
                              )
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
          </div>
        )}
      </section>

      {/* 4 — the keepers */}
      <section className={SECTION} id="saved-captions">
        <p className={SECTION_NUMBER}>Step 4 of 4</p>
        <h2 className={SECTION_TITLE}>Keep the captions worth using</h2>
        <p className={GOAL_TEXT}>
          Every caption you saved, newest first, across every moment you have
          run on this flavor — these survive clearing a run and starting a new
          moment. Each one records the moment it came from, since that moment
          will not be on screen any more, and each can be simplified or handed
          to the image search on its own. A simplified caption you save lands
          here too, labelled with the caption it was cut down from.
        </p>

        {!favorites.length ? (
          <p className="mt-6 max-w-3xl text-sm leading-relaxed text-[rgb(var(--muted))]">
            Nothing saved yet. Every caption in section 3 has a &ldquo;Save this
            caption&rdquo; button.
          </p>
        ) : (
          <ul className="mt-8 space-y-14">
            {favorites.map((favorite) => {
              const termsJob = imageTerms[favorite.id]
              const simplifyJob = simplified[favorite.id]
              return (
                <li
                  key={favorite.id}
                  id={`saved-${favorite.id.replace('#', '-')}`}
                  className="max-w-3xl scroll-mt-6"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">
                    {favorite.persona} · {favorite.angleName}
                  </p>
                  <p className="mt-2.5 text-2xl font-semibold leading-snug">
                    &ldquo;{favorite.caption}&rdquo;
                  </p>

                  {favorite.embedSrc ? (
                    <>
                      <MemePreview
                        caption={favorite.caption}
                        embedSrc={favorite.embedSrc}
                        embedTitle={favorite.embedTitle}
                        embedKind={favorite.embedKind}
                        onRemove={() => removeEmbed(favorite.id)}
                      />
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          className={SMALL_BUTTON}
                          onClick={() => removeEmbed(favorite.id)}
                        >
                          Remove this GIF from the caption
                        </button>
                        <a
                          href={favorite.embedSrc}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                        >
                          Open the GIF on its own site →
                        </a>
                      </div>
                    </>
                  ) : null}

                  <GifSearch
                    favoriteId={favorite.id}
                    suggestedTerms={suggestedTermsFor(favorite.id)}
                    onChoose={(result) =>
                      chooseKlipyResult(favorite.id, result)
                    }
                  />

                  <EmbedInput
                    favoriteId={favorite.id}
                    value={embedDrafts[favorite.id] ?? ''}
                    onChange={(next) =>
                      setEmbedDrafts((prev) => ({
                        ...prev,
                        [favorite.id]: next,
                      }))
                    }
                    onAttach={() => attachEmbed(favorite.id)}
                    error={embedErrors[favorite.id]}
                    hasEmbed={Boolean(favorite.embedSrc)}
                  />

                  <dl className="mt-5 space-y-3">
                    <Field term="The moment it was written about">
                      {favorite.moment}
                    </Field>
                  </dl>
                  <p className="mt-3 text-xs text-[rgb(var(--muted))]">
                    {favorite.source === 'simplified'
                      ? `Step 4 scored this simplification ${favorite.totalScore} out of 25`
                      : `Step 2 scored it ${favorite.totalScore} out of 25`}{' '}
                    · {formatWhen(favorite.savedAt).replace('Generated', 'saved')}
                  </p>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className={SMALL_BUTTON}
                      disabled={
                        !simplifyStep || simplifyJob?.status === 'running'
                      }
                      onClick={() =>
                        simplifyCaption({
                          id: favorite.id,
                          caption: favorite.caption,
                          personaName: favorite.persona,
                          angleName: favorite.angleName,
                        })
                      }
                    >
                      {simplifyJob?.status === 'running'
                        ? 'Simplifying this caption…'
                        : simplifyJob
                          ? 'Simplify this caption, again'
                          : 'Simplify this caption'}
                    </button>
                    <button
                      type="button"
                      className={SMALL_BUTTON}
                      disabled={
                        !imageTermsStep || termsJob?.status === 'running'
                      }
                      onClick={() =>
                        findImageTerms({
                          id: favorite.id,
                          caption: favorite.caption,
                          personaName: favorite.persona,
                          angleName: favorite.angleName,
                        })
                      }
                    >
                      {termsJob?.status === 'running'
                        ? 'Finding images to search for…'
                        : termsJob
                          ? 'Find images to search for, again'
                          : 'Find images to search for this caption'}
                    </button>
                    <button
                      type="button"
                      className={SMALL_BUTTON}
                      onClick={() =>
                        navigator.clipboard.writeText(favorite.caption)
                      }
                    >
                      Copy the caption
                    </button>
                    <button
                      type="button"
                      className={SMALL_BUTTON}
                      onClick={() =>
                        setFavorites((prev) =>
                          prev.filter((f) => f.id !== favorite.id)
                        )
                      }
                    >
                      Remove from saved
                    </button>
                  </div>

                  {simplifyJob ? (
                    <SimplifiedBlock
                      job={simplifyJob}
                      onSaveVersion={(version) =>
                        saveSimplified(
                          favorite.id,
                          favorite.persona,
                          favorite.angleName,
                          version
                        )
                      }
                      isVersionSaved={(versionId) =>
                        favorites.some(
                          (f) =>
                            f.id === simplifiedCaptionId(favorite.id, versionId)
                        )
                      }
                    />
                  ) : null}
                  {termsJob ? <ImageTermsBlock job={termsJob} /> : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Reference — the funnel's working-out, none of it runnable */}
      {step1Parsed ? (
        <section className={SECTION} id="how-step-1-narrowed-down">
          <p className={SECTION_NUMBER}>Reference</p>
          <h2 className={SECTION_TITLE}>
            Review how step 1 narrowed the moment down to those premises
          </h2>
          <p className={GOAL_TEXT}>
            Nothing here can be run — it is the working-out behind section
            2&rsquo;s list, kept so you can tell whether a persona was missed or
            correctly dropped, and whether the premises it threw away as
            duplicates really were duplicates. Step 1 deliberately looks at far
            more than it keeps: it scans every persona candidate against every
            moment cheaply, then spends real reasoning only on the pairings that
            scored well.
          </p>
          <button
            type="button"
            className={`${SMALL_BUTTON} mt-6`}
            onClick={() => setShowRejected((v) => !v)}
          >
            {showRejected ? 'Hide' : 'Show'} the working-out
          </button>

          {showRejected ? (
            <div className="mt-8 max-w-3xl space-y-12">
              {/* The moments — the level everything else hangs off. */}
              <div id="reference-moments" className="scroll-mt-6">
                <h3 className="text-xl font-semibold">
                  The moments step 1 broke the event into
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--muted))]">
                  Each one is a separate point in the event that a persona can
                  react to. A persona reacting to two different moments is what
                  produces two genuinely different jokes rather than two
                  wordings of one.
                </p>
                {step1Parsed.event?.event_moments?.length ? (
                  <ul className="mt-5 space-y-5">
                    {step1Parsed.event.event_moments.map((moment) => (
                      <li key={moment.moment_id}>
                        <p className="text-base font-semibold">
                          {moment.moment}
                        </p>
                        <p className="mt-1 text-sm text-[rgb(var(--muted))]">
                          Step 1 called this {describeMomentType(moment.moment_type)}.
                        </p>
                        {moment.concrete_features?.length ? (
                          <p className="mt-1 text-sm leading-relaxed">
                            <span className="font-semibold">
                              What is observably true of it:{' '}
                            </span>
                            <span className="text-[rgb(var(--muted))]">
                              {moment.concrete_features.join('; ')}
                            </span>
                          </p>
                        ) : null}
                        {moment.comic_affordances?.length ? (
                          <p className="mt-1 text-sm leading-relaxed">
                            <span className="font-semibold">
                              What it could be funny about:{' '}
                            </span>
                            <span className="text-[rgb(var(--muted))]">
                              {moment.comic_affordances.join(', ')}
                            </span>
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 text-sm text-[rgb(var(--muted))]">
                    Step 1 returned no event moments.
                  </p>
                )}
              </div>

              {/* Every persona candidate, selected or not. */}
              <div id="reference-personas" className="scroll-mt-6">
                <h3 className="text-xl font-semibold">
                  Every persona step 1 scanned and scored
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--muted))]">
                  All {step1Parsed.personas?.length ?? 0} candidates, in the
                  order step 1 generated them, each marked with how far through
                  the funnel it got. A persona that was shortlisted but not
                  selected had premises written for it that you can still read
                  in the raw JSON in section 1.
                </p>
                {step1Parsed.personas?.length ? (
                  <ul className="mt-5 space-y-6">
                    {step1Parsed.personas.map((persona) => {
                      const id = persona.persona_id ?? ''
                      const shortlisted = (
                        step1Parsed.shortlisted_persona_ids ?? []
                      ).includes(id)
                      const selected = (
                        step1Parsed.selected_persona_ids ?? []
                      ).includes(id)
                      const { total, disagreesWith } = personaTotal(
                        persona.persona_scores
                      )
                      const bestScan = (persona.moment_scan ?? []).reduce(
                        (best, entry) =>
                          (entry.activation_strength ?? 0) >
                          (best?.activation_strength ?? -1)
                            ? entry
                            : best,
                        null as MomentScanEntry | null
                      )
                      return (
                        <li key={id || persona.persona}>
                          <p className="text-base font-semibold">
                            {persona.persona}
                          </p>
                          <p className="mt-1 text-sm text-[rgb(var(--muted))]">
                            {selected
                              ? 'Selected — its premises are in section 2.'
                              : shortlisted
                                ? 'Shortlisted and expanded into premises, but not selected at the end.'
                                : 'Scanned and scored, but never expanded.'}{' '}
                            Scored{' '}
                            <span className="font-semibold text-[rgb(var(--ink))]">
                              {total} out of 15
                            </span>{' '}
                            ({personaScoreLine(persona.persona_scores)})
                            {disagreesWith !== null
                              ? ` — step 1 reported ${disagreesWith}, which is not the sum of its own components`
                              : ''}
                            . From {describeSource(persona.source)}.
                          </p>
                          {persona.persona_baseline ? (
                            <p className="mt-1 text-sm leading-relaxed text-[rgb(var(--muted))]">
                              {persona.persona_baseline}
                            </p>
                          ) : null}
                          {bestScan ? (
                            <p className="mt-1 text-sm leading-relaxed">
                              <span className="font-semibold">
                                Strongest moment for it:{' '}
                              </span>
                              <span className="text-[rgb(var(--muted))]">
                                {byId.moments.get(bestScan.moment_id ?? '')
                                  ?.moment ?? bestScan.moment_id}{' '}
                                (activation {bestScan.activation_strength}/3
                                {bestScan.activation_reason
                                  ? ` — ${bestScan.activation_reason}`
                                  : ''}
                                )
                              </span>
                            </p>
                          ) : null}
                          {persona.evaluation_notes ? (
                            <p className="mt-1 text-sm leading-relaxed">
                              <span className="font-semibold">
                                What step 1 concluded:{' '}
                              </span>
                              <span className="text-[rgb(var(--muted))]">
                                {persona.evaluation_notes}
                              </span>
                            </p>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="mt-4 text-sm text-[rgb(var(--muted))]">
                    Step 1 returned no persona candidates.
                  </p>
                )}
              </div>

              {/* The deduplication pass — the reason a persona's premises are
                  supposed to be genuinely different from each other. */}
              <div id="reference-duplicates" className="scroll-mt-6">
                <h3 className="text-xl font-semibold">
                  The premises step 1 threw away as duplicates
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--muted))]">
                  Step 1 groups its raw premises by the joke mechanism
                  underneath them and keeps one per group, on the rule that a
                  different wording or metaphor is not a different joke. This is
                  where to check that rule was applied sensibly: a group whose
                  members are genuinely different jokes means a real premise was
                  lost.
                </p>
                {step1Parsed.semantic_deduplication?.length ? (
                  <ul className="mt-5 space-y-5">
                    {step1Parsed.semantic_deduplication.map((entry, i) => {
                      const kept = byId.ideas.get(entry.kept_idea_id ?? '')
                      const dropped = (entry.duplicate_idea_ids ?? [])
                        .map((id) => byId.ideas.get(id))
                        .filter(Boolean)
                      if (!dropped.length) return null
                      return (
                        <li key={`${entry.kept_idea_id}-${i}`}>
                          <p className="text-sm font-semibold">
                            {entry.semantic_cluster}
                          </p>
                          <p className="mt-1 text-sm leading-relaxed">
                            <span className="font-semibold">Kept: </span>
                            <span className="text-[rgb(var(--muted))]">
                              {kept?.core_comic_idea ?? entry.kept_idea_id}
                            </span>
                          </p>
                          <p className="mt-1 text-sm font-semibold">
                            Dropped as the same joke:
                          </p>
                          <ul className="mt-1 space-y-1">
                            {dropped.map((idea) => (
                              <li
                                key={idea.idea_id}
                                className="text-sm leading-relaxed text-[rgb(var(--muted))]"
                              >
                                {idea.core_comic_idea}
                              </li>
                            ))}
                          </ul>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="mt-4 text-sm text-[rgb(var(--muted))]">
                    Step 1 threw nothing away as a duplicate. On a prompt that
                    asks for roughly eight raw premises per persona and keeps
                    three to five, that usually means the deduplication pass did
                    not really run.
                  </p>
                )}
              </div>

              {/* Step 1's own read on whether the personas overlap. */}
              {step1Parsed.diversity_check ? (
                <div>
                  <h3 className="text-xl font-semibold">
                    What step 1 said about its own selection
                  </h3>
                  {step1Parsed.diversity_check.overall_assessment ? (
                    <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--muted))]">
                      {step1Parsed.diversity_check.overall_assessment}
                    </p>
                  ) : null}
                  {step1Parsed.diversity_check.selected_persona_lenses?.length ? (
                    <>
                      <p className="mt-4 text-sm font-semibold">
                        The distinct lens it claims each selected persona brings
                      </p>
                      <ul className="mt-2 space-y-1.5">
                        {step1Parsed.diversity_check.selected_persona_lenses.map(
                          (lens, i) => (
                            <li key={i} className="text-sm leading-relaxed">
                              <span className="font-semibold">
                                {byId.personas.get(lens.persona_id ?? '')
                                  ?.persona ?? lens.persona_id}
                              </span>
                              <span className="text-[rgb(var(--muted))]">
                                {' '}
                                — {lens.distinct_lens}
                              </span>
                            </li>
                          )
                        )}
                      </ul>
                    </>
                  ) : null}
                  {step1Parsed.diversity_check.potentially_redundant_personas
                    ?.length ? (
                    <>
                      <p className="mt-4 text-sm font-semibold">
                        Pairs it flagged as possibly the same lens twice
                      </p>
                      <ul className="mt-2 space-y-1.5">
                        {step1Parsed.diversity_check.potentially_redundant_personas.map(
                          (pair, i) => (
                            <li key={i} className="text-sm leading-relaxed">
                              <span className="font-semibold">
                                {byId.personas.get(pair.persona_id_1 ?? '')
                                  ?.persona ?? pair.persona_id_1}{' '}
                                and{' '}
                                {byId.personas.get(pair.persona_id_2 ?? '')
                                  ?.persona ?? pair.persona_id_2}
                              </span>
                              <span className="text-[rgb(var(--muted))]">
                                {' '}
                                — {pair.overlap}
                              </span>
                            </li>
                          )
                        )}
                      </ul>
                    </>
                  ) : null}
                  {step1Parsed.diversity_check.personas_with_insufficient_range
                    ?.length ? (
                    <>
                      <p className="mt-4 text-sm font-semibold">
                        Personas whose premises collapsed into one note
                      </p>
                      <ul className="mt-2 space-y-1.5">
                        {step1Parsed.diversity_check.personas_with_insufficient_range.map(
                          (row, i) => (
                            <li key={i} className="text-sm leading-relaxed">
                              <span className="font-semibold">
                                {byId.personas.get(row.persona_id ?? '')
                                  ?.persona ?? row.persona_id}
                              </span>
                              <span className="text-[rgb(var(--muted))]">
                                {' '}
                                — {row.problem}
                              </span>
                            </li>
                          )
                        )}
                      </ul>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
      </div>
    </div>
  )
}
