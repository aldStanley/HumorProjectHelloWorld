'use client'

// POV Joke Maker (/pov-jokes) — the moment-only surface.
//
// Step 1 runs once for the moment and returns a scored JSON roster of points
// of view. Step 2 runs ONCE PER POINT OF VIEW, and never on its own: the whole
// point of this page is that step 1 usually returns more points of view than
// you want to pay for, so nothing fans out until you pick and press.
//
// Prompts are stored in the DB with {{EVENT}}-style placeholders, which this
// surface fills before handing the finished text to the shared runStepAction.
// The shared ${...} resolver never sees them, and no image is involved.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { JsonTree } from '@/components/json-tree'
import { promptHash } from '@/utils/prompt-hash'

import { runStepWithSession } from './run-step'
import { AllJokesRanked, type RankedJokeRow } from './all-jokes-ranked'
import { searchKlipyAction } from './klipy-actions'
import type { KlipyResult, KlipySearchResult } from './klipy-types'
import { PERSONA_DESCRIPTIONS } from './persona-descriptions'
import { SidechatMomentPicker } from './sidechat-moment-picker'
import {
  deleteRecord,
  describeQuota,
  loadRecord,
  migrateFromLocalStorage,
  saveRecord,
} from './pov-jokes-store'
import {
  EXECUTION_SCORE_LABELS,
  executionTotal,
  PremiseJokesResult,
  type Execution,
  type PremiseBlock,
  type PremiseJokesOutput,
} from './premise-jokes'
import {
  ImagePickerGrid,
  ImageSetControls,
  PairSavedCaptions,
  SavedPoster,
  bareName,
  useImageSet,
  type ImageAssignment,
} from './image-pairs'
import {
  BIG_BUTTON,
  CopyButton,
  Field,
  FIELD_HELP,
  FIELD_LABEL,
  GOAL_TEXT,
  SECTION,
  SECTION_NUMBER,
  SECTION_TITLE,
  SMALL_BUTTON,
  StructuredOutput,
  TEXTAREA,
} from './pov-jokes-ui'
import {
  buildS2Payload,
  isDiscoverySchema,
  jokeContextFrom,
  resolveDiscovery,
  type JokeContext,
  type ResolvedPersona,
  type ResolvedPremise,
} from './resolve-premises'

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

// Every step runs on the model the flavor's steps name, at this reasoning
// effort. Effort has no per-step column yet — it is a property of this
// surface, so changing it here changes it for every flavor the page serves.
const REASONING_EFFORT = 'high' as const
// Step 1 is a scoring and roster task, and it is the call the researcher
// waits on before anything else can happen. Measured 2026-09-05 on one
// moment with the lean 1558 prompt: 165s at high, 126s at medium, with the
// same roster shape and the same mechanical checks passing. Step 2 writes
// the captions and stays at high.
const STEP1_REASONING_EFFORT = 'medium' as const
// Step 1 evaluates every supplied persona plus 5-10 event-native and 3-5
// narrow-lens discoveries, each with ten prose fields — the 16k default cuts
// the JSON off mid-object once hidden reasoning is paid for too.
const MAX_OUTPUT_TOKENS = 60000
// How many per-POV step-2 calls are in flight at once.
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

// The same nine personas as pathologies: what each wants, pretends, does
// compulsively at a cost, and would never admit. A flavor whose step 1 asks
// for `persona_pathology` (1558 onward) starts with this one; the one-line
// library above is a function, and a function has nothing to expose.
const PATHOLOGY_PERSONA_LIBRARY = `* the sad girl
  - wants: him to choose her, and to look like she does not care whether he does
  - pretends: she is done, she is healing, "i don't care" energy
  - does compulsively (and pays for): rereads his "lol" six times, checks his location, goes back after telling the group chat she was done, redownloads Hinge
  - would never admit: she is the one keeping the situationship alive
* the social justice warrior
  - wants: the issue recognized as systemic, and to be the one who recognized it
  - pretends: this is about the cause, never about being right
  - does compulsively (and pays for): turns one incident into fourteen more struggles, writes the paragraph in the group chat nobody asked for, refuses to accept anything as resolved
  - would never admit: a win would leave her with nothing to post
* the grind-mode premed
  - wants: a 4.0 and a seat in Butler
  - pretends: the grind is a choice, not a fear
  - does compulsively (and pays for): measures every event in lost Butler hours, does Anki in the elevator, treats fun as a threat to be managed
  - would never admit: the hours are not producing the grades
* the broke student
  - wants: to not be broke, or at least to not be seen being broke
  - pretends: the choices are lifestyle choices ("I actually prefer the dining hall")
  - does compulsively (and pays for): converts every event into dollars they do not have, does the math on the free-food email, splits a $9 charge four ways
  - would never admit: how much of the "budget" is their parents
* the international student
  - wants: to belong, and to decode the ritual before anyone notices they have not
  - pretends: they find it all anthropologically amusing rather than baffling
  - does compulsively (and pays for): googles the tradition mid-event, nods along, writes home an explanation they are not sure of
  - would never admit: they still do not know what a tailgate is for
* the wannabe finance bro
  - wants: a Goldman offer and a portfolio that proves he belongs there
  - pretends: he is already an operator; every dorm decision is a trade, every acquaintance a contact, "crushing it" energy
  - does compulsively (and pays for): checks Robinhood under the desk mid-lecture, screenshots every trade to the group chat, sends a third follow-up to a recruiter who ghosted him, puts meal-plan money in coins with dogs on them
  - would never admit: the portfolio is four figures, he has leverage over nobody, and the vest was a gift to himself
* the hard-core Republican
  - wants: every event to prove the worldview he arrived with
  - pretends: he is the only one on campus thinking independently
  - does compulsively (and pays for): says "this is exactly what happens when" before the facts are in, cites his dad's business, posts the take on Sidechat and refreshes
  - would never admit: the market he trusts is what priced him into the dorm he is complaining about
* the CC professor
  - wants: the syllabus to matter, and students to see that it does
  - pretends: the reading was chosen in advance and just happens to fit
  - does compulsively (and pays for): says "this is literally Rousseau" about a housing dispute, assigns the extra reading, turns a crisis into a discussion question
  - would never admit: no student has finished the reading
* the gamer
  - wants: reality to have rules, a meta, and patch notes
  - pretends: reading life as a game is a bit, not a coping strategy
  - does compulsively (and pays for): calls a policy change a nerf, calls a person an NPC, min-maxes a schedule nobody else optimizes
  - would never admit: he has not touched grass since move-in`

// The library text parsed back into pathologies, keyed by a normalized
// persona name. Step 1 does not echo the library (echoing it was output the
// call paid for twice), so the page joins each library persona in step 1's
// roster to its supplied four lines here, and step 2 receives them that way.
const normalizePersonaName = (name: string): string =>
  name.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim()

const parsePathologyLibrary = (
  library: string
): Map<string, PersonaPathology> => {
  const out = new Map<string, PersonaPathology>()
  let current: { name: string; pathology: PersonaPathology } | null = null
  const LINE: [RegExp, (p: PersonaPathology, v: string) => void][] = [
    [/^wants:/i, (p, v) => (p.wants = v)],
    [/^pretends:/i, (p, v) => (p.pretends = /^null$/i.test(v) ? null : v)],
    [
      /^does compulsively[^:]*:/i,
      (p, v) => (p.does_compulsively = v.split(/,\s*/).filter(Boolean)),
    ],
    [/^would never admit:/i, (p, v) => (p.would_never_admit = v)],
  ]
  for (const raw of library.split('\n')) {
    const bullet = raw.match(/^\s*\*\s+(.+?)\s*$/)
    if (bullet) {
      if (current) out.set(normalizePersonaName(current.name), current.pathology)
      current = { name: bullet[1].replace(/:.*$/, ''), pathology: {} }
      continue
    }
    const sub = raw.match(/^\s*-\s+(.+?)\s*$/)
    if (!sub || !current) continue
    for (const [test, apply] of LINE) {
      if (test.test(sub[1])) {
        apply(current.pathology, sub[1].replace(/^[^:]*:\s*/, ''))
        break
      }
    }
  }
  if (current) out.set(normalizePersonaName(current.name), current.pathology)
  return out
}

// A library persona in step 1's roster gets the library's four lines; a
// persona step 1 discovered keeps whatever it wrote. Nothing is overwritten.
const attachPathology = (
  persona: SelectedPersona,
  library: Map<string, PersonaPathology>
): SelectedPersona => {
  if (persona.persona_pathology && typeof persona.persona_pathology === 'object')
    return persona
  const found = library.get(normalizePersonaName(persona.persona ?? ''))
  return found ? { ...persona, persona_pathology: found } : persona
}

// Step 1's `selected_personas` is a pick list on the lean prompt (1558 on):
// name, source, why, and a pathology for discovered personas. The full record
// (scores, translation, tension, who pays) lives once, in the evaluation
// array the persona came from, and is joined back here by name. Fields the
// pick carries win, so a roster that still repeats the record is unchanged.
const attachEvaluation = (
  persona: SelectedPersona,
  step1: Step1Output | null
): SelectedPersona => {
  if (!step1 || typeof fitTotal(persona.scores) === 'number') return persona
  const key = normalizePersonaName(persona.persona ?? '')
  const record = [
    ...(step1.recurring_persona_evaluations ?? []),
    ...(step1.event_native_personas ?? []),
    ...(step1.narrow_lens_personas ?? []),
    ...(step1.candidates ?? []),
  ].find((p) => normalizePersonaName(p.persona ?? '') === key)
  if (!record) return persona
  const { persona_event_translation, joke_runway, verdict, evaluation_notes, ...rest } = record
  void joke_runway
  void verdict
  void evaluation_notes
  const merged: SelectedPersona = { ...rest, ...persona }
  // The card reads the handoff form; on the lean prompt only the evaluation
  // form exists, so it stands in.
  if (!merged.comic_translation && persona_event_translation)
    merged.comic_translation = persona_event_translation
  if (persona.persona_pathology == null && record.persona_pathology)
    merged.persona_pathology = record.persona_pathology
  // The cast prompt names its target `joke_target`; the card reads the
  // roster form.
  if (!merged.likely_joke_target && record.joke_target)
    merged.likely_joke_target = record.joke_target
  return merged
}

// One broad character with one obvious emotional instinct, for the
// reaction-meme flavor (1560). Specific roles are manifestations of it, not
// separate personas; the palette is the joke inventory and each entry names
// the reaction GIF it maps to.
const BROAD_CHARACTER_LIBRARY = `* Columbia
  - wants: to keep institutional control while appearing reasonable, normal, and student-friendly
  - pretends: nothing fundamental has changed; every restriction is ordinary administration
  - does compulsively: renames the obvious problem, calmly doubles down, issues polished explanations, treats criticism as a messaging problem
  - would never admit: sometimes the students' blunt description is more accurate than the official one
  - comic emotion: serene bureaucratic confidence while doing something obviously absurd
  - best joke behavior: denial, euphemism, doubling down, awkward spin, proudly presenting the problem as the solution
  - emotional palette: smug denial → "actually…" correction; cheerful rebranding → proudly unveiling; casual doubling down → pressing the same button again; oblivious pride → presenting the problem as the solution; caught-but-unbothered → zero embarrassment
* the sad girl
  - wants: him to choose her, and to look like she does not care whether he does
  - pretends: she is done, she is healing, "i don't care" energy
  - does compulsively: rereads his "lol" six times, checks his location, goes back after telling the group chat she was done, redownloads Hinge
  - would never admit: she is the one keeping the situationship alive
  - comic emotion: serene "I'm fine" while visibly not fine
  - best joke behavior: relapse, over-reading, performed indifference, making any event about him
  - emotional palette: fake composure → "I'm fine" through tears; spiral → frantic scrolling; relapse → running back in; performed indifference → hair flip and walking away; caught caring → deer in headlights
* Dwight Schrute
  - wants: to be recognized as the most competent, dangerous, and loyal person in any room
  - pretends: every trivial matter is a security situation only he is trained for
  - does compulsively: declares "Fact:" before an opinion, describes mundane things in predator language, volunteers for authority nobody granted, takes sarcasm literally
  - would never admit: nobody asked, and nobody is impressed
  - comic emotion: deadly earnestness about something absurd
  - best joke behavior: military intensity on a trivial matter, self-mythologizing, missing the joke everyone else got, rules for a world that has none
  - emotional palette: grave declaration → dead-serious stare at camera; tactical readiness → springing into a fighting stance; self-mythologizing → proud nod to himself; missed sarcasm → confused blink; misplaced authority → pointing and issuing an order
* Keke Palmer
  - wants: to say the true thing out loud and have everyone love her for it
  - pretends: she is just being honest, baby, no shade intended
  - does compulsively: reacts to mild news like a telenovela twist, slips into a church-lady voice for one beat, narrates life as her own reality show, roasts you so gently it feels like a hug
  - would never admit: she knew exactly how that would land
  - comic emotion: warm, delighted disbelief at other people's nonsense
  - best joke behavior: radical honesty wrapped in charm, heightened reaction to a small thing, "I'm sorry to this man" non-recognition, friendly roast
  - emotional palette: theatrical disbelief → head snap back "you said WHAT?"; warm dismissal → "I'm sorry to this man"; gentle roast → side-eye with a smile; church-lady beat → "we gon' pray on that"; camp confidence → "God's favorite" hair toss
* GigaChad
  - wants: nothing; he has already won, and wishes you the discipline to win too
  - pretends: null
  - does compulsively: answers a complaint with a gym proverb, treats a chore as a mythic quest, states an absurd certainty with total calm, turns any setback into "protein for the soul"
  - would never admit: the situation might actually be bad
  - comic emotion: divine serenity about something that is clearly a problem
  - best joke behavior: absolute declarations, mundane task as heroic epic, unbothered stoicism where panic would be reasonable, accidental inspiration
  - emotional palette: serene certainty → slow nod, jaw set; mythic framing → gazing at the horizon; unbothered → flexing while everything burns; grave wisdom → hand on your shoulder; effortless superiority → walking away in slow motion
* Russ Hanneman
  - wants: everyone in the room to know he has money, and to feel 1999 again
  - pretends: every idea he has is genius and every room is his
  - does compulsively: measures things in McLarens, calls the normal option "peasant vibes", throws a tantrum when told no, wears sunglasses indoors to a crisis, brings "this guy" energy to a memo
  - would never admit: it was one lucky break and he has been terrified of irrelevance ever since
  - comic emotion: loud, try-hard swagger with insecurity leaking out
  - best joke behavior: performing wealth, teenage tantrum in a billionaire's body, confusing volume for wisdom, arriving like chaos with a soundtrack
  - emotional palette: peacocking → arms wide, "who's got two commas?"; tantrum → throwing something expensive; try-hard swagger → sunglasses on indoors; dismissal → "peasant vibes" wave-off; wounded ego → storming out
* Corecore Man
  - wants: this moment to mean something, and someone to feel it with him
  - pretends: he is not trying to be profound; the universe just keeps signaling him
  - does compulsively: reads a flickering light as an omen, narrates an errand like a coming-of-age film, speaks in lowercase, cuts from cosmic to stupid in one breath
  - would never admit: it was just some guy eating Pringles
  - comic emotion: aching sincerity about something mundane
  - best joke behavior: profundity forced onto a parking lot, sensory detail as symbolism, montage cadence, the jolt from cosmic to dumb
  - emotional palette: cosmic ache → staring out a bus window; omen reading → slow zoom on a Gatorade bottle; montage cadence → sunset over a strip mall; deflation → "turns out it was just some guy"; quiet devastation → sitting alone in a food court
* the social justice warrior
  - wants: the issue recognized as systemic, and to be the one who recognized it
  - pretends: this is about the cause, never about being right
  - does compulsively: turns one incident into fourteen more struggles, writes the paragraph in the group chat nobody asked for, names the harm, apologizes for you, pauses game night to deconstruct Uno
  - would never admit: a win would leave her with nothing to post
  - comic emotion: righteous urgency about dorm-sized stakes
  - best joke behavior: activist vocabulary for a tiny thing, spontaneous teach-in, "sorry, I just want to name the harm", the crusade that is too big for the campus
  - emotional palette: righteous escalation → typing furiously; naming the harm → hand raised, "actually"; performed apology → "sorry that you haven't unpacked that"; teach-in → whiteboard lecture nobody asked for; blocked on principle → dramatic phone lock
* the wannabe finance bro
  - wants: a Goldman offer and a portfolio that proves he belongs there
  - pretends: he is already an operator; every dorm decision is a trade, every acquaintance a contact
  - does compulsively: checks Robinhood under the desk mid-lecture, screenshots every trade to the group chat, sends a third follow-up to a recruiter who ghosted him, puts meal-plan money in coins with dogs on them
  - would never admit: the portfolio is four figures, he has leverage over nobody, and the vest was a gift to himself
  - comic emotion: crushing-it confidence over a four-figure account
  - best joke behavior: pricing everything, networking at a funeral, treating a setback as "the market pricing in", the vest
  - emotional palette: crushing-it → adjusting the vest; portfolio check → phone under the desk; ghosted → refreshing the inbox; loss → "it's a long-term hold" shrug; networking → firm handshake at the wrong moment
* the hard-core Republican
  - wants: every event to prove the worldview he arrived with
  - pretends: he is the only one on campus thinking independently
  - does compulsively: says "this is exactly what happens when" before the facts are in, cites his dad's business, posts the take on Sidechat and refreshes, blames a policy from 1974
  - would never admit: the market he trusts is what priced him into the dorm he is complaining about
  - comic emotion: vindicated certainty before the facts arrive
  - best joke behavior: "told you so" on day one, personal responsibility for everyone else, the take that was ready before the event, refreshing for upvotes
  - emotional palette: vindication → leaning back, arms crossed; premature verdict → pointing "this is exactly what happens"; posting → hitting send with force; refreshing → pulling down to reload; citing dad → hands on hips
* the grind-mode premed
  - wants: a 4.0 and a seat in Butler
  - pretends: the grind is a choice, not a fear
  - does compulsively: measures every event in lost Butler hours, does Anki in the elevator, treats fun as a threat to be managed, schedules a breakdown for after the exam
  - would never admit: the hours are not producing the grades
  - comic emotion: panic disguised as productivity
  - best joke behavior: converting any event into study time lost, guarding a library seat like territory, the flashcard in every situation, fun as a risk
  - emotional palette: lost hours → staring at a clock; Anki everywhere → flashcards in the elevator; seat guarding → hovering over a desk; scheduled breakdown → crying on a timer; fun as threat → backing away from a party
* the broke student
  - wants: to not be broke, or at least to not be seen being broke
  - pretends: the choices are lifestyle choices ("I actually prefer the dining hall")
  - does compulsively: converts every event into dollars they do not have, does the math on the free-food email, splits a $9 charge four ways, walks forty blocks to save $2.90
  - would never admit: how much of the "budget" is their parents
  - comic emotion: dignified poverty performed as preference
  - best joke behavior: converting the event to dollars, the free-food sprint, "I actually prefer" the cheaper thing, the Venmo request for $2.25
  - emotional palette: free food → sprinting across campus; price check → wincing at a receipt; performed preference → "I actually prefer this" smile; Venmo request → typing $2.25 with a straight face; parental money → looking away
* the international student
  - wants: to belong, and to decode the ritual before anyone notices they have not
  - pretends: they find it all anthropologically amusing rather than baffling
  - does compulsively: googles the tradition mid-event, nods along, writes home an explanation they are not sure of, converts the price to home currency out loud
  - would never admit: they still do not know what a tailgate is for
  - comic emotion: polite bafflement disguised as amusement
  - best joke behavior: field notes on American ritual, nodding along to a thing nobody explained, the currency conversion, the explanation home
  - emotional palette: polite nod → nodding with no idea; mid-event google → phone under the table; anthropological amusement → "fascinating"; currency shock → double take at a price; writing home → typing a long message
* the CC professor
  - wants: the syllabus to matter, and students to see that it does
  - pretends: the reading was chosen in advance and just happens to fit
  - does compulsively: says "this is literally Rousseau" about a housing dispute, assigns the extra reading, turns a crisis into a discussion question, waits for a student to say the thing
  - would never admit: no student has finished the reading
  - comic emotion: scholarly delight that the world is proving the syllabus
  - best joke behavior: "this is literally" a canonical text, the extra reading, the discussion question nobody wants, the pause for participation
  - emotional palette: syllabus vindicated → tapping a book; discussion question → expectant silence at a seminar table; extra reading → sliding a stack across; "this is literally Rousseau" → finger raised; disappointment → sighing at a blank room
* the gamer
  - wants: reality to have rules, a meta, and patch notes
  - pretends: reading life as a game is a bit, not a coping strategy
  - does compulsively: calls a policy change a nerf, calls a person an NPC, min-maxes a schedule nobody else optimizes, asks where the patch notes are
  - would never admit: he has not touched grass since move-in
  - comic emotion: calm expertise about a game nobody else is playing
  - best joke behavior: the nerf, the NPC, the meta, the min-max, reading a crisis as a patch
  - emotional palette: nerf → controller thrown; NPC → staring through someone; patch notes → scrolling a changelog; min-max → spreadsheet at 3 a.m.; touch grass → squinting at daylight`

// Which library a flavor starts with. Read from the step, not from a flag:
// the prompt that asks for a field is the prompt that needs it.
const defaultPersonaLibrary = (findPovsStep: PovStep | null): string => {
  const prompt = findPovsStep?.userPrompt ?? ''
  if (prompt.includes('comic_emotion')) return BROAD_CHARACTER_LIBRARY
  if (prompt.includes('persona_pathology')) return PATHOLOGY_PERSONA_LIBRARY
  return DEFAULT_PERSONA_LIBRARY
}

// The library as a list: each `* name` bullet with the sub-lines under it.
// The one-POV flavors elect one entry and send only that block to step 1.
const libraryEntries = (library: string): { name: string; block: string }[] => {
  const entries: { name: string; block: string }[] = []
  library.split('\n').forEach((line) => {
    const head = line.match(/^\s*\*\s+(.+?)\s*$/)
    if (head) entries.push({ name: head[1], block: line })
    else if (entries.length && line.trim()) entries[entries.length - 1].block += `\n${line}`
  })
  return entries
}

type Scores = {
  trigger_strength?: number
  persona_specificity?: number
  event_specificity?: number
  comic_transformation?: number
  joke_runway?: number
  // Added on flavor 1558, 0-3. Named for the first version (how directly
  // the loss lands on the persona); since the 2026-09-05 revision it scores
  // pathology payoff: does the persona's own behavior expose them.
  expense_fit?: number
  total_fit_score?: number
  // The event-native cast prompt (1559) scores six different things, /18.
  causal_relevance?: number
  comic_contradiction?: number
  behavioral_runway?: number
  target_clarity?: number
  satirical_leverage?: number
  total_score?: number
  // The broad-character prompt (1560) scores five things, /15.
  mockability?: number
  one_idea_one_attitude?: number
  gif_ability?: number
}

const fitTotal = (scores?: Scores): number | undefined =>
  scores?.total_fit_score ?? scores?.total_score

// The four lines that define a persona on the pathology flavors (1558 on).
type PersonaPathology = {
  wants?: string
  pretends?: string | null
  does_compulsively?: string[]
  would_never_admit?: string
}

type WhoPays = { entity?: string; what_it_costs?: string }

// One moment's grounding for a character, from step 1's `per_event`.
type PerEventNote = {
  event?: number
  // On the one-POV flavors: how well the character fits this moment, 0-3,
  // and the sentence that says why.
  fits?: number
  why_it_fits?: string
  // The three named checks behind `fits`, each answered with a reason.
  // `fits` is how many pass.
  fit_checks?: { check?: string; passes?: boolean; reason?: string }[]
  // Older runs: the one concrete thing this moment lacked for a 3.
  fit_deficit?: string | null
  // The character's complete reading of THIS moment, in its own terms.
  trigger_feature?: string
  persona_event_translation?: string
  comic_contradiction?: string
  joke_target?: string
  manifestations?: string[]
  reusable_engine?: string
  punch_direction?: string
  best_reactions?: string[]
  why_promising?: string
}

type SelectedPersona = {
  // Step 1 on the multi-moment flavors grounds the character in each numbered
  // moment separately. Step 2 receives only its own moment's entry.
  per_event?: PerEventNote[]
  persona?: string
  source?: string
  relationship_to_event?: string
  persona_baseline?: string
  persona_pathology?: PersonaPathology
  who_pays?: WhoPays
  // Event-native cast prompt (1559): its own target field, plus which way
  // the joke punches and which search category found the role.
  joke_target?: string
  punch_direction?: string
  category?: string
  // Broad-character prompt (1560): the one attitude, the reaction inventory
  // with the GIF each maps to, the roles it shows up as, and its engine.
  comic_emotion?: string
  emotional_palette?: { reaction?: string; gif_emotion?: string }[]
  manifestations?: string[]
  reusable_engine?: string
  comic_role?: string
  trigger_feature?: string | null
  persona_processing_rule?: string
  comic_translation?: string
  likely_joke_target?: string
  comic_contradiction?: string
  why_this_persona_is_promising?: string
  scores?: Scores
}

type PersonaEvaluation = SelectedPersona & {
  persona_event_translation?: string
  joke_runway?: string
  verdict?: string
  evaluation_notes?: string
}

type WeakFit = {
  persona?: string
  trigger_feature?: string | null
  why_skip?: string
  total_fit_score?: number
}

type Step1Output = {
  event?: {
    event_core?: string
    event_affordances?: { feature?: string; why_comically_useful?: string }[]
  }
  recurring_persona_evaluations?: PersonaEvaluation[]
  event_native_personas?: PersonaEvaluation[]
  narrow_lens_personas?: PersonaEvaluation[]
  // The event-native cast prompt puts every scored role here instead.
  candidates?: PersonaEvaluation[]
  selected_personas?: SelectedPersona[]
  weak_fits_to_skip?: WeakFit[]
  coverage_check?: {
    comic_transformations_represented?: string[]
    potentially_redundant_pairs?: {
      persona_1?: string
      persona_2?: string
      overlap?: string
    }[]
    selection_summary?: string
  }
}

type JokeCandidate = {
  angle_name?: string
  // Punchy reaction-meme step 2 (1560): the one-line idea the caption came from.
  kernel?: string
  setup?: string
  joke_mechanism?: string
  image_situation?: string
  caption?: string
  // Flavor 1558 on: the filmable behavior the caption carries, and who loses.
  behavior?: string
  who_pays?: string
  scores?: {
    persona_specificity?: number
    event_specificity?: number
    comic_tension?: number
    naturalness?: number
    target_clarity?: number
    at_persona_expense?: number
    // Reaction-meme flavor (1560): can a familiar reaction GIF carry it,
    // does it land in one glance, is anything removable.
    gif_ability?: number
    punch?: number
    compression?: number
    // The premise-discovery flavors (1562 on) judge four more things.
    event_generatedness?: number
    comic_leap?: number
    premise_fidelity?: number
    factual_support?: number
    // The minimum of the checks, computed by the judge. Absent on flavors
    // whose judge sums instead.
    overall?: number
  }
  weakest_check?: string
  // The premise-discovery flavors: what the execution step checked and why
  // this execution won, one line each, for the analysis column.
  execution_notes?: string[]
}

// Step 2 of the premise-discovery flavors: premises found, checked, selected.
type DiscoverOutput = {
  event_analysis?: unknown
  character_role?: unknown
  raw_premises?: {
    premise_id?: string
    premise?: string
    decision?: string
    rejection_reason?: string | null
    swap_test?: { result?: string }
    generic_device_risk?: string
    duplicate_family?: string
    scores?: Record<string, number>
  }[]
  selected_premises?: {
    premise_id?: string
    premise?: string
    why_selected?: string
    execution_space?: string[]
  }[]
}

// Step 3 of the premise-discovery flavors: two executions per premise, the
// checks on each, the winner, the compressed caption, the GIF.
type ExecuteOutput = {
  persona?: { persona_baseline?: string }
  premise_executions?: {
    premise_id?: string
    premise_analysis?: { premise?: string; odd_implication?: string }
    executions?: {
      execution_id?: string
      caption?: string
      fact_integrity?: { passes?: boolean; explanation?: string }
      swap_test?: { result?: string; explanation?: string }
      generic_template_check?: { risk?: string; template_family?: string | null }
    }[]
    execution_selection?: { winner?: string; why_winner?: string }
    finalization?: { pre_compression_caption?: string; final_caption?: string; compression_changes?: string }
    gif_pairing?: { image_situation?: string; gif_action?: string; why_it_amplifies?: string }
  }[]
  final_candidates?: {
    premise_id?: string
    angle_name?: string
    premise?: string
    caption?: string
    image_situation?: string
    scores?: JokeCandidate['scores']
  }[]
  best?: { premise_id?: string; best_caption?: string; best_overall?: number; why_best?: string }
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
    // Punchy reaction-meme step 2 (1560): the one-line ideas it considered.
    comic_kernels?: string[]
  }
  persona_material?: {
    persona_specific_vocabulary?: string[]
    visual_behaviors?: string[]
  }
  joke_candidates?: JokeCandidate[]
  // Punchy reaction-meme step 2 (1560): the 8-12 one-line comic ideas it
  // generated before choosing five to write.
  kernels?: string[]
  best?: { best_caption?: string; best_overall?: number; why_best?: string }
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
  // What the score is out of. Step 2 scored five dimensions on the earlier
  // flavors and six on the premise-first ones; absent means the original 25.
  scoreOutOf?: number
  // The GIF paired with this caption: the src pulled out of a pasted embed,
  // never the pasted markup itself. See parseEmbed.
  embedSrc?: string
  embedTitle?: string
  embedKind?: 'iframe' | 'image' | 'video'
  // The GIF emotion step 2 had in mind, handed to the pairing step.
  gifNote?: string
  // An image assigned from a study image set, by the pairing step or by
  // hand. Independent of the GIF: a caption can hold both, and the poster
  // prefers the image.
  imageId?: string
  imageUrl?: string
  imageWho?: string
  imageFit?: number
  imageWhy?: string
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

type JokeJob = {
  persona: string
  // The premise-discovery flavors: step 2's output, kept beside step 3's,
  // and which of the two calls is running right now.
  discoverText?: string
  phase?: string
  // Which of the page's moments this run wrote for. Absent means the first,
  // which is also what every run saved before the page took several means.
  momentIndex?: number
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
  // `moment` is what step 1 was sent (one moment, or the numbered list of
  // several); `moments` is the list itself. Runs saved before the page took
  // several moments have only `moment`.
  moment: string
  moments?: string[]
  // The one-POV flavors: which library character was elected, and which
  // moments were unticked in section 2 (by index).
  electedPov?: string
  momentsOff?: Record<number, boolean>
  eventContext: string
  personaLibrary: string
  step1Raw: string
  step1PromptHash: string
  step1FinishedAt: string
  jobs: Record<string, JokeJob>
  imageTerms: Record<string, CaptionJob>
  simplified: Record<string, CaptionJob>
  premisesOff: Record<string, boolean>
}

// A caption's stable identity across renders and reloads: which point of view
// wrote it and which of that point of view's five angles it was.
const captionId = (persona: string, index: number): string =>
  `${slugify(persona)}#${index + 1}`

// The page takes one or more moments. Step 1 sees them all at once as a
// numbered list; step 2 and step 5 see one at a time. A single moment is a
// list of one and takes the same path, so this is the only place the two
// cases differ.
const liveMomentsOf = (moments: string[]): string[] =>
  moments.map((m) => m.trim()).filter(Boolean)
const eventTextFor = (moments: string[]): string => {
  const live = liveMomentsOf(moments)
  if (live.length <= 1) return live[0] ?? ''
  return live.map((m, i) => `${i + 1}. ${m}`).join('\n\n')
}

// A run is one point of view writing for one moment. The first moment keeps
// the bare persona name as its key, so runs saved before the page took
// several moments still read.
const jobKeyFor = (persona: string, momentIndex: number): string =>
  momentIndex === 0 ? persona : `${persona} · moment ${momentIndex + 1}`

// What step 2 is told about a persona for ONE moment: everything step 1 said,
// with that moment's `per_event` entry laid over the cross-moment fields.
const personaContextFor = (
  persona: SelectedPersona,
  momentIndex: number
): Record<string, unknown> => {
  const { persona: _omit, per_event, ...rest } = persona
  const note =
    per_event?.find((e) => Number(e.event) === momentIndex + 1) ??
    per_event?.[momentIndex]
  if (!note) return rest
  const { event: _n, ...fields } = note
  return {
    ...rest,
    ...fields,
    ...(fields.joke_target ? { likely_joke_target: fields.joke_target } : {}),
  }
}

// The premise-first path names its captions after the execution that wrote
// them. Execution ids are unique within one persona's call, so the persona is
// prefixed to keep them unique across the page.
const executionCaptionId = (personaId: string, executionId: string): string =>
  `${slugify(personaId)}~${executionId || 'unnamed-execution'}`

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
  // The moment this caption was written for. Absent on a caption reached
  // from section 4, which falls back to what step 1 was sent.
  moment?: string
  angleName?: string
  jokeMechanism?: string
  originalImage?: string
  analysis?: Step2Output
  // Set on the premise-first path. When present it IS the context, and the
  // fields derived from Step2Output below are not consulted.
  jokeContext?: JokeContext
}

// The {{JOKE_OUTPUT}} both optional steps read. Missing pieces are sent as
// null rather than dropped, so the prompt sees which context it did not get.
//
// The premise-first path sends a `joke_context` object — the one interface
// steps 3 and 4 are written against, so a later change to step 1's schema is
// absorbed by jokeContextFrom rather than by two more prompts. The earlier
// path has no such object and keeps sending its context flat, which both
// prompts still accept.
const jokeOutputFor = (input: CaptionInput, pageMoment: string) => {
  const moment = input.moment ?? pageMoment
  return input.jokeContext
    ? {
        caption: input.caption,
        simple_image_concept: input.originalImage ?? null,
        joke_context: { ...input.jokeContext, event: moment.trim() },
      }
    : {
        caption: input.caption,
        persona: input.personaName,
        event: moment.trim(),
        angle_name: input.angleName ?? null,
        joke_mechanism: input.jokeMechanism ?? null,
        original_image_concept: input.originalImage ?? null,
        why_the_joke_is_funny:
          input.analysis?.humor_engine?.comic_contradiction ?? null,
        comic_move: input.analysis?.humor_engine?.comic_move ?? null,
        intended_reaction:
          input.analysis?.comic_relationship?.joke_target ?? null,
        persona_baseline: input.analysis?.persona?.persona_baseline ?? null,
      }
}

// Fills {{EVENT}}-style placeholders. An unknown placeholder is left visible
// rather than blanked, so a missing binding shows up in the sent prompt.
const fillTemplate = (
  template: string,
  values: Record<string, string>
): string =>
  template.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole
  )

// Placeholders the surface failed to fill. Leaving them visible in the sent
// prompt makes a missing binding findable, but a prompt is not worth sending
// in that state: the model either refuses (a paid call that returns an error
// object) or, worse, answers around the hole. Every run path checks this
// before spending the call.
const unfilledPlaceholders = (filled: string): string[] => [
  ...new Set(
    [...filled.matchAll(/\{\{\s*([A-Z_]+)\s*\}\}/g)].map((match) => match[1])
  ),
]

// A model that refuses by returning {"error": "..."} has told us something
// specific and useful; it should read as a failure, not as an unknown shape.
const modelRefusal = (parsed: Record<string, unknown> | null): string | null =>
  parsed && typeof parsed.error === 'string' ? parsed.error : null

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

// Which of step 2's two output shapes this is. Read from the output itself,
// because the two steps can disagree: a flavor mid-migration has the
// premise-first step 2 and the persona-roster step 1, and drawing the wrong
// block around the right JSON renders a completely empty section.
const step2Shape = (
  parsed: Record<string, unknown> | null
): 'premise' | 'legacy' | 'unknown' => {
  if (!parsed) return 'unknown'
  if (
    Array.isArray(parsed.premises) ||
    Array.isArray(parsed.ranked_finalists)
  ) {
    return 'premise'
  }
  if (Array.isArray(parsed.joke_candidates) || parsed.best) return 'legacy'
  return 'unknown'
}

// Step 2 scores each candidate 1-5 on five dimensions, six on flavor 1558.
const CANDIDATE_SCORE_LABELS: [keyof NonNullable<JokeCandidate['scores']>, string][] = [
  ['persona_specificity', 'only this persona'],
  ['event_specificity', 'uses this event'],
  ['comic_tension', 'real tension'],
  ['naturalness', 'sounds like a post'],
  ['target_clarity', 'clear target'],
  ['at_persona_expense', 'costs the persona'],
  ['punch', 'lands immediately'],
  ['compression', 'nothing removable'],
  ['gif_ability', 'works as a GIF'],
  ['event_generatedness', 'made by this event'],
  ['comic_leap', 'surprising leap'],
  ['premise_fidelity', 'keeps its premise'],
  ['factual_support', 'supported by the facts'],
]

// The premise-discovery flavors' step 3 returns one winner per premise plus
// the whole execution record. Reshaped into the candidate list every reader
// on this page already understands; the checks ride along as notes.
const normalizeStep2 = (
  parsed: Record<string, unknown> | null
): Record<string, unknown> | null => {
  if (!parsed || !Array.isArray(parsed.final_candidates)) return parsed
  const out = parsed as ExecuteOutput
  const execs = out.premise_executions ?? []
  const labelOf = (key: string) =>
    CANDIDATE_SCORE_LABELS.find(([k]) => k === key)?.[1] ?? key.replace(/_/g, ' ')
  const joke_candidates: JokeCandidate[] = (out.final_candidates ?? []).map((c) => {
    const ex = execs.find((e) => e.premise_id === c.premise_id)
    const winner =
      ex?.executions?.find((x) => x.execution_id === ex.execution_selection?.winner) ??
      ex?.executions?.[0]
    const loser = ex?.executions?.find((x) => x !== winner)
    const notes = [
      loser?.caption ? `The other execution: \u201c${loser.caption}\u201d` : null,
      ex?.execution_selection?.why_winner ? `Why this one won: ${ex.execution_selection.why_winner}` : null,
      winner?.swap_test?.result
        ? `Swap test ${winner.swap_test.result}${winner.swap_test.explanation ? `: ${winner.swap_test.explanation}` : ''}`
        : null,
      winner?.generic_template_check?.risk
        ? `Template risk ${winner.generic_template_check.risk}${winner.generic_template_check.template_family ? ` (${winner.generic_template_check.template_family})` : ''}`
        : null,
      winner?.fact_integrity
        ? `Fact integrity ${winner.fact_integrity.passes ? 'passes' : 'fails'}${winner.fact_integrity.explanation ? `: ${winner.fact_integrity.explanation}` : ''}`
        : null,
      ex?.finalization?.compression_changes ? `Compression: ${ex.finalization.compression_changes}` : null,
      ex?.gif_pairing?.gif_action
        ? `GIF: ${ex.gif_pairing.gif_action}${ex.gif_pairing.why_it_amplifies ? ` \u2014 ${ex.gif_pairing.why_it_amplifies}` : ''}`
        : null,
    ].filter((n): n is string => Boolean(n))
    const scores = c.scores ?? {}
    const low = Object.entries(scores)
      .filter(([k, v]) => k !== 'overall' && typeof v === 'number')
      .sort((a, b) => (a[1] as number) - (b[1] as number))[0]
    return {
      angle_name: c.angle_name || c.premise_id,
      kernel: c.premise,
      caption: c.caption,
      image_situation: c.image_situation,
      joke_mechanism: ex?.premise_analysis?.odd_implication,
      scores,
      weakest_check: low ? `${labelOf(low[0])} scored ${low[1]}` : undefined,
      execution_notes: notes,
    }
  })
  return {
    ...parsed,
    joke_candidates,
    best: out.best,
    humor_engine: {
      comic_kernels: execs.map((e) => e.premise_analysis?.premise).filter(Boolean),
    },
  }
}

const parseStep2 = (text: string): Record<string, unknown> | null =>
  normalizeStep2(parseJson<Record<string, unknown>>(text))

const candidateTotal = (candidate: JokeCandidate): number =>
  CANDIDATE_SCORE_LABELS.reduce(
    (sum, [key]) => sum + (Number(candidate.scores?.[key]) || 0),
    0
  )

// The number that leads a caption's score line. On the pathology flavors the
// judge reports `overall` as the MINIMUM of its checks, so that is the headline
// and it is out of 5; a caption is only as good as its weakest check. Older
// flavors sum five checks out of 25, and that display is kept for their runs.
const candidateHeadline = (
  candidate: JokeCandidate
): { value: number; max: number; isMin: boolean } => {
  const overall = candidate.scores?.overall
  if (typeof overall === 'number') return { value: overall, max: 5, isMin: true }
  const present = CANDIDATE_SCORE_LABELS.filter(
    ([key]) => typeof candidate.scores?.[key] === 'number'
  ).length
  return { value: candidateTotal(candidate), max: (present || 5) * 5, isMin: false }
}

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

const scoreLine = (scores?: Scores): string => {
  if (!scores) return 'no scores returned'
  const parts = [
    ['trigger', scores.trigger_strength],
    ['persona-specific', scores.persona_specificity],
    ['event-specific', scores.event_specificity],
    ['transformation', scores.comic_transformation],
    ['runway', scores.joke_runway],
    ['pathology payoff', scores.expense_fit],
    ['causal', scores.causal_relevance],
    ['contradiction', scores.comic_contradiction],
    ['runway', scores.behavioral_runway],
    ['clear target', scores.target_clarity],
    ['leverage', scores.satirical_leverage],
    ['mockable', scores.mockability],
    ['one idea one attitude', scores.one_idea_one_attitude],
    ['works as a GIF', scores.gif_ability],
  ]
    .filter(([, v]) => typeof v === 'number')
    .map(([label, v]) => `${label} ${v}/3`)
  return parts.join(' · ')
}

// Five checks of 3 on the older flavors, six on the pathology and cast ones.
const fitMax = (scores?: Scores): number =>
  typeof scores?.expense_fit === 'number' ||
  typeof scores?.satirical_leverage === 'number'
    ? 18
    : 15

type NavEntry = { id: string; label: string; note?: string; children: NavEntry[] }

// Sticky table of contents for a page that runs far past one screen. Nested
// to two levels: the numbered sections, and inside them the individual points
// of view, which are the things actually worth jumping between. Hidden below
// lg, where the page is a single narrow column and scrolling is the nav.
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
        title="Removes the moment, the points of view, and every set of jokes from this page and from this browser's saved run. Saved captions in step 4 stay."
      >
        {canClear ? 'Clear the last run and start a new moment' : 'Nothing from a past run to clear'}
      </button>
      <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
        Jump to a section
      </p>
      <ul className="mt-4 space-y-4">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              className="block text-sm font-semibold leading-snug hover:text-[rgb(var(--accent-strong))]"
            >
              {entry.label}
            </a>
            {entry.note ? (
              <p className="mt-0.5 text-[11px] text-[rgb(var(--muted))]">
                {entry.note}
              </p>
            ) : null}
            {entry.children.length ? (
              <ul className="mt-2 space-y-1.5 border-l border-[rgb(var(--gloss)/0.4)] pl-3 dark:border-[rgb(var(--gloss)/0.15)]">
                {entry.children.map((child) => (
                  <li key={child.id}>
                    <a
                      href={`#${child.id}`}
                      className="block text-[13px] leading-snug text-[rgb(var(--muted))] hover:text-[rgb(var(--accent-strong))]"
                    >
                      {child.label}
                      {child.note ? (
                        <span className="block text-[11px] opacity-70">
                          {child.note}
                        </span>
                      ) : null}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
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

  const recommended = parsed.recommended_concept

  // The whole output, laid out the way the Flavor Maker lays out any step's
  // JSON: every key as a small uppercase label, arrays of like objects as a
  // comparison table with one column per item, scores in colour. Nothing is
  // summarised away — what the model returned is what is on screen. The
  // recommended concept's search terms stay as copy-to-clipboard chips above
  // it, because they are the thing that gets pasted into an image search.
  return (
    <div className="mt-5 space-y-6 border-l-2 border-[rgb(var(--gloss)/0.5)] pl-6 dark:border-[rgb(var(--gloss)/0.2)]">
      {recommended?.best_search_terms?.length ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">
            Search terms for the recommended concept — click one to copy it
          </p>
          <TermChips terms={recommended.best_search_terms} strong />
        </div>
      ) : null}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">
          Everything step 3 returned for this caption
        </p>
        <div className="mt-3">
          <JsonTree data={parsed} />
        </div>
      </div>
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

// The three things you can do to any caption on this page, wherever it came
// from — step 2's five angles, or a premise winner — plus whatever the two
// optional steps have returned for it. Shared so a caption offers the same
// actions in every place it appears.
function CaptionActions({
  saved,
  savedAnchorId,
  onToggleSave,
  onSimplify,
  onFindTerms,
  canSimplify,
  canFindTerms,
  simplifyJob,
  termsJob,
  onSaveSimplifiedVersion,
  isVersionSaved,
}: {
  saved: boolean
  // The caption id, so the saved notice can jump to its entry in step 4.
  savedAnchorId?: string
  onToggleSave: () => void
  onSimplify: () => void
  onFindTerms: () => void
  canSimplify: boolean
  canFindTerms: boolean
  simplifyJob?: CaptionJob
  termsJob?: CaptionJob
  onSaveSimplifiedVersion: (version: SimplifiedVersion) => void
  isVersionSaved: (versionId: number) => boolean
}) {
  return (
    <>
      {saved ? (
        // The saved state has to be readable at a glance, not inferred from
        // which label the button happens to carry — so it is its own line,
        // bold, above the actions, saying where the caption now lives.
        <p className="mt-5 text-sm font-bold">
          ✓ Saved. This caption is in &ldquo;Generate images/GIFs for saved captions&rdquo; below.
          {savedAnchorId ? (
            <>
              {' '}
              <a
                href={`#saved-${savedAnchorId.replace('#', '-')}`}
                className="font-semibold text-[rgb(var(--accent-strong))] hover:underline"
              >
                Jump to it
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      <div className={`${saved ? 'mt-2' : 'mt-4'} flex flex-wrap items-center gap-3`}>
        <button type="button" className={SMALL_BUTTON} onClick={onToggleSave}>
          {saved ? 'Remove this caption from the saved ones' : 'Save this caption'}
        </button>
        <button
          type="button"
          className={SMALL_BUTTON}
          disabled={!canSimplify || simplifyJob?.status === 'running'}
          onClick={onSimplify}
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
          disabled={!canFindTerms || termsJob?.status === 'running'}
          onClick={onFindTerms}
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
          onSaveVersion={onSaveSimplifiedVersion}
          isVersionSaved={isVersionSaved}
        />
      ) : null}
      {termsJob ? <ImageTermsBlock job={termsJob} /> : null}
    </>
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

// One point of view's step-2 output. The caption the model picked leads,
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
      {/* Everything step 2 returned for this point of view, in the Flavor
          Maker's structured view. First in the block so it is findable, but
          collapsed so the picked caption below still reads as the answer. */}
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-[rgb(var(--accent-strong))] hover:underline">
          Show everything step 2 returned for this point of view, laid out field
          by field
        </summary>
        <div className="mt-3 rounded-lg bg-[rgb(var(--panel)/0.6)] p-4 dark:bg-[rgb(var(--panel)/0.3)]">
          <StructuredOutput text={rawText} />
        </div>
      </details>

      {bestCaption ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
            The caption this point of view picked as its best
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
            {candidates.length === 1 ? '' : 's'} this point of view wrote, with
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
              const headline = candidateHeadline(candidate)
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

                  {/* Two columns on wide screens: the caption and what it
                      needs on the left, the judge's analysis on the right,
                      so the scores and the weakest check sit beside the
                      joke they describe instead of under it. */}
                  <div className="min-w-0 lg:grid lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-x-10">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">
                      {candidate.angle_name || `Angle ${i + 1}`}
                      {isBest ? ' · picked as best' : ''}
                      {isFavorite(captionId(personaName, i)) ? (
                        <span className="text-[rgb(var(--ink))]"> · saved</span>
                      ) : null}
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
                      {candidate.kernel && candidate.kernel !== candidate.angle_name ? (
                        <div>
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
                            The comic kernel it came from
                          </dt>
                          <dd className="mt-1 text-sm leading-relaxed">
                            {candidate.kernel}
                          </dd>
                        </div>
                      ) : null}
                    </dl>

                    {(() => {
                      const id = captionId(personaName, i)
                      return (
                        <CaptionActions
                          saved={isFavorite(id)}
                          savedAnchorId={id}
                          onToggleSave={() => onToggleFavorite(candidate, i)}
                          onSimplify={() => onSimplify(candidate, i)}
                          onFindTerms={() => onFindTerms(candidate, i)}
                          canSimplify={canSimplify}
                          canFindTerms={canFindTerms}
                          simplifyJob={simplifyJobs[id]}
                          termsJob={termsJobs[id]}
                          onSaveSimplifiedVersion={(version) =>
                            onSaveSimplified(candidate, i, version)
                          }
                          isVersionSaved={(versionId) =>
                            isFavorite(simplifiedCaptionId(id, versionId))
                          }
                        />
                      )
                    })()}
                  </div>

                  <aside className="mt-6 border-t border-[rgb(var(--gloss)/0.4)] pt-4 dark:border-[rgb(var(--gloss)/0.15)] lg:mt-0 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">
                      How the judge scored it
                    </p>
                    <dl className="mt-3 space-y-1.5">
                      {CANDIDATE_SCORE_LABELS.filter(
                        ([key]) => typeof candidate.scores?.[key] === 'number'
                      ).map(([key, label]) => {
                        const value = candidate.scores?.[key] ?? 0
                        const isLow = headline.isMin && value === headline.value
                        return (
                          <div key={key} className="flex items-baseline justify-between gap-3 text-sm">
                            <dt className={isLow ? 'font-semibold' : 'text-[rgb(var(--muted))]'}>{label}</dt>
                            <dd className={`tabular-nums ${isLow ? 'font-bold' : ''}`}>{value}</dd>
                          </div>
                        )
                      })}
                    </dl>
                    <p className="mt-3 text-sm">
                      <span className="text-[rgb(var(--muted))]">
                        {headline.isMin ? 'Weakest score across all the checks' : 'Total'}
                      </span>
                      <span className="ml-3 text-base font-bold tabular-nums">{headline.value}</span>
                      <span className="text-[rgb(var(--muted))]"> / {headline.max}</span>
                    </p>
                    <dl className="mt-3 space-y-3">
                      {candidate.weakest_check ? (
                        <div>
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
                            Weakest check
                          </dt>
                          <dd className="mt-1 text-sm leading-relaxed">{candidate.weakest_check}</dd>
                        </div>
                      ) : null}
                      {candidate.joke_mechanism ? (
                        <div>
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
                            Why it should be funny
                          </dt>
                          <dd className="mt-1 text-sm leading-relaxed">{candidate.joke_mechanism}</dd>
                        </div>
                      ) : null}
                      {candidate.behavior ? (
                        <div>
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
                            The behavior the caption carries
                          </dt>
                          <dd className="mt-1 text-sm leading-relaxed">{candidate.behavior}</dd>
                        </div>
                      ) : null}
                      {candidate.who_pays ? (
                        <div>
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
                            Who pays in this caption
                          </dt>
                          <dd className="mt-1 text-sm leading-relaxed">{candidate.who_pays}</dd>
                        </div>
                      ) : null}
                      {candidate.execution_notes?.length ? (
                        <div>
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
                            How this execution was chosen
                          </dt>
                          <dd className="mt-1">
                            <ul className="space-y-1.5 text-sm leading-relaxed">
                              {candidate.execution_notes.map((n, k) => (
                                <li key={k}>{n}</li>
                              ))}
                            </ul>
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  </aside>
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
            {(analysis.humor_engine?.comic_kernels ?? analysis.kernels)?.length ? (
              <Field term="The comic kernels it considered before writing">
                {(analysis.humor_engine?.comic_kernels ?? analysis.kernels ?? []).join(' · ')}
              </Field>
            ) : null}
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
                Copy this point of view&rsquo;s raw JSON
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function PovJokesClient({
  flavorId,
  steps,
}: {
  flavorId: number
  steps: PovStep[]
}) {
  const findPovsStep = steps.find((s) => s.orderBy === 1) ?? null
  const writeJokesStep = steps.find((s) => s.orderBy === 2) ?? null
  // The premise-discovery flavors (1562 on) write in two calls: step 2
  // discovers the premises, step 3 executes them, and every later step
  // moves down one. Detected by step 3's placeholder, not by flavor id.
  const executeStep =
    steps.find((s) => s.userPrompt.includes('{{SELECTED_PREMISES}}')) ?? null
  const premiseChain = Boolean(executeStep)
  const later = premiseChain ? 1 : 0
  const imageTermsStep = steps.find((s) => s.orderBy === 3 + later) ?? null
  const simplifyStep = steps.find((s) => s.orderBy === 4 + later) ?? null
  // Step 5 (flavor 1560 on): pair every caption with an image from a set.
  const pairStep = steps.find((s) => s.orderBy === 5 + later) ?? null
  // The event-native cast prompt (1559) has no {{PERSONAS}} placeholder: it
  // derives its cast from the event. The library box would be a lie there.
  const step1UsesLibrary = Boolean(
    findPovsStep && /\{\{\s*PERSONAS\s*\}\}/.test(findPovsStep.userPrompt)
  )

  const [moments, setMoments] = useState<string[]>([''])
  const liveMoments = useMemo(() => liveMomentsOf(moments), [moments])
  const moment = useMemo(() => eventTextFor(moments), [moments])
  const [eventContext, setEventContext] = useState('')
  const [personaLibrary, setPersonaLibrary] = useState(() =>
    defaultPersonaLibrary(findPovsStep)
  )
  // A flavor whose step 1 fits ONE elected character to every moment, rather
  // than searching for whom to mock. Read from the prompt: the field it asks
  // for is the field that makes it that flavor.
  const electsPov = Boolean(findPovsStep?.userPrompt.includes('why_it_fits'))
  const entries = useMemo(() => libraryEntries(personaLibrary), [personaLibrary])
  const [electedPov, setElectedPov] = useState('')
  const elected =
    entries.find((e) => e.name === electedPov) ?? entries[0] ?? null
  // Moments unticked in section 2 because the character does not fit them.
  const [momentsOff, setMomentsOff] = useState<Record<number, boolean>>({})
  const [showPersonaLibrary, setShowPersonaLibrary] = useState(false)
  // The archived-Sidechat moment picker under the moment box; closed by
  // default so typing a moment stays the obvious path.
  const [showSidechatPicker, setShowSidechatPicker] = useState(false)

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
  // The study image set section 4 assigns pictures from.
  const imageSet = useImageSet()
  const [simplified, setSimplified] = useState<Record<string, CaptionJob>>({})
  // Premises the user turned OFF, keyed persona::idea. See premisesFor.
  const [premisesOff, setPremisesOff] = useState<Record<string, boolean>>({})
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

  const storageKey = `pov-jokes:${flavorId}`
  // Favorites are deliberately NOT in the run cache: they survive "Clear the
  // saved run" and accumulate across different moments.
  const favoritesKey = `pov-jokes-favorites:${flavorId}`

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

  // Restore the last run for this flavor: step 1 and the per-POV step 2 calls
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
        if (saved.moments?.length) setMoments(saved.moments)
        else if (saved.moment) setMoments([saved.moment])
        if (saved.electedPov) setElectedPov(saved.electedPov)
        if (saved.momentsOff) setMomentsOff(saved.momentsOff)
        if (saved.eventContext) setEventContext(saved.eventContext)
        // A saved library that is the start of the current default is an
        // older default, not an edit: the default grew (new characters were
        // added), so the saved copy would hide them. An edited library is
        // kept as saved.
        if (saved.personaLibrary) {
          const current = defaultPersonaLibrary(findPovsStep)
          const savedText = saved.personaLibrary.trim()
          if (!current.startsWith(savedText) || savedText === current.trim()) {
            setPersonaLibrary(saved.personaLibrary)
          }
        }
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
        if (saved.premisesOff) setPremisesOff(saved.premisesOff)
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
                        'This call was still running when the page reloaded, so its result was lost. Run this point of view again.',
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
            moments,
            electedPov,
            momentsOff,
            eventContext,
            personaLibrary,
            step1Raw,
            step1PromptHash,
            step1FinishedAt,
            jobs,
            imageTerms,
            simplified,
            premisesOff,
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
    moments,
    electedPov,
    momentsOff,
    eventContext,
    personaLibrary,
    step1Raw,
    step1PromptHash,
    step1FinishedAt,
    jobs,
    imageTerms,
    simplified,
    premisesOff,
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
    setMomentsOff({})
    setExpanded({})
    setImageTerms({})
    setSimplified({})
    setPremisesOff({})
    // The moment and its context go too: "clear the last run" means the
    // page is ready for a NEW moment, not a re-run of the old one.
    setMoments([''])
    setMomentsOff({})
    setEventContext('')
    // Favorites are intentionally left alone — they are the keepers.
  }, [storageKey])

  // Whether there is anything from a past run on the page to clear.
  const hasRunToClear =
    Boolean(step1Raw) || Boolean(moment.trim()) || Boolean(eventContext.trim()) || Object.keys(jobs).length > 0

  const toggleFavorite = useCallback(
    (personaName: string, candidate: JokeCandidate, index: number, momentText?: string) => {
      const id = captionId(personaName, index)
      setFavorites((prev) => {
        if (prev.some((f) => f.id === id)) {
          return prev.filter((f) => f.id !== id)
        }
        return [
          {
            id,
            caption: (candidate.caption ?? '').trim(),
            persona: bareName(personaName),
            angleName: candidate.angle_name ?? `Angle ${index + 1}`,
            gifNote: candidate.image_situation,
            moment: (momentText ?? moment).trim(),
            totalScore: candidateHeadline(candidate).value,
            scoreOutOf: candidateHeadline(candidate).max,
            savedAt: new Date().toISOString(),
            source: 'step2',
          },
          ...prev,
        ]
      })
    },
    [moment]
  )

  // Writes a set image onto a saved caption, or clears it.
  const assignImage = useCallback(
    (favoriteId: string, assignment: ImageAssignment | null) =>
      setFavorites((prev) =>
        prev.map((f) =>
          f.id !== favoriteId
            ? f
            : assignment
              ? { ...f, ...assignment }
              : {
                  ...f,
                  imageId: undefined,
                  imageUrl: undefined,
                  imageWho: undefined,
                  imageFit: undefined,
                  imageWhy: undefined,
                }
        )
      ),
    []
  )
  const [pickingFor, setPickingFor] = useState<string | null>(null)

  // Saves one of step 4's shorter rewrites alongside the originals. It keeps
  // the id of the caption it came from, so section 4 can say which caption it
  // is a simplification of.
  const saveSimplified = useCallback(
    (
      sourceId: string,
      personaName: string,
      angleName: string,
      version: SimplifiedVersion,
      momentText?: string
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
            persona: bareName(personaName),
            angleName: `${angleName} · simplified (${
              SIMPLIFICATION_LEVELS[version.simplification_level ?? ''] ??
              version.simplification_level ??
              'shorter'
            })`,
            moment: (momentText ?? moment).trim(),
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

  // One execution's caption, packaged for the optional per-caption steps.
  // Everything they are told about the joke comes from jokeContextFrom, which
  // is the only place that knows step 1's shape.
  const captionInputFor = useCallback(
    (
      id: string,
      caption: string,
      persona: ResolvedPersona,
      ideaId: string | null,
      simpleImageConcept?: string
    ): CaptionInput => ({
      id,
      caption,
      personaName: persona.persona,
      originalImage: simpleImageConcept,
      jokeContext: jokeContextFrom(
        persona,
        ideaId
          ? (persona.premises.find((premise) => premise.ideaId === ideaId) ??
            null)
          : null
      ),
    }),
    []
  )

  // Saving one premise winner (or one of its alternates, or a wildcard). The
  // premise it came from is what section 4 shows in place of an angle name.
  const toggleExecutionFavorite = useCallback(
    (
      id: string,
      caption: string,
      persona: ResolvedPersona,
      premise: PremiseBlock | null,
      execution: Execution
    ) => {
      setFavorites((prev) => {
        if (prev.some((f) => f.id === id)) return prev.filter((f) => f.id !== id)
        return [
          {
            id,
            caption,
            persona: persona.persona,
            angleName: execution.is_wildcard
              ? 'wildcard — a premise step 1 did not select'
              : premise?.semantic_cluster ||
                premise?.compressed_comic_core ||
                premise?.source_idea_id ||
                'one premise',
            moment: moment.trim(),
            totalScore: executionTotal(execution),
            scoreOutOf: 30,
            savedAt: new Date().toISOString(),
            source: 'step2',
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
      const missing = unfilledPlaceholders(filled)
      if (missing.length) {
        setJobs((prev) => ({
          ...prev,
          [input.id]: {
            captionId: input.id,
            status: 'failed',
            error: `Not sent: this prompt still contains ${missing
              .map((name) => `{{${name}}}`)
              .join(', ')}, which this page does not know how to fill. Nothing was spent on the call.`,
            finishedAt: new Date().toISOString(),
          },
        }))
        return
      }
      const res = await runStepWithSession({
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

  // Step 1 comes back in one of two shapes. The premise-first flavors return
  // the normalized discovery object — personas, moments, activations, paths,
  // and ideas joined by id — and the earlier ones return a flat
  // `selected_personas` roster. Which one it is decides how sections 2 and 3
  // are drawn, so it is settled once, here, from the output itself rather
  // than from a flag someone has to remember to set.
  const step1Json = useMemo(
    () => (step1Raw ? parseJson<unknown>(step1Raw) : null),
    [step1Raw]
  )
  const isDiscovery = useMemo(() => isDiscoverySchema(step1Json), [step1Json])
  // The joins step 2 used to be asked to do in prose, done here in code.
  const resolution = useMemo(
    () => (isDiscovery ? resolveDiscovery(step1Json) : null),
    [isDiscovery, step1Json]
  )
  const discoveryPersonas = useMemo(
    () => resolution?.personas ?? [],
    [resolution]
  )

  // Step 2's prompt says which step 1 it was written for: the premise-first
  // one is the only one with this placeholder. When it wants premises and
  // step 1 did not produce any, the run still works but is not the pipeline
  // anyone intended — so it is said here, before the money is spent, rather
  // than discovered afterwards in a block that looks odd.
  const step2WantsPremises = Boolean(
    writeJokesStep && /\{\{\s*PERSONA_AND_PREMISES\s*\}\}/.test(writeJokesStep.userPrompt)
  )
  const stepsDisagree = Boolean(step1Raw) && step2WantsPremises && !isDiscovery

  const step1Parsed = useMemo(
    () =>
      step1Raw && !isDiscovery ? parseJson<Step1Output>(step1Raw) : null,
    [step1Raw, isDiscovery]
  )
  const pathologyLibrary = useMemo(
    () => parsePathologyLibrary(personaLibrary),
    [personaLibrary]
  )
  const selectedPersonas = useMemo(
    () =>
      (step1Parsed?.selected_personas ?? [])
        .filter((p) => Boolean((p.persona ?? '').trim()))
        .map((p) => attachEvaluation(p, step1Parsed))
        .map((p) => attachPathology(p, pathologyLibrary)),
    [step1Parsed, pathologyLibrary]
  )

  const checkedPersonas = useMemo(
    () => selectedPersonas.filter((p) => checked[p.persona ?? '']),
    [selectedPersonas, checked]
  )

  // Premises default to selected: picking a persona and pressing go must stay
  // exactly as cheap as it was. This records only the ones turned OFF, so a
  // fresh roster needs no initialisation pass and a premise that appears in a
  // later run is not silently pre-unchecked.
  const premiseKey = (personaId: string, ideaId: string): string =>
    `${personaId}::${ideaId}`
  const premisesFor = useCallback(
    (persona: ResolvedPersona): ResolvedPremise[] =>
      persona.premises.filter(
        (premise) => !premisesOff[premiseKey(persona.personaId, premise.ideaId)]
      ),
    [premisesOff]
  )
  const checkedDiscoveryPersonas = useMemo(
    () => discoveryPersonas.filter((persona) => checked[persona.personaId]),
    [discoveryPersonas, checked]
  )
  // What the button actually costs: premises, not personas. A checked persona
  // with every premise turned off is not work, and must not be counted as any.
  const checkedPremiseCount = useMemo(
    () =>
      checkedDiscoveryPersonas.reduce(
        (sum, persona) => sum + premisesFor(persona).length,
        0
      ),
    [checkedDiscoveryPersonas, premisesFor]
  )

  const runFindPovs = useCallback(async () => {
    if (!findPovsStep || !moment.trim()) return
    setStep1Running(true)
    setStep1Error(null)
    const filled = fillTemplate(findPovsStep.userPrompt, {
      EVENT: moment.trim(),
      EVENT_CONTEXT: eventContext.trim() || 'None provided.',
      // The one-POV flavors send only the elected character.
      PERSONAS: electsPov && elected ? elected.block.trim() : personaLibrary.trim(),
    })
    const missing = unfilledPlaceholders(filled)
    if (missing.length) {
      setStep1Running(false)
      setStep1Error(
        `Not sent: step 1's prompt still contains ${missing
          .map((name) => `{{${name}}}`)
          .join(', ')} after this page filled it in. This page fills {{EVENT}}, {{EVENT_CONTEXT}}, and {{PERSONAS}}. Nothing was spent on the call.`
      )
      return
    }
    const res = await runStepWithSession({
      imageId: null,
      systemPrompt: findPovsStep.systemPrompt,
      userPrompt: filled,
      providerModelId: findPovsStep.providerModelId,
      temperature: findPovsStep.temperature,
      includeImage: false,
      isTemperatureSupported: findPovsStep.isTemperatureSupported,
      priorOutputs: {},
      reasoningEffort: STEP1_REASONING_EFFORT,
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
    setMomentsOff({})
    setExpanded({})
    setPremisesOff({})
  }, [findPovsStep, moment, eventContext, personaLibrary, electsPov, elected, currentStep1Hash])

  const runOnePov = useCallback(
    async (persona: SelectedPersona, momentIndex = 0) => {
      const name = (persona.persona ?? '').trim()
      const momentText = liveMoments[momentIndex] ?? moment.trim()
      if (!writeJokesStep || !name || !momentText) return
      const key = jobKeyFor(name, momentIndex)
      setJobs((prev) => ({
        ...prev,
        [key]: {
          persona: name,
          momentIndex,
          status: 'running',
          phase: premiseChain ? 'discovering the premises\u2026' : undefined,
        },
      }))
      // Everything step 1 said about this POV is the persona context — its
      // JSON contract exists precisely to be handed to this prompt. Step 2
      // sees ONE moment, so it gets that moment's grounding only.
      const context = personaContextFor(persona, momentIndex)
      const filled = fillTemplate(writeJokesStep.userPrompt, {
        EVENT: momentText,
        PERSONA: name,
        PERSONA_CONTEXT: JSON.stringify(context, null, 2),
        // The premise-discovery step 2 takes the last run's premises to
        // avoid; a first run has none.
        PREVIOUS_PREMISES: 'None.',
      })
      const missing = unfilledPlaceholders(filled)
      if (missing.length) {
        const finishedAt = new Date().toISOString()
        setJobs((prev) => ({
          ...prev,
          [key]: {
            persona: name,
            momentIndex,
            status: 'failed',
            error: `Not sent: step 2's prompt still contains ${missing
              .map((name) => `{{${name}}}`)
              .join(', ')} after this page filled it in. That usually means step 2 was written for a different step 1 than the one this flavor has. Nothing was spent on the call.`,
            promptHash: currentStep2Hash,
            finishedAt,
          },
        }))
        return
      }
      const startedAt = Date.now()
      const res = await runStepWithSession({
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
      // On the premise-discovery flavors step 2 only found the premises;
      // step 3 writes the jokes from them, in a second call, and its output
      // is what the page reads as "the jokes". Step 2's output is kept
      // beside it.
      let finalRes = res
      let discoverText: string | undefined
      if (premiseChain && executeStep && res.ok) {
        discoverText = res.text ?? ''
        const discovered = parseJson<DiscoverOutput>(discoverText)
        if (!discovered) {
          finalRes = {
            ok: false,
            error: 'Step 2 returned text that is not valid JSON, so step 3 could not be given its premises.',
          }
        } else {
          setJobs((prev) => ({
            ...prev,
            [key]: { ...prev[key], persona: name, momentIndex, status: 'running', phase: 'executing the premises\u2026' },
          }))
          const filled3 = fillTemplate(executeStep.userPrompt, {
            EVENT: momentText,
            PERSONA: name,
            PERSONA_CONTEXT: JSON.stringify(context, null, 2),
            EVENT_ANALYSIS: JSON.stringify(discovered.event_analysis ?? null, null, 2),
            CHARACTER_ROLE: JSON.stringify(discovered.character_role ?? null, null, 2),
            SELECTED_PREMISES: JSON.stringify(discovered.selected_premises ?? [], null, 2),
            PREVIOUS_JOKES: 'None.',
          })
          const missing3 = unfilledPlaceholders(filled3)
          if (missing3.length) {
            finalRes = {
              ok: false,
              error: `Not sent: step 3's prompt still contains ${missing3
                .map((n) => `{{${n}}}`)
                .join(', ')} after this page filled it in. This page fills {{EVENT}}, {{PERSONA}}, {{PERSONA_CONTEXT}}, {{EVENT_ANALYSIS}}, {{CHARACTER_ROLE}}, {{SELECTED_PREMISES}}, and {{PREVIOUS_JOKES}}. Step 2 ran; step 3 was not sent.`,
            }
          } else {
            finalRes = await runStepWithSession({
              imageId: null,
              systemPrompt: executeStep.systemPrompt,
              userPrompt: filled3,
              providerModelId: executeStep.providerModelId,
              temperature: executeStep.temperature,
              includeImage: false,
              isTemperatureSupported: executeStep.isTemperatureSupported,
              priorOutputs: {},
              reasoningEffort: REASONING_EFFORT,
              maxOutputTokens: MAX_OUTPUT_TOKENS,
            })
          }
        }
      }
      const durationMs = Date.now() - startedAt
      const finishedAt = new Date().toISOString()
      setJobs((prev) => ({
        ...prev,
        [key]: finalRes.ok
          ? {
              persona: name,
              momentIndex,
              status: 'done',
              text: finalRes.text ?? '',
              discoverText,
              durationMs,
              promptHash: currentStep2Hash,
              finishedAt,
            }
          : {
              persona: name,
              momentIndex,
              status: 'failed',
              error: finalRes.error ?? (premiseChain ? 'Step 2 or 3 failed.' : 'Step 2 failed.'),
              discoverText,
              durationMs,
              promptHash: currentStep2Hash,
              finishedAt,
            },
      }))
      // The captions render on their own; only the machinery behind them is
      // collapsible, and it stays collapsed until asked for.
    },
    [writeJokesStep, executeStep, premiseChain, moment, liveMoments, currentStep2Hash]
  )

  // Step 2 on the premise-first flavors. Still one call per persona — but the
  // premises are pre-joined here and only the checked ones are sent, so the
  // prompt receives a flat object with nothing left to look up, and the user
  // pays for exactly the premises still ticked.
  const runOnePersona = useCallback(
    async (persona: ResolvedPersona) => {
      if (!writeJokesStep) return
      const premises = premisesFor(persona)
      if (!premises.length) return
      const key = persona.personaId
      setJobs((prev) => ({
        ...prev,
        [key]: { persona: persona.persona, status: 'running' },
      }))
      const filled = fillTemplate(writeJokesStep.userPrompt, {
        PERSONA_AND_PREMISES: JSON.stringify(
          buildS2Payload(persona, premises),
          null,
          2
        ),
        // Sent for the flavors whose prompt still names them. An unused
        // placeholder costs nothing; a missing one shows up in the prompt.
        EVENT: moment.trim(),
        PERSONA: persona.persona,
      })
      const missing = unfilledPlaceholders(filled)
      if (missing.length) {
        const finishedAt = new Date().toISOString()
        setJobs((prev) => ({
          ...prev,
          [key]: {
            persona: persona.persona,
            status: 'failed',
            error: `Not sent: step 2's prompt still contains ${missing
              .map((name) => `{{${name}}}`)
              .join(', ')} after this page filled it in. That usually means step 2 was written for a different step 1 than the one this flavor has. Nothing was spent on the call.`,
            promptHash: currentStep2Hash,
            finishedAt,
          },
        }))
        return
      }
      const startedAt = Date.now()
      const res = await runStepWithSession({
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
        [key]: res.ok
          ? {
              persona: persona.persona,
              status: 'done',
              text: res.text ?? '',
              durationMs,
              promptHash: currentStep2Hash,
              finishedAt,
            }
          : {
              persona: persona.persona,
              status: 'failed',
              error: res.error ?? 'Step 2 failed.',
              durationMs,
              promptHash: currentStep2Hash,
              finishedAt,
            },
      }))
    },
    [writeJokesStep, moment, currentStep2Hash, premisesFor]
  )

  // Runs the picked personas a few at a time. Nothing here starts on its own —
  // every call into this comes from a button press. Shared by both step-1
  // shapes: they differ only in what one call is and what key it is filed
  // under, both of which the caller has already decided.
  const runQueue = useCallback(
    async (queue: { key: string; personaName: string; run: () => Promise<void> }[]) => {
      if (!queue.length) return
      setJobs((prev) => {
        const next = { ...prev }
        queue.forEach(({ key, personaName }) => {
          next[key] = { persona: personaName, status: 'queued' }
        })
        return next
      })
      let cursor = 0
      const worker = async (): Promise<void> => {
        while (cursor < queue.length) {
          const index = cursor
          cursor += 1
          await queue[index].run()
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker)
      )
    },
    []
  )

  // Every checked point of view for every moment: the unit of work is the
  // (moment, persona) pair, and one moment is the list of one.
  const runManyPovs = useCallback(
    async (personas: SelectedPersona[]) =>
      runQueue(
        personas
          .filter((p) => (p.persona ?? '').trim())
          .flatMap((p) =>
            liveMoments
              .map((_, momentIndex) => momentIndex)
              .filter((momentIndex) => !momentsOff[momentIndex])
              .map((momentIndex) => ({
                key: jobKeyFor((p.persona ?? '').trim(), momentIndex),
                personaName: (p.persona ?? '').trim(),
                run: () => runOnePov(p, momentIndex),
              }))
          )
      ),
    [runQueue, runOnePov, liveMoments, momentsOff]
  )
  const electedMomentCount = liveMoments.filter((_, i) => !momentsOff[i]).length

  // A persona's runs across every moment, in moment order, for the status
  // line beside it in section 2.
  const jobsFor = useCallback(
    (name: string): (JokeJob | undefined)[] =>
      liveMoments.map((_, i) => jobs[jobKeyFor(name, i)]),
    [jobs, liveMoments]
  )

  const runManyPersonas = useCallback(
    async (personas: ResolvedPersona[]) =>
      runQueue(
        personas
          .filter((persona) => premisesFor(persona).length)
          .map((persona) => ({
            key: persona.personaId,
            personaName: persona.persona,
            run: () => runOnePersona(persona),
          }))
      ),
    [runQueue, runOnePersona, premisesFor]
  )

  const anyRunning = Object.values(jobs).some(
    (j) => j.status === 'running' || j.status === 'queued'
  )
  const step1Stale = Boolean(
    step1Raw && step1PromptHash && step1PromptHash !== currentStep1Hash
  )

  // Whatever has actually been run, in one shape both step-1 schemas can fill.
  // `resolved` is the persona with its premises joined, which only exists on
  // the discovery path; section 3 stubs it when it is null.
  const ranEntries: {
    key: string
    label: string
    // The moment this run wrote for, and its position in the page's list.
    moment: string
    momentIndex: number
    resolved: ResolvedPersona | null
  }[] = isDiscovery
    ? discoveryPersonas
        .filter((persona) => jobs[persona.personaId])
        .map((persona) => ({
          key: persona.personaId,
          label: persona.persona,
          moment: liveMoments[0] ?? moment.trim(),
          momentIndex: 0,
          resolved: persona,
        }))
    : // One entry per (moment, persona) that has run, moment-major so section
      // 3 reads one moment's jokes together. Key and label are the same
      // string: the caption ids downstream are built from either.
      liveMoments.flatMap((momentText, momentIndex) =>
        selectedPersonas
          .map((p) => (p.persona ?? '').trim())
          .filter((name) => name && jobs[jobKeyFor(name, momentIndex)])
          .map((name) => ({
            key: jobKeyFor(name, momentIndex),
            label: jobKeyFor(name, momentIndex),
            moment: momentText,
            momentIndex,
            resolved: null,
          }))
      )

  // On the one-POV flavors the moment blocks read best-fit first.
  if (electsPov && selectedPersonas[0]?.per_event?.length) {
    const notes = selectedPersonas[0].per_event
    const fitOf = (i: number) =>
      notes.find((n) => Number(n.event) === i + 1)?.fits ?? notes[i]?.fits ?? 0
    ranEntries.sort((a, b) => fitOf(b.momentIndex) - fitOf(a.momentIndex))
  }

  // Every scored caption on the page, flattened for the ranked list at the top
  // of section 3. Read from each run's finished output; both step-2 shapes
  // contribute, each carrying its own maximum.
  const rankedRows: RankedJokeRow[] = ranEntries.flatMap((entry) => {
    const job = jobs[entry.key]
    if (!job?.text || job.status !== 'done') return []
    const parsed = parseStep2(job.text)
    const shape = step2Shape(parsed)
    const povAnchorId = `jokes-${slugify(entry.key)}`
    if (shape === 'legacy') {
      const out = parsed as Step2Output
      const bestCaption = (out.best?.best_caption ?? '').trim()
      return (out.joke_candidates ?? []).flatMap((candidate, i) => {
        const caption = (candidate.caption ?? '').trim()
        if (!caption) return []
        const id = captionId(entry.key, i)
        return [
          {
            id,
            caption,
            povLabel: entry.label,
            povAnchorId,
            angle: candidate.angle_name || `Angle ${i + 1}`,
            total: candidateHeadline(candidate).value,
            max: candidateHeadline(candidate).max,
            // A minimum ties often; the sum of the checks breaks the tie.
            tiebreak: candidateTotal(candidate),
            gifNote: candidate.image_situation,
            scores: CANDIDATE_SCORE_LABELS.filter(
              ([key]) => typeof candidate.scores?.[key] === 'number'
            ).map(([key, label]) => ({ label, value: Number(candidate.scores?.[key]) })),
            pickedAsBest: Boolean(bestCaption) && caption === bestCaption,
            saved: favorites.some((f) => f.id === id),
            onToggleSave: () => toggleFavorite(entry.key, candidate, i),
          },
        ]
      })
    }
    if (shape === 'premise') {
      const out = parsed as PremiseJokesOutput
      const persona: ResolvedPersona = entry.resolved ?? {
        personaId: entry.key,
        persona: entry.label,
        personaBaseline: null,
        generalProcessingRule: null,
        premises: [],
        problems: [],
      }
      const bestId = out.best_overall_execution_id ?? ''
      const pairs: { execution: Execution; premise: PremiseBlock | null }[] = [
        ...(out.premises ?? []).flatMap((premise) =>
          (premise.executions ?? []).map((execution) => ({ execution, premise }))
        ),
        ...(out.wildcards ?? []).map((execution) => ({ execution, premise: null })),
      ]
      return pairs.flatMap(({ execution, premise }) => {
        const caption = (execution.caption ?? '').trim()
        if (!caption) return []
        const id = executionCaptionId(persona.personaId, execution.execution_id ?? '')
        return [
          {
            id,
            caption,
            povLabel: entry.label,
            povAnchorId,
            angle: premise
              ? premise.compressed_comic_core || premise.source_idea_id || 'premise'
              : 'wildcard',
            total: executionTotal(execution),
            max: EXECUTION_SCORE_LABELS.length * 5,
            scores: EXECUTION_SCORE_LABELS.filter(
              ([key]) => typeof execution.scores?.[key] === 'number'
            ).map(([key, label]) => ({ label, value: Number(execution.scores?.[key]) })),
            pickedAsBest: Boolean(bestId) && execution.execution_id === bestId,
            saved: favorites.some((f) => f.id === id),
            onToggleSave: () => toggleExecutionFavorite(id, caption, persona, premise, execution),
          },
        ]
      })
    }
    return []
  })

  // The persona library editor. On the one-POV flavors it lives in the
  // select-a-point-of-view section, since that is where characters come from.
  const libraryBlock = step1UsesLibrary ? (
          <div>
            <button
              type="button"
              className="text-sm font-semibold text-[rgb(var(--accent-strong))] hover:underline"
              onClick={() => setShowPersonaLibrary((v) => !v)}
            >
              {showPersonaLibrary ? 'Hide' : 'Show'} the recurring persona
              library the model scores against (
              {personaLibrary.split('\n').filter((l) => /^\s*\*\s/.test(l)).length}{' '}
              personas)
            </button>
            {showPersonaLibrary ? (
              <>
                <p className={FIELD_HELP}>
                  One persona per bullet. On the pathology flavors each bullet
                  carries four lines: what the persona wants, pretends, does
                  compulsively at a cost, and would never admit; on the
                  earlier flavors it is one line of comic logic. Fills{' '}
                  <code>{'{{PERSONAS}}'}</code> in the step-1 prompt.
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
                  onClick={() =>
                    setPersonaLibrary(defaultPersonaLibrary(findPovsStep))
                  }
                >
                  Reset the library to this flavor&rsquo;s default
                </button>
              </>
            ) : null}
          </div>
          ) : (
            <p className={FIELD_HELP}>
              This flavor&rsquo;s step 1 derives its cast from the event itself
              (power-holders, spinners, implementers, affected people,
              opportunists) and does not read a persona library.
            </p>
          )

  const navEntries: NavEntry[] = [
    {
      id: 'describe-the-moment',
      label: liveMoments.length > 1
        ? `1. Describe the ${liveMoments.length} moments you want jokes about`
        : `1. Describe the moment you want jokes about`,
      note: moment.trim() ? undefined : 'Nothing typed yet',
      children: [],
    },
    ...(electsPov
      ? [
          {
            id: 'select-point-of-view',
            label: '2. Select the point of view and find its angle on each moment',
            note: !elected
              ? 'No character in the library'
              : !selectedPersonas[0]
                ? `${elected.name} · angles not found yet`
                : `${selectedPersonas[0].persona} · fits ${(selectedPersonas[0].per_event ?? []).filter((n) => (n.fits ?? 0) >= 2).length} of ${liveMoments.length} moments well · ${electedMomentCount} ticked`,
            children: [],
          },
        ]
      : []),
    ...(electsPov ? [] : [{
      id: 'choose-points-of-view',
      label: isDiscovery
        ? `2. Choose which personas and premises get jokes`
        : electsPov
          ? `2. Confirm the point of view fits each moment`
          : `2. Choose which points of view get the full joke treatment`,
      note: isDiscovery
        ? discoveryPersonas.length
          ? `${discoveryPersonas.length} personas, ${checkedPremiseCount} premise${
              checkedPremiseCount === 1 ? '' : 's'
            } checked`
          : 'Run step 1 first'
        : selectedPersonas.length
          ? `${selectedPersonas.length} found, ${checkedPersonas.length} checked`
          : 'Run step 1 first',
      children: (isDiscovery
        ? discoveryPersonas.map((persona) => ({
            key: persona.personaId,
            label: persona.persona,
            extra: `${premisesFor(persona).length}/${persona.premises.length} premises`,
          }))
        : selectedPersonas.map((p) => ({
            key: (p.persona ?? '').trim(),
            label: p.persona ?? '',
            extra: '',
          }))
      ).map(({ key, label, extra }) => {
        const status = jobs[key]?.status ?? 'not-run'
        const state =
          status === 'done'
            ? 'jokes written'
            : status === 'failed'
              ? 'failed'
              : status === 'running' || status === 'queued'
                ? 'running'
                : 'not run yet'
        return {
          id: `choose-${slugify(key)}`,
          label,
          note: extra ? `${extra} · ${state}` : state,
          children: [],
        }
      }),
    }]),
    {
      id: 'read-the-jokes',
      label: isDiscovery
        ? `3. Read the jokes each persona produced`
        : electsPov
          ? '3. Write the jokes for each moment from this point of view'
          : `3. Read the jokes each point of view produced`,
      note: ranEntries.length
        ? `${ranEntries.length} ${isDiscovery ? 'persona' : 'point'}${
            ranEntries.length === 1 ? '' : 's'
          }${isDiscovery ? '' : ' of view'} run`
        : 'Nothing run yet',
      children: [
        ...(rankedRows.length
          ? [
              {
                id: 'all-jokes-ranked',
                label: `Every joke from every ${isDiscovery ? 'persona' : 'point of view'}, ranked`,
                note: `${rankedRows.length} captions`,
                children: [],
              },
            ]
          : []),
        ...ranEntries.map((entry) => ({
          id: `jokes-${slugify(entry.key)}`,
          label: entry.label,
          children: [],
        })),
      ],
    },
    {
      id: 'saved-captions',
      label: `4. Generate images/GIFs for saved captions`,
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
            id: 'rejected-points-of-view',
            label:
              'Reference: the points of view step 1 did not select',
            children: [],
          },
        ]
      : []),
  ]

  const modelLine = findPovsStep
    ? `${findPovsStep.modelName} (${findPovsStep.providerModelId}) at ${REASONING_EFFORT} reasoning effort`
    : 'no model set'

  // What each per-moment fit score means, in the prompt's own words. Kept
  // for runs from before the checks were named.
  const FIT_MEANING = [
    'the character has no move here',
    'it could say something, but nothing in the moment is specific to it',
    'one clear detail of the moment activates its instinct',
    'the moment is this character\u2019s behavior on display',
  ]
  // The three named checks behind the fit score, in the prompt's order.
  const FIT_CHECK_LABELS: Record<string, string> = {
    distinctive_detail: 'A specific detail of this moment sets the character off',
    character_is_actor: 'The character itself did or said something in the moment',
    pathology_on_display: 'What it did or said already shows its pathology, so no behavior needs inventing',
  }

  // The fit, as the three checks with their answers and reasons; older runs
  // fall back to the score's meaning and the deficit sentence.
  const fitChecksBlock = (note: PerEventNote) => {
    const fits = typeof note.fits === 'number' ? note.fits : null
    if (note.fit_checks?.length) {
      return (
        <ul className="mt-3 space-y-2">
          {note.fit_checks.map((k, i) => (
            <li key={i} className="flex items-start gap-2 text-sm leading-snug">
              <span className={`mt-0.5 shrink-0 font-bold ${k.passes ? 'text-emerald-700' : 'text-amber-700 dark:text-amber-400'}`}>
                {k.passes ? '\u2713' : '\u2717'}
              </span>
              <span>
                <span className={k.passes ? 'font-semibold' : 'font-semibold text-amber-700 dark:text-amber-400'}>
                  {FIT_CHECK_LABELS[k.check ?? ''] ?? (k.check ?? '').replace(/_/g, ' ')}
                </span>
                {k.reason ? <span className="text-[rgb(var(--muted))]"> \u2014 {k.reason}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )
    }
    if (fits !== null && fits < 3) {
      return (
        <p className="mt-3 rounded-lg bg-amber-500/10 p-3 text-sm leading-relaxed text-amber-700 dark:text-amber-400">
          <span className="font-semibold">What holds it at {fits}: </span>
          {note.fit_deficit ||
            'step 1 did not say. Run it again with the current prompt, which answers three named checks.'}
        </p>
      )
    }
    return null
  }

  // The character's reading of one moment, field by field: the same card
  // the persona used to get, filled with that moment's terms. Shown in
  // section 2 under each moment and beside that moment's jokes in section 3.
  const angleFields = (persona: SelectedPersona, note: PerEventNote) => (
                        <dl className="mt-4 space-y-3">
                          {note.persona_event_translation ? (
                            <Field term="How it reads the moment">{note.persona_event_translation}</Field>
                          ) : null}
                          {note.comic_contradiction ? (
                            <Field term="The tension powering the joke">{note.comic_contradiction}</Field>
                          ) : null}
                          {note.trigger_feature ? (
                            <Field term="What in this moment sets it off">{note.trigger_feature}</Field>
                          ) : null}
                          {note.joke_target ? (
                            <Field term="What ends up ridiculous">{note.joke_target}</Field>
                          ) : null}
                          {persona.persona_pathology?.pretends ? (
                            <Field term="What this persona pretends">{persona.persona_pathology.pretends}</Field>
                          ) : null}
                          {persona.persona_pathology?.would_never_admit ? (
                            <Field term="What it would never admit">{persona.persona_pathology.would_never_admit}</Field>
                          ) : null}
                          {persona.comic_emotion ? (
                            <Field term="The one emotion it plays">{persona.comic_emotion}</Field>
                          ) : null}
                          {note.best_reactions?.length ? (
                            <Field term="The reactions to play here, and the GIF each maps to">
                              {note.best_reactions
                                .map((r) => {
                                  const gif = persona.emotional_palette?.find((e) => e.reaction === r)?.gif_emotion
                                  return gif ? `${r} \u2192 ${gif}` : r
                                })
                                .join(' \u00b7 ')}
                            </Field>
                          ) : null}
                          {note.manifestations?.length ? (
                            <Field term="Where it shows up in this moment">{note.manifestations.join(' \u00b7 ')}</Field>
                          ) : null}
                          {note.reusable_engine ? (
                            <Field term="The reusable engine">{note.reusable_engine}</Field>
                          ) : null}
                          {note.punch_direction ? (
                            <Field term="Which way the joke punches">{note.punch_direction}</Field>
                          ) : null}
                          {note.why_promising ? (
                            <Field term="Why step 1 thinks it is promising">{note.why_promising}</Field>
                          ) : null}
                        </dl>
  )

  // One card per moment: how the elected character fits it, laid out field
  // by field, with the tick that decides whether step 3 writes for it.
  const momentFitRows = (persona: SelectedPersona) =>
    persona.per_event?.length ? (
      <div className="pt-3">
        <p className="text-sm font-semibold">
          {electsPov
            ? `${persona.persona}\u2019s angle on each moment \u2014 tick the ones to write jokes for`
            : 'How this character shows up in each moment'}
        </p>
        {electsPov ? (
          <p className={`${FIELD_HELP} mt-1`}>
            The fit score counts three checks the prompt answers for every moment, each with a reason:
            a specific detail of the moment sets the character off; the character itself did or said
            something in it; and what it did or said already shows its pathology. Step 1 also scored{' '}
            {persona.persona} as a character across all the moments:{' '}
            <span className="font-semibold text-[rgb(var(--ink))]">
              {fitTotal(persona.scores) ?? '?'} out of {fitMax(persona.scores)}
            </span>{' '}
            ({scoreLine(persona.scores)}).
          </p>
        ) : null}
        <ul className="mt-4 space-y-6">
          {liveMoments.map((momentText, i) => {
            const note =
              persona.per_event?.find((n) => Number(n.event) === i + 1) ??
              persona.per_event?.[i]
            const on = !momentsOff[i]
            const fits = typeof note?.fits === 'number' ? note.fits : null
            const boxId = `moment-on-${slugify(persona.persona ?? '')}-${i}`
            // The moment's first line, cut at a word so it reads as a title.
            const firstLine = momentText.split('\n')[0] ?? ''
            const title =
              firstLine.length > 120
                ? `${firstLine.slice(0, 120).replace(/\s+\S*$/, '')}\u2026`
                : firstLine
            return (
              <li
                key={i}
                className={`rounded-xl bg-[rgb(var(--panel)/0.7)] p-5 dark:bg-[rgb(var(--panel)/0.3)] ${on ? '' : 'opacity-60'}`}
              >
                <div className="flex items-start gap-4">
                  <input
                    type="checkbox"
                    id={boxId}
                    className="mt-1.5 h-4 w-4 shrink-0"
                    checked={on}
                    disabled={anyRunning}
                    onChange={(e) =>
                      setMomentsOff((prev) => ({ ...prev, [i]: !e.target.checked }))
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <label htmlFor={boxId} className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">
                        Moment {i + 1}
                      </label>
                      {fits !== null ? (
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">
                          {note?.fit_checks?.length ? `${fits} of 3 checks pass` : `fit ${fits} of 3`}
                        </span>
                      ) : null}
                      {fits !== null && !note?.fit_checks?.length && FIT_MEANING[fits] ? (
                        <span className="text-xs text-[rgb(var(--muted))]">{FIT_MEANING[fits]}</span>
                      ) : null}
                    </div>
                    <label htmlFor={boxId} className={`mt-1 block text-base font-semibold leading-snug ${on ? '' : 'line-through'}`}>
                      {title}
                    </label>
                    {note ? (
                      <>
                        {note.why_it_fits ? (
                          <p className="mt-3 text-sm leading-relaxed">{note.why_it_fits}</p>
                        ) : null}
                        {/* The three checks, answered, so a 2 says which
                            one failed and why. */}
                        {fitChecksBlock(note)}
                        {/* The same card the persona gets, filled with this
                            moment's reading. Character-level lines (what it
                            pretends, the one emotion) repeat on every card so
                            each reads on its own. */}
                        {angleFields(persona, note)}
                      </>
                    ) : (
                      <p className="mt-2 text-sm text-[rgb(var(--muted))]">
                        Step 1 said nothing about this moment.
                      </p>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    ) : null

  if (!findPovsStep || !writeJokesStep) {
    return (
      <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-400">
        This flavor needs at least two steps — step 1 to find the points of
        view and step 2 to write jokes from one point of view. Two further
        steps are optional and their buttons stay disabled without them: step
        3 finds searchable image concepts for one caption, and step 4
        simplifies one caption into shorter versions. This flavor currently
        has {steps.length}.
      </div>
    )
  }

  // Step 1's button and its results. Rendered in the moments section, or on
  // the one-POV flavors in the point-of-view section, where it belongs.
  const findPovsBlock = (
    <>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <button
            type="button"
            className={BIG_BUTTON}
            disabled={step1Running || !moment.trim()}
            onClick={runFindPovs}
          >
            {step1Running
              ? electsPov
                ? 'Finding the angles…'
                : 'Finding the points of view…'
              : electsPov
                ? `Find ${elected?.name ?? 'the character'}\u2019s angle on ${liveMoments.length === 1 ? 'this moment' : `each of the ${liveMoments.length} moments`}`
                : 'Find the points of view worth joking from'}
          </button>
          <span className="text-xs text-[rgb(var(--muted))]">
            One call to {modelLine}. This does not write any jokes.
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
        {step1Raw && !step1Parsed && !isDiscovery ? (
          <p className="mt-4 max-w-3xl rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            Step 1 returned text that is not valid JSON, so no points of view
            could be listed. The raw output is below.
          </p>
        ) : null}
        {/* On the one-POV flavors the per-moment rows below already show every
            field that matters, so the field-by-field dump only appears when
            step 1 returned something the page could not read. */}
        {step1Raw && !(electsPov && step1Parsed) ? (
          <div className="mt-4">
            <button
              type="button"
              className="text-sm font-semibold text-[rgb(var(--accent-strong))] hover:underline"
              onClick={() => setShowStep1Raw((v) => !v)}
            >
              {showStep1Raw ? 'Hide' : 'Show'} everything step 1 returned, laid
              out field by field
            </button>
            {showStep1Raw ? (
              <div className="mt-3 rounded-lg bg-[rgb(var(--panel)/0.6)] p-4 dark:bg-[rgb(var(--panel)/0.3)]">
                {/* The Flavor Maker's structured view of a step's JSON: every
                    key an uppercase label, lists of like objects as a table. */}
                <StructuredOutput text={step1Raw} />
              </div>
            ) : null}
          </div>
        ) : null}

        {isDiscovery ? (
          <div className="mt-8 max-w-3xl space-y-4">
            {step1Stale ? (
              <p className="rounded-lg bg-amber-500/10 p-3 text-sm leading-relaxed text-amber-700 dark:text-amber-400">
                Step 1&rsquo;s prompt in the database has changed since these
                personas were discovered, so what you see below came from an
                older version of the prompt. Run step 1 again to use the
                current one.
              </p>
            ) : null}

            {/* The answer, stated before any of step 1's working-out. The
                unit that matters here is the premise, because that is what
                section 2 spends money on. */}
            <p className="text-lg font-semibold">
              {discoveryPersonas.length
                ? `Step 1 found ${discoveryPersonas.length} persona${
                    discoveryPersonas.length === 1 ? '' : 's'
                  } worth joking from, with ${discoveryPersonas.reduce(
                    (sum, persona) => sum + persona.premises.length,
                    0
                  )} comic premises between them.`
                : 'Step 1 selected no personas for this moment.'}{' '}
              {discoveryPersonas.length ? (
                <a
                  href="#choose-points-of-view"
                  className="font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                >
                  Pick which ones get jokes in section 2 below →
                </a>
              ) : null}
            </p>

            {/* Every join this page could not complete. A premise that lost
                its moment still runs; it simply arrives thinner, and saying
                so here is the difference between a diagnosable contract
                mismatch and jokes that quietly came out vague. */}
            {resolution?.problems.length ? (
              <div className="rounded-lg bg-amber-500/10 p-3 text-sm leading-relaxed text-amber-700 dark:text-amber-400">
                <p className="font-semibold">
                  {resolution.problems.length} thing
                  {resolution.problems.length === 1 ? '' : 's'} in step
                  1&rsquo;s output could not be read:
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {resolution.problems.map((problem, i) => (
                    <li key={i}>{problem}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {step1FinishedAt ? (
              <p className="text-xs text-[rgb(var(--muted))]">
                {formatWhen(step1FinishedAt)}. This page keeps your latest run
                in this browser, so a reload does not cost you a re-run.{' '}
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
          </div>
        ) : null}

        {step1Parsed ? (
          <div className="mt-8 max-w-3xl space-y-4">
            {step1Stale ? (
              <p className="rounded-lg bg-amber-500/10 p-3 text-sm leading-relaxed text-amber-700 dark:text-amber-400">
                Step 1&rsquo;s prompt in the database has changed since these
                points of view were generated, so what you see below came from
                an older version of the prompt. Run step 1 again to use the
                current one.
              </p>
            ) : null}

            {/* The answer, stated before any of step 1's working-out. */}
            <p className="text-lg font-semibold">
              {electsPov && selectedPersonas[0]
                ? (() => {
                    const notes = selectedPersonas[0].per_event ?? []
                    const all = notes.filter((n) => (n.fits ?? 0) >= 3).length
                    const some = notes.filter((n) => (n.fits ?? 0) === 2).length
                    return `Step 1 checked ${selectedPersonas[0].persona} against ${liveMoments.length} moment${liveMoments.length === 1 ? '' : 's'}: ${all} pass all three checks, ${some} pass two.`
                  })()
                : selectedPersonas.length
                  ? `Step 1 found ${selectedPersonas.length} point${
                      selectedPersonas.length === 1 ? '' : 's'
                    } of view worth joking from.`
                  : 'Step 1 selected no points of view for this moment.'}{' '}
              {selectedPersonas.length && !electsPov ? (
                <a
                  href="#choose-points-of-view"
                  className="font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                >
                  Pick which ones get jokes in section 2 below →
                </a>
              ) : null}
            </p>

            {/* On the one-POV flavors the answer IS the angle per moment, so
                it comes right here, before any of step 1's working-out. */}
            {electsPov && selectedPersonas[0] ? momentFitRows(selectedPersonas[0]) : null}

            {step1FinishedAt ? (
              <p className="text-xs text-[rgb(var(--muted))]">
                {formatWhen(step1FinishedAt)}. This page keeps your latest run
                — the moment, the points of view, and every set of jokes — in
                this browser, so a reload does not cost you a re-run.{' '}
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
                Show how step 1 read the moment before it considered any point
                of view — background, not the list of points of view
              </summary>
              <div className="mt-3">
                {step1Parsed.event?.event_core ? (
                  <p className="text-sm leading-relaxed text-[rgb(var(--muted))]">
                    {step1Parsed.event.event_core}
                  </p>
                ) : null}
                {step1Parsed.event?.event_affordances?.length ? (
                  <>
                    <p className="mt-3 text-sm font-semibold">
                      The{' '}
                      {step1Parsed.event.event_affordances.length} comic
                      openings step 1 found in the moment
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {step1Parsed.event.event_affordances.map((a, i) => (
                        <li key={i} className="text-sm leading-relaxed">
                          <span className="font-semibold">{a.feature}</span>
                          <span className="text-[rgb(var(--muted))]">
                            {' '}
                            — {a.why_comically_useful}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            </details>
          </div>
        ) : null}
    </>
  )

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
            ? 'Removes the moment, the points of view, and every set of jokes from this page and from this browser’s saved run. Saved captions in step 4 stay.'
            : 'Nothing from a past run is on the page.'}
        </span>
      </div>

      {/* 1 — the only input */}
      <section className={SECTION} id="describe-the-moment">
        <p className={SECTION_NUMBER}>Step 1 of 4</p>
        <h2 className={SECTION_TITLE}>Describe the moment you want jokes about</h2>
        <p className={GOAL_TEXT}>
          {electsPov
            ? 'One moment or several. Step 2 picks the point of view and finds its angle on each of them; step 3 writes the jokes, one call per moment.'
            : 'This is the page\u2019s only real input. Everything below is derived from the moment you type here. The persona library underneath it is a starting roster that the model scores against the moment \u2014 it does not decide the answer, and the model also invents points of view of its own.'}
        </p>

        <div className="mt-6 max-w-3xl space-y-5">
          <div>
            <label className={FIELD_LABEL} htmlFor="pov-moment">
              {moments.length > 1 ? 'The campus moments' : 'The campus moment'}
            </label>
            <p className={FIELD_HELP}>
              One event, in as much detail as you have, or several. With
              several, step 1 sees them all as one numbered list and picks one
              character for all of them; step 2 then writes jokes for each
              moment on its own. Fills <code>{'{{EVENT}}'}</code>.
            </p>
            <div className="mt-2 space-y-3">
              {moments.map((text, i) => (
                <div key={i}>
                  {moments.length > 1 ? (
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[rgb(var(--muted))]">
                        Moment {i + 1}
                      </span>
                      <button
                        type="button"
                        className="text-xs font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                        disabled={step1Running}
                        onClick={() => setMoments((prev) => prev.filter((_, j) => j !== i))}
                      >
                        Remove this moment
                      </button>
                    </div>
                  ) : null}
                  <textarea
                    id={i === 0 ? 'pov-moment' : `pov-moment-${i + 1}`}
                    className={`${TEXTAREA} mt-1`}
                    rows={4}
                    value={text}
                    onChange={(e) =>
                      setMoments((prev) => prev.map((m, j) => (j === i ? e.target.value : m)))
                    }
                    placeholder={i === 0 ? 'Columbia agrees to a $200M federal settlement…' : 'Another moment for the same character…'}
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              className={`${SMALL_BUTTON} mt-3`}
              disabled={step1Running}
              onClick={() => setMoments((prev) => [...prev, ''])}
            >
              Add another moment
            </button>
          </div>

          <div>
            <button
              type="button"
              className="text-sm font-semibold text-[rgb(var(--accent-strong))] hover:underline"
              onClick={() => setShowSidechatPicker((v) => !v)}
            >
              {showSidechatPicker ? 'Hide the' : 'Or pick one or more moments from an'}{' '}
              archived Sidechat clustering
            </button>
            {showSidechatPicker ? (
              <div className="mt-2">
                <SidechatMomentPicker
                  disabled={step1Running}
                  selectedTexts={moments}
                  onPick={(m) => {
                    // Fills the last box if it is empty, otherwise adds one.
                    // No scroll: picking several in a row should not keep
                    // yanking the page back up to the boxes.
                    setMoments((prev) =>
                      prev.length && !prev[prev.length - 1].trim()
                        ? [...prev.slice(0, -1), m.text]
                        : [...prev, m.text]
                    )
                  }}
                  onRemove={(m) => {
                    setMoments((prev) => {
                      const next = prev.filter((t) => t.trim() !== m.text.trim())
                      return next.length ? next : ['']
                    })
                  }}
                />
              </div>
            ) : null}
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

          {electsPov ? null : libraryBlock}
        </div>

        {electsPov ? null : findPovsBlock}
      </section>

      {electsPov ? (
        <section className={SECTION} id="select-point-of-view">
          <p className={SECTION_NUMBER}>Step 2 of 4</p>
          <h2 className={SECTION_TITLE}>Select the point of view and find its angle on each moment</h2>
          <p className={GOAL_TEXT}>
            This flavor works one point of view at a time. Pick the character
            here, then press the button: one call takes the character and every
            moment above and says, moment by moment, how the character fits it,
            scored 0 to 3, with the detail that sets it off, what it makes
            ridiculous, and which of its reactions the jokes should play. Untick
            the moments it fits poorly before step 3 pays for them. The
            characters come from the library underneath; add a bullet there and
            it appears in the list.
          </p>

          <div className="mt-6 max-w-6xl space-y-5">
            <div>
              <label className={FIELD_LABEL} htmlFor="pov-elected">
                The point of view
              </label>
              <select
                id="pov-elected"
                className="mt-2 rounded-md border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm"
                value={elected?.name ?? ''}
                disabled={step1Running}
                onChange={(e) => setElectedPov(e.target.value)}
              >
                {entries.map((e) => (
                  <option key={e.name} value={e.name}>
                    {e.name}
                  </option>
                ))}
              </select>
              {!entries.length ? (
                <p className={`${FIELD_HELP} mt-2`}>
                  The library below has no characters. Add one as a{' '}
                  <code>* name</code> bullet with its lines underneath.
                </p>
              ) : null}
            </div>

            {elected ? (
              <div className="lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-x-12">
              {/* The seven lines step 1 reads stay in the narrow left column;
                  the whole character, the long voice description where one
                  exists, fills the wide right column. Display only. */}
              <div className="min-w-0">
                <p className={FIELD_LABEL}>What step 1 reads</p>
                <ul className="mt-2 space-y-1">
                  {elected.block
                    .split('\n')
                    .slice(1)
                    .map((line) => line.replace(/^\s*-\s*/, ''))
                    .filter(Boolean)
                    .map((line, i) => {
                      const [term, ...rest] = line.split(':')
                      return (
                        <li key={i} className="text-sm leading-relaxed">
                          <span className="font-semibold">{term.trim()}</span>
                          {rest.length ? `: ${rest.join(':').trim()}` : ''}
                        </li>
                      )
                    })}
                </ul>
              </div>
              <div className="mt-8 min-w-0 lg:mt-0">
                <p className={FIELD_LABEL}>Who {elected.name} is</p>
                {PERSONA_DESCRIPTIONS[elected.name] ? (
                  <>
                    <div className="mt-2 max-w-3xl space-y-3 text-sm leading-relaxed">
                      {PERSONA_DESCRIPTIONS[elected.name].text.split(/\n\s*\n/).map((para, i) => {
                        const ls = para.split('\n')
                        if (ls.every((l) => /^-\s/.test(l))) {
                          return (
                            <ul key={i} className="list-disc space-y-0.5 pl-5">
                              {ls.map((l, k) => (
                                <li key={k}>{l.replace(/^-\s/, '')}</li>
                              ))}
                            </ul>
                          )
                        }
                        const heading = ls.length === 1 && /^\d+\.\s|^[A-Z][^.!?]{3,60}$/.test(para.trim()) && para.trim().length < 80
                        return heading ? (
                          <p key={i} className="pt-2 font-semibold">{para.trim()}</p>
                        ) : (
                          <p key={i} className="whitespace-pre-line">{para.trim()}</p>
                        )
                      })}
                    </div>
                    <p className={`${FIELD_HELP} mt-3`}>
                      From {PERSONA_DESCRIPTIONS[elected.name].source}. Shown for reference; step 1
                      reads only the lines on the right.
                    </p>
                  </>
                ) : (
                  <p className={`${FIELD_HELP} mt-2`}>
                    No long description on file for {elected.name}; the lines on the right are all
                    there is. Add one in pov-jokes/persona-descriptions.ts.
                  </p>
                )}
              </div>
              </div>
            ) : null}

            {libraryBlock}
          </div>

          {findPovsBlock}
        </section>
      ) : null}

      {/* 2 — pick, then fan out (not on the one-POV flavors, whose section 2 is above) */}
      {electsPov ? null : (
      <section className={SECTION} id="choose-points-of-view">
        <p className={SECTION_NUMBER}>Step 2 of 4</p>
        <h2 className={SECTION_TITLE}>
          {isDiscovery
            ? 'Choose which personas and premises get jokes'
            : electsPov
              ? 'Confirm the point of view fits each moment'
              : 'Choose which points of view get the full joke treatment'}
        </h2>
        <p className={GOAL_TEXT}>
          {electsPov
            ? 'Step 1\u2019s answer, moment by moment: why the elected character fits each one, scored 0 to 3, with the detail that sets it off, what it makes ridiculous, and which of its reactions the jokes should play. Every moment starts ticked; untick the ones it fits poorly before you pay for them. Each ticked moment is one call that writes five captions from this point of view.'
            : isDiscovery
            ? 'This is step 1\u2019s real answer: the personas worth joking from, each with the comic premises it selected for them. Nothing is written until you pick here. Each persona you run is one call, and it writes two captions for every premise still ticked \u2014 so the premises, not the personas, are what the run actually costs. They all start ticked; untick any that look weak or repetitive before you pay for them.'
            : 'This is step 1\u2019s real answer: the points of view it thinks are worth joking from, each one a persona to write jokes as. Step 1 selects more of them than you usually want to pay for, so nothing is written until you pick here. Each point of view you run is one separate call that inhabits that persona and produces five scored joke angles plus a best caption.'}
        </p>

        {stepsDisagree ? (
          <p className="mt-6 max-w-3xl rounded-lg bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-700 dark:text-amber-400">
            <span className="font-semibold">
              These two steps were written for different pipelines, so nothing
              here can be run yet.
            </span>{' '}
            Step 2 on this flavor expects the comic premises step 1 is supposed
            to discover, but step 1 returned the older persona roster, which
            has none. Step 2 checks for them and refuses rather than guessing,
            so running from here would spend calls and return errors. The write
            buttons stay disabled until step 1 is the discovery prompt.
          </p>
        ) : null}

        {isDiscovery ? (
          !discoveryPersonas.length ? (
            <p className="mt-6 max-w-3xl text-sm leading-relaxed text-[rgb(var(--muted))]">
              Step 1 returned the discovery schema but no personas could be read
              out of it. What went wrong is listed in section 1.
            </p>
          ) : (
            <>
              <div className="mt-6 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  className={BIG_BUTTON}
                  disabled={anyRunning || !checkedPremiseCount}
                  onClick={() => runManyPersonas(checkedDiscoveryPersonas)}
                >
                  Write jokes from the {checkedPremiseCount} premise
                  {checkedPremiseCount === 1 ? '' : 's'} I checked
                </button>
                <button
                  type="button"
                  className={SMALL_BUTTON}
                  disabled={anyRunning}
                  onClick={() =>
                    setChecked(
                      Object.fromEntries(
                        discoveryPersonas.map((persona) => [
                          persona.personaId,
                          true,
                        ])
                      )
                    )
                  }
                >
                  Check all {discoveryPersonas.length} personas
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

              <ul className="mt-8 space-y-10">
                {discoveryPersonas.map((persona) => {
                  const job = jobs[persona.personaId]
                  const status = job?.status ?? 'not-run'
                  const kept = premisesFor(persona)
                  return (
                    <li
                      key={persona.personaId}
                      id={`choose-${slugify(persona.personaId)}`}
                      className="max-w-3xl scroll-mt-6"
                    >
                      <div className="flex items-start gap-4">
                        <input
                          type="checkbox"
                          id={`pov-${persona.personaId}`}
                          className="mt-1.5 h-4 w-4 shrink-0"
                          checked={Boolean(checked[persona.personaId])}
                          disabled={anyRunning}
                          onChange={(e) =>
                            setChecked((prev) => ({
                              ...prev,
                              [persona.personaId]: e.target.checked,
                            }))
                          }
                        />
                        <div className="min-w-0 flex-1 space-y-2">
                          <label
                            htmlFor={`pov-${persona.personaId}`}
                            className="block text-lg font-semibold"
                          >
                            {persona.persona}
                          </label>
                          <p className="text-sm text-[rgb(var(--muted))]">
                            {kept.length} of {persona.premises.length} premise
                            {persona.premises.length === 1 ? '' : 's'} ticked.
                          </p>
                          <dl className="space-y-3 pt-1">
                            <Field term="How students recognize this persona">
                              {persona.personaBaseline}
                            </Field>
                            <Field term="What it converts events into">
                              {persona.generalProcessingRule}
                            </Field>
                          </dl>

                          {persona.problems.length ? (
                            <ul className="list-disc space-y-1 rounded-lg bg-amber-500/10 p-3 pl-8 text-sm text-amber-700 dark:text-amber-400">
                              {persona.problems.map((problem, i) => (
                                <li key={i}>{problem}</li>
                              ))}
                            </ul>
                          ) : null}

                          {/* The premises. Ticked by default, so a user who
                              does not care about this level never has to
                              touch it. */}
                          <ul className="space-y-4 pt-2">
                            {persona.premises.map((premise) => {
                              const key = premiseKey(
                                persona.personaId,
                                premise.ideaId
                              )
                              const on = !premisesOff[key]
                              return (
                                <li key={premise.ideaId} className="flex items-start gap-3">
                                  <input
                                    type="checkbox"
                                    id={`premise-${slugify(key)}`}
                                    className="mt-1 h-4 w-4 shrink-0"
                                    checked={on}
                                    disabled={anyRunning}
                                    onChange={(e) =>
                                      setPremisesOff((prev) => ({
                                        ...prev,
                                        [key]: !e.target.checked,
                                      }))
                                    }
                                  />
                                  <div className="min-w-0 flex-1">
                                    <label
                                      htmlFor={`premise-${slugify(key)}`}
                                      className={`block text-sm font-semibold leading-snug ${
                                        on ? '' : 'text-[rgb(var(--muted))] line-through'
                                      }`}
                                    >
                                      {premise.coreComicIdea ??
                                        premise.semanticCluster ??
                                        premise.ideaId}
                                    </label>
                                    <p className="mt-0.5 text-xs text-[rgb(var(--muted))]">
                                      {[
                                        premise.moment,
                                        premise.processingPath,
                                        premise.likelyJokeTarget
                                          ? `makes ridiculous: ${premise.likelyJokeTarget}`
                                          : null,
                                      ]
                                        .filter(Boolean)
                                        .join(' · ')}
                                    </p>
                                    {premise.problems.length ? (
                                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                                        {premise.problems.join(' ')}
                                      </p>
                                    ) : null}
                                  </div>
                                </li>
                              )
                            })}
                          </ul>

                          <div className="flex flex-wrap items-center gap-3 pt-3">
                            <button
                              type="button"
                              className={SMALL_BUTTON}
                              disabled={anyRunning || !kept.length}
                              onClick={() => runOnePersona(persona)}
                            >
                              {status === 'done'
                                ? `Write jokes from this persona again (${kept.length} premise${kept.length === 1 ? '' : 's'})`
                                : `Write jokes from this persona (${kept.length} premise${kept.length === 1 ? '' : 's'})`}
                            </button>
                            <span className="text-xs text-[rgb(var(--muted))]">
                              {!kept.length
                                ? 'Every premise is unticked, so there is nothing to write.'
                                : status === 'not-run'
                                  ? 'Not run yet.'
                                  : status === 'queued'
                                    ? 'Waiting for a free slot\u2026'
                                    : status === 'running'
                                      ? 'Writing jokes\u2026'
                                      : status === 'failed'
                                        ? `Failed: ${job?.error}`
                                        : `Jokes written in ${Math.round(
                                            (job?.durationMs ?? 0) / 1000
                                          )}s \u2014 read them in section 3 below.`}
                            </span>
                          </div>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )
        ) : !selectedPersonas.length ? (
          <p className="mt-6 max-w-3xl text-sm leading-relaxed text-[rgb(var(--muted))]">
            {!step1Raw
              ? 'No points of view yet — run step 1 above first.'
              : !step1Parsed
                ? 'Step 1 returned text that is not valid JSON, so no points of view could be read out of it. The raw output is in section 1.'
                : 'Step 1 returned valid JSON, but its selected_personas array was empty — it chose no points of view for this moment. Check the raw output in section 1.'}
          </p>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                type="button"
                className={BIG_BUTTON}
                disabled={
                  anyRunning || !checkedPersonas.length || stepsDisagree
                }
                onClick={() => runManyPovs(checkedPersonas)}
              >
                Write jokes for the {checkedPersonas.length} point
                {checkedPersonas.length === 1 ? '' : 's'} of view I checked
                {liveMoments.length > 1
                  ? ` across ${electedMomentCount} ticked moment${electedMomentCount === 1 ? '' : 's'} (${checkedPersonas.length * electedMomentCount} calls)`
                  : ''}
              </button>
              <button
                type="button"
                className={SMALL_BUTTON}
                disabled={anyRunning}
                onClick={() =>
                  setChecked(
                    Object.fromEntries(
                      selectedPersonas.map((p) => [p.persona ?? '', true])
                    )
                  )
                }
              >
                Check all {selectedPersonas.length}
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

            <ul className="mt-8 space-y-6">
              {selectedPersonas.map((persona) => {
                const name = persona.persona ?? ''
                // One run per moment; the status line summarizes them.
                const runs = jobsFor(name)
                const job = runs[0]
                const statuses = runs.map((r) => r?.status ?? 'not-run')
                const status = statuses.some((st) => st === 'running')
                  ? 'running'
                  : statuses.some((st) => st === 'queued')
                    ? 'queued'
                    : statuses.some((st) => st === 'failed')
                      ? 'failed'
                      : statuses.every((st) => st === 'done')
                        ? 'done'
                        : statuses.some((st) => st === 'done')
                          ? 'partial'
                          : 'not-run'
                const failedRun = runs.find((r) => r?.status === 'failed')
                const doneCount = statuses.filter((st) => st === 'done').length
                return (
                  <li
                    key={name}
                    id={`choose-${slugify(name)}`}
                    className="max-w-3xl scroll-mt-6"
                  >
                    <div className="flex items-start gap-4">
                      <input
                        type="checkbox"
                        id={`pov-${name}`}
                        className="mt-1.5 h-4 w-4 shrink-0"
                        checked={Boolean(checked[name])}
                        disabled={anyRunning}
                        onChange={(e) =>
                          setChecked((prev) => ({
                            ...prev,
                            [name]: e.target.checked,
                          }))
                        }
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <label
                          htmlFor={`pov-${name}`}
                          className="block text-lg font-semibold"
                        >
                          {name}
                        </label>
                        <p className="text-sm text-[rgb(var(--muted))]">
                          Step 1 scored this point of view{' '}
                          <span className="font-semibold text-[rgb(var(--ink))]">
                            {fitTotal(persona.scores) ?? '?'} out of{' '}
                            {fitMax(persona.scores)}
                          </span>{' '}
                          ({scoreLine(persona.scores)}). It came from{' '}
                          {persona.source === 'recurring_trope'
                            ? 'the recurring persona library you supplied'
                            : persona.source === 'event_native'
                              ? 'roles this event itself creates'
                              : persona.source === 'narrow_lens'
                                ? 'the search for comically narrow concerns'
                                : `an unrecognized source (${persona.source})`}
                          .
                        </p>
                        <dl className="space-y-3 pt-1">
                          <Field term="How it reads the moment">
                            {persona.comic_translation}
                          </Field>
                          <Field term="The tension powering the joke">
                            {persona.comic_contradiction}
                          </Field>
                          <Field term="What ends up ridiculous">
                            {persona.likely_joke_target}
                          </Field>
                          {persona.persona_pathology?.pretends ? (
                            <Field term="What this persona pretends">
                              {persona.persona_pathology.pretends}
                            </Field>
                          ) : null}
                          {persona.persona_pathology?.would_never_admit ? (
                            <Field term="What it would never admit">
                              {persona.persona_pathology.would_never_admit}
                            </Field>
                          ) : null}
                          {persona.comic_emotion ? (
                            <Field term="The one emotion it plays">
                              {persona.comic_emotion}
                            </Field>
                          ) : null}
                          {persona.emotional_palette?.length ? (
                            <Field term="Its reactions, and the GIF each maps to">
                              {persona.emotional_palette
                                .map((e) =>
                                  e.gif_emotion ? `${e.reaction} → ${e.gif_emotion}` : e.reaction
                                )
                                .join(' · ')}
                            </Field>
                          ) : null}
                          {persona.manifestations?.length ? (
                            <Field term="Where it shows up in this moment">
                              {persona.manifestations.join(' · ')}
                            </Field>
                          ) : null}
                          {persona.reusable_engine ? (
                            <Field term="The reusable engine">
                              {persona.reusable_engine}
                            </Field>
                          ) : null}
                          {persona.punch_direction ? (
                            <Field term="Which way the joke punches">
                              {persona.punch_direction}
                              {persona.category ? ` · found as ${persona.category}` : ''}
                            </Field>
                          ) : null}
                          {persona.who_pays?.entity ? (
                            <Field term="Who is exposed, and how">
                              {persona.who_pays.entity}
                              {persona.who_pays.what_it_costs
                                ? ` — ${persona.who_pays.what_it_costs}`
                                : ''}
                            </Field>
                          ) : null}
                          <Field term="Why step 1 thinks it is promising">
                            {persona.why_this_persona_is_promising}
                          </Field>
                        </dl>


                        <div className="flex flex-wrap items-center gap-3 pt-3">
                          <button
                            type="button"
                            className={SMALL_BUTTON}
                            disabled={anyRunning || stepsDisagree || !electedMomentCount}
                            onClick={() => runManyPovs([persona])}
                          >
                            {status === 'done'
                              ? 'Write jokes from this point of view again'
                              : 'Write jokes from this point of view'}
                            {liveMoments.length > 1
                              ? ` for the ${electedMomentCount} ticked moment${electedMomentCount === 1 ? '' : 's'}`
                              : ''}
                          </button>
                          <span className="text-xs text-[rgb(var(--muted))]">
                            {stepsDisagree
                              ? 'Cannot run: step 2 needs premises step 1 did not produce.'
                              : status === 'not-run'
                                ? 'Not run yet.'
                              : status === 'queued'
                                ? 'Waiting for a free slot…'
                                : status === 'running'
                                  ? liveMoments.length > 1
                                    ? `Writing jokes… ${doneCount} of ${liveMoments.length} moments done.`
                                    : 'Writing jokes…'
                                  : status === 'failed'
                                    ? `Failed: ${failedRun?.error}`
                                    : status === 'partial'
                                      ? `Jokes written for ${doneCount} of ${liveMoments.length} moments — read them in section 3 below.`
                                      : liveMoments.length > 1
                                        ? `Jokes written for all ${liveMoments.length} moments — read them in section 3 below.`
                                        : `Jokes written in ${Math.round(
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
          </>
        )}
      </section>
      )}

      {/* 3 — the jokes */}
      <section className={SECTION} id="read-the-jokes">
        <p className={SECTION_NUMBER}>Step 3 of 4</p>
        <h2 className={SECTION_TITLE}>
          {isDiscovery
            ? 'Read the jokes each persona produced'
            : electsPov
              ? 'Write the jokes for each moment from this point of view'
              : 'Read the jokes each point of view produced'}
        </h2>
        <p className={GOAL_TEXT}>
          {isDiscovery
            ? 'One block per persona you ran. Each block is a single ranking: one joke per premise, best first, so no two lines in it are rewrites of the same idea. Both captions written for each premise, and why one of them won, are collapsed underneath. Any caption can be saved to section 4, or handed to either optional step \u2014 simplify, which keeps the comic idea and writes eight shorter versions of it, and image search, which turns it into simple GIF-searchable concepts and the queries to find them.'
            : 'One block per point of view you ran, in the order step 1 listed them. Each block leads with the caption that point of view picked as its best, then all five captions it wrote with the angle and score of each. Any caption can be saved to section 4, or handed to either optional step: simplify, which keeps the comic idea and writes eight shorter versions of it, and image search, which turns it into simple GIF-searchable concepts and the queries to find them. The reasoning that produced the captions is collapsed underneath.'}
        </p>

        {electsPov ? (
          <div className="mt-6 max-w-3xl">
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                className={BIG_BUTTON}
                disabled={anyRunning || !selectedPersonas.length || !electedMomentCount || stepsDisagree}
                onClick={() => runManyPovs(selectedPersonas.slice(0, 1))}
              >
                {anyRunning
                  ? 'Writing jokes…'
                  : `Write jokes for the ${electedMomentCount} ticked moment${electedMomentCount === 1 ? '' : 's'} from ${selectedPersonas[0]?.persona ?? elected?.name ?? 'the point of view'}`}
              </button>
              <span className="text-xs text-[rgb(var(--muted))]">
                {!selectedPersonas.length
                  ? 'Run step 2 above first.'
                  : premiseChain
                    ? `Two calls per ticked moment, ${CONCURRENCY} moments at a time, to ${modelLine}: step 2 discovers the comic premises in that moment for this point of view, step 3 executes them, two tries each, and keeps the better one.`
                    : `One call per ticked moment, ${CONCURRENCY} at a time, to ${modelLine}. Each call writes five captions from this point of view using its angle on that moment.`}
              </span>
            </div>
            {selectedPersonas[0]
              ? jobsFor(selectedPersonas[0].persona ?? '').map((job, i) =>
                  job ? (
                    <p key={i} className="mt-2 text-sm text-[rgb(var(--muted))]">
                      <span className="font-semibold text-[rgb(var(--ink))]">Moment {i + 1}</span>
                      {' — '}
                      {job.status === 'queued'
                        ? 'waiting for a free slot…'
                        : job.status === 'running'
                          ? (job.phase ?? 'writing jokes…')
                          : job.status === 'failed'
                            ? `failed: ${job.error}`
                            : `written in ${Math.round((job.durationMs ?? 0) / 1000)}s.`}
                    </p>
                  ) : null
                )
              : null}
          </div>
        ) : null}

        {rankedRows.length ? (
          <div className="mt-10">
            <AllJokesRanked rows={rankedRows} unit={isDiscovery ? 'persona' : 'point of view'} />
            <h3 className="mt-16 text-[11px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
              The same jokes, {isDiscovery ? 'persona by persona' : 'point of view by point of view'}, with the reasoning behind them
            </h3>
          </div>
        ) : null}

        {!Object.keys(jobs).length ? (
          <p className="mt-6 text-sm text-[rgb(var(--muted))]">
            No jokes yet — pick points of view in section 2 and press one of the
            write buttons.
          </p>
        ) : (
          <div className="mt-8 space-y-16">
            {ranEntries.map((entry) => {
              const job = jobs[entry.key]
              const parsed = job.text
                ? parseStep2(job.text)
                : null
              // Which block to draw is decided by what STEP 2 actually
              // returned, not by what step 1 returned. Those two can disagree
              // — a flavor part-way through the premise-first migration has
              // the new step 2 and the old step 1 — and when they did, this
              // page used to draw the old block around new output and come
              // out completely blank.
              const shape = step2Shape(parsed)
              const isOpen = expanded[entry.key] ?? false
              // The premise block wants the resolved persona for its labels
              // and for joke_context. On a legacy step 1 there is none, so it
              // gets a stub and falls back to what step 2 said about itself.
              const persona: ResolvedPersona = entry.resolved ?? {
                personaId: entry.key,
                persona: entry.label,
                personaBaseline: null,
                generalProcessingRule: null,
                premises: [],
                problems: [],
              }
              return (
                <div
                  key={entry.key}
                  id={`jokes-${slugify(entry.key)}`}
                  className={`${electsPov ? 'max-w-6xl' : 'max-w-3xl'} scroll-mt-6`}
                >
                  <div className="flex flex-wrap items-baseline gap-3">
                    <h3 className="text-3xl font-bold">{entry.label}</h3>
                    <span className="text-xs text-[rgb(var(--muted))]">
                      {job.status === 'done'
                        ? `${
                            job.finishedAt
                              ? `${formatWhen(job.finishedAt).toLowerCase()}, `
                              : ''
                          }in ${Math.round((job.durationMs ?? 0) / 1000)}s`
                        : job.status === 'failed'
                          ? 'failed'
                          : job.status === 'running'
                            ? (job.phase ?? 'writing…')
                            : 'queued'}
                    </span>
                  </div>

                  {/* On the one-POV flavors the jokes sit beside the moment
                      they are about and the reading step 1 gave the writer,
                      so a block can be judged without scrolling back up. */}
                  <div className={electsPov ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-x-10' : ''}>
                  <div className="min-w-0">
                  {job.status === 'failed' ? (
                    <p className="mt-2 rounded-lg bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
                      {job.error}
                    </p>
                  ) : null}

                  {job.status === 'done' &&
                  job.promptHash &&
                  job.promptHash !== currentStep2Hash ? (
                    <p className="mt-2 rounded-lg bg-amber-500/10 p-3 text-sm leading-relaxed text-amber-700 dark:text-amber-400">
                      Step 2&rsquo;s prompt in the database has changed since
                      these jokes were written. Run this{' '}
                      {isDiscovery ? 'persona' : 'point of view'} again to use
                      the current prompt.
                    </p>
                  ) : null}

                  {/* A premise-first result under a persona-roster step 1.
                      The jokes are fine and are shown; the premises they came
                      from are not, because step 1 never produced any. */}

                  {job.text ? (
                    shape === 'premise' ? (
                      <PremiseJokesResult
                        analysis={parsed as PremiseJokesOutput}
                        persona={persona}
                        rawText={job.text}
                        isOpen={isOpen}
                        onToggle={() =>
                          setExpanded((prev) => ({
                            ...prev,
                            [entry.key]: !isOpen,
                          }))
                        }
                        renderActions={(execution, premise) => {
                          const id = executionCaptionId(
                            persona.personaId,
                            execution.execution_id ?? ''
                          )
                          const caption = (execution.caption ?? '').trim()
                          const input = captionInputFor(
                            id,
                            caption,
                            persona,
                            premise?.source_idea_id ?? null,
                            execution.simple_image_concept
                          )
                          return (
                            <CaptionActions
                              saved={favorites.some((f) => f.id === id)}
                              savedAnchorId={id}
                              onToggleSave={() =>
                                toggleExecutionFavorite(
                                  id,
                                  caption,
                                  persona,
                                  premise,
                                  execution
                                )
                              }
                              onSimplify={() => simplifyCaption(input)}
                              onFindTerms={() => findImageTerms(input)}
                              canSimplify={Boolean(simplifyStep)}
                              canFindTerms={Boolean(imageTermsStep)}
                              simplifyJob={simplified[id]}
                              termsJob={imageTerms[id]}
                              onSaveSimplifiedVersion={(version) =>
                                saveSimplified(
                                  id,
                                  persona.persona,
                                  premise?.semantic_cluster ||
                                    premise?.compressed_comic_core ||
                                    'wildcard',
                                  version
                                )
                              }
                              isVersionSaved={(versionId) =>
                                favorites.some(
                                  (f) =>
                                    f.id === simplifiedCaptionId(id, versionId)
                                )
                              }
                            />
                          )
                        }}
                      />
                    ) : shape === 'legacy' ? (
                      <JokeResult
                        analysis={parsed as Step2Output}
                        personaName={entry.label}
                        rawText={job.text}
                        isOpen={isOpen}
                        onToggle={() =>
                          setExpanded((prev) => ({
                            ...prev,
                            [entry.key]: !isOpen,
                          }))
                        }
                        isFavorite={(id) => favorites.some((f) => f.id === id)}
                        onToggleFavorite={(candidate, index) =>
                          toggleFavorite(entry.label, candidate, index, entry.moment)
                        }
                        termsJobs={imageTerms}
                        onFindTerms={(candidate, index) =>
                          findImageTerms({
                            id: captionId(entry.label, index),
                            caption: (candidate.caption ?? '').trim(),
                            personaName: entry.label,
                            moment: entry.moment,
                            angleName: candidate.angle_name,
                            jokeMechanism: candidate.joke_mechanism,
                            originalImage: candidate.image_situation,
                            analysis: parsed as Step2Output,
                          })
                        }
                        canFindTerms={Boolean(imageTermsStep)}
                        simplifyJobs={simplified}
                        onSimplify={(candidate, index) =>
                          simplifyCaption({
                            id: captionId(entry.label, index),
                            caption: (candidate.caption ?? '').trim(),
                            personaName: entry.label,
                            moment: entry.moment,
                            angleName: candidate.angle_name,
                            jokeMechanism: candidate.joke_mechanism,
                            originalImage: candidate.image_situation,
                            analysis: parsed as Step2Output,
                          })
                        }
                        canSimplify={Boolean(simplifyStep)}
                        onSaveSimplified={(candidate, index, version) =>
                          saveSimplified(
                            captionId(entry.label, index),
                            entry.label,
                            candidate.angle_name ?? `Angle ${index + 1}`,
                            version,
                            entry.moment
                          )
                        }
                      />
                    ) : (
                      // Parsed, but neither block recognizes it. Saying so
                      // beside the raw output is the whole point: a run that
                      // renders as nothing at all is indistinguishable from a
                      // run that never happened.
                      <>
                        <p className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm leading-relaxed text-red-600 dark:text-red-400">
                          {modelRefusal(parsed)
                            ? `Step 2 refused to write anything and returned an error instead: “${modelRefusal(parsed)}” This run produced no jokes. It was not a formatting problem — the prompt was sent with something missing, so there is nothing to recover here and the run needs repeating once the flavor's steps agree.`
                            : parsed
                              ? 'Step 2 returned valid JSON in a shape this page does not recognize — it has neither the five joke_candidates of the persona-roster prompt nor the premises and ranked_finalists of the premise-first one. The raw output is below.'
                              : 'Step 2 returned text that is not valid JSON, so the jokes could not be laid out. The raw output is below.'}
                        </p>
                        <div className="mt-3 rounded-lg bg-[rgb(var(--panel)/0.6)] p-4 dark:bg-[rgb(var(--panel)/0.3)]">
                          <StructuredOutput text={job.text} />
                        </div>
                      </>
                    )
                  ) : null}
                  </div>

                  {electsPov
                    ? (() => {
                        const pov = selectedPersonas[0]
                        const note =
                          pov?.per_event?.find((n) => Number(n.event) === entry.momentIndex + 1) ??
                          pov?.per_event?.[entry.momentIndex]
                        const fits = typeof note?.fits === 'number' ? note.fits : null
                        const long = entry.moment.length > 700
                        return (
                          <aside className="mt-10 border-t border-[rgb(var(--gloss)/0.4)] pt-6 dark:border-[rgb(var(--gloss)/0.15)] lg:mt-0 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">
                              Moment {entry.momentIndex + 1} — what these jokes are about
                            </p>
                            {long ? (
                              <details className="mt-2">
                                <summary className="cursor-pointer text-sm leading-relaxed">
                                  {entry.moment.slice(0, 700).replace(/\s+\S*$/, '')}&hellip;{' '}
                                  <span className="font-semibold text-[rgb(var(--accent-strong))]">show the rest</span>
                                </summary>
                                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{entry.moment}</p>
                              </details>
                            ) : (
                              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{entry.moment}</p>
                            )}

                            {job.discoverText
                              ? (() => {
                                  const d = parseJson<DiscoverOutput>(job.discoverText)
                                  if (!d) return null
                                  const raw = d.raw_premises ?? []
                                  const sel = d.selected_premises ?? []
                                  const rejected = raw.filter((r) => r.decision !== 'select')
                                  return (
                                    <>
                                      <p className="mt-8 text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">
                                        The {sel.length} premise{sel.length === 1 ? '' : 's'} step 2 found in this moment
                                      </p>
                                      <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
                                        {sel.map((p, i) => (
                                          <li key={p.premise_id ?? i}>
                                            <span className="font-semibold">{p.premise}</span>
                                            {p.why_selected ? (
                                              <span className="text-[rgb(var(--muted))]"> {p.why_selected}</span>
                                            ) : null}
                                            {p.execution_space?.length ? (
                                              <span className="block text-xs text-[rgb(var(--muted))]">
                                                Frames it leaves open: {p.execution_space.join(', ')}
                                              </span>
                                            ) : null}
                                          </li>
                                        ))}
                                      </ol>
                                      {raw.length ? (
                                        <details className="mt-3">
                                          <summary className="cursor-pointer text-sm font-semibold text-[rgb(var(--accent-strong))]">
                                            {raw.length} raw premises considered, {rejected.length} rejected
                                          </summary>
                                          <ul className="mt-2 space-y-2 text-xs leading-relaxed text-[rgb(var(--muted))]">
                                            {raw.map((r, i) => (
                                              <li key={r.premise_id ?? i}>
                                                <span className={r.decision === 'select' ? 'font-semibold text-[rgb(var(--ink))]' : ''}>
                                                  {r.premise}
                                                </span>
                                                {' \u2014 '}
                                                {r.decision ?? '?'}
                                                {r.rejection_reason ? `: ${r.rejection_reason}` : ''}
                                                {r.swap_test?.result ? ` \u00b7 swap test ${r.swap_test.result}` : ''}
                                                {r.generic_device_risk ? ` \u00b7 device risk ${r.generic_device_risk}` : ''}
                                                {r.duplicate_family ? ` \u00b7 ${r.duplicate_family}` : ''}
                                              </li>
                                            ))}
                                          </ul>
                                        </details>
                                      ) : null}
                                      <details className="mt-2">
                                        <summary className="cursor-pointer text-sm font-semibold text-[rgb(var(--accent-strong))]">
                                          Everything step 2 returned, field by field
                                        </summary>
                                        <div className="mt-2 rounded-lg bg-[rgb(var(--panel)/0.6)] p-3 dark:bg-[rgb(var(--panel)/0.3)]">
                                          <StructuredOutput text={job.discoverText} />
                                        </div>
                                      </details>
                                    </>
                                  )
                                })()
                              : null}

                            {pov && note ? (
                              <>
                                <p className="mt-8 text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">
                                  What {pov.persona} is using to write them
                                </p>
                                {fits !== null ? (
                                  <p className="mt-2 text-sm">
                                    <span className="font-semibold">
                                      {note.fit_checks?.length ? `${fits} of 3 checks pass` : `Fit ${fits} of 3`}
                                    </span>
                                    {!note.fit_checks?.length && FIT_MEANING[fits] ? (
                                      <span className="text-[rgb(var(--muted))]"> · {FIT_MEANING[fits]}</span>
                                    ) : null}
                                  </p>
                                ) : null}
                                {note.why_it_fits ? (
                                  <p className="mt-2 text-sm leading-relaxed">{note.why_it_fits}</p>
                                ) : null}
                                {fitChecksBlock(note)}
                                {angleFields(pov, note)}
                              </>
                            ) : null}
                          </aside>
                        )
                      })()
                    : null}
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
        <h2 className={SECTION_TITLE}>Generate images/GIFs for saved captions</h2>
        <p className={GOAL_TEXT}>
          Every caption you saved, newest first, across every moment you have
          run on this flavor — these survive clearing a run and starting a new
          moment. This is where each one gets its picture: an image from a
          study image set, chosen for all of them at once by the pairing step
          or by hand from the thumbnails, or a GIF from the KLIPY search or a
          pasted embed. Whatever a caption has is laid out on the poster
          below, one block per moment, ready to screenshot. Each caption can
          also be simplified or handed to the image search on its own.
        </p>

        <div className="mt-6 max-w-3xl">
          <ImageSetControls state={imageSet} />
          <PairSavedCaptions
            pairStep={pairStep}
            saved={favorites}
            images={imageSet.images}
            set={imageSet.set}
            onAssign={(id, assignment) => assignImage(id, assignment)}
          />
        </div>
        <SavedPoster saved={favorites} />

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

                  {favorite.imageUrl ? (
                    <figure className="mt-5 flex max-w-[640px] items-start gap-4 rounded-xl bg-[rgb(var(--panel)/0.7)] p-4 dark:bg-[rgb(var(--panel)/0.3)]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={favorite.imageUrl}
                        alt={favorite.imageWho || 'The image assigned to this caption'}
                        className="h-40 w-40 shrink-0 rounded-lg object-cover"
                        loading="lazy"
                      />
                      <figcaption className="min-w-0 text-sm leading-relaxed">
                        <p className="font-semibold">
                          {favorite.imageWho || 'Image from the set'}
                          {typeof favorite.imageFit === 'number' ? ` · fit ${favorite.imageFit.toFixed(2)}` : ''}
                        </p>
                        {favorite.imageWhy ? (
                          <p className="mt-1 text-[rgb(var(--muted))]">{favorite.imageWhy}</p>
                        ) : (
                          <p className="mt-1 text-[rgb(var(--muted))]">Picked by hand.</p>
                        )}
                      </figcaption>
                    </figure>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className={SMALL_BUTTON}
                      onClick={() =>
                        setPickingFor((prev) => (prev === favorite.id ? null : favorite.id))
                      }
                    >
                      {pickingFor === favorite.id
                        ? 'Hide the image set'
                        : favorite.imageUrl
                          ? 'Pick a different image from the set'
                          : 'Pick an image from the set'}
                    </button>
                    {favorite.imageUrl ? (
                      <button
                        type="button"
                        className={SMALL_BUTTON}
                        onClick={() => assignImage(favorite.id, null)}
                      >
                        Remove this image from the caption
                      </button>
                    ) : null}
                  </div>
                  {pickingFor === favorite.id ? (
                    <div className="mt-3">
                      <ImagePickerGrid
                        images={imageSet.images}
                        currentId={favorite.imageId}
                        onPick={(img) => {
                          assignImage(favorite.id, {
                            imageId: img.id,
                            imageUrl: img.url,
                            imageWho: img.who,
                          })
                          setPickingFor(null)
                        }}
                      />
                    </div>
                  ) : null}

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
                      : `Step 2 scored it ${favorite.totalScore} out of ${
                          favorite.scoreOutOf ?? 25
                        }`}{' '}
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

      {/* Reference — what step 1 looked at but did not pick */}
      {step1Parsed ? (
        <section className={SECTION} id="rejected-points-of-view">
          <p className={SECTION_NUMBER}>Reference</p>
          <h2 className={SECTION_TITLE}>
            Review the points of view step 1 considered but did not select
          </h2>
          <p className={GOAL_TEXT}>
            Nothing here can be run — it is the reasoning behind section
            2&rsquo;s list, so you can tell whether a point of view was missed
            or correctly rejected.
          </p>
          <button
            type="button"
            className={`${SMALL_BUTTON} mt-6`}
            onClick={() => setShowRejected((v) => !v)}
          >
            {showRejected ? 'Hide' : 'Show'} the rejected points of view and the
            coverage check
          </button>

          {showRejected ? (
            <div className="mt-8 max-w-3xl space-y-8">
              {step1Parsed.coverage_check?.selection_summary ? (
                <div>
                  <h3 className="text-base font-semibold">
                    Why step 1 says this set covers the moment
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--muted))]">
                    {step1Parsed.coverage_check.selection_summary}
                  </p>
                  {step1Parsed.coverage_check
                    .comic_transformations_represented?.length ? (
                    <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--muted))]">
                      The distinct ways of seeing the moment it counts as
                      represented:{' '}
                      {step1Parsed.coverage_check.comic_transformations_represented.join(
                        '; '
                      )}
                      .
                    </p>
                  ) : null}
                  {step1Parsed.coverage_check.potentially_redundant_pairs
                    ?.length ? (
                    <ul className="mt-2 space-y-1">
                      {step1Parsed.coverage_check.potentially_redundant_pairs.map(
                        (pair, i) => (
                          <li
                            key={i}
                            className="text-sm leading-relaxed text-[rgb(var(--muted))]"
                          >
                            {pair.persona_1} and {pair.persona_2} may overlap:{' '}
                            {pair.overlap}
                          </li>
                        )
                      )}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {step1Parsed.weak_fits_to_skip?.length ? (
                <div>
                  <h3 className="text-base font-semibold">
                    Personas step 1 says to skip for this moment
                  </h3>
                  <ul className="mt-2 space-y-3">
                    {step1Parsed.weak_fits_to_skip.map((weak, i) => (
                      <li key={i} className="text-sm leading-relaxed">
                        <span className="font-semibold">{weak.persona}</span>
                        <span className="text-[rgb(var(--muted))]">
                          {' '}
                          — scored {weak.total_fit_score ?? '?'} out of{' '}
                          {fitMax(step1Parsed.selected_personas?.[0]?.scores)}.{' '}
                          {weak.why_skip}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {step1Parsed.recurring_persona_evaluations?.length ? (
                <div>
                  <h3 className="text-base font-semibold">
                    Every persona from the library, scored against this moment
                  </h3>
                  <ul className="mt-2 space-y-3">
                    {step1Parsed.recurring_persona_evaluations.map((eva, i) => (
                      <li key={i} className="text-sm leading-relaxed">
                        <span className="font-semibold">{eva.persona}</span>
                        <span className="text-[rgb(var(--muted))]">
                          {' '}
                          — {eva.scores?.total_fit_score ?? '?'} out of{' '}
                          {fitMax(eva.scores)},
                          judged {eva.verdict ?? 'unrated'}.{' '}
                          {eva.persona_event_translation}
                        </span>
                      </li>
                    ))}
                  </ul>
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
