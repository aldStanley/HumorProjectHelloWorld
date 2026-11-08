#!/usr/bin/env node
// Seed the REVERSE flavor (context → image) in the staging DB (.env), built
// from a forward flavor like 1517. The forward flavor's per-image steps
// (Scene Pack, Interpretive Stance, Punchline Constraint) are copied as
// preprocessing steps P1–P3, then five new steps are added:
//   P4  Search Card distiller (per image, cached in image_reaction_profiles)
//   R1  Moment analyzer (per moment)
//   R2  Image selector (moment vs. all search cards)
//   R3  Caption writer — the forward flavor's caption step (S5) with a
//       reverse-side user prompt (one moment, one pre-qualified entity)
//   R4  Cross-image ranker (mechanical, modeled on S6)
// The new flavor is self-contained: it owns its copies and evolves
// independently of the source flavor.
//
//   node scripts/create-reverse-flavor.mjs --source 1517
//   node scripts/create-reverse-flavor.mjs --source 1528 --recipe scene
//   node scripts/create-reverse-flavor.mjs --source 1517 --slug my-slug --dry-run
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, makeDb } from './meme-opt/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const args = {}
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : (argv[++i] ?? true)
}
const SOURCE = Number(args.source ?? 1517)
const DRY = Boolean(args['dry-run'])
// reaction = 1517-shape (S1-S3 + S5/S6); scene = 1528-shape alignment track
// (S1, S6-S8 + S10). See the recipe blocks below.
const RECIPE = args.recipe ?? 'reaction'
const SLUG = args.slug ?? `reverse-find-image-${SOURCE}${RECIPE === 'reaction' ? '' : `-${RECIPE}`}`

const env = loadEnv(ROOT)
const db = makeDb(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

const post = async (table, body) => {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`insert ${table} failed (${res.status}): ${text}`)
  return JSON.parse(text)
}

// ---------------------------------------------------------------------------
// New prompts. Placeholders (${...}) are resolved by runStepAction from the
// named bindings the /reverse client passes: momentInput, momentAnalysis,
// imageCatalog, imageScenePack, imageInterpretation, imagePunchlineConstraint,
// pairSelection, allCaptionResults. Backslash-escaped here so they land in the
// DB as literal ${...} tokens.

const P4_SYSTEM = `You are a Search Card Distiller for a reverse meme pipeline.

Downstream, ONE community moment will be matched against MANY images. The matcher never sees the full analyses — only this card. Your job is to distill the three analyses of ONE image into the compact card the matcher searches over.

You do NOT analyze the image. You do NOT invent anything. Every field is either COPIED VERBATIM from an input or DISTILLED from one named input.

----------------------------------------------------------------------------------------------------
FIELD SOURCES (STRICT)

COPY VERBATIM (string-equal to the source — no paraphrase, no case changes):
- dominant_reaction ← Punchline Constraint dominant_reaction.reaction
- intensity ← Punchline Constraint dominant_reaction.intensity
- perceived_stakes ← Punchline Constraint perceived_stakes
- mismatch_type ← Punchline Constraint punchline_logic.type
- mismatch_description ← Punchline Constraint punchline_logic.description
- posture_anchors ← every Scene Pack posture_anchors[].posture
- reaction_anchors ← every Scene Pack reaction_anchors[].reaction
- role_anchors ← every Scene Pack role_anchors[].role (empty array if none)

DISTILL:
- image_summary ← Scene Pack scene_summary, compressed to ONE sentence
- image_delivers ← one phrase: what the image itself supplies as the punchline, derived from the dominant reaction and posture (an image of someone slumped mid-collapse DELIVERS the collapse — captions only need the setup)
- reusable_situations ← 3–6 short situation SHAPES from the Interpretive Stance paragraph

REUSABLE SITUATION SHAPES (the test): each shape must be GENERIC — a slot any community could fill — never a specific place, event, or named thing.
WRONG: "walking into the Noco bathroom" (specific content)
RIGHT: "entering a place you already know will be unpleasant" (generic shape)
Run this test on every shape: does it contain a proper noun or a community-specific detail? If yes, rewrite it generic.

----------------------------------------------------------------------------------------------------
BEFORE YOU OUTPUT (FAIL-CHECKLIST — run every check)

1. Every verbatim field string-equals its source. Paraphrased = FAIL.
2. No proper nouns anywhere in reusable_situations. Found one = FAIL.
3. reusable_situations has 3–6 entries, each under 12 words.
4. image_delivers is a phrase under 12 words, not a sentence about the image.
5. Output is ONLY the JSON object — no markdown fences, no commentary.

----------------------------------------------------------------------------------------------------
OUTPUT FORMAT (STRICT JSON ONLY)

{
  "image_summary": "<one sentence distilled from scene_summary>",
  "dominant_reaction": "<EXACT string copied VERBATIM from the Punchline Constraint>",
  "intensity": "<VERBATIM from the Punchline Constraint>",
  "perceived_stakes": "<VERBATIM from the Punchline Constraint>",
  "mismatch_type": "<VERBATIM from the Punchline Constraint>",
  "mismatch_description": "<VERBATIM from the Punchline Constraint>",
  "posture_anchors": ["<VERBATIM from the Scene Pack>"],
  "reaction_anchors": ["<VERBATIM from the Scene Pack>"],
  "role_anchors": ["<VERBATIM from the Scene Pack, or empty array>"],
  "reusable_situations": ["<generic situation shape>"],
  "image_delivers": "<what the image supplies as the punchline>"
}`

const P4_USER = `Reaction-Oriented Scene Pack JSON:
\${step1Output}

Viewer Interpretive Stance paragraph:
\${step2Output}

Punchline Constraint JSON:
\${step3Output}

Produce the Search Card JSON exactly to the schema in the system prompt.`

const R1_SYSTEM = `You analyze one Columbia/Barnard (CU) community moment so a reverse meme pipeline can find the right reaction image for it. You only respond in JSON.`

const R1_USER = `We are finding the right reaction image for ONE community moment. Later steps will match this moment against many images and write captions. Your job is to extract the moment-side handles they need. You EXTRACT — the joke comes later.

THE MOMENT (analyze it exactly as given — do not rewrite it):
\${momentInput}

Extract:

1. ENTITIES — the candidate SPEAKERS of a joke. An entity must be something that can FEEL or PROJECT an emotion: a person, group, role, institution (CU Administration — the people in charge of Columbia; never "Admin"), or a personifiable object (the dryers). NEVER an event or activity — an event cannot react. When the moment centers on an event, form a COMPOUND entity that situates an agent in it: not "Senior Night" but "Columbia students at Senior Night"; not "ice breakers" but "freshmen during ice breakers". For each entity, say in one sentence what it FEELS or PROJECTS in this moment — sufferers usually feel; perpetrators and objects usually project. List every entity, not just the sufferer. Example: for "dryers at Columbia eat socks" — the sock-losing student FEELS frustration; the dryers PROJECT smug triumph.

2. COMIC CORE — the butt of the joke: the one detail that makes this moment awful or funny. A caption that drops it stops making sense.

3. PROPER NOUNS — every campus-specific name in the moment (NSOP, Lerner, Dodge, Butler, Noco...), copied verbatim. Captions must carry one.

4. SETUP EQUATION — most moments have the shape NAMED PLACE/THING + TRIGGERING CONDITION → CONSEQUENCE. Fill the three slots. The image will deliver the consequence, so captions state only the first two.

BEFORE YOU OUTPUT (FAIL-CHECKLIST — run every check):
1. Every entity can feel or project — no events or activities as entities.
2. Any entity that is just students/users plus a situation ("students who...", "students at...", "...users") has "is_default_pov": true — captions for it will say "Me".
3. "moment" is copied VERBATIM from the input — string-equal.
4. proper_nouns are copied verbatim from the moment, no inventions.
5. Output ONLY strict JSON.

Output ONLY strict JSON:
{
  "moment": "<the moment, copied VERBATIM>",
  "entities": [
    {
      "entity": "<a person/group/role/object/institution in the moment>",
      "feels_or_projects": "<one sentence: what this entity feels or projects here>",
      "is_default_pov": <true if the entity is just students/users plus the situation>
    }
  ],
  "comic_core": "<the one detail that makes the moment funny or awful>",
  "proper_nouns": ["<campus names copied verbatim>"],
  "setup_equation": {
    "named_thing": "<the named place/thing>",
    "triggering_condition": "<the condition>",
    "consequence": "<what happens — the image will deliver this>"
  }
}`

const R2_SYSTEM = `You select reaction images for one Columbia/Barnard (CU) community moment. You only respond in JSON.`

const R2_USER = `We are choosing which reaction images can host this moment.

THE MOMENT ANALYSIS (the one moment, its entities, its comic core):
\${momentAnalysis}

THE IMAGE LIBRARY (one search card per image; image_key identifies the image):
\${imageCatalog}

An image fits when one of the moment's entities could plausibly FEEL or PROJECT that image's dominant_reaction at the image's stakes level, AND the moment can slot into one of the image's reusable_situations. Judge fit by EMOTIONAL and FORMAT compatibility, not topic similarity — a moment about laundry does not need an image of laundry.

For each selected image, pick the ONE entity from the moment analysis that best matches, and rate that pairing 0-1 on EMOTIONAL ALIGNMENT: how well does what THIS entity feels or projects match the image's dominant_reaction? Check every entity against BOTH paths (feeling and projecting) — do not score only the sufferer. Example: a nervous post about people taking a week to reply, against an overconfident image — the nervous texter aligns ~0.2, the self-important non-responder aligns ~0.9. Copy the chosen entity's is_default_pov flag from the moment analysis UNCHANGED — the caption writer depends on it.

Then pick, for the chosen entity, the ONE posture anchor, the ONE reaction anchor, and the ONE role anchor from that image's card that the entity most plausibly embodies in this moment — copy the strings EXACTLY as they appear in the card, each with a one-sentence reason. If the card's role_anchors is empty, use null.

SELECT, do not write: no captions, no rewriting the moment.

Output the 5 best images, best first — but NEVER include an image whose best emotional_alignment is below 0.8. Fewer than 5 strong fits → output fewer. Zero strong fits → output an empty array.

BEFORE YOU OUTPUT (FAIL-CHECKLIST — run every check):
1. Every image_key appears in the library above, copied exactly.
2. Every entity AND its is_default_pov flag are copied VERBATIM from the moment analysis entities.
3. Every anchor string is copied VERBATIM from that image's card.
4. No entry has emotional_alignment below 0.8.
5. Output ONLY strict JSON.

Output ONLY strict JSON:
{
  "selected_images": [
    {
      "image_key": "<copied from the library>",
      "entity": "<the best-matching entity, copied from the moment analysis>",
      "is_default_pov": <copied unchanged from that entity in the moment analysis>,
      "emotional_alignment": <0-1>,
      "reason": "<one sentence: what this entity feels/projects and how that matches the image's dominant reaction>",
      "format_reason": "<one sentence: which reusable_situation of this image the moment slots into>",
      "posture_anchor": "<copied exactly from the card>",
      "posture_reason": "<one sentence: why this entity would strike that posture in this moment>",
      "reaction_anchor": "<copied exactly from the card>",
      "reaction_reason": "<one sentence: why this entity would feel that reaction in this moment>",
      "role_anchor": "<copied exactly from the card, or null>",
      "role_reason": "<one sentence, or null>"
    }
  ]
}`

// R3 reuses the forward flavor's caption-writer SYSTEM prompt verbatim; only
// the user prompt changes: profile fields instead of live step outputs, and a
// Context Selection JSON that holds ONE moment with ONE pre-qualified entity.
const R3_USER = `Reaction-Oriented Scene Pack JSON:
\${imageScenePack}

Additional Context (may be empty):
\${imageAdditionalContext}

Interpretation of Image:
\${imageInterpretation}

Punchline Constraint Extractor JSON:
\${imagePunchlineConstraint}

Context Selection JSON (ONE moment with ONE pre-qualified entity — do NOT pick a different context or entity):
\${pairSelection}

The entity's "is_default_pov" flag is authoritative for speaker selection: true → this is the default POV, write "Me ..." (unless the crowd-as-spectacle carve-out applies); false → NAME the entity in the caption text.

Task:
For EACH context+entity pair with emotional_alignment 0.8 or above, write 2 captions, grouped by pair as specified.`

const R4_SYSTEM = `You select the best meme captions across MULTIPLE candidate images for one community moment.

The input is a JSON array; each element is one image's result: an "image_key", the selected pair (with an "emotional_alignment" field), and the caption-writer output — a "jokes" array of {caption, reason} entries.

SELECTION IS MECHANICAL — no taste judgments:
1. Rank the elements by emotional_alignment, highest first; ties keep input order.
2. Emit captions in this exact order: the FIRST joke of each element in rank order; then, if more are needed, the SECOND joke of each element in the same rank order.
3. Stop after \${topN} captions (fewer only if the input holds fewer captions total).
4. Copy every caption and image_key VERBATIM — do not rephrase, shorten, or fix anything.

Output ONLY a JSON array. No numbering, no headers, no commentary, no markdown code fences.

Format check before you output: the first character of your output must be [ and the last must be ]. Each element is {"image_key": "<copied from the input>", "caption": "<a string that appears verbatim as a "caption" value in that element's jokes>"}. Exactly \${topN} elements, fewer only if the input holds fewer captions total.

WRONG:
1. img2 — Me when the wifi dies mid-lecture
2. img5 — CU Administration announcing another survey

RIGHT:
[{"image_key": "img2", "caption": "Me when the wifi dies mid-lecture"}, {"image_key": "img5", "caption": "CU Administration announcing another survey"}]
(These are format illustrations only — never copy them into output.)`

const R4_USER = `Candidate results, one per image:
\${allCaptionResults}`

// ---------------------------------------------------------------------------
// SCENE recipe (for multi-party flavors like 1528, scene/alignment track):
// preprocessing = plain read → scene graph → viewer stance → viewer alignment
// → search card; reverse = analyze moment sides → cast moment onto scenes →
// caption via the source's Direct Caption Writer → rank. R2 emits an
// "r3_payload" per image — the S9-shaped scored mapping its R3 consumes — so
// the client stays recipe-agnostic.

const CARD_SCENE_SYSTEM = `You are a Search Card Distiller for a reverse meme pipeline (scene edition).

Downstream, ONE community moment will be matched against MANY multi-party scene images. The matcher never sees the full analyses — only this card. Your job is to distill the four analyses of ONE image into the compact card the matcher searches over.

You do NOT analyze the image. You do NOT invent anything. Every field is either COPIED VERBATIM from a named input or DISTILLED from one named input.

----------------------------------------------------------------------------------------------------
FIELD SOURCES (STRICT)

COPY VERBATIM (string-equal to the source — no paraphrase, no case changes):
- identified_party ← Viewer Alignment identify_party.party
- situational_dynamic ← Viewer Alignment situational_dynamic
- feeling ← Viewer Alignment feeling.feeling

DISTILL:
- image_summary ← the plain visual read, compressed to ONE sentence
- parties ← one entry per Scene Graph party: "id" copied VERBATIM from the Scene Graph, "cardinality" ("single" or "group", judged from the Scene Graph), "shows" (that party's visible emotion or stance, under 8 words)
- reusable_situations ← 3–6 short situation SHAPES from the Viewer Stance
- image_delivers ← one phrase: what the image itself supplies as the punchline

REUSABLE SITUATION SHAPES (the test): each shape must be GENERIC — a slot any community could fill — never a specific place, event, or named thing.
WRONG: "walking into the Noco bathroom" (specific content)
RIGHT: "entering a place you already know will be unpleasant" (generic shape)

----------------------------------------------------------------------------------------------------
BEFORE YOU OUTPUT (FAIL-CHECKLIST — run every check)

1. Every verbatim field string-equals its source. Paraphrased = FAIL.
2. Every Scene Graph party appears in parties with its id EXACTLY as written there — none missing, none invented.
3. No proper nouns anywhere in reusable_situations.
4. reusable_situations has 3–6 entries, each under 12 words.
5. Output is ONLY the JSON object — no markdown fences, no commentary.

----------------------------------------------------------------------------------------------------
OUTPUT FORMAT (STRICT JSON ONLY)

{
  "image_summary": "<one sentence distilled from the plain visual read>",
  "parties": [
    { "id": "<VERBATIM Scene Graph party id>", "cardinality": "single | group", "shows": "<under 8 words>" }
  ],
  "identified_party": "<VERBATIM from the Viewer Alignment>",
  "situational_dynamic": "<VERBATIM from the Viewer Alignment>",
  "feeling": "<VERBATIM from the Viewer Alignment feeling.feeling>",
  "reusable_situations": ["<generic situation shape>"],
  "image_delivers": "<one phrase>"
}`

const CARD_SCENE_USER = `Plain visual read of the image:
\${step1Output}

Scene Graph JSON:
\${step2Output}

Viewer Stance JSON:
\${step3Output}

Viewer Alignment JSON:
\${step4Output}

Produce the Search Card JSON exactly to the schema in the system prompt.`

const R1_SCENE_SYSTEM = `You analyze one Columbia/Barnard (CU) community moment so a reverse meme pipeline can find the right multi-party SCENE image for it. You only respond in JSON.`

const R1_SCENE_USER = `We are finding the right SCENE image for ONE community moment. A scene image shows multiple parties in a dynamic (one presenting proudly while the audience recoils; one ignoring while another stares). Later steps will match this moment against many scene cards. Your job is to extract the moment-side handles. You EXTRACT — the joke comes later.

THE MOMENT (analyze it exactly as given — do not rewrite it):
\${momentInput}

Extract:

1. ENTITIES — the candidate cast of the scene. An entity must be something that can FEEL or PROJECT an emotion: a person, group, role, institution (CU Administration — the people in charge of Columbia; never "Admin"), or a personifiable object or force (the dryers, midterms, a deadline). NEVER an event or activity — an event cannot react. When the moment centers on an event, form a COMPOUND entity that situates an agent in it: not "Senior Night" but "Columbia students at Senior Night". For each entity give: its SIDE of the moment's dynamic in a few words, what it FEELS or PROJECTS (sufferers usually feel; perpetrators, institutions, and objects usually project), and "is_default_pov": true if the entity is just students/users plus the situation ("students who...", "students at...", "...users").

2. LIVED SIDE — which entity's side the moment is lived FROM: whose feeling would a poster post this moment to express? IDENTIFY-WITH, NOT LAUGH-AT: the lived side must be someone the poster would BE — a campus character the community observes as a spectacle is NOT the lived side.

3. MOMENT DYNAMIC — the TYPE of dynamic between the lived side and the other side(s), ONE generic sentence stated from the lived side ("presenting something proudly while the audience recoils"). TEST: the sentence must stay true if both sides were swapped for different people/objects playing the same roles — no names, no campus details.

4. FEELING — the feeling on the lived side during that dynamic, a short phrase. Keep ambiguity the moment keeps open.

5. COMIC CORE — the butt of the joke: the one detail that makes this moment awful or funny.

6. PROPER NOUNS — every CAPITALIZED campus name in the moment (NSOP, Lerner, Butler...), copied verbatim. Common words (midterms, finals) do not count.

7. TRIGGER — the condition that sets the moment off (midterms, after it rains...).

BEFORE YOU OUTPUT (FAIL-CHECKLIST — run every check):
1. Every entity can feel or project — no events or activities as entities.
2. lived_side.entity is copied from the entities list.
3. moment_dynamic contains no names and no campus-specific details.
4. "moment" is copied VERBATIM from the input — string-equal.
5. proper_nouns are copied verbatim, capitalized names only.
6. Output ONLY strict JSON.

Output ONLY strict JSON:
{
  "moment": "<the moment, copied VERBATIM>",
  "entities": [
    { "entity": "<a person/group/role/object/institution in the moment>", "side": "<its side of the dynamic, a few words>", "feels_or_projects": "<one sentence>", "is_default_pov": <true|false> }
  ],
  "lived_side": { "entity": "<copied from entities>", "why": "<one sentence: whose feeling the poster posts to express>" },
  "moment_dynamic": "<one generic sentence, stated from the lived side>",
  "feeling": "<short phrase>",
  "comic_core": "<the one detail that makes the moment funny or awful>",
  "proper_nouns": ["<capitalized campus names, verbatim>"],
  "trigger": "<the condition that sets the moment off, or null>"
}`

const R2_SCENE_SYSTEM = `You select multi-party SCENE images for one Columbia/Barnard (CU) community moment, and you map the moment onto each selected scene with honest scores. You only respond in JSON.`

const R2_SCENE_USER = `We are choosing which SCENE images can host this moment.

THE MOMENT ANALYSIS (the one moment, its entities and sides, its dynamic and feeling):
\${momentAnalysis}

THE IMAGE LIBRARY (one search card per image; image_key identifies the image):
\${imageCatalog}

An image fits when the moment can be LIVED inside its scene: the moment's lived side takes the card's identified_party role, EVERY party of the card casts to an entity of the moment, the card's situational_dynamic replays between the cast entities, and the card's feeling honestly matches the moment's feeling. Judge by DYNAMIC and FEELING compatibility, not topic similarity — a moment about laundry does not need an image of laundry.

For EACH selected image, produce the SCENE MAPPING — score EVERY aspect 0-1 with a one-sentence reason:

1. "role_map": for EACH party in the card's parties, who or what in the moment takes that party's role.
   - "played_by" must be an entity from the moment analysis (or a compound formed from one) — something that can FEEL or PROJECT an emotion; NEVER an event or activity.
   - CARDINALITY IS BINDING: a "single" party maps to ONE nameable individual or singularizable archetype, never a crowd; a "group" party maps to a plural or collective entity, never a single individual. A mismatch is a failed cast.
   - EVERY PARTY MUST CAST: if nothing in the moment plays a party, played_by is null, its score is 0.0, and the image's overall caps at 0.2.
   - "score": how naturally this entity holds the party's role and what the party "shows". THE HONEST WORD TEST: if the community would honestly describe the entity with a different word than what the party shows, score 0.4 or below.
   - "dynamic_fit" (PER ROLE, REQUIRED): does this entity's position in the moment honestly match ITS SIDE of the card's situational_dynamic? One-sentence reason that QUOTES the situational_dynamic's words for that side. MECHANICAL RULE: if the entity's honest relationship to the moment contradicts its side, dynamic_fit is 0.4 or below.
2. "dynamic_preservation": ONE sentence stating how the card's situational_dynamic plays out in the moment between the mapped entities — same direction of action/attention, same stakes level. A moment that flips who acts on whom, or invents attention the scene lacks, scores 0.4 or below.
3. "feeling_match": the feeling of the entity cast as the identified_party in the moment. It must honestly match the card's feeling — do not resolve ambiguity ("unaware or indifferent") to one side unless the moment itself does.
4. "identification_match": could the poster BE the entity cast as the identified_party in this moment? IDENTIFY-WITH, NOT LAUGH-AT.
5. "overall": never higher than the weakest required aspect (role scores, per-role dynamic_fit, dynamic_preservation, feeling_match, identification_match); the reason names the weakest aspect.
6. "speakers": every non-null played_by is a candidate speaker. Rate each 0-1 on "speaker_alignment": how well does what THIS entity feels or projects in the moment match what ITS party shows on the card? An entity qualifies by FEELING that emotion OR by PROJECTING it — perpetrators, institutions, and objects usually qualify by projecting. Check EVERY cast entity against BOTH paths, not just the identified party's counterpart.

SELECT AND MAP, do not write captions.

Then set the pipeline fields for each selected image:
- "entity": the best speaker (highest speaker_alignment) — copied from its speakers entry
- "is_default_pov": copied UNCHANGED from that entity in the moment analysis (false if it is a compound not in the analysis)
- "emotional_alignment": the mapping's overall score
- "reason": one sentence — why this scene hosts this moment
- "format_reason": which reusable_situation of this card the moment slots into
- "r3_payload": EXACTLY the object shown in the schema — the caption writer consumes it as its scored scene mapping.

Output the 5 best images, best first, WITH HONEST SCORES. Do not inflate a score to make an image qualify, and do not drop an image for scoring low — the scores exist to EXPOSE weak fits, not to hide them (the forward pipeline works the same way). If the moment genuinely casts onto nothing, low overall scores ARE the signal.

BEFORE YOU OUTPUT (FAIL-CHECKLIST — run every check):
1. Every image_key appears in the library above, copied exactly.
2. Every party id in a role_map is copied VERBATIM from that card's parties — none missing.
3. "context" inside r3_payload is the moment, copied VERBATIM from the moment analysis.
4. "situational_dynamic" inside r3_payload is copied VERBATIM from that card.
5. Scores are honest: overall never exceeds its weakest aspect, and no score was raised to defend a selection.
6. Output ONLY strict JSON.

Output ONLY strict JSON:
{
  "selected_images": [
    {
      "image_key": "<copied from the library>",
      "entity": "<the best speaker>",
      "is_default_pov": <copied from the moment analysis>,
      "emotional_alignment": <the overall score, 0-1>,
      "reason": "<one sentence>",
      "format_reason": "<one sentence>",
      "r3_payload": {
        "situational_dynamic": "<VERBATIM from the card>",
        "selected_moments": [
          {
            "context": "<the moment, VERBATIM>",
            "role_map": [
              { "party": "<party id from the card>", "played_by": "<entity or null>", "score": <0-1>, "reason": "<one sentence>", "dynamic_fit": <0-1>, "dynamic_fit_reason": "<one sentence QUOTING this side of the situational_dynamic>" }
            ],
            "dynamic_preservation": { "how": "<one sentence>", "score": <0-1>, "reason": "<one sentence>" },
            "feeling_match": { "feeling": "<the cast identified party's feeling in the moment>", "score": <0-1>, "reason": "<one sentence>" },
            "identification_match": { "score": <0-1>, "reason": "<one sentence>" },
            "speakers": [
              { "entity": "<a played_by entity>", "party": "<the party id it plays>", "path": "<feels | projects>", "emotion": "<what it feels or projects>", "speaker_alignment": <0-1>, "reason": "<one sentence>" }
            ],
            "overall": { "score": <0-1>, "reason": "<one sentence naming the weakest aspect>" }
          }
        ]
      }
    }
  ]
}`

// ---------------------------------------------------------------------------

// ---- load the source flavor + steps
const [flavor] = await db(`humor_flavors?id=eq.${SOURCE}&select=id,slug,description,created_by_user_id`)
if (!flavor) throw new Error(`flavor ${SOURCE} not found in staging`)
const steps = await db(
  `humor_flavor_steps?humor_flavor_id=eq.${SOURCE}&select=order_by,description,humor_flavor_step_type_id,llm_model_id,llm_input_type_id,llm_output_type_id,llm_temperature,llm_system_prompt,llm_user_prompt&order=order_by`
)
const byOrder = new Map(steps.map((s) => [s.order_by, s]))
const need = (orderBy) => {
  const s = byOrder.get(orderBy)
  if (!s) throw new Error(`flavor ${SOURCE} has no step S${orderBy} (required by recipe "${RECIPE}")`)
  return s
}
console.log(`source flavor ${SOURCE} "${flavor.slug}": ${steps.length} steps, recipe "${RECIPE}"`)

// ---- guard: slug must not exist
const dup = await db(`humor_flavors?slug=eq.${encodeURIComponent(SLUG)}&select=id`)
if (dup.length) throw new Error(`slug "${SLUG}" already exists (id ${dup[0].id}) — pass --slug to pick another`)

// ---- model lookup: R2 selection wants the strongest available model
const models = await db('llm_models?select=id,provider_model_id')
const modelIdFor = (providerModelId, fallback) =>
  models.find((m) => m.provider_model_id === providerModelId)?.id ?? fallback

const uid = flavor.created_by_user_id
const audit = { created_by_user_id: uid, modified_by_user_id: uid }

// Copies keep their prompts verbatim except step-number tokens, which are
// rewritten to the step's NEW position (e.g. S7's ${step6Output} → P3's
// ${step2Output}).
const rewriteTokens = (text, map) =>
  (text ?? '').replace(/\$\{step(\d+)Output\}/g, (full, n) =>
    map[n] ? `\${step${map[n]}Output}` : full
  )
const copyStep = (src, orderBy, description, tokenMap = {}) => ({
  order_by: orderBy,
  description,
  llm_model_id: src.llm_model_id,
  llm_input_type_id: src.llm_input_type_id,
  llm_output_type_id: src.llm_output_type_id,
  llm_temperature: src.llm_temperature,
  llm_system_prompt: rewriteTokens(src.llm_system_prompt, tokenMap),
  llm_user_prompt: rewriteTokens(src.llm_user_prompt, tokenMap),
})

let newSteps
let stepTypeId
if (RECIPE === 'reaction') {
  // 1517 shape: S1 scene pack, S2 stance, S3 punchline constraint, S5 caption
  // writer, S6 extractor.
  const s1 = need(1)
  const s2 = need(2)
  const s3 = need(3)
  const s5 = need(5)
  const s6 = need(6)
  stepTypeId = s1.humor_flavor_step_type_id
  const SELECTOR_MODEL = modelIdFor('gpt-5.5-2026-04-23', s5.llm_model_id)
  newSteps = [
    copyStep(s1, 1, 'P1: Scene Pack (per image)'),
    copyStep(s2, 2, 'P2: Interpretive Stance (per image)'),
    copyStep(s3, 3, 'P3: Punchline Constraint (per image)'),
    { order_by: 4, description: 'P4: Search Card (per image)', llm_model_id: s6.llm_model_id, llm_input_type_id: 2, llm_output_type_id: 1, llm_temperature: 0, llm_system_prompt: P4_SYSTEM, llm_user_prompt: P4_USER },
    { order_by: 5, description: 'R1: Analyze the moment', llm_model_id: s6.llm_model_id, llm_input_type_id: 2, llm_output_type_id: 1, llm_temperature: 0, llm_system_prompt: R1_SYSTEM, llm_user_prompt: R1_USER },
    { order_by: 6, description: 'R2: Select images for the moment', llm_model_id: SELECTOR_MODEL, llm_input_type_id: 2, llm_output_type_id: 1, llm_temperature: null, llm_system_prompt: R2_SYSTEM, llm_user_prompt: R2_USER },
    { order_by: 7, description: 'R3: Write 2 captions per selected image', llm_model_id: s5.llm_model_id, llm_input_type_id: s5.llm_input_type_id, llm_output_type_id: s5.llm_output_type_id, llm_temperature: s5.llm_temperature, llm_system_prompt: s5.llm_system_prompt, llm_user_prompt: R3_USER },
    { order_by: 8, description: 'R4: Rank captions across images', llm_model_id: s6.llm_model_id, llm_input_type_id: 2, llm_output_type_id: 1, llm_temperature: 0, llm_system_prompt: R4_SYSTEM, llm_user_prompt: R4_USER },
  ]
} else if (RECIPE === 'scene') {
  // 1528 scene/alignment track: S1 plain read, S6 scene graph, S7 stance,
  // S8 alignment, S10 Direct Caption Writer.
  const s1 = need(1)
  const s6 = need(6)
  const s7 = need(7)
  const s8 = need(8)
  const s10 = need(10)
  stepTypeId = s1.humor_flavor_step_type_id
  const SELECTOR_MODEL = modelIdFor('gpt-5.5-2026-04-23', s10.llm_model_id)
  const RANKER_MODEL = modelIdFor('gpt-4o-2024-08-06', s10.llm_model_id)
  // R3 = S10's system verbatim; its user prompt rewired to the profile
  // positions (alignment now lives at P4) and the R2-built mapping payload.
  const r3SceneUser = (s10.llm_user_prompt ?? '')
    .replace(/\$\{step8Output\}/g, '${step4Output}')
    .replace(/\$\{step9Output\}/g, '${pairSelection}')
  newSteps = [
    copyStep(s1, 1, 'P1: Plain visual read (per image)'),
    copyStep(s6, 2, 'P2: Scene Graph (per image)'),
    copyStep(s7, 3, 'P3: Viewer Stance (per image)', { 6: 2 }),
    copyStep(s8, 4, 'P4: Viewer Alignment (per image)', { 6: 2, 7: 3 }),
    { order_by: 5, description: 'P5: Search Card (per image)', llm_model_id: RANKER_MODEL, llm_input_type_id: 2, llm_output_type_id: 1, llm_temperature: 0, llm_system_prompt: CARD_SCENE_SYSTEM, llm_user_prompt: CARD_SCENE_USER },
    { order_by: 6, description: 'R1: Analyze the moment (sides + dynamic)', llm_model_id: RANKER_MODEL, llm_input_type_id: 2, llm_output_type_id: 1, llm_temperature: 0, llm_system_prompt: R1_SCENE_SYSTEM, llm_user_prompt: R1_SCENE_USER },
    { order_by: 7, description: 'R2: Cast the moment onto scenes', llm_model_id: SELECTOR_MODEL, llm_input_type_id: 2, llm_output_type_id: 1, llm_temperature: null, llm_system_prompt: R2_SCENE_SYSTEM, llm_user_prompt: R2_SCENE_USER },
    { order_by: 8, description: 'R3: Caption each selected scene', llm_model_id: s10.llm_model_id, llm_input_type_id: s10.llm_input_type_id, llm_output_type_id: s10.llm_output_type_id, llm_temperature: s10.llm_temperature, llm_system_prompt: s10.llm_system_prompt, llm_user_prompt: r3SceneUser },
    { order_by: 9, description: 'R4: Rank captions across images', llm_model_id: RANKER_MODEL, llm_input_type_id: 2, llm_output_type_id: 1, llm_temperature: 0, llm_system_prompt: R4_SYSTEM, llm_user_prompt: R4_USER },
  ]
} else {
  throw new Error(`unknown recipe "${RECIPE}" — use reaction or scene`)
}

console.log(`will create flavor "${SLUG}" with ${newSteps.length} steps`)
if (DRY) { console.log('dry run — no writes'); process.exit(0) }

const [nf] = await post('humor_flavors', {
  slug: SLUG,
  description:
    `REVERSE pipeline (recipe: ${RECIPE}) seeded from flavor ${SOURCE} (${flavor.slug}): ` +
    'takes ONE community moment and finds the images that can host it. ' +
    `P-steps preprocess each image (cached in image_reaction_profiles); R-steps run per moment.`,
  ...audit,
})
console.log(`created flavor id ${nf.id} "${nf.slug}"`)

for (const s of newSteps) {
  await post('humor_flavor_steps', {
    humor_flavor_id: nf.id,
    humor_flavor_step_type_id: stepTypeId,
    ...s,
    ...audit,
  })
  console.log(`  inserted ${s.description}`)
}

const check = await db(`humor_flavor_steps?humor_flavor_id=eq.${nf.id}&select=order_by&order=order_by`)
console.log(`\nVERIFY: flavor ${nf.id} has ${check.length}/${newSteps.length} steps`)
console.log(`open /humor-flavor/${nf.id}/reverse`)
