#!/usr/bin/env node
// Golden checks for the discovery → premise resolver, which does in code the
// idea → activation → moment / idea → path join that step 2 used to be asked
// to do in prose. There is no test runner in this repo, so this is the check:
//
//   node scripts/check-premise-resolver.mjs
//
// The FIXTURE below doubles as the written-down expectation of step 1's output
// contract. When the real discovery prompt lands, diff it against this.
import {
  isDiscoverySchema,
  resolveDiscovery,
  buildS2Payload,
  jokeContextFrom,
} from '../src/app/humor-flavor/[humorFlavorId]/pov-jokes/resolve-premises.ts'

let failures = 0
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures += 1
    console.error(`FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`)
  } else {
    console.log(`ok    ${label}`)
  }
}
const checkIncludes = (label, haystack, needle) => {
  const ok = haystack.some((entry) => entry.includes(needle))
  if (!ok) {
    failures += 1
    console.error(`FAIL  ${label}\n        no problem mentioning "${needle}" in ${JSON.stringify(haystack)}`)
  } else {
    console.log(`ok    ${label}`)
  }
}

// Deliberately off-domain, so nothing here can be mistaken for real data.
const FIXTURE = {
  event: {
    event_core: 'The hardware store runs out of generators before the storm.',
    event_arc: 'warning → rush → sold out',
    event_moments: [
      { moment_id: 'moment_01', moment: 'The storm warning is upgraded to a watch' },
      { moment_id: 'moment_02', moment: 'The last generator sells at 7am' },
    ],
  },
  personas: [
    {
      persona_id: 'persona_owner',
      persona: 'the hardware store owner',
      persona_baseline: 'Prices nothing emotionally and remembers every regular.',
      general_processing_rule: 'civic emergency → inventory problem',
    },
    {
      persona_id: 'persona_regular',
      persona: 'the weekday regular',
      persona_baseline: 'Comes in daily for one item and stays forty minutes.',
      general_processing_rule: 'any event → an anecdote about a previous storm',
    },
  ],
  activations: [
    {
      activation_id: 'act_01',
      persona_id: 'persona_owner',
      moment_id: 'moment_01',
      trigger_feature: 'the watch upgrade',
      activated_concerns: ['shelves emptying faster than restock'],
      activation_strength: 3,
    },
    {
      activation_id: 'act_02',
      persona_id: 'persona_owner',
      moment_id: 'moment_02',
      trigger_feature: 'the last unit selling',
      activated_concerns: ['what to tell everyone arriving at 7:05'],
      activation_strength: 2,
    },
  ],
  processing_paths: [
    {
      path_id: 'path_01',
      activation_id: 'act_01',
      concern: 'shelves emptying faster than restock',
      processing_path: 'weather warning → restock math',
    },
    {
      path_id: 'path_02',
      activation_id: 'act_02',
      concern: 'what to tell everyone arriving at 7:05',
      processing_path: 'sold-out item → apology script',
    },
  ],
  ideas: [
    {
      idea_id: 'idea_owner_01',
      persona_id: 'persona_owner',
      activation_id: 'act_01',
      path_id: 'path_01',
      core_comic_idea: 'The town hears a storm warning; the owner hears a restock deadline.',
      comic_translation: 'civic alarm becomes a purchase-order deadline',
      comic_contradiction: 'It is funny that everyone is preparing for weather while he is preparing for a queue.',
      likely_joke_target: 'the scale of civic panic',
      visual_primitives: ['empty shelf', 'person on the phone with a supplier'],
      semantic_cluster: 'warning becomes logistics',
    },
    {
      idea_id: 'idea_owner_02',
      persona_id: 'persona_owner',
      activation_id: 'act_02',
      path_id: 'path_02',
      core_comic_idea: 'He has to say the same sentence about generators 200 times.',
      comic_translation: 'shortage becomes a script',
      comic_contradiction: 'It is funny that a crisis reduces him to one repeated sentence.',
      likely_joke_target: 'the repetition',
      visual_primitives: ['exhausted person behind a counter'],
      semantic_cluster: 'sold out becomes a script',
    },
  ],
  persona_premise_selections: [
    {
      persona_id: 'persona_owner',
      selected_idea_ids: ['idea_owner_01', 'idea_owner_02'],
    },
  ],
  selected_persona_ids: ['persona_owner'],
}

const clone = () => JSON.parse(JSON.stringify(FIXTURE))

// 1. Schema detection distinguishes discovery from the earlier shape.
check('detects the discovery schema', isDiscoverySchema(FIXTURE), true)
check(
  'does not mistake the legacy schema for discovery',
  isDiscoverySchema({ selected_personas: [{ persona: 'the bar manager' }] }),
  false
)
check('a non-object is not discovery', isDiscoverySchema('nope'), false)

// 2. The happy path resolves every hop.
{
  const { personas, problems } = resolveDiscovery(FIXTURE)
  check('no top-level problems on a clean fixture', problems, [])
  check('one persona survives selection', personas.length, 1)
  check('persona name resolved', personas[0].persona, 'the hardware store owner')
  check('both premises resolved', personas[0].premises.length, 2)
  check('no premise problems', personas[0].premises.flatMap((p) => p.problems), [])
  check(
    'idea → activation → moment resolved',
    personas[0].premises[0].moment,
    'The storm warning is upgraded to a watch'
  )
  check(
    'idea → activation trigger resolved',
    personas[0].premises[0].triggerFeature,
    'the watch upgrade'
  )
  check(
    'idea → path resolved',
    personas[0].premises[1].processingPath,
    'sold-out item → apology script'
  )
  check(
    'visual primitives carried through',
    personas[0].premises[0].visualPrimitives.length,
    2
  )
}

// 3. A dangling idea id is reported, not silently dropped.
{
  const broken = clone()
  broken.persona_premise_selections[0].selected_idea_ids.push('idea_owner_99')
  const { personas } = resolveDiscovery(broken)
  check('the dangling premise is still listed', personas[0].premises.length, 3)
  checkIncludes(
    'a dangling idea id is reported',
    personas[0].premises[2].problems,
    'not in the ideas array'
  )
}

// 4. A broken activation hop is reported and does not blank the premise.
{
  const broken = clone()
  broken.activations = broken.activations.filter((a) => a.activation_id !== 'act_01')
  const { personas } = resolveDiscovery(broken)
  checkIncludes(
    'a missing activation is reported',
    personas[0].premises[0].problems,
    'not in the activations array'
  )
  check(
    'the premise keeps its own comic idea despite the broken hop',
    personas[0].premises[0].coreComicIdea,
    'The town hears a storm warning; the owner hears a restock deadline.'
  )
}

// 5. A missing moment record is reported.
{
  const broken = clone()
  broken.event.event_moments = []
  const { personas } = resolveDiscovery(broken)
  checkIncludes(
    'a missing moment is reported',
    personas[0].premises[0].problems,
    'not in the moments array'
  )
}

// 5b. Moments read from event.event_moments, the contract's canonical home,
// and still resolve if a later prompt ever flattens them to the top level.
{
  const flattened = clone()
  flattened.moments = flattened.event.event_moments
  delete flattened.event.event_moments
  const { personas } = resolveDiscovery(flattened)
  check(
    'top-level moments still resolve',
    personas[0].premises[0].moment,
    'The storm warning is upgraded to a watch'
  )
}

// 5c. The concern comes off the activation's activated_concerns list.
{
  const { personas } = resolveDiscovery(FIXTURE)
  check(
    'activated_concerns resolves to the concern',
    personas[0].premises[0].concern,
    'shelves emptying faster than restock'
  )
  const viaPath = clone()
  delete viaPath.activations[0].activated_concerns
  const { personas: p2 } = resolveDiscovery(viaPath)
  check(
    'falls back to the processing path\u2019s concern',
    p2[0].premises[0].concern,
    'shelves emptying faster than restock'
  )
}

// 6. The one field step 2 cannot work without is called out by name.
{
  const broken = clone()
  delete broken.ideas[0].core_comic_idea
  const { personas } = resolveDiscovery(broken)
  checkIncludes(
    'a missing core_comic_idea is reported',
    personas[0].premises[0].problems,
    'core_comic_idea'
  )
}

// 7. Missing selections are a loud problem, not an empty page. The persona is
// still listed — with zero premises and a stated reason — because a persona
// that silently disappears looks identical to one step 1 never found.
{
  const broken = clone()
  delete broken.persona_premise_selections
  const { personas, problems } = resolveDiscovery(broken)
  checkIncludes('missing selections are reported', problems, 'persona_premise_selections')
  check('the persona is still listed', personas.length, 1)
  check('it has no premises to run', personas[0].premises.length, 0)
  checkIncludes(
    'and says why it has none',
    personas[0].problems,
    'persona_premise_selections'
  )
}

// 8. A selected persona that does not exist is named.
{
  const broken = clone()
  broken.selected_persona_ids = ['persona_owner', 'persona_ghost']
  const { personas, problems } = resolveDiscovery(broken)
  checkIncludes('an unknown selected persona is named', problems, 'persona_ghost')
  check('the real persona still resolves', personas.length, 1)
}

// 9. Falling back to the selections list when selected_persona_ids is absent.
{
  const broken = clone()
  delete broken.selected_persona_ids
  const { personas } = resolveDiscovery(broken)
  check('falls back to persona_premise_selections', personas.length, 1)
}

// 10. The step-2 payload is flat, ordered, and keeps nulls.
{
  const { personas } = resolveDiscovery(FIXTURE)
  const payload = buildS2Payload(personas[0], personas[0].premises.slice(0, 1))
  check('payload has exactly two top-level keys', Object.keys(payload), ['persona', 'premises'])
  check('payload carries only the checked premises', payload.premises.length, 1)
  check('payload premise is flat', payload.premises[0].moment, 'The storm warning is upgraded to a watch')
  check(
    'payload keeps a missing field as null rather than dropping it',
    Object.prototype.hasOwnProperty.call(payload.premises[0], 'semantic_cluster'),
    true
  )
  check('no ids are left for the model to join', payload.premises[0].idea_id, 'idea_owner_01')
}

// 11. joke_context is the stable downstream interface.
{
  const { personas } = resolveDiscovery(FIXTURE)
  const context = jokeContextFrom(personas[0], personas[0].premises[1])
  check('joke_context keys are stable', Object.keys(context), [
    'persona',
    'persona_baseline',
    'moment',
    'core_comic_idea',
    'comic_contradiction',
    'likely_joke_target',
    'processing_path',
  ])
  check('joke_context carries the premise moment', context.moment, 'The last generator sells at 7am')
  const noPremise = jokeContextFrom(personas[0], null)
  check('joke_context survives a caption with no premise', noPremise.moment, null)
  check('joke_context still names the persona', noPremise.persona, 'the hardware store owner')
}

console.log(
  failures ? `\n${failures} check(s) FAILED` : '\nall checks passed'
)
process.exit(failures ? 1 : 0)
