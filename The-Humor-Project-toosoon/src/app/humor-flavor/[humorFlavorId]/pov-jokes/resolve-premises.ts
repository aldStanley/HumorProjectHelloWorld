// Turns step 1's normalized discovery output into the flat, purpose-built
// payload step 2 actually consumes.
//
// Step 1 stores its reasoning normalized — personas, moments, activations,
// processing paths, and ideas in separate arrays joined by id. That is the
// right shape for storage and the wrong shape for a language model: asking S2
// to walk idea → activation → moment and idea → path, five times over, is a
// join, and a model that gets a join wrong produces a plausible-looking wrong
// answer with nothing on screen to show for it.
//
// So the join happens here, in code, where a miss is an error rather than a
// hallucination. Every unresolved hop is recorded as a `problem` string and
// surfaced on the page. Nothing is silently dropped and nothing is guessed.
//
// THE EXPECTED STEP-1 CONTRACT lives in FIELD_NAMES below, and matches the
// discovery prompt's own DATA MODEL PRINCIPLE, which names the five canonical
// collections: `event.event_moments`, `personas`, `activations`,
// `processing_paths`, `ideas`. Everything else in that output is ids and
// evaluation metadata. When the prompt changes, this constant is the only
// thing that should need editing — every lookup in this file goes through it.

export const FIELD_NAMES = {
  // Top-level arrays on the discovery object. First name found wins.
  personas: ['personas'],
  // Moments are the one canonical collection that is NOT top level: they hang
  // off `event`. Both are searched so a later flattening does not break this.
  event: ['event'],
  moments: ['event_moments', 'moments'],
  activations: ['activations'],
  processingPaths: ['processing_paths'],
  ideas: ['ideas'],
  selections: ['persona_premise_selections'],
  selectedPersonaIds: ['selected_persona_ids'],
  // Identity fields, per record kind.
  personaId: ['persona_id'],
  momentId: ['moment_id'],
  activationId: ['activation_id'],
  pathId: ['path_id'],
  ideaId: ['idea_id'],
  // Payload fields, in the order they are tried.
  personaName: ['persona', 'persona_name'],
  personaBaseline: ['persona_baseline'],
  generalProcessingRule: ['general_processing_rule', 'persona_processing_rule'],
  selectedIdeaIds: ['selected_idea_ids'],
  momentText: ['moment', 'moment_text', 'description', 'summary'],
  triggerFeature: ['trigger_feature'],
  // A string on a processing path, but a LIST on an activation
  // (`activated_concerns`), so both a string and an array read are tried.
  concern: ['concern', 'activated_concern'],
  concerns: ['activated_concerns', 'concerns'],
  pathText: ['processing_path', 'path', 'description'],
  comicRole: ['comic_role'],
  comicTranslation: ['comic_translation'],
  comicContradiction: ['comic_contradiction'],
  coreComicIdea: ['core_comic_idea'],
  likelyJokeTarget: ['likely_joke_target'],
  visualPrimitives: ['visual_primitives'],
  semanticCluster: ['semantic_cluster', 'cluster', 'cluster_id'],
} as const

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// First present, non-empty value among the candidate names.
const pick = (record: Json | null, names: readonly string[]): unknown => {
  if (!record) return undefined
  for (const name of names) {
    const value = record[name]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

const pickString = (record: Json | null, names: readonly string[]): string | null => {
  const value = pick(record, names)
  return typeof value === 'string' ? value : null
}

const pickStrings = (record: Json | null, names: readonly string[]): string[] => {
  const value = pick(record, names)
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

const pickArray = (record: Json | null, names: readonly string[]): Json[] => {
  const value = pick(record, names)
  if (!Array.isArray(value)) return []
  return value.filter(isObject)
}

// The canonical moment collection, wherever it is: `event.event_moments` per
// the contract, or top level if it is ever flattened.
const momentRecords = (discovery: Json): Json[] => {
  const nested = pick(discovery, FIELD_NAMES.event)
  const fromEvent = isObject(nested)
    ? pickArray(nested, FIELD_NAMES.moments)
    : []
  return fromEvent.length ? fromEvent : pickArray(discovery, FIELD_NAMES.moments)
}

// Finds the record whose id field equals `id`.
const findById = (
  records: Json[],
  idNames: readonly string[],
  id: string
): Json | null => records.find((record) => pickString(record, idNames) === id) ?? null

export type ResolvedPremise = {
  ideaId: string
  momentId: string | null
  moment: string | null
  triggerFeature: string | null
  concern: string | null
  processingPath: string | null
  comicRole: string | null
  comicTranslation: string | null
  comicContradiction: string | null
  coreComicIdea: string | null
  likelyJokeTarget: string | null
  visualPrimitives: string[]
  semanticCluster: string | null
  // Which hops of the join did not land. A premise with problems still runs —
  // it is simply missing context, and the page says which.
  problems: string[]
}

export type ResolvedPersona = {
  personaId: string
  persona: string
  personaBaseline: string | null
  generalProcessingRule: string | null
  premises: ResolvedPremise[]
  problems: string[]
}

export type Resolution = {
  personas: ResolvedPersona[]
  // Problems that belong to the discovery output as a whole rather than to any
  // one persona — a missing top-level array, a selection naming an unknown
  // persona.
  problems: string[]
}

// True when this looks like the normalized discovery schema rather than the
// earlier one-persona-per-entry `selected_personas` shape.
export const isDiscoverySchema = (parsed: unknown): boolean => {
  if (!isObject(parsed)) return false
  return (
    pickArray(parsed, FIELD_NAMES.personas).length > 0 &&
    pickArray(parsed, FIELD_NAMES.ideas).length > 0
  )
}

// Resolves one idea into a flat premise, walking idea → activation → moment
// and idea → processing path.
const resolvePremise = (
  discovery: Json,
  ideaId: string,
  personaLabel: string
): ResolvedPremise => {
  const problems: string[] = []
  const ideas = pickArray(discovery, FIELD_NAMES.ideas)
  const idea = findById(ideas, FIELD_NAMES.ideaId, ideaId)

  if (!idea) {
    return {
      ideaId,
      momentId: null,
      moment: null,
      triggerFeature: null,
      concern: null,
      processingPath: null,
      comicRole: null,
      comicTranslation: null,
      comicContradiction: null,
      coreComicIdea: null,
      likelyJokeTarget: null,
      visualPrimitives: [],
      semanticCluster: null,
      problems: [
        `${personaLabel} selected idea "${ideaId}", which is not in the ideas array.`,
      ],
    }
  }

  // idea → activation → moment
  const activationId = pickString(idea, FIELD_NAMES.activationId)
  const activation = activationId
    ? findById(
        pickArray(discovery, FIELD_NAMES.activations),
        FIELD_NAMES.activationId,
        activationId
      )
    : null
  if (activationId && !activation) {
    problems.push(
      `Idea "${ideaId}" points at activation "${activationId}", which is not in the activations array.`
    )
  }
  if (!activationId) {
    problems.push(`Idea "${ideaId}" has no activation_id, so its moment and trigger are unknown.`)
  }

  const momentId =
    pickString(activation, FIELD_NAMES.momentId) ??
    pickString(idea, FIELD_NAMES.momentId)
  const moment = momentId
    ? findById(momentRecords(discovery), FIELD_NAMES.momentId, momentId)
    : null
  if (momentId && !moment) {
    problems.push(
      `Idea "${ideaId}" resolves to moment "${momentId}", which is not in the moments array.`
    )
  }

  // idea → processing path
  const pathId = pickString(idea, FIELD_NAMES.pathId)
  const path = pathId
    ? findById(
        pickArray(discovery, FIELD_NAMES.processingPaths),
        FIELD_NAMES.pathId,
        pathId
      )
    : null
  if (pathId && !path) {
    problems.push(
      `Idea "${ideaId}" points at processing path "${pathId}", which is not in the processing_paths array.`
    )
  }

  const coreComicIdea = pickString(idea, FIELD_NAMES.coreComicIdea)
  if (!coreComicIdea) {
    problems.push(
      `Idea "${ideaId}" has no core_comic_idea, which is the one field step 2 cannot work without.`
    )
  }

  return {
    ideaId,
    momentId,
    // The moment record's own text, falling back to whatever the activation
    // carried, so a thin moments array does not blank the premise.
    moment:
      pickString(moment, FIELD_NAMES.momentText) ??
      pickString(activation, FIELD_NAMES.momentText),
    triggerFeature:
      pickString(activation, FIELD_NAMES.triggerFeature) ??
      pickString(idea, FIELD_NAMES.triggerFeature),
    // The activation lists what the persona is worried about; the processing
    // path names the single concern it followed. Either will do.
    concern:
      (pickStrings(activation, FIELD_NAMES.concerns).join('; ') || null) ??
      pickString(path, FIELD_NAMES.concern) ??
      pickString(activation, FIELD_NAMES.concern) ??
      pickString(idea, FIELD_NAMES.concern),
    processingPath:
      pickString(path, FIELD_NAMES.pathText) ??
      pickString(idea, FIELD_NAMES.pathText),
    comicRole: pickString(idea, FIELD_NAMES.comicRole),
    comicTranslation: pickString(idea, FIELD_NAMES.comicTranslation),
    comicContradiction: pickString(idea, FIELD_NAMES.comicContradiction),
    coreComicIdea,
    likelyJokeTarget: pickString(idea, FIELD_NAMES.likelyJokeTarget),
    visualPrimitives: pickStrings(idea, FIELD_NAMES.visualPrimitives),
    semanticCluster: pickString(idea, FIELD_NAMES.semanticCluster),
    problems,
  }
}

// The whole discovery output → the personas worth showing, each with its
// selected premises already flattened.
export const resolveDiscovery = (parsed: unknown): Resolution => {
  const problems: string[] = []
  if (!isObject(parsed)) {
    return { personas: [], problems: ['Step 1 did not return a JSON object.'] }
  }

  const personaRecords = pickArray(parsed, FIELD_NAMES.personas)
  const selections = pickArray(parsed, FIELD_NAMES.selections)
  if (!personaRecords.length) problems.push('Step 1 returned no personas array.')
  if (!selections.length) {
    problems.push(
      'Step 1 returned no persona_premise_selections, so no premises are selected for any persona.'
    )
  }
  if (!pickArray(parsed, FIELD_NAMES.ideas).length) {
    problems.push('Step 1 returned no ideas array, so no premise can be resolved.')
  }

  // `selected_persona_ids` narrows the roster when present; otherwise every
  // persona that has a selection is shown.
  const selectedIds = pickStrings(parsed, FIELD_NAMES.selectedPersonaIds)
  const selectionIds = selections
    .map((selection) => pickString(selection, FIELD_NAMES.personaId))
    .filter((id): id is string => Boolean(id))
  const wanted = selectedIds.length ? selectedIds : selectionIds

  selectedIds.forEach((id) => {
    if (!findById(personaRecords, FIELD_NAMES.personaId, id)) {
      problems.push(
        `selected_persona_ids names "${id}", which is not in the personas array.`
      )
    }
  })

  const personas: ResolvedPersona[] = []
  wanted.forEach((personaId) => {
    const record = findById(personaRecords, FIELD_NAMES.personaId, personaId)
    if (!record) return
    const name = pickString(record, FIELD_NAMES.personaName) ?? personaId
    const personaProblems: string[] = []

    const selection = findById(selections, FIELD_NAMES.personaId, personaId)
    const ideaIds = pickStrings(selection, FIELD_NAMES.selectedIdeaIds)
    if (!selection) {
      personaProblems.push(
        `No entry in persona_premise_selections for "${personaId}", so it has no selected premises.`
      )
    } else if (!ideaIds.length) {
      personaProblems.push(
        `"${personaId}" has an entry in persona_premise_selections but its selected_idea_ids is empty.`
      )
    }

    personas.push({
      personaId,
      persona: name,
      personaBaseline: pickString(record, FIELD_NAMES.personaBaseline),
      generalProcessingRule: pickString(record, FIELD_NAMES.generalProcessingRule),
      premises: ideaIds.map((ideaId) => resolvePremise(parsed, ideaId, name)),
      problems: personaProblems,
    })
  })

  // A persona duplicated across both lists would run twice; keep the first.
  const seen = new Set<string>()
  const deduped = personas.filter((persona) => {
    if (seen.has(persona.personaId)) return false
    seen.add(persona.personaId)
    return true
  })

  return { personas: deduped, problems }
}

// The exact object step 2's {{PERSONA_AND_PREMISES}} receives: one persona and
// the premises the user left checked, already flat. Nulls are kept rather than
// dropped so the prompt can see which context it did not get.
export const buildS2Payload = (
  persona: ResolvedPersona,
  premises: ResolvedPremise[]
) => ({
  persona: {
    persona_id: persona.personaId,
    persona: persona.persona,
    persona_baseline: persona.personaBaseline,
    general_processing_rule: persona.generalProcessingRule,
  },
  premises: premises.map((premise) => ({
    idea_id: premise.ideaId,
    moment_id: premise.momentId,
    moment: premise.moment,
    trigger_feature: premise.triggerFeature,
    concern: premise.concern,
    processing_path: premise.processingPath,
    comic_role: premise.comicRole,
    comic_translation: premise.comicTranslation,
    comic_contradiction: premise.comicContradiction,
    core_comic_idea: premise.coreComicIdea,
    likely_joke_target: premise.likelyJokeTarget,
    visual_primitives: premise.visualPrimitives,
    semantic_cluster: premise.semanticCluster,
  })),
})

// The stable interface the downstream per-caption steps read. Steps 3 and 4
// consume this and nothing else, so a later change to the discovery schema is
// absorbed here rather than in two more prompts.
export type JokeContext = {
  persona: string
  persona_baseline: string | null
  moment: string | null
  core_comic_idea: string | null
  comic_contradiction: string | null
  likely_joke_target: string | null
  processing_path: string | null
}

export const jokeContextFrom = (
  persona: ResolvedPersona,
  premise: ResolvedPremise | null
): JokeContext => ({
  persona: persona.persona,
  persona_baseline: persona.personaBaseline,
  moment: premise?.moment ?? null,
  core_comic_idea: premise?.coreComicIdea ?? null,
  comic_contradiction: premise?.comicContradiction ?? null,
  likely_joke_target: premise?.likelyJokeTarget ?? null,
  processing_path: premise?.processingPath ?? null,
})
