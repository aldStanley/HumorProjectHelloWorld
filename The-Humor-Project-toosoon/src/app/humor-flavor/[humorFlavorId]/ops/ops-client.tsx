'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { JsonTree } from '@/components/json-tree'

// The typed-operations surface reuses the Chiltrix run action. Its resolver now
// treats an explicitly-passed named variable (e.g. ${emotionalTone}) as an
// override of any built-in of the same name, which is exactly how a bound input
// slot should behave.
import BulkModelSelect, { type ModelChoice } from '@/components/bulk-model-select'
import ManualStepValue from '@/components/manual-step-value'
import { parseManualStepOutput } from '@/utils/manual-step-output'

import { diagnoseJokeAction, runStepAction } from '../chiltrix/actions'
import {
  listClusteringsAction,
  loadClusteringAction,
  type SavedClusteringMeta,
} from '@/app/sidechat-topics/actions'
import { clusteringToContextText } from '@/app/sidechat-topics/sidechat-moments'
import {
  loadHarnessManifestAction,
  type HarnessCastCard,
} from './harness-actions'
import { setStepHiddenAction, updateStepPromptsAction } from '../actions'
import {
  createOpsRunAction,
  finishOpsRunAction,
  finishOpsRunImageAction,
  saveOpsRunStepsAction,
  startOpsRunImageAction,
  type OpsRunStepRecord,
} from './run-actions'
import {
  finalCaptions,
  quickStudyRows,
  type GalleryItem,
  type QuickStudyRow,
} from './export-format'

export type OpsStep = {
  id: number
  orderBy: number
  description: string
  systemPrompt: string
  userPrompt: string
  providerModelId: string
  isTemperatureSupported: boolean
  temperature: number | null
  includeImage: boolean
  isHidden: boolean
}

export type OpsImage = {
  id: string
  url: string
  additionalContext: string | null
  imageDescription: string | null
  celebrityRecognition: string | null
}

export type OpsImageSet = {
  id: number
  slug: string
  images: OpsImage[]
}

type ImageField =
  | 'imageDescription'
  | 'additionalContext'
  | 'celebrityRecognition'

// A binding wires an input slot to where its value comes from.
type Binding =
  | { kind: 'op'; opKey: string } // an upstream operation's output
  | { kind: 'image'; field: ImageField } // a built-in cached image field
  | { kind: 'corpus' } // sampled server-side at runtime (display only)
  | { kind: 'studentBrain' } // fetched server-side at runtime (display only)
  // The two runtime slots above can be overridden from the UI:
  | { kind: 'off' } // slot unchecked — sent as an empty string
  | { kind: 'clustering'; id: string; name: string } // a saved Sidechat clustering, as text

type InputSlot = {
  slot: string // the local name used inside the prompt (${slot})
  description: string // the tool-spec description an agent would read
  binding: Binding // default wiring
  // If true, the op can run even when this input hasn't been produced yet
  // (the transform/prompt handles a missing value itself).
  optional?: boolean
}

// 'llm' calls a model; 'transform' runs a pure JS function (no model).
type OpKind = 'llm' | 'transform'

type OpSpec = {
  key: string
  kind: OpKind
  fromOrderBy?: number // which loaded step supplies the prompt + model (llm only)
  title: string
  description: string
  output: { name: string; description: string; isList?: boolean }
  // ${oldVar} -> slot, applied to the loaded prompt to express it in slot names
  rewrites: Record<string, string>
  // Extra text appended to the user prompt (already in slot names). Lets a
  // variant op reuse a step's prompt but add an input, for A/B comparison.
  appendUserPrompt?: string
  inputs: InputSlot[]
  // If set, the op runs once per element of this (list-valued) slot — a fan-out.
  fanOutOver?: string
  // For a fan-out op: fill these slots from the current branch's bundle instead
  // of the whole-list binding. { slotName: bundleKey }.
  bundleSlots?: Record<string, string>
  // For kind 'transform': pure function of the resolved input values.
  transform?: (vals: Record<string, unknown>) => unknown
  // Inline prompts (already in slot names). When set, used instead of the
  // fromOrderBy step's prompts — for analysis ops that have no flavor step.
  // (fromOrderBy is still used to borrow a model.)
  systemPrompt?: string
  userPrompt?: string
  // Overrides the borrowed step's temperature (when the model supports it).
  temperature?: number
  // Overrides the borrowed step's model id (still borrows everything else — the
  // prompt, temperature support — from the fromOrderBy step). Provider is routed
  // from the id (grok*/gemini* → that provider, else OpenAI).
  providerModelId?: string
  // Overrides the borrowed step's includeImage flag. Lets an analysis op attach
  // the real image without changing the shared flavor step it borrows its model
  // from. Requires the borrowed model to be vision-capable.
  includeImage?: boolean
  // A short highlighted note shown on the card (e.g. how ranking is done).
  note?: string
}

// Shared caption-writing clause: when the image is a known meme, the caption
// must be WRITTEN to fit the template (not just judged afterward). Appended to
// the caption ops so a meme joke actually reads as that meme.
const MEME_FORMAT_CLAUSE =
  '\n\n--------------------------------------\n' +
  'MEME FORMAT (important). The recognized content below includes a "meme" verdict ' +
  '(is_meme, template_name, meaning, how_a_caption_should_use_it):\n${recognizedContent}\n' +
  'If meme.is_meme is true, the caption MUST fit that template: follow ' +
  'meme.how_a_caption_should_use_it and the template’s conventional FORMAT or ' +
  'snowclone (e.g. the "I am once again asking for ___" structure) so it ' +
  'unmistakably reads as that meme. A caption that does not read as the template is ' +
  'wrong even if it is funny.\n' +
  'IF meme.image_is_punchline is true, the IMAGE itself delivers the punchline — ' +
  'write ONLY the SETUP and let the image land the joke. Adding ' +
  'the punchline in text is redundant and ruins the joke.\n' +
  'If meme.is_meme is false, ignore this section.'

// ---- The seed: S1 -> S2 -> S3 -> S4 of the flavor, expressed as typed
// operations. This is the DEFAULT pipeline shared by every flavor. To give a
// specific flavor its OWN editable copy, duplicate this array into a new const
// and register it in FLAVOR_PIPELINES below, keyed by that flavor's id.
const DEFAULT_OP_SPECS: OpSpec[] = [
  {
    key: 'recognize',
    kind: 'llm',
    fromOrderBy: 1,
    title: 'Recognize content',
    description:
      'Identifies famous or recognizable content in the image — people, characters, shows, locations, brands, logos, events, memes.',
    output: {
      name: 'recognizedContent',
      description:
        'recognized people/brands/places PLUS a structured meme-template verdict, as JSON',
    },
    // S1 reads the image directly; it has no ${stepNOutput} references.
    rewrites: {},
    appendUserPrompt:
      '\n\n--------------------------------------\n' +
      'Do your normal recognition above exactly as usual — fill in all the content / ' +
      'scene fields fully. Then ALSO add ONE extra top-level field "meme".\n' +
      '"is_meme" is true if the image is a recognizable, reusable MEME or REACTION ' +
      'IMAGE — a still people commonly caption to express a feeling (frustration, ' +
      'panic, smugness, etc.), including well-known TV/movie reaction shots — even if ' +
      'it has no official name. It is false only for a generic or original photo with ' +
      'no established meme/reaction use. BE CONSISTENT: if your scene_context says the ' +
      'image is used in meme or reaction culture, "is_meme" MUST be true.\n' +
      'When true, give a template_name (an official name if it has one, else a short ' +
      'descriptive handle like "Henry Danger panic-at-laptop reaction") and say how ' +
      'it is used — and in how_a_caption_should_use_it, spell out the concrete caption ' +
      'FORMAT or snowclone if the template has one (e.g. "I am once again asking for ___").\n' +
      'ALSO: set "image_is_punchline" true when the IMAGE ITSELF delivers the ' +
      'punchline / reaction (a reaction image) — meaning a good caption is only the ' +
      'SETUP and the image lands the joke. When it does, put what the image itself ' +
      'says or implies in "image_delivers" (e.g. "an emphatic NO", "disgust", "hard ' +
      'pass") — this is the response the caption must NOT restate in words.\n' +
      '"meme": { "is_meme": <bool>, "template_name": <name/short description or null>, ' +
      '"meaning": <how it is normally used, or null>, "how_a_caption_should_use_it": ' +
      '<or null>, "image_is_punchline": <bool>, "image_delivers": <what the image ' +
      'says/implies, or null>, "confidence": <0..1> }',
    inputs: [],
  },
  {
    key: 'describe',
    kind: 'llm',
    fromOrderBy: 2,
    title: 'Describe image',
    description:
      'Produces a detailed, neutral description of the scene — demeanor, foreground/background, and any notable setting.',
    output: {
      name: 'imageDescription',
      description: 'a literal, neutral description of what is in the image',
    },
    rewrites: { step1Output: 'recognizedContent' },
    inputs: [
      {
        slot: 'recognizedContent',
        description: 'famous people, brands, places or scenes detected in the image',
        binding: { kind: 'op', opKey: 'recognize' },
      },
      {
        slot: 'imageAdditionalContext',
        description: 'extra facts attached to the image',
        binding: { kind: 'image', field: 'additionalContext' },
      },
    ],
  },
  {
    key: 'tone',
    kind: 'llm',
    fromOrderBy: 3,
    title: 'Read emotional tone',
    description:
      'Infers the dominant feeling the image gives the viewer (not the emotion of people in it).',
    output: {
      name: 'emotionalTone',
      description: 'the dominant emotional vibe the image evokes, as a short phrase',
    },
    rewrites: { step2Output: 'imageDescription' },
    inputs: [
      {
        slot: 'imageDescription',
        description: 'a description of the scene',
        binding: { kind: 'op', opKey: 'describe' },
      },
    ],
  },
  {
    key: 'toneCeleb',
    kind: 'llm',
    fromOrderBy: 4,
    title: 'Emotional tone (with celeb)',
    description:
      'Infers the emotional tone, also taking the recognized celebrity / content into account.',
    output: {
      name: 'emotionalToneCeleb',
      description:
        'the emotional vibe, informed by who/what is recognized in the image',
    },
    rewrites: { step2Output: 'imageDescription', step1Output: 'recognizedContent' },
    // Attach the real image so the tone is read from the actual expressions and
    // body language, not only the text description. Requires S4's model to be vision-capable.
    includeImage: true,
    appendUserPrompt:
      '\n\n--------------------------------------\n' +
      'An image is ATTACHED. Read the emotional tone from what is actually visible ' +
      'in it (facial expressions, body language, setting) — the description and ' +
      'recognized content above are only supplements.\n' +
      '\n--------------------------------------\n' +
      'If the recognized content marks this as a meme (meme.is_meme is true), RESTATE ' +
      'it here: name the template and its conventional meaning, and factor that ' +
      'meme’s typical use into the emotional tone you report.',
    inputs: [
      {
        slot: 'imageDescription',
        description: 'a description of the scene',
        binding: { kind: 'op', opKey: 'describe' },
      },
      {
        slot: 'recognizedContent',
        description: 'famous people, brands, places or scenes detected in the image',
        binding: { kind: 'op', opKey: 'recognize' },
      },
      {
        slot: 'imageAdditionalContext',
        description: 'extra facts attached to the image',
        binding: { kind: 'image', field: 'additionalContext' },
      },
    ],
  },
  {
    key: 'relevant',
    kind: 'llm',
    fromOrderBy: 5,
    title: 'Find relevant CU content',
    description:
      'Ranks Columbia/Barnard lived-experience moments by how well they connect to the image (visually and emotionally).',
    output: {
      name: 'relevantMoments',
      description: '5 ranked moments with visual + emotional scores, as JSON',
      isList: true,
    },
    rewrites: {
      step2Output: 'imageDescription',
      step4Output: 'emotionalToneCeleb',
    },
    appendUserPrompt:
      '\n\n--------------------------------------\n' +
      'When scoring VISUAL connection, do NOT require the literal activity to be ' +
      'shown. Also consider the OBJECTS, TOOLS, or SETTINGS a moment implies and ' +
      'check whether THOSE appear in the image description. Example: Vergil, ' +
      'waitlists, CourseWorks, or course registration all imply a computer / ' +
      'laptop / screen — if the description mentions a laptop or screen, that is a ' +
      'real visual connection even though registration itself is not depicted. ' +
      'Name the specific object you matched in the visual_connection reason.',
    inputs: [
      {
        slot: 'imageDescription',
        description: 'a description of the scene',
        binding: { kind: 'op', opKey: 'describe' },
      },
      {
        slot: 'emotionalToneCeleb',
        description: 'the feeling the image evokes (celeb-aware)',
        binding: { kind: 'op', opKey: 'toneCeleb' },
      },
      {
        slot: 'imageAdditionalContext',
        description: 'extra facts attached to the image',
        binding: { kind: 'image', field: 'additionalContext' },
      },
      {
        slot: 'allCommunityContexts',
        description: 'the full Columbia moments corpus',
        binding: { kind: 'corpus' },
      },
    ],
  },
  {
    key: 'filter',
    kind: 'transform',
    title: 'Filter strong moments',
    description:
      'Pure code (no model): keeps only moments whose average OR highest of the visual/emotional scores is ≥ 0.7.',
    output: {
      name: 'strongMoments',
      description: 'the subset of moments that cleared the 0.7 threshold',
      isList: true,
    },
    rewrites: {},
    inputs: [
      {
        slot: 'relevantMoments',
        description: 'all scored moments to filter',
        binding: { kind: 'op', opKey: 'relevant' },
      },
    ],
    transform: (vals) => {
      const arr = parseJsonLoose(vals.relevantMoments)
      if (!Array.isArray(arr)) return []
      const num = (x: unknown): number | null => {
        const n = Number(x)
        return Number.isFinite(n) ? n : null
      }
      return arr.filter((m) => {
        const v = num(m?.visual_connection?.score)
        const e = num(m?.emotional_connection?.score)
        const rel = num(m?.relevance_score)
        // Prefer the two-axis scores when present; otherwise fall back to a
        // single relevance_score (which already is the higher of the two axes).
        const axes = [v, e].filter((n): n is number => n != null)
        const avg = axes.length
          ? axes.reduce((a, b) => a + b, 0) / axes.length
          : rel
        const max = axes.length ? Math.max(...axes) : rel
        if (avg == null && max == null) return false
        return (avg ?? 0) >= 0.7 || (max ?? 0) >= 0.7
      })
    },
  },
  {
    key: 'focus',
    kind: 'transform',
    title: 'Decide focus (visual vs emotional)',
    description:
      'Pure code (no model): from each moment’s scores, tag which connection to lean into — visual, emotional, or both — and why.',
    output: {
      name: 'focusedMoments',
      description: 'each moment annotated with a "focus" decision',
      isList: true,
    },
    rewrites: {},
    inputs: [
      {
        slot: 'strongMoments',
        description: 'the strong moments to decide on',
        binding: { kind: 'op', opKey: 'filter' },
      },
    ],
    transform: (vals) => {
      const arr = Array.isArray(vals.strongMoments)
        ? vals.strongMoments
        : parseJsonLoose(vals.strongMoments)
      if (!Array.isArray(arr)) return []
      const num = (x: unknown): number | null => {
        const n = Number(x)
        return Number.isFinite(n) ? n : null
      }
      const HIGH = 0.7
      return arr.map((m) => {
        const v = num(m?.visual_connection?.score)
        const e = num(m?.emotional_connection?.score)
        let focus: string
        let basis: string
        if (v == null || e == null) {
          focus = 'both'
          basis = 'only a single score available'
        } else if (v >= HIGH && e >= HIGH) {
          focus = 'both'
          basis = `both strong (visual ${v}, emotional ${e})`
        } else if (v >= e) {
          focus = 'visual'
          basis = `visual ${v} ≥ emotional ${e}`
        } else {
          focus = 'emotional'
          basis = `emotional ${e} > visual ${v}`
        }
        return { ...m, focus, focus_basis: basis }
      })
    },
  },
  {
    key: 'reaction',
    kind: 'llm',
    fromOrderBy: 6,
    title: 'CU reaction (per moment)',
    description:
      'Fan-out: runs once per moment, writing a raw one-line reaction that leans into that moment’s chosen focus (visual vs emotional).',
    output: {
      name: 'reactions',
      description: 'one emotional reaction per moment',
      isList: true,
    },
    rewrites: {},
    systemPrompt:
      'You are a reaction-framing assistant. Given ONE Columbia/Barnard moment ' +
      '(already selected for you) and the image’s emotional tone, decide how a ' +
      'tired Columbia student would emotionally react to THAT moment. Not funny ' +
      'yet. Not a caption. You only respond in JSON.',
    userPrompt:
      'How would a tired Columbia student emotionally react to the moment below?\n\n' +
      'Emotional tone:\n${emotionalToneCeleb}\n\n' +
      'React to THIS moment (it is already selected — do NOT pick a different one):\n' +
      '${relevantMoment}\n\n' +
      'The moment includes a "focus" field (visual, emotional, or both). Lean into THAT connection:\n' +
      '- visual = react to what is literally happening in the image\n' +
      '- emotional = react to the feeling the image evokes\n' +
      '- both = either or both is fine\n\n' +
      'Output ONLY JSON:\n' +
      '{\n' +
      '  "moment": "<the moment you reacted to>",\n' +
      '  "emotional_reaction": "<a raw, lowercase emotional thought — like a text someone sends without thinking>"\n' +
      '}',
    fanOutOver: 'relevantMoment',
    inputs: [
      {
        slot: 'emotionalToneCeleb',
        description: 'the feeling the image evokes (celeb-aware)',
        binding: { kind: 'op', opKey: 'toneCeleb' },
      },
      {
        slot: 'relevantMoment',
        description: 'ONE focus-tagged moment to react to (iterated over the list)',
        binding: { kind: 'op', opKey: 'focus' },
      },
    ],
  },
  {
    key: 'reactionEmoReason',
    kind: 'llm',
    fromOrderBy: 6,
    title: 'CU reaction WITH Emotion Reason from Image',
    description:
      'Variant of CU reaction: also takes the moment’s emotional_connection REASON into account. Run alongside CU reaction to compare.',
    output: {
      name: 'reactionsEmoReason',
      description: 'reaction per moment, informed by the emotional-connection reason',
      isList: true,
    },
    rewrites: {},
    systemPrompt:
      'You are a reaction-framing assistant. Given ONE Columbia/Barnard moment ' +
      '(already selected for you) and the image’s emotional tone, decide how a ' +
      'tired Columbia student would emotionally react to THAT moment. Not funny ' +
      'yet. Not a caption. You only respond in JSON.',
    userPrompt:
      'How would a tired Columbia student emotionally react to the moment below?\n\n' +
      'Emotional tone:\n${emotionalToneCeleb}\n\n' +
      'React to THIS moment (it is already selected — do NOT pick a different one):\n' +
      '${relevantMoment}\n\n' +
      'The moment includes a "focus" field (visual, emotional, or both). Lean into THAT connection:\n' +
      '- visual = react to what is literally happening in the image\n' +
      '- emotional = react to the feeling the image evokes\n' +
      '- both = either or both is fine\n\n' +
      'The moment also includes an "emotional_connection" with a "reason" ' +
      '(why the moment emotionally connects to the image). Make sure your ' +
      'reaction takes that REASON into account.\n\n' +
      'Output ONLY JSON:\n' +
      '{\n' +
      '  "moment": "<the moment you reacted to>",\n' +
      '  "emotional_reaction": "<a raw, lowercase emotional thought>",\n' +
      '  "emotional_connection_reason_used": "<explain HOW you took the emotional-connection reason into account in the reaction>"\n' +
      '}',
    fanOutOver: 'relevantMoment',
    inputs: [
      {
        slot: 'emotionalToneCeleb',
        description: 'the feeling the image evokes (celeb-aware)',
        binding: { kind: 'op', opKey: 'toneCeleb' },
      },
      {
        slot: 'relevantMoment',
        description: 'ONE focus-tagged moment to react to (iterated over the list)',
        binding: { kind: 'op', opKey: 'focus' },
      },
    ],
  },
  {
    key: 'caption',
    kind: 'llm',
    fromOrderBy: 7,
    title: 'Caption writing (OUTPUT)',
    description:
      'Fan-out: runs once per reaction branch, writing mean, Gen-Z captions grounded in the image and that moment’s reaction.',
    output: {
      name: 'captions',
      description: '3 short captions per moment, as a JSON array of strings',
      isList: true,
    },
    rewrites: { step3Output: 'emotionalToneCeleb', step6Output: 'reaction' },
    appendUserPrompt:
      MEME_FORMAT_CLAUSE +
      '\n\n--------------------------------------\n' +
      'The moment above includes a "focus" field (visual, emotional, or both).\n' +
      'Make the caption lean into THAT connection:\n' +
      '- visual = joke about what is literally in the image\n' +
      '- emotional = joke about the feeling the image evokes\n' +
      '- both = either or both is fine\n' +
      '\n--------------------------------------\n' +
      'IMPORTANT — override the output format above. Do NOT return plain strings.\n' +
      'For EACH caption, also explain it. Return a JSON array of objects:\n' +
      '[\n' +
      '  {\n' +
      '    "caption": "<the caption>",\n' +
      '    "reason": "<one sentence: why this caption is funny>",\n' +
      '    "used": {\n' +
      '      "focus": "<which connection you leaned into: visual, emotional, or both>",\n' +
      '      "moment": "<what you used from the Columbia moment, or none>",\n' +
      '      "reaction": "<what you used from the emotional reaction, or none>",\n' +
      '      "meme_format": "<if a meme: the template format you followed, or none>",\n' +
      '      "image": "<what you used from the image, or none>"\n' +
      '    }\n' +
      '  }\n' +
      ']',
    fanOutOver: 'reaction',
    inputs: [
      {
        slot: 'emotionalToneCeleb',
        description: 'the feeling the image evokes (celeb-aware)',
        binding: { kind: 'op', opKey: 'toneCeleb' },
      },
      {
        slot: 'reaction',
        description: 'ONE moment + its reaction (iterated over the reaction branches)',
        binding: { kind: 'op', opKey: 'reaction' },
      },
      {
        slot: 'tenRandomCaptionExamples',
        description: 'tone-reference example captions',
        binding: { kind: 'corpus' },
      },
      {
        slot: 'recognizedContent',
        description: 'recognized content incl. the meme verdict (for meme format)',
        binding: { kind: 'op', opKey: 'recognize' },
      },
    ],
  },
  {
    key: 'captionWithDesc',
    kind: 'llm',
    fromOrderBy: 7,
    temperature: 0.7,
    title: 'Caption writing — VARIANT (+ image description)',
    description:
      'Variant: feeds in the image description AND uses the emotion-reason reaction (CU reaction WITH Emotion Reason). Run alongside Caption writing to compare.',
    output: {
      name: 'captionsWithDesc',
      description: '3 captions per moment (description-aware), as JSON',
      isList: true,
    },
    rewrites: { step3Output: 'emotionalToneCeleb', step6Output: 'reaction' },
    appendUserPrompt:
      '\n\n--------------------------------------\n' +
      'Image description (for extra grounding — make sure the caption fits it):\n' +
      '${imageDescription}\n' +
      '\n--------------------------------------\n' +
      'The moment above includes a "focus" field (visual, emotional, or both).\n' +
      'Make the caption lean into THAT connection:\n' +
      '- visual = joke about what is literally in the image\n' +
      '- emotional = joke about the feeling the image evokes\n' +
      '- both = either or both is fine\n' +
      '\n--------------------------------------\n' +
      'IMPORTANT — override the output format above. Do NOT return plain strings.\n' +
      'For EACH caption, also explain it. Return a JSON array of objects:\n' +
      '[\n' +
      '  {\n' +
      '    "caption": "<the caption>",\n' +
      '    "reason": "<one sentence: why this caption is funny>",\n' +
      '    "used": {\n' +
      '      "focus": "<which connection you leaned into: visual, emotional, or both>",\n' +
      '      "moment": "<what you used from the Columbia moment, or none>",\n' +
      '      "reaction": "<what you used from the emotional reaction, or none>",\n' +
      '      "image": "<what you used from the image, or none>",\n' +
      '      "description": "<what you used from the image description, or none>"\n' +
      '    }\n' +
      '  }\n' +
      ']',
    fanOutOver: 'reaction',
    inputs: [
      {
        slot: 'emotionalToneCeleb',
        description: 'the feeling the image evokes (celeb-aware)',
        binding: { kind: 'op', opKey: 'toneCeleb' },
      },
      {
        slot: 'reaction',
        description:
          'ONE moment + its emotion-reason reaction (iterated over the branches)',
        binding: { kind: 'op', opKey: 'reactionEmoReason' },
      },
      {
        slot: 'imageDescription',
        description: 'a description of the scene (the variant’s extra input)',
        binding: { kind: 'op', opKey: 'describe' },
      },
      {
        slot: 'tenRandomCaptionExamples',
        description: 'tone-reference example captions',
        binding: { kind: 'corpus' },
      },
    ],
  },
  {
    key: 'captionTouchstone',
    kind: 'llm',
    fromOrderBy: 7,
    providerModelId: 'gpt-4o-2024-08-06',
    temperature: 0.7,
    title: 'Caption writing — VARIANT (keep touchstone)',
    description:
      'Variant of Caption writing: commits to the moment’s specific touchstone FIRST, then writes captions that keep it recoverable (fights drift to generic school-stress jokes). Same inputs as Caption writing — an A/B on the prompt only. To measure it, point “Extract captions” at this op and re-run the analysis chain.',
    output: {
      name: 'captionsTouchstone',
      description: '3 captions per moment that keep the specific touchstone, as JSON',
      isList: true,
    },
    rewrites: { step3Output: 'emotionalToneCeleb', step6Output: 'reaction' },
    appendUserPrompt:
      MEME_FORMAT_CLAUSE +
      '\n\n--------------------------------------\n' +
      'KEEP THE SPECIFIC TOUCHSTONE.\n' +
      'First, name the ONE specific Columbia/Barnard touchstone of this moment — a ' +
      'short concrete phrase for the specific experience, ritual, place, or object ' +
      '(e.g. "add/drop class registration", "Primal Scream", "Butler Library at 3am"). ' +
      'NOT a generic feeling like "stress" or "anxiety".\n' +
      '\n' +
      'The moment above includes a "focus" field (visual, emotional, or both).\n' +
      'Lean into THAT connection — but keep the touchstone recoverable either way:\n' +
      '- visual = joke about what is literally in the image, still tied to the touchstone\n' +
      '- emotional = joke about the feeling OF THIS SPECIFIC MOMENT (not a generic school feeling)\n' +
      '- both = either or both is fine\n' +
      '\n' +
      'HARD RULE: a Columbia student reading ONLY the caption must be able to name the ' +
      'touchstone. Keep at least one concrete anchor (a word, object, place, or ritual) ' +
      'that points to it. If a caption drifts to generic school stress, rewrite it.\n' +
      '\n--------------------------------------\n' +
      'IMPORTANT — override the output format above. Do NOT return plain strings.\n' +
      'Return a JSON array of objects:\n' +
      '[\n' +
      '  {\n' +
      '    "touchstone": "<the specific phrase you committed to>",\n' +
      '    "caption": "<the caption — keeps the touchstone recoverable>",\n' +
      '    "reason": "<one sentence: why this caption is funny>",\n' +
      '    "used": {\n' +
      '      "focus": "<visual, emotional, or both>",\n' +
      '      "anchor": "<the concrete word/object/place/ritual in the caption that points to the touchstone>",\n' +
      '      "moment": "<what you used from the Columbia moment, or none>",\n' +
      '      "reaction": "<what you used from the emotional reaction, or none>",\n' +
      '      "image": "<what you used from the image, or none>"\n' +
      '    }\n' +
      '  }\n' +
      ']',
    fanOutOver: 'reaction',
    inputs: [
      {
        slot: 'emotionalToneCeleb',
        description: 'the feeling the image evokes (celeb-aware)',
        binding: { kind: 'op', opKey: 'toneCeleb' },
      },
      {
        slot: 'reaction',
        description: 'ONE moment + its reaction (iterated over the reaction branches)',
        binding: { kind: 'op', opKey: 'reaction' },
      },
      {
        slot: 'tenRandomCaptionExamples',
        description: 'tone-reference example captions',
        binding: { kind: 'corpus' },
      },
      {
        slot: 'recognizedContent',
        description: 'recognized content incl. the meme verdict (for meme format)',
        binding: { kind: 'op', opKey: 'recognize' },
      },
    ],
  },
  {
    key: 'extract',
    kind: 'transform',
    title: 'Extract captions',
    description:
      'Pure code (no model): from each caption branch, keep ONLY the caption text (drops reason / used), so alignment gets clean captions. Works off either caption op.',
    output: {
      name: 'cleanCaptions',
      description: 'just the caption strings, per branch',
      isList: true,
    },
    rewrites: {},
    inputs: [
      {
        slot: 'captions',
        description: 'the caption branches to clean (Caption writing or its variant)',
        binding: { kind: 'op', opKey: 'caption' },
      },
    ],
    transform: (vals) => {
      const branches = vals.captions
      if (!Array.isArray(branches)) return []
      return branches.map((b) => {
        const src = isFanResult(b) ? b.text : b
        const parsed = parseJsonLoose(src)
        const caps = Array.isArray(parsed)
          ? parsed
              .map((c) => (typeof c === 'string' ? c : c?.caption))
              .filter((c): c is string => typeof c === 'string' && c.length > 0)
          : []
        const cleanText = JSON.stringify(caps, null, 2)
        const base = isFanResult(b)
          ? b
          : { label: '', item: b, text: '', bundle: {} }
        return {
          ...base,
          text: cleanText,
          bundle: { ...(base.bundle ?? {}), captions: cleanText },
        }
      })
    },
  },
  {
    key: 'alignment',
    kind: 'llm',
    fromOrderBy: 8,
    title: 'Alignment analysis',
    description:
      'Fan-out: runs once per caption branch, rating how well that branch’s captions align with the image — emotionally and in content — using its own reaction.',
    output: {
      name: 'alignment',
      description:
        'per-caption emotional + content alignment scores and reasons, as JSON',
      isList: true,
    },
    rewrites: {
      step7Output: 'captions',
      step2Output: 'imageDescription',
      step6Output: 'reactions',
    },
    // Attach the real image so content_alignment is judged from what is actually
    // visible, not only the text description. Requires S8's model to be vision-capable.
    includeImage: true,
    appendUserPrompt:
      '\n\n--------------------------------------\n' +
      'An image is ATTACHED. Judge content_alignment from what is actually visible ' +
      'in that image (people, expressions, devices, setting) — the description above ' +
      'is only a supplement. If the caption is consistent with the scene, score it high.\n' +
      '\n--------------------------------------\n' +
      'MEME / KNOWN-TEMPLATE CHECK.\n' +
      'Recognized content — this INCLUDES a "meme" verdict from the recognition step ' +
      '(is_meme, template_name, meaning, how_a_caption_should_use_it):\n${recognizedContent}\n' +
      'Trust that "meme" verdict. If meme.is_meme is true, the template carries ' +
      'EXPECTATIONS — use meme.meaning and meme.how_a_caption_should_use_it as the ' +
      'rubric and judge meme_alignment: does the caption use the image the way the ' +
      'template expects (or subvert it clearly and on purpose)?\n' +
      '- 1.0 = nails how this template is meant to be used\n' +
      '- 0.5 = loosely uses the template; the expectation is only partly met\n' +
      '- 0.0 = ignores or fights the template’s established meaning\n' +
      'IF meme.image_is_punchline is true, the image itself delivers the punchline: ' +
      'LOWER meme_alignment for a caption that restates that response in words ' +
      '(e.g. the image already says NO and the caption still says "no"/"hard pass") — ' +
      'that is redundant. REWARD captions that stop at the setup and let the image land it.\n' +
      'Copy meme.is_meme into "is_meme", and meme.template_name into "meme_template" ' +
      '(null if unknown). If meme.is_meme is false, set "is_meme" false and ' +
      '"meme_alignment" to null.\n' +
      '\n--------------------------------------\n' +
      'TOUCHSTONE CHECK.\n' +
      'The SPECIFIC Columbia/Barnard touchstone this caption is meant to land is:\n' +
      '${moment}\n' +
      'That is a specific experience, ritual, place, or object (e.g. add/drop ' +
      'registration, Primal Scream, Butler at 3am). Score touchstone_alignment ' +
      '(0..1): does the caption clearly LAND that specific touchstone — would a ' +
      'Columbia student recognize the specific moment — rather than a generic vibe?\n' +
      '- 1.0 = the specific touchstone is unmistakable\n' +
      '- 0.5 = gestures at it; takes a leap to connect\n' +
      '- 0.0 = generic; the specific touchstone is absent\n' +
      '\n--------------------------------------\n' +
      'Output ONLY strict, valid JSON — EVERY key in double quotes. ' +
      'One object per caption:\n' +
      '[\n' +
      '  {\n' +
      '    "caption": "<the caption>",\n' +
      '    "emotional_alignment": <0..1>,\n' +
      '    "content_alignment": <0..1>,\n' +
      '    "is_meme": <true|false>,\n' +
      '    "meme_template": "<the template name from the recognition step, or null>",\n' +
      '    "meme_alignment": <0..1 or null>,\n' +
      '    "meme_reason": "<one sentence: the template’s expectation and whether the caption fits — or why it is not a meme>",\n' +
      '    "touchstone": "<restate the specific touchstone this caption should land, from the moment above>",\n' +
      '    "touchstone_alignment": <0..1>,\n' +
      '    "touchstone_reason": "<one sentence: is the specific touchstone present, and how>",\n' +
      '    "reason": "<one sentence>"\n' +
      '  }\n' +
      ']',
    fanOutOver: 'captions',
    // Pull this branch's own captions + reaction + moment from the bundle; the
    // image description stays shared across branches. ${moment} is the specific
    // touchstone the caption is meant to land (used by the TOUCHSTONE CHECK).
    bundleSlots: { captions: 'captions', reactions: 'reactions', moment: 'moment' },
    inputs: [
      {
        slot: 'captions',
        description: 'the clean captions to evaluate',
        binding: { kind: 'op', opKey: 'extract' },
      },
      {
        slot: 'imageDescription',
        description: 'a description of the scene',
        binding: { kind: 'op', opKey: 'describe' },
      },
      {
        slot: 'reactions',
        description: 'the Columbia moments + reactions used',
        binding: { kind: 'op', opKey: 'reaction' },
      },
      {
        slot: 'recognizedContent',
        description: 'recognized celebrity / meme / known template (for the meme check)',
        binding: { kind: 'op', opKey: 'recognize' },
      },
    ],
  },
  {
    key: 'refClarity',
    kind: 'llm',
    fromOrderBy: 8, // borrow Alignment's model (no flavor step of its own)
    title: 'Reference clarity analysis',
    description:
      'Fan-out: for each branch, judges how clearly each caption references its Columbia moment, and why.',
    output: {
      name: 'referenceClarity',
      description: 'per-caption reference-clarity score (0–1) + reason, as JSON',
      isList: true,
    },
    rewrites: {},
    systemPrompt:
      'You evaluate how clearly a humorous caption references a specific ' +
      'Columbia/Barnard "lived-experience" moment. Be precise. You only respond in JSON.',
    userPrompt:
      'Judge how clearly EACH caption references the Columbia moment below.\n\n' +
      'Columbia moment:\n${moment}\n\n' +
      'Captions:\n${captions}\n\n' +
      'Score reference_clarity from 0 to 1:\n' +
      '- 1.0 = the moment is unmistakable to someone who knows it\n' +
      '- 0.5 = hinted at; takes a leap to connect\n' +
      '- 0.0 = no recognizable reference to the moment\n\n' +
      'Output ONLY a JSON array, one object per caption:\n' +
      '[\n' +
      '  {\n' +
      '    "caption": "<the caption>",\n' +
      '    "reference_clarity": <0..1>,\n' +
      '    "reason": "<one sentence on what makes the reference clear or unclear>"\n' +
      '  }\n' +
      ']',
    fanOutOver: 'captions',
    // Pull this branch's clean captions + its moment from the bundle.
    bundleSlots: { captions: 'captions', moment: 'moment' },
    inputs: [
      {
        slot: 'captions',
        description: 'the captions to judge (per branch)',
        binding: { kind: 'op', opKey: 'alignment' },
      },
    ],
  },
  {
    key: 'refRecover',
    kind: 'llm',
    fromOrderBy: 8, // borrow Alignment's model
    title: 'Reference recoverability (blind)',
    description:
      'Fan-out: sees ONLY the caption (the moment is withheld) and judges whether the specific reference can be recovered from the caption alone.',
    output: {
      name: 'referenceRecoverability',
      description: 'per-caption blind guess + recoverability score (0–1)',
      isList: true,
    },
    rewrites: {},
    systemPrompt:
      'You are a Columbia/Barnard student. You are shown ONLY a caption, with ' +
      'no other context. Your job is to guess what specific campus moment or ' +
      'experience it refers to, judging ONLY from the caption itself. Do not ' +
      'invent context you were not given. You only respond in JSON.',
    userPrompt:
      'Using ONLY each caption below (no other context), infer what specific ' +
      'Columbia/Barnard moment or experience it references.\n\n' +
      'Captions:\n${captions}\n\n' +
      'Then score reference_recoverability from 0 to 1:\n' +
      '- 1.0 = a Columbia student could identify the SPECIFIC reference from the caption alone\n' +
      '- 0.5 = points at a general vibe; the specific reference is guessable but not certain\n' +
      '- 0.0 = too generic; no way to recover the specific reference\n\n' +
      'Output ONLY a JSON array, one object per caption:\n' +
      '[\n' +
      '  {\n' +
      '    "caption": "<the caption>",\n' +
      '    "inferred_reference": "<your best guess, from the caption alone>",\n' +
      '    "reference_recoverability": <0..1>,\n' +
      '    "reason": "<one sentence on why it is or isn’t recoverable>"\n' +
      '  }\n' +
      ']',
    fanOutOver: 'captions',
    // ONLY captions from the bundle — the moment is deliberately NOT passed in.
    bundleSlots: { captions: 'captions' },
    inputs: [
      {
        slot: 'captions',
        description: 'the captions to test (blind — the moment is withheld)',
        binding: { kind: 'op', opKey: 'refClarity' },
      },
    ],
  },
  {
    key: 'collect',
    kind: 'transform',
    title: 'Collect all jokes',
    description:
      'Pure code (fan-in): flattens every branch into ONE list of all jokes, each with its alignment, reference-clarity and recoverability assessments.',
    output: {
      name: 'allJokes',
      description: 'every caption across all branches with its three assessments',
      isList: true,
    },
    rewrites: {},
    inputs: [
      {
        slot: 'alignment',
        description: 'alignment analysis (all branches)',
        binding: { kind: 'op', opKey: 'alignment' },
      },
      {
        slot: 'clarity',
        description: 'reference clarity (all branches) — optional; looked up per caption',
        binding: { kind: 'op', opKey: 'refClarity' },
        optional: true,
      },
      {
        slot: 'recoverability',
        description:
          'reference recoverability (all branches) — optional; looked up per caption',
        binding: { kind: 'op', opKey: 'refRecover' },
        optional: true,
      },
    ],
    transform: (vals) => {
      const toArr = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])
      const aB = toArr(vals.alignment)
      const cB = toArr(vals.clarity)
      const rB = toArr(vals.recoverability)
      const norm = (s: unknown) =>
        String(s ?? '')
          .toLowerCase()
          .replace(/[‘’‚‛`´]/g, "'")
          .replace(/[“”„]/g, '"')
          .replace(/\s+/g, ' ')
          .trim()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const momentObj = (branch: unknown): any => {
        const b = branch as { item?: unknown; bundle?: { moment?: unknown } }
        return b?.item ?? b?.bundle?.moment ?? null
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const momentText = (m: any): string => {
        const orig = m?.item ?? m
        if (typeof orig === 'string') return orig
        return String(
          orig?.context ?? orig?.content ?? JSON.stringify(orig ?? '')
        )
      }
      // Focus from the moment's own field, or derived from its scores when the
      // field is missing (e.g. branches generated before Decide focus existed).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const focusOf = (m: any): string => {
        if (typeof m?.focus === 'string' && m.focus) return m.focus
        const v = Number(m?.visual_connection?.score)
        const e = Number(m?.emotional_connection?.score)
        if (!Number.isFinite(v) || !Number.isFinite(e)) return 'unknown'
        if (v >= 0.7 && e >= 0.7) return 'both'
        return v >= e ? 'visual' : 'emotional'
      }
      const textOf = (branch: unknown) =>
        (branch as { text?: unknown })?.text
      // Global caption → assessment index across ALL branches, so each joke is
      // paired with its OWN clarity/recoverability entry even when the three
      // fan-outs aren't index-aligned or a step was re-run out of sync. A miss
      // returns null ("re-run this step") — never a different caption's entry
      // (the old per-branch positional fallback caused mismatches).
      const indexByCaption = (branches: unknown[]): Map<string, unknown> => {
        const m = new Map<string, unknown>()
        for (const b of branches) {
          for (const x of toArr(parseJsonLoose(textOf(b)))) {
            const key = norm((x as { caption?: unknown })?.caption)
            if (key && !m.has(key)) m.set(key, x)
          }
        }
        return m
      }
      const alignByCaption = indexByCaption(aB)
      const clarityByCaption = indexByCaption(cB)
      const recoverByCaption = indexByCaption(rB)

      // The branch bundle accumulated { moment, reactions, captions } along the
      // way; pull the reaction text so a joke can trace back to what emotional
      // reaction produced it (either reaction variant fills its own key).
      const bundleOf = (b: unknown): Record<string, unknown> =>
        (b as { bundle?: Record<string, unknown> })?.bundle ?? {}
      const reactionText = (bd: Record<string, unknown>): string =>
        String(bd?.reactions ?? bd?.reactionsEmoReason ?? '')

      // One joke per caption. Enumerate from the ALIGNMENT branches only — that
      // is the spine carrying each caption together with its moment, reaction
      // and scores. Clarity/recoverability are looked up by caption (above), so
      // they never add or drop jokes if their fan-outs are out of sync. Dedup by
      // caption guards against a branch being run twice.
      const jokes: unknown[] = []
      const seen = new Set<string>()
      for (const branch of aB) {
        const m = momentObj(branch)
        const moment = momentText(m)
        const focus = focusOf(m)
        const reaction = reactionText(bundleOf(branch))
        const aList = toArr(parseJsonLoose(textOf(branch))) as any[] // eslint-disable-line @typescript-eslint/no-explicit-any
        for (const entry of aList) {
          const caption =
            typeof entry === 'string' ? entry : entry?.caption ?? ''
          const key = norm(caption)
          if (!key || seen.has(key)) continue
          seen.add(key)
          jokes.push({
            moment,
            focus,
            reaction,
            caption,
            alignment:
              entry && typeof entry === 'object'
                ? entry
                : alignByCaption.get(key) ?? null,
            reference_clarity: clarityByCaption.get(key) ?? null,
            reference_recoverability: recoverByCaption.get(key) ?? null,
          })
        }
      }
      return jokes
    },
  },
  {
    key: 'rank',
    kind: 'transform',
    title: 'Rank all jokes',
    description:
      'Pure code: ranks jokes by alignment on their focused dimension, after filtering out any joke with a weak (<0.4) reference score.',
    note:
      'RANKING POLICY\n' +
      '1) Filter out anything really bad: drop jokes where reference_clarity OR ' +
      'reference_recoverability is below 0.4.\n' +
      '2) Maximize alignment: rank the survivors by the alignment score on the ' +
      'joke’s focus — emotional→emotional_alignment, visual→content_alignment, ' +
      'both→min(the two). Filtered-out jokes are listed last.',
    output: {
      name: 'ranking',
      description: 'jokes ranked best→worst; filtered-out ones listed last',
      isList: true,
    },
    rewrites: {},
    inputs: [
      {
        slot: 'jokes',
        description: 'all jokes with their three assessments',
        binding: { kind: 'op', opKey: 'collect' },
      },
    ],
    transform: (vals) => {
      const jokes = Array.isArray(vals.jokes)
        ? vals.jokes
        : parseJsonLoose(vals.jokes)
      if (!Array.isArray(jokes)) return []
      const num = (x: unknown): number | null => {
        const n = Number(x)
        return Number.isFinite(n) ? n : null
      }
      const THRESHOLD = 0.4
      const scored = jokes.map((j) => {
        const focus = j?.focus ?? 'unknown'
        const emo = num(j?.alignment?.emotional_alignment)
        const con = num(j?.alignment?.content_alignment)
        const clarity = num(j?.reference_clarity?.reference_clarity)
        const recover = num(j?.reference_recoverability?.reference_recoverability)
        let focusedAlignment: number | null
        if (focus === 'emotional') focusedAlignment = emo
        else if (focus === 'visual') focusedAlignment = con
        else if (focus === 'both')
          focusedAlignment =
            emo != null && con != null ? Math.min(emo, con) : emo ?? con
        else focusedAlignment = emo != null && con != null ? (emo + con) / 2 : emo ?? con
        // Guardrail: only fail on a score that is present and below threshold.
        const fails: string[] = []
        if (clarity != null && clarity < THRESHOLD)
          fails.push(`reference_clarity ${clarity} < ${THRESHOLD}`)
        if (recover != null && recover < THRESHOLD)
          fails.push(`reference_recoverability ${recover} < ${THRESHOLD}`)
        return { j, focus, emo, con, clarity, recover, focusedAlignment, fails }
      })
      const byAlign = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
        (b.focusedAlignment ?? -1) - (a.focusedAlignment ?? -1)
      const passed = scored.filter((s) => s.fails.length === 0).sort(byAlign)
      const failed = scored.filter((s) => s.fails.length > 0).sort(byAlign)
      return [...passed, ...failed].map((s, i) => ({
        rank: s.fails.length === 0 ? i + 1 : null,
        status: s.fails.length === 0 ? 'ranked' : 'filtered out',
        caption: s.j?.caption ?? '',
        focus: s.focus,
        focused_alignment: s.focusedAlignment,
        scores: {
          emotional_alignment: s.emo,
          content_alignment: s.con,
          reference_clarity: s.clarity,
          reference_recoverability: s.recover,
        },
        reason:
          s.fails.length === 0
            ? `focus=${s.focus}; focused alignment=${s.focusedAlignment}`
            : `filtered: ${s.fails.join('; ')}`,
        moment: s.j?.moment ?? '',
        reaction: s.j?.reaction ?? '',
        // Provenance: the per-op assessments each score came from, kept so the
        // UI can trace a score back to the reason (and step) that produced it.
        evidence: {
          alignment: s.j?.alignment ?? null,
          reference_clarity: s.j?.reference_clarity ?? null,
          reference_recoverability: s.j?.reference_recoverability ?? null,
        },
      }))
    },
  },
  {
    key: 'rankAlignOnly',
    kind: 'transform',
    title: 'Rank all jokes — VARIANT (alignment only)',
    description:
      'Pure code: ranks jokes purely by alignment on their focused dimension. No reference-score filtering.',
    note:
      'RANKING POLICY (alignment only)\n' +
      'Rank every joke by the alignment score on its focus — ' +
      'emotional→emotional_alignment, visual→content_alignment, both→min(the two). ' +
      'If the image is a meme, ALSO require meme fit: blend the focused alignment ' +
      'with meme_alignment via min. No filtering on reference clarity/recoverability.',
    output: {
      name: 'rankingAlignOnly',
      description:
        'jokes ranked best→worst by focused alignment (meme jokes also blended with meme_alignment)',
      isList: true,
    },
    rewrites: {},
    inputs: [
      {
        slot: 'jokes',
        description: 'all jokes with their assessments',
        binding: { kind: 'op', opKey: 'collect' },
      },
    ],
    transform: (vals) => {
      const jokes = Array.isArray(vals.jokes)
        ? vals.jokes
        : parseJsonLoose(vals.jokes)
      if (!Array.isArray(jokes)) return []
      const num = (x: unknown): number | null => {
        const n = Number(x)
        return Number.isFinite(n) ? n : null
      }
      // Blend a 0..1 factor into the running score via min (guards nulls): the
      // joke must satisfy every present factor, not average its way past one.
      const blendMin = (a: number | null, b: number | null): number | null =>
        b == null ? a : a == null ? b : Math.min(a, b)
      const scored = jokes.map((j) => {
        const focus = j?.focus ?? 'unknown'
        const emo = num(j?.alignment?.emotional_alignment)
        const con = num(j?.alignment?.content_alignment)
        const isMeme = j?.alignment?.is_meme === true
        const meme = num(j?.alignment?.meme_alignment)
        const touch = num(j?.alignment?.touchstone_alignment)
        let base: number | null
        if (focus === 'emotional') base = emo
        else if (focus === 'visual') base = con
        else if (focus === 'both')
          base = emo != null && con != null ? Math.min(emo, con) : emo ?? con
        else base = emo != null && con != null ? (emo + con) / 2 : emo ?? con
        // The joke must ALSO land the specific touchstone, and (if a meme) fit the
        // template. Blend both in with min so a strong scene score can't rescue a
        // caption that misses the touchstone or ignores the template.
        let focusedAlignment = blendMin(base, touch)
        if (isMeme) focusedAlignment = blendMin(focusedAlignment, meme)
        return { j, focus, emo, con, isMeme, meme, touch, focusedAlignment }
      })
      scored.sort((a, b) => (b.focusedAlignment ?? -1) - (a.focusedAlignment ?? -1))
      return scored.map((s, i) => ({
        rank: i + 1,
        caption: s.j?.caption ?? '',
        focus: s.focus,
        is_meme: s.isMeme,
        focused_alignment: s.focusedAlignment,
        scores: {
          emotional_alignment: s.emo,
          content_alignment: s.con,
          touchstone_alignment: s.touch,
          ...(s.isMeme ? { meme_alignment: s.meme } : {}),
        },
        reason:
          `focus=${s.focus}; blended` +
          (s.touch != null ? ` touchstone=${s.touch}` : '') +
          (s.isMeme && s.meme != null ? ` meme=${s.meme}` : '') +
          ` → ${s.focusedAlignment}`,
        moment: s.j?.moment ?? '',
        reaction: s.j?.reaction ?? '',
        evidence: {
          alignment: s.j?.alignment ?? null,
          reference_clarity: s.j?.reference_clarity ?? null,
          reference_recoverability: s.j?.reference_recoverability ?? null,
        },
      }))
    },
  },
]

// An independent copy of DEFAULT_OP_SPECS for flavor 1513 (a clone of 1508).
// Edit this array to diverge 1513's pipeline without affecting the original.
const OP_SPECS_1513: OpSpec[] = [
  {
    key: 'recognize',
    kind: 'llm',
    fromOrderBy: 1,
    title: 'Recognize content',
    description:
      'Identifies famous or recognizable content in the image — people, characters, shows, locations, brands, logos, events, memes.',
    output: {
      name: 'recognizedContent',
      description:
        'recognized people/brands/places PLUS a structured meme-template verdict, as JSON',
    },
    // S1 reads the image directly; it has no ${stepNOutput} references.
    rewrites: {},
    appendUserPrompt:
      '\n\n--------------------------------------\n' +
      'Do your normal recognition above exactly as usual — fill in all the content / ' +
      'scene fields fully. Then ALSO add ONE extra top-level field "meme".\n' +
      '"is_meme" is true if the image is a recognizable, reusable MEME or REACTION ' +
      'IMAGE — a still people commonly caption to express a feeling (frustration, ' +
      'panic, smugness, etc.), including well-known TV/movie reaction shots — even if ' +
      'it has no official name. It is false only for a generic or original photo with ' +
      'no established meme/reaction use. BE CONSISTENT: if your scene_context says the ' +
      'image is used in meme or reaction culture, "is_meme" MUST be true.\n' +
      'When true, give a template_name (an official name if it has one, else a short ' +
      'descriptive handle like "Henry Danger panic-at-laptop reaction"). The ' +
      'template_name is the NAME of the template/snowclone — NOT a filled-in example ' +
      'caption: for a snowclone use the pattern with a blank (e.g. "I am once again ' +
      'asking for ___") or its known handle (e.g. Bernie "I am once again asking"), ' +
      'never a specific completed instance (e.g. "I am once again asking for your ' +
      'financial support" is an EXAMPLE, not the template name). Then say how ' +
      'it is used — and in how_a_caption_should_use_it, spell out the concrete caption ' +
      'FORMAT or snowclone if the template has one (e.g. "I am once again asking for ___"), ' +
      'and give 3 distinct example captions that fit the template (not just one).\n' +
      'ALSO: set "image_is_punchline" true when the IMAGE ITSELF delivers the ' +
      'punchline / reaction (a reaction image) — meaning a good caption is only the ' +
      'SETUP and the image lands the joke. When it does, put what the image itself ' +
      'says or implies in "image_delivers" (e.g. "an emphatic NO", "disgust", "hard ' +
      'pass") — this is the response the caption must NOT restate in words.\n' +
      '"meme": { "is_meme": <bool>, "template_name": <name/short description or null>, ' +
      '"meaning": <how it is normally used, or null>, "how_a_caption_should_use_it": ' +
      '<or null>, "image_is_punchline": <bool>, "image_delivers": <what the image ' +
      'says/implies, or null>, "confidence": <0..1> }',
    inputs: [],
  },
  {
    key: 'naiveMemeCaption',
    kind: 'llm',
    fromOrderBy: 1,
    providerModelId: 'gpt-4o-2024-08-06',
    temperature: 0.7,
    title: 'Naive meme Caption',
    description:
      'Writes naive meme text straight from the recognized template + the image \u2014 picks a topic and fits the format. A quick baseline caption, before the moment/reaction pipeline.',
    output: {
      name: 'naiveMemeCaption',
      description: 'a naive meme caption that fits the template',
    },
    rewrites: {},
    // Reads the image (borrows S1's vision model) and overrides its prompt.
    includeImage: true,
    systemPrompt: 'You are writing the text for a meme.',
    userPrompt:
      'You are writing the text for a meme. Come up with something that fits this ' +
      'template (use the recognized content below and the attached image).\n\n' +
      'Recognized content:\n${recognizedContent}\n\n' +
      'Here are some topics you can pick from:\n' +
      '- relationship/romantic conflicts\n' +
      '- school / academic conflicts\n' +
      '- political conflicts\n' +
      '- self-deprecation\n' +
      '- sibling conflicts' +
      MEME_FORMAT_CLAUSE,
    inputs: [
      {
        slot: 'recognizedContent',
        description: 'recognized content incl. the meme verdict',
        binding: { kind: 'op', opKey: 'recognize' },
      },
    ],
  },
  {
    key: 'memeRelevantContext',
    kind: 'llm',
    fromOrderBy: 5,
    providerModelId: 'gpt-4o-2024-08-06',
    temperature: 0.7,
    title: 'Find Meme-Relevant CU Context',
    description:
      'Given the recognized meme/template, searches the Columbia/Barnard community context for moments that could fill in this meme, and returns the top 3 scored by usefulness.',
    output: {
      name: 'memeRelevantContext',
      description: 'top 3 CU moments relevant to this meme, scored 0-1 with reasons',
      isList: true,
    },
    rewrites: {},
    systemPrompt:
      'You find Columbia/Barnard (CU) community context relevant to filling in a ' +
      'meme. You only respond in JSON.',
    userPrompt:
      'We are trying to write context for this meme. Here is the recognized content ' +
      '(the meme / template):\n${recognizedContent}\n\n' +
      'Please find CU (Columbia/Barnard) context that might be relevant to filling in ' +
      'this meme, from the community context below:\n${allCommunityContexts}\n\n' +
      'Output the 3 most relevant moments. Score each 0-1 by its potential to be ' +
      'useful info for this meme, and give a reason.\n\n' +
      'Output ONLY a JSON array:\n' +
      '[\n' +
      '  {\n' +
      '    "moment": "<the relevant CU moment / context>",\n' +
      '    "score": <0-1>,\n' +
      '    "reason": "<one sentence: why it is useful for this meme>"\n' +
      '  }\n' +
      ']',
    inputs: [
      {
        slot: 'recognizedContent',
        description: 'recognized content incl. the meme verdict',
        binding: { kind: 'op', opKey: 'recognize' },
      },
      {
        slot: 'allCommunityContexts',
        description: 'the Columbia/Barnard community context corpus',
        binding: { kind: 'corpus' },
      },
    ],
  },
  {
    key: 'cuContextMemeCaption',
    kind: 'llm',
    fromOrderBy: 1,
    providerModelId: 'gpt-4o-2024-08-06',
    temperature: 0.7,
    title: 'Meme Caption (with CU context)',
    description:
      'Like Naive meme Caption, but fans out over EACH of the 3 CU moments from "Find Meme-Relevant CU Context" and writes one meme per moment, so the joke is CU-specific.',
    output: {
      name: 'cuContextMemeCaption',
      description: 'one meme caption per relevant CU moment',
      isList: true,
    },
    rewrites: {},
    includeImage: true,
    fanOutOver: 'memeRelevantContext',
    systemPrompt: 'You are writing the text for a meme.',
    userPrompt:
      'You are writing the text for a meme. Come up with something that fits this ' +
      'template (use the recognized content below and the attached image).\n\n' +
      'Recognized content:\n${recognizedContent}\n\n' +
      'Fill this meme in using THIS ONE Columbia/Barnard (CU) moment (it is already ' +
      'selected for you — do NOT pick a different one):\n${memeRelevantContext}\n\n' +
      'Lean on this CU moment so the meme is specific to Columbia/Barnard.\n\n' +
      'Keep the caption under 60 characters.' +
      MEME_FORMAT_CLAUSE +
      '\n\n--------------------------------------\n' +
      'Say WHICH specific part of the CU moment you leaned into to make the joke, ' +
      'and name that part in the reason.\n' +
      'Output ONLY strict JSON:\n' +
      '{\n' +
      '  "caption": "<the meme caption, under 60 chars>",\n' +
      '  "moment_part": "<the specific detail of the CU moment you leaned into>",\n' +
      '  "reason": "<one sentence: why it is funny — name the part of the moment you used>"\n' +
      '}',
    inputs: [
      {
        slot: 'recognizedContent',
        description: 'recognized content incl. the meme verdict',
        binding: { kind: 'op', opKey: 'recognize' },
      },
      {
        slot: 'memeRelevantContext',
        description: 'ONE CU moment to fill the meme with (iterated over the top 3)',
        binding: { kind: 'op', opKey: 'memeRelevantContext' },
      },
    ],
  },
  {
    key: 'memeCaptionAlignment',
    kind: 'llm',
    fromOrderBy: 1,
    providerModelId: 'gpt-4o-2024-08-06',
    temperature: 0.2,
    title: 'Check meme format alignment',
    description:
      'Fan-out: for each CU-context meme caption, rates 0–1 how well the caption text fits the recognized meme template / format (using the attached image).',
    output: {
      name: 'memeCaptionAlignment',
      description: 'per-caption meme-format alignment score (0–1) + reason',
      isList: true,
    },
    rewrites: {},
    includeImage: true,
    fanOutOver: 'memeCaption',
    // Pull the single caption for this branch straight from the caption op's bundle.
    bundleSlots: { memeCaption: 'cuContextMemeCaption' },
    systemPrompt:
      'You judge how well a caption fits a meme template’s format. You only respond ' +
      'in JSON.',
    userPrompt:
      'An image is ATTACHED — it is the meme template.\n\n' +
      'Recognized content — this INCLUDES a "meme" verdict (is_meme, template_name, ' +
      'meaning, how_a_caption_should_use_it, image_is_punchline):\n${recognizedContent}\n\n' +
      'The caption to judge:\n${memeCaption}\n\n' +
      'FIRST, from meme.how_a_caption_should_use_it, name the SPECIFIC concrete setup ' +
      'this template REQUIRES — the exact action/object/scenario, not the mood (e.g. ' +
      '"frantically doing something on a COMPUTER/LAPTOP", not just "panic" or ' +
      '"urgency"). Then check whether the caption actually contains THAT specific ' +
      'element.\n\n' +
      'SNOWCLONE / FIXED PHRASING (check this FIRST): if the template is a snowclone ' +
      'or has a fixed sentence structure — e.g. "I am once again asking for ___", ' +
      '"Nobody: / Me: ___", "Me explaining ___" — then the caption MUST actually ' +
      'FOLLOW that wording/structure. Allusion does NOT satisfy a snowclone: merely ' +
      'gesturing at the idea (e.g. the phrasing "repeatedly asking" for the "I am ' +
      'once again asking for ___" template) is NOT enough — the caption has to be ' +
      'written IN that structure. If it does not, set required_setup_present false ' +
      'and score meme_format_alignment at most 0.3.\n\n' +
      'ALLUSION COUNTS (only for a required OBJECT or SCENARIO, NOT for snowclone ' +
      'wording): the caption does NOT have to name the required object literally — ' +
      'it is present if the caption clearly IMPLIES it. Consider the ' +
      'objects/tools/systems the caption references: SSOL, CourseWorks, Vergil, ' +
      'course registration, closing tabs, a Zoom call, etc. all imply a computer / ' +
      'laptop / screen. If the caption implies the required object, set ' +
      'required_setup_present true and do NOT cap the score just because the literal ' +
      'word is absent. Name the thing you matched in the reason.\n\n' +
      'Rate meme_format_alignment 0..1: how well does the caption use the image the ' +
      'way this template expects — its conventional FORMAT / snowclone / structure?\n' +
      '- 1.0 = nails the format AND contains the specific required setup element ' +
      '(and, for a snowclone, follows the required phrasing)\n' +
      '- 0.5 = right MOOD but MISSES the specific required element (e.g. captures ' +
      'panic/urgency but there is no computer/laptop) — this is a partial fit, NOT a 1.0\n' +
      '- 0.0 = ignores or fights the template’s format\n' +
      'HARD RULE: if the caption matches only the general feeling but drops the ' +
      'specific required action/object, it CANNOT score above 0.5. If the template ' +
      'is a snowclone and the caption does not follow its phrasing, it CANNOT score ' +
      'above 0.3.\n' +
      'IF meme.image_is_punchline is true, PENALIZE a caption that restates in words ' +
      'the response the image already delivers (redundant); REWARD a setup-only ' +
      'caption that lets the image land it.\n\n' +
      'Output ONLY strict JSON:\n' +
      '{\n' +
      '  "caption": "<the caption>",\n' +
      '  "meme_template": "<the template name from the recognition step, or null>",\n' +
      '  "required_setup": "<the specific concrete action/object this template requires>",\n' +
      '  "required_setup_present": <true|false>,\n' +
      '  "meme_format_alignment": <0..1>,\n' +
      '  "reason": "<one sentence: name the required setup and whether the caption contains it>"\n' +
      '}',
    inputs: [
      {
        slot: 'memeCaption',
        description: 'ONE CU-context meme caption (iterated over the branches)',
        binding: { kind: 'op', opKey: 'cuContextMemeCaption' },
      },
      {
        slot: 'recognizedContent',
        description: 'recognized content incl. the meme verdict',
        binding: { kind: 'op', opKey: 'recognize' },
      },
    ],
  },
  {
    key: 'rankMemeCaptions',
    kind: 'transform',
    title: 'Rank all jokes',
    description:
      'Pure code: ranks the CU-context meme captions by their meme_format_alignment score (best→worst). Click a score to see why and jump to the step that produced it.',
    note:
      'RANKING POLICY\n' +
      'Rank every meme caption by meme_format_alignment — how well it fits the ' +
      'template’s required format. Higher is better; ties keep input order.',
    output: {
      name: 'rankingMeme',
      description: 'meme captions ranked best→worst by meme_format_alignment',
      isList: true,
    },
    rewrites: {},
    inputs: [
      {
        slot: 'alignments',
        description: 'the per-caption meme-format alignment results',
        binding: { kind: 'op', opKey: 'memeCaptionAlignment' },
      },
    ],
    transform: (vals) => {
      const branches = Array.isArray(vals.alignments) ? vals.alignments : []
      const num = (x: unknown): number | null => {
        const n = Number(x)
        return Number.isFinite(n) ? n : null
      }
      const rows = branches.map((b) => {
        const raw = isFanResult(b)
          ? b.text
          : typeof b === 'string'
            ? b
            : JSON.stringify(b)
        const parsed = parseJsonLoose(raw)
        const o =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (parsed as Record<string, any>)
            : {}
        return { o, score: num(o.meme_format_alignment) }
      })
      rows.sort((a, z) => (z.score ?? -1) - (a.score ?? -1))
      return rows.map((r, i) => ({
        rank: i + 1,
        status: 'ranked',
        caption: r.o.caption ?? '',
        focus: r.o.meme_template ?? 'meme',
        focused_alignment: r.score,
        scores: { meme_format_alignment: r.score },
        reason: r.o.reason ?? '',
        moment: r.o.required_setup ?? '',
        reaction: '',
        // Provenance: the full alignment object so a clicked score can show its
        // reason and jump back to “Check meme format alignment”.
        evidence: { memeAlign: r.o },
      }))
    },
  },
  {
    key: 'describe',
    kind: 'llm',
    fromOrderBy: 2,
    title: 'Describe image',
    description:
      'Produces a detailed, neutral description of the scene — demeanor, foreground/background, and any notable setting.',
    output: {
      name: 'imageDescription',
      description: 'a literal, neutral description of what is in the image',
    },
    rewrites: { step1Output: 'recognizedContent' },
    inputs: [
      {
        slot: 'recognizedContent',
        description: 'famous people, brands, places or scenes detected in the image',
        binding: { kind: 'op', opKey: 'recognize' },
      },
      {
        slot: 'imageAdditionalContext',
        description: 'extra facts attached to the image',
        binding: { kind: 'image', field: 'additionalContext' },
      },
    ],
  },
  {
    key: 'tone',
    kind: 'llm',
    fromOrderBy: 3,
    title: 'Read emotional tone',
    description:
      'Infers the dominant feeling the image gives the viewer (not the emotion of people in it).',
    output: {
      name: 'emotionalTone',
      description: 'the dominant emotional vibe the image evokes, as a short phrase',
    },
    rewrites: { step2Output: 'imageDescription' },
    inputs: [
      {
        slot: 'imageDescription',
        description: 'a description of the scene',
        binding: { kind: 'op', opKey: 'describe' },
      },
    ],
  },
  {
    key: 'toneCeleb',
    kind: 'llm',
    fromOrderBy: 4,
    title: 'Emotional tone (with celeb)',
    description:
      'Infers the emotional tone, also taking the recognized celebrity / content into account.',
    output: {
      name: 'emotionalToneCeleb',
      description:
        'the emotional vibe, informed by who/what is recognized in the image',
    },
    rewrites: { step2Output: 'imageDescription', step1Output: 'recognizedContent' },
    // Attach the real image so the tone is read from the actual expressions and
    // body language, not only the text description. Requires S4's model to be vision-capable.
    includeImage: true,
    appendUserPrompt:
      '\n\n--------------------------------------\n' +
      'An image is ATTACHED. Read the emotional tone from what is actually visible ' +
      'in it (facial expressions, body language, setting) — the description and ' +
      'recognized content above are only supplements.\n' +
      '\n--------------------------------------\n' +
      'If the recognized content marks this as a meme (meme.is_meme is true), RESTATE ' +
      'it here: name the template and its conventional meaning, and factor that ' +
      'meme’s typical use into the emotional tone you report.',
    inputs: [
      {
        slot: 'imageDescription',
        description: 'a description of the scene',
        binding: { kind: 'op', opKey: 'describe' },
      },
      {
        slot: 'recognizedContent',
        description: 'famous people, brands, places or scenes detected in the image',
        binding: { kind: 'op', opKey: 'recognize' },
      },
      {
        slot: 'imageAdditionalContext',
        description: 'extra facts attached to the image',
        binding: { kind: 'image', field: 'additionalContext' },
      },
    ],
  },
  {
    key: 'relevant',
    kind: 'llm',
    fromOrderBy: 5,
    title: 'Find relevant CU content',
    description:
      'Ranks Columbia/Barnard lived-experience moments by how well they connect to the image (visually and emotionally).',
    output: {
      name: 'relevantMoments',
      description: '5 ranked moments with visual + emotional scores, as JSON',
      isList: true,
    },
    rewrites: {
      step2Output: 'imageDescription',
      step4Output: 'emotionalToneCeleb',
    },
    appendUserPrompt:
      '\n\n--------------------------------------\n' +
      'When scoring VISUAL connection, do NOT require the literal activity to be ' +
      'shown. Also consider the OBJECTS, TOOLS, or SETTINGS a moment implies and ' +
      'check whether THOSE appear in the image description. Example: Vergil, ' +
      'waitlists, CourseWorks, or course registration all imply a computer / ' +
      'laptop / screen — if the description mentions a laptop or screen, that is a ' +
      'real visual connection even though registration itself is not depicted. ' +
      'Name the specific object you matched in the visual_connection reason.',
    inputs: [
      {
        slot: 'imageDescription',
        description: 'a description of the scene',
        binding: { kind: 'op', opKey: 'describe' },
      },
      {
        slot: 'emotionalToneCeleb',
        description: 'the feeling the image evokes (celeb-aware)',
        binding: { kind: 'op', opKey: 'toneCeleb' },
      },
      {
        slot: 'imageAdditionalContext',
        description: 'extra facts attached to the image',
        binding: { kind: 'image', field: 'additionalContext' },
      },
      {
        slot: 'allCommunityContexts',
        description: 'the full Columbia moments corpus',
        binding: { kind: 'corpus' },
      },
    ],
  },
  {
    key: 'filter',
    kind: 'transform',
    title: 'Filter strong moments',
    description:
      'Pure code (no model): keeps only moments whose average OR highest of the visual/emotional scores is ≥ 0.7.',
    output: {
      name: 'strongMoments',
      description: 'the subset of moments that cleared the 0.7 threshold',
      isList: true,
    },
    rewrites: {},
    inputs: [
      {
        slot: 'relevantMoments',
        description: 'all scored moments to filter',
        binding: { kind: 'op', opKey: 'relevant' },
      },
    ],
    transform: (vals) => {
      const arr = parseJsonLoose(vals.relevantMoments)
      if (!Array.isArray(arr)) return []
      const num = (x: unknown): number | null => {
        const n = Number(x)
        return Number.isFinite(n) ? n : null
      }
      return arr.filter((m) => {
        const v = num(m?.visual_connection?.score)
        const e = num(m?.emotional_connection?.score)
        const rel = num(m?.relevance_score)
        // Prefer the two-axis scores when present; otherwise fall back to a
        // single relevance_score (which already is the higher of the two axes).
        const axes = [v, e].filter((n): n is number => n != null)
        const avg = axes.length
          ? axes.reduce((a, b) => a + b, 0) / axes.length
          : rel
        const max = axes.length ? Math.max(...axes) : rel
        if (avg == null && max == null) return false
        return (avg ?? 0) >= 0.7 || (max ?? 0) >= 0.7
      })
    },
  },
  {
    key: 'focus',
    kind: 'transform',
    title: 'Decide focus (visual vs emotional)',
    description:
      'Pure code (no model): from each moment’s scores, tag which connection to lean into — visual, emotional, or both — and why.',
    output: {
      name: 'focusedMoments',
      description: 'each moment annotated with a "focus" decision',
      isList: true,
    },
    rewrites: {},
    inputs: [
      {
        slot: 'strongMoments',
        description: 'the strong moments to decide on',
        binding: { kind: 'op', opKey: 'filter' },
      },
    ],
    transform: (vals) => {
      const arr = Array.isArray(vals.strongMoments)
        ? vals.strongMoments
        : parseJsonLoose(vals.strongMoments)
      if (!Array.isArray(arr)) return []
      const num = (x: unknown): number | null => {
        const n = Number(x)
        return Number.isFinite(n) ? n : null
      }
      const HIGH = 0.7
      return arr.map((m) => {
        const v = num(m?.visual_connection?.score)
        const e = num(m?.emotional_connection?.score)
        let focus: string
        let basis: string
        if (v == null || e == null) {
          focus = 'both'
          basis = 'only a single score available'
        } else if (v >= HIGH && e >= HIGH) {
          focus = 'both'
          basis = `both strong (visual ${v}, emotional ${e})`
        } else if (v >= e) {
          focus = 'visual'
          basis = `visual ${v} ≥ emotional ${e}`
        } else {
          focus = 'emotional'
          basis = `emotional ${e} > visual ${v}`
        }
        return { ...m, focus, focus_basis: basis }
      })
    },
  },
  {
    key: 'reaction',
    kind: 'llm',
    fromOrderBy: 6,
    title: 'CU reaction (per moment)',
    description:
      'Fan-out: runs once per moment, writing a raw one-line reaction that leans into that moment’s chosen focus (visual vs emotional).',
    output: {
      name: 'reactions',
      description: 'one emotional reaction per moment',
      isList: true,
    },
    rewrites: {},
    systemPrompt:
      'You are a reaction-framing assistant. Given ONE Columbia/Barnard moment ' +
      '(already selected for you) and the image’s emotional tone, decide how a ' +
      'tired Columbia student would emotionally react to THAT moment. Not funny ' +
      'yet. Not a caption. You only respond in JSON.',
    userPrompt:
      'How would a tired Columbia student emotionally react to the moment below?\n\n' +
      'Emotional tone:\n${emotionalToneCeleb}\n\n' +
      'React to THIS moment (it is already selected — do NOT pick a different one):\n' +
      '${relevantMoment}\n\n' +
      'The moment includes a "focus" field (visual, emotional, or both). Lean into THAT connection:\n' +
      '- visual = react to what is literally happening in the image\n' +
      '- emotional = react to the feeling the image evokes\n' +
      '- both = either or both is fine\n\n' +
      'Output ONLY JSON:\n' +
      '{\n' +
      '  "moment": "<the moment you reacted to>",\n' +
      '  "emotional_reaction": "<a raw, lowercase emotional thought — like a text someone sends without thinking>"\n' +
      '}',
    fanOutOver: 'relevantMoment',
    inputs: [
      {
        slot: 'emotionalToneCeleb',
        description: 'the feeling the image evokes (celeb-aware)',
        binding: { kind: 'op', opKey: 'toneCeleb' },
      },
      {
        slot: 'relevantMoment',
        description: 'ONE focus-tagged moment to react to (iterated over the list)',
        binding: { kind: 'op', opKey: 'focus' },
      },
    ],
  },
  {
    key: 'reactionEmoReason',
    kind: 'llm',
    fromOrderBy: 6,
    title: 'CU reaction WITH Emotion Reason from Image',
    description:
      'Variant of CU reaction: also takes the moment’s emotional_connection REASON into account. Run alongside CU reaction to compare.',
    output: {
      name: 'reactionsEmoReason',
      description: 'reaction per moment, informed by the emotional-connection reason',
      isList: true,
    },
    rewrites: {},
    systemPrompt:
      'You are a reaction-framing assistant. Given ONE Columbia/Barnard moment ' +
      '(already selected for you) and the image’s emotional tone, decide how a ' +
      'tired Columbia student would emotionally react to THAT moment. Not funny ' +
      'yet. Not a caption. You only respond in JSON.',
    userPrompt:
      'How would a tired Columbia student emotionally react to the moment below?\n\n' +
      'Emotional tone:\n${emotionalToneCeleb}\n\n' +
      'React to THIS moment (it is already selected — do NOT pick a different one):\n' +
      '${relevantMoment}\n\n' +
      'The moment includes a "focus" field (visual, emotional, or both). Lean into THAT connection:\n' +
      '- visual = react to what is literally happening in the image\n' +
      '- emotional = react to the feeling the image evokes\n' +
      '- both = either or both is fine\n\n' +
      'The moment also includes an "emotional_connection" with a "reason" ' +
      '(why the moment emotionally connects to the image). Make sure your ' +
      'reaction takes that REASON into account.\n\n' +
      'Output ONLY JSON:\n' +
      '{\n' +
      '  "moment": "<the moment you reacted to>",\n' +
      '  "emotional_reaction": "<a raw, lowercase emotional thought>",\n' +
      '  "emotional_connection_reason_used": "<explain HOW you took the emotional-connection reason into account in the reaction>"\n' +
      '}',
    fanOutOver: 'relevantMoment',
    inputs: [
      {
        slot: 'emotionalToneCeleb',
        description: 'the feeling the image evokes (celeb-aware)',
        binding: { kind: 'op', opKey: 'toneCeleb' },
      },
      {
        slot: 'relevantMoment',
        description: 'ONE focus-tagged moment to react to (iterated over the list)',
        binding: { kind: 'op', opKey: 'focus' },
      },
    ],
  },
  {
    key: 'caption',
    kind: 'llm',
    fromOrderBy: 7,
    title: 'Caption writing (OUTPUT)',
    description:
      'Fan-out: runs once per reaction branch, writing mean, Gen-Z captions grounded in the image and that moment’s reaction.',
    output: {
      name: 'captions',
      description: '3 short captions per moment, as a JSON array of strings',
      isList: true,
    },
    rewrites: { step3Output: 'emotionalToneCeleb', step6Output: 'reaction' },
    appendUserPrompt:
      MEME_FORMAT_CLAUSE +
      '\n\n--------------------------------------\n' +
      'The moment above includes a "focus" field (visual, emotional, or both).\n' +
      'Make the caption lean into THAT connection:\n' +
      '- visual = joke about what is literally in the image\n' +
      '- emotional = joke about the feeling the image evokes\n' +
      '- both = either or both is fine\n' +
      '\n--------------------------------------\n' +
      'IMPORTANT — override the output format above. Do NOT return plain strings.\n' +
      'For EACH caption, also explain it. Return a JSON array of objects:\n' +
      '[\n' +
      '  {\n' +
      '    "caption": "<the caption>",\n' +
      '    "reason": "<one sentence: why this caption is funny>",\n' +
      '    "used": {\n' +
      '      "focus": "<which connection you leaned into: visual, emotional, or both>",\n' +
      '      "moment": "<what you used from the Columbia moment, or none>",\n' +
      '      "reaction": "<what you used from the emotional reaction, or none>",\n' +
      '      "meme_format": "<if a meme: the template format you followed, or none>",\n' +
      '      "image": "<what you used from the image, or none>"\n' +
      '    }\n' +
      '  }\n' +
      ']',
    fanOutOver: 'reaction',
    inputs: [
      {
        slot: 'emotionalToneCeleb',
        description: 'the feeling the image evokes (celeb-aware)',
        binding: { kind: 'op', opKey: 'toneCeleb' },
      },
      {
        slot: 'reaction',
        description: 'ONE moment + its reaction (iterated over the reaction branches)',
        binding: { kind: 'op', opKey: 'reaction' },
      },
      {
        slot: 'tenRandomCaptionExamples',
        description: 'tone-reference example captions',
        binding: { kind: 'corpus' },
      },
      {
        slot: 'recognizedContent',
        description: 'recognized content incl. the meme verdict (for meme format)',
        binding: { kind: 'op', opKey: 'recognize' },
      },
    ],
  },
  {
    key: 'captionWithDesc',
    kind: 'llm',
    fromOrderBy: 7,
    temperature: 0.7,
    title: 'Caption writing — VARIANT (+ image description)',
    description:
      'Variant: feeds in the image description AND uses the emotion-reason reaction (CU reaction WITH Emotion Reason). Run alongside Caption writing to compare.',
    output: {
      name: 'captionsWithDesc',
      description: '3 captions per moment (description-aware), as JSON',
      isList: true,
    },
    rewrites: { step3Output: 'emotionalToneCeleb', step6Output: 'reaction' },
    appendUserPrompt:
      '\n\n--------------------------------------\n' +
      'Image description (for extra grounding — make sure the caption fits it):\n' +
      '${imageDescription}\n' +
      '\n--------------------------------------\n' +
      'The moment above includes a "focus" field (visual, emotional, or both).\n' +
      'Make the caption lean into THAT connection:\n' +
      '- visual = joke about what is literally in the image\n' +
      '- emotional = joke about the feeling the image evokes\n' +
      '- both = either or both is fine\n' +
      '\n--------------------------------------\n' +
      'IMPORTANT — override the output format above. Do NOT return plain strings.\n' +
      'For EACH caption, also explain it. Return a JSON array of objects:\n' +
      '[\n' +
      '  {\n' +
      '    "caption": "<the caption>",\n' +
      '    "reason": "<one sentence: why this caption is funny>",\n' +
      '    "used": {\n' +
      '      "focus": "<which connection you leaned into: visual, emotional, or both>",\n' +
      '      "moment": "<what you used from the Columbia moment, or none>",\n' +
      '      "reaction": "<what you used from the emotional reaction, or none>",\n' +
      '      "image": "<what you used from the image, or none>",\n' +
      '      "description": "<what you used from the image description, or none>"\n' +
      '    }\n' +
      '  }\n' +
      ']',
    fanOutOver: 'reaction',
    inputs: [
      {
        slot: 'emotionalToneCeleb',
        description: 'the feeling the image evokes (celeb-aware)',
        binding: { kind: 'op', opKey: 'toneCeleb' },
      },
      {
        slot: 'reaction',
        description:
          'ONE moment + its emotion-reason reaction (iterated over the branches)',
        binding: { kind: 'op', opKey: 'reactionEmoReason' },
      },
      {
        slot: 'imageDescription',
        description: 'a description of the scene (the variant’s extra input)',
        binding: { kind: 'op', opKey: 'describe' },
      },
      {
        slot: 'tenRandomCaptionExamples',
        description: 'tone-reference example captions',
        binding: { kind: 'corpus' },
      },
    ],
  },
  {
    key: 'captionTouchstone',
    kind: 'llm',
    fromOrderBy: 7,
    providerModelId: 'gpt-4o-2024-08-06',
    temperature: 0.7,
    title: 'Caption writing — VARIANT (keep touchstone)',
    description:
      'Variant of Caption writing: commits to the moment’s specific touchstone FIRST, then writes captions that keep it recoverable (fights drift to generic school-stress jokes). Same inputs as Caption writing — an A/B on the prompt only. To measure it, point “Extract captions” at this op and re-run the analysis chain.',
    output: {
      name: 'captionsTouchstone',
      description: '3 captions per moment that keep the specific touchstone, as JSON',
      isList: true,
    },
    rewrites: { step3Output: 'emotionalToneCeleb', step6Output: 'reaction' },
    appendUserPrompt:
      MEME_FORMAT_CLAUSE +
      '\n\n--------------------------------------\n' +
      'KEEP THE SPECIFIC TOUCHSTONE.\n' +
      'First, name the ONE specific Columbia/Barnard touchstone of this moment — a ' +
      'short concrete phrase for the specific experience, ritual, place, or object ' +
      '(e.g. "add/drop class registration", "Primal Scream", "Butler Library at 3am"). ' +
      'NOT a generic feeling like "stress" or "anxiety".\n' +
      '\n' +
      'The moment above includes a "focus" field (visual, emotional, or both).\n' +
      'Lean into THAT connection — but keep the touchstone recoverable either way:\n' +
      '- visual = joke about what is literally in the image, still tied to the touchstone\n' +
      '- emotional = joke about the feeling OF THIS SPECIFIC MOMENT (not a generic school feeling)\n' +
      '- both = either or both is fine\n' +
      '\n' +
      'HARD RULE: a Columbia student reading ONLY the caption must be able to name the ' +
      'touchstone. Keep at least one concrete anchor (a word, object, place, or ritual) ' +
      'that points to it. If a caption drifts to generic school stress, rewrite it.\n' +
      '\n--------------------------------------\n' +
      'IMPORTANT — override the output format above. Do NOT return plain strings.\n' +
      'Return a JSON array of objects:\n' +
      '[\n' +
      '  {\n' +
      '    "touchstone": "<the specific phrase you committed to>",\n' +
      '    "caption": "<the caption — keeps the touchstone recoverable>",\n' +
      '    "reason": "<one sentence: why this caption is funny>",\n' +
      '    "used": {\n' +
      '      "focus": "<visual, emotional, or both>",\n' +
      '      "anchor": "<the concrete word/object/place/ritual in the caption that points to the touchstone>",\n' +
      '      "moment": "<what you used from the Columbia moment, or none>",\n' +
      '      "reaction": "<what you used from the emotional reaction, or none>",\n' +
      '      "image": "<what you used from the image, or none>"\n' +
      '    }\n' +
      '  }\n' +
      ']',
    fanOutOver: 'reaction',
    inputs: [
      {
        slot: 'emotionalToneCeleb',
        description: 'the feeling the image evokes (celeb-aware)',
        binding: { kind: 'op', opKey: 'toneCeleb' },
      },
      {
        slot: 'reaction',
        description: 'ONE moment + its reaction (iterated over the reaction branches)',
        binding: { kind: 'op', opKey: 'reaction' },
      },
      {
        slot: 'tenRandomCaptionExamples',
        description: 'tone-reference example captions',
        binding: { kind: 'corpus' },
      },
      {
        slot: 'recognizedContent',
        description: 'recognized content incl. the meme verdict (for meme format)',
        binding: { kind: 'op', opKey: 'recognize' },
      },
    ],
  },
  {
    key: 'extract',
    kind: 'transform',
    title: 'Extract captions',
    description:
      'Pure code (no model): from each caption branch, keep ONLY the caption text (drops reason / used), so alignment gets clean captions. Works off either caption op.',
    output: {
      name: 'cleanCaptions',
      description: 'just the caption strings, per branch',
      isList: true,
    },
    rewrites: {},
    inputs: [
      {
        slot: 'captions',
        description: 'the caption branches to clean (Caption writing or its variant)',
        binding: { kind: 'op', opKey: 'caption' },
      },
    ],
    transform: (vals) => {
      const branches = vals.captions
      if (!Array.isArray(branches)) return []
      return branches.map((b) => {
        const src = isFanResult(b) ? b.text : b
        const parsed = parseJsonLoose(src)
        const caps = Array.isArray(parsed)
          ? parsed
              .map((c) => (typeof c === 'string' ? c : c?.caption))
              .filter((c): c is string => typeof c === 'string' && c.length > 0)
          : []
        const cleanText = JSON.stringify(caps, null, 2)
        const base = isFanResult(b)
          ? b
          : { label: '', item: b, text: '', bundle: {} }
        return {
          ...base,
          text: cleanText,
          bundle: { ...(base.bundle ?? {}), captions: cleanText },
        }
      })
    },
  },
  {
    key: 'alignment',
    kind: 'llm',
    fromOrderBy: 8,
    title: 'Alignment analysis',
    description:
      'Fan-out: runs once per caption branch, rating how well that branch’s captions align with the image — emotionally and in content — using its own reaction.',
    output: {
      name: 'alignment',
      description:
        'per-caption emotional + content alignment scores and reasons, as JSON',
      isList: true,
    },
    rewrites: {
      step7Output: 'captions',
      step2Output: 'imageDescription',
      step6Output: 'reactions',
    },
    // Attach the real image so content_alignment is judged from what is actually
    // visible, not only the text description. Requires S8's model to be vision-capable.
    includeImage: true,
    appendUserPrompt:
      '\n\n--------------------------------------\n' +
      'An image is ATTACHED. Judge content_alignment from what is actually visible ' +
      'in that image (people, expressions, devices, setting) — the description above ' +
      'is only a supplement. If the caption is consistent with the scene, score it high.\n' +
      '\n--------------------------------------\n' +
      'MEME / KNOWN-TEMPLATE CHECK.\n' +
      'Recognized content — this INCLUDES a "meme" verdict from the recognition step ' +
      '(is_meme, template_name, meaning, how_a_caption_should_use_it):\n${recognizedContent}\n' +
      'Trust that "meme" verdict. If meme.is_meme is true, the template carries ' +
      'EXPECTATIONS — use meme.meaning and meme.how_a_caption_should_use_it as the ' +
      'rubric and judge meme_alignment: does the caption use the image the way the ' +
      'template expects (or subvert it clearly and on purpose)?\n' +
      '- 1.0 = nails how this template is meant to be used\n' +
      '- 0.5 = loosely uses the template; the expectation is only partly met\n' +
      '- 0.0 = ignores or fights the template’s established meaning\n' +
      'IF meme.image_is_punchline is true, the image itself delivers the punchline: ' +
      'LOWER meme_alignment for a caption that restates that response in words ' +
      '(e.g. the image already says NO and the caption still says "no"/"hard pass") — ' +
      'that is redundant. REWARD captions that stop at the setup and let the image land it.\n' +
      'Copy meme.is_meme into "is_meme", and meme.template_name into "meme_template" ' +
      '(null if unknown). If meme.is_meme is false, set "is_meme" false and ' +
      '"meme_alignment" to null.\n' +
      '\n--------------------------------------\n' +
      'TOUCHSTONE CHECK.\n' +
      'The SPECIFIC Columbia/Barnard touchstone this caption is meant to land is:\n' +
      '${moment}\n' +
      'That is a specific experience, ritual, place, or object (e.g. add/drop ' +
      'registration, Primal Scream, Butler at 3am). Score touchstone_alignment ' +
      '(0..1): does the caption clearly LAND that specific touchstone — would a ' +
      'Columbia student recognize the specific moment — rather than a generic vibe?\n' +
      '- 1.0 = the specific touchstone is unmistakable\n' +
      '- 0.5 = gestures at it; takes a leap to connect\n' +
      '- 0.0 = generic; the specific touchstone is absent\n' +
      '\n--------------------------------------\n' +
      'Output ONLY strict, valid JSON — EVERY key in double quotes. ' +
      'One object per caption:\n' +
      '[\n' +
      '  {\n' +
      '    "caption": "<the caption>",\n' +
      '    "emotional_alignment": <0..1>,\n' +
      '    "content_alignment": <0..1>,\n' +
      '    "is_meme": <true|false>,\n' +
      '    "meme_template": "<the template name from the recognition step, or null>",\n' +
      '    "meme_alignment": <0..1 or null>,\n' +
      '    "meme_reason": "<one sentence: the template’s expectation and whether the caption fits — or why it is not a meme>",\n' +
      '    "touchstone": "<restate the specific touchstone this caption should land, from the moment above>",\n' +
      '    "touchstone_alignment": <0..1>,\n' +
      '    "touchstone_reason": "<one sentence: is the specific touchstone present, and how>",\n' +
      '    "reason": "<one sentence>"\n' +
      '  }\n' +
      ']',
    fanOutOver: 'captions',
    // Pull this branch's own captions + reaction + moment from the bundle; the
    // image description stays shared across branches. ${moment} is the specific
    // touchstone the caption is meant to land (used by the TOUCHSTONE CHECK).
    bundleSlots: { captions: 'captions', reactions: 'reactions', moment: 'moment' },
    inputs: [
      {
        slot: 'captions',
        description: 'the clean captions to evaluate',
        binding: { kind: 'op', opKey: 'extract' },
      },
      {
        slot: 'imageDescription',
        description: 'a description of the scene',
        binding: { kind: 'op', opKey: 'describe' },
      },
      {
        slot: 'reactions',
        description: 'the Columbia moments + reactions used',
        binding: { kind: 'op', opKey: 'reaction' },
      },
      {
        slot: 'recognizedContent',
        description: 'recognized celebrity / meme / known template (for the meme check)',
        binding: { kind: 'op', opKey: 'recognize' },
      },
    ],
  },
  {
    key: 'refClarity',
    kind: 'llm',
    fromOrderBy: 8, // borrow Alignment's model (no flavor step of its own)
    title: 'Reference clarity analysis',
    description:
      'Fan-out: for each branch, judges how clearly each caption references its Columbia moment, and why.',
    output: {
      name: 'referenceClarity',
      description: 'per-caption reference-clarity score (0–1) + reason, as JSON',
      isList: true,
    },
    rewrites: {},
    systemPrompt:
      'You evaluate how clearly a humorous caption references a specific ' +
      'Columbia/Barnard "lived-experience" moment. Be precise. You only respond in JSON.',
    userPrompt:
      'Judge how clearly EACH caption references the Columbia moment below.\n\n' +
      'Columbia moment:\n${moment}\n\n' +
      'Captions:\n${captions}\n\n' +
      'Score reference_clarity from 0 to 1:\n' +
      '- 1.0 = the moment is unmistakable to someone who knows it\n' +
      '- 0.5 = hinted at; takes a leap to connect\n' +
      '- 0.0 = no recognizable reference to the moment\n\n' +
      'Output ONLY a JSON array, one object per caption:\n' +
      '[\n' +
      '  {\n' +
      '    "caption": "<the caption>",\n' +
      '    "reference_clarity": <0..1>,\n' +
      '    "reason": "<one sentence on what makes the reference clear or unclear>"\n' +
      '  }\n' +
      ']',
    fanOutOver: 'captions',
    // Pull this branch's clean captions + its moment from the bundle.
    bundleSlots: { captions: 'captions', moment: 'moment' },
    inputs: [
      {
        slot: 'captions',
        description: 'the captions to judge (per branch)',
        binding: { kind: 'op', opKey: 'alignment' },
      },
    ],
  },
  {
    key: 'refRecover',
    kind: 'llm',
    fromOrderBy: 8, // borrow Alignment's model
    title: 'Reference recoverability (blind)',
    description:
      'Fan-out: sees ONLY the caption (the moment is withheld) and judges whether the specific reference can be recovered from the caption alone.',
    output: {
      name: 'referenceRecoverability',
      description: 'per-caption blind guess + recoverability score (0–1)',
      isList: true,
    },
    rewrites: {},
    systemPrompt:
      'You are a Columbia/Barnard student. You are shown ONLY a caption, with ' +
      'no other context. Your job is to guess what specific campus moment or ' +
      'experience it refers to, judging ONLY from the caption itself. Do not ' +
      'invent context you were not given. You only respond in JSON.',
    userPrompt:
      'Using ONLY each caption below (no other context), infer what specific ' +
      'Columbia/Barnard moment or experience it references.\n\n' +
      'Captions:\n${captions}\n\n' +
      'Then score reference_recoverability from 0 to 1:\n' +
      '- 1.0 = a Columbia student could identify the SPECIFIC reference from the caption alone\n' +
      '- 0.5 = points at a general vibe; the specific reference is guessable but not certain\n' +
      '- 0.0 = too generic; no way to recover the specific reference\n\n' +
      'Output ONLY a JSON array, one object per caption:\n' +
      '[\n' +
      '  {\n' +
      '    "caption": "<the caption>",\n' +
      '    "inferred_reference": "<your best guess, from the caption alone>",\n' +
      '    "reference_recoverability": <0..1>,\n' +
      '    "reason": "<one sentence on why it is or isn’t recoverable>"\n' +
      '  }\n' +
      ']',
    fanOutOver: 'captions',
    // ONLY captions from the bundle — the moment is deliberately NOT passed in.
    bundleSlots: { captions: 'captions' },
    inputs: [
      {
        slot: 'captions',
        description: 'the captions to test (blind — the moment is withheld)',
        binding: { kind: 'op', opKey: 'refClarity' },
      },
    ],
  },
  {
    key: 'collect',
    kind: 'transform',
    title: 'Collect all jokes',
    description:
      'Pure code (fan-in): flattens every branch into ONE list of all jokes, each with its alignment, reference-clarity and recoverability assessments.',
    output: {
      name: 'allJokes',
      description: 'every caption across all branches with its three assessments',
      isList: true,
    },
    rewrites: {},
    inputs: [
      {
        slot: 'alignment',
        description: 'alignment analysis (all branches)',
        binding: { kind: 'op', opKey: 'alignment' },
      },
      {
        slot: 'clarity',
        description: 'reference clarity (all branches) — optional; looked up per caption',
        binding: { kind: 'op', opKey: 'refClarity' },
        optional: true,
      },
      {
        slot: 'recoverability',
        description:
          'reference recoverability (all branches) — optional; looked up per caption',
        binding: { kind: 'op', opKey: 'refRecover' },
        optional: true,
      },
    ],
    transform: (vals) => {
      const toArr = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])
      const aB = toArr(vals.alignment)
      const cB = toArr(vals.clarity)
      const rB = toArr(vals.recoverability)
      const norm = (s: unknown) =>
        String(s ?? '')
          .toLowerCase()
          .replace(/[‘’‚‛`´]/g, "'")
          .replace(/[“”„]/g, '"')
          .replace(/\s+/g, ' ')
          .trim()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const momentObj = (branch: unknown): any => {
        const b = branch as { item?: unknown; bundle?: { moment?: unknown } }
        return b?.item ?? b?.bundle?.moment ?? null
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const momentText = (m: any): string => {
        const orig = m?.item ?? m
        if (typeof orig === 'string') return orig
        return String(
          orig?.context ?? orig?.content ?? JSON.stringify(orig ?? '')
        )
      }
      // Focus from the moment's own field, or derived from its scores when the
      // field is missing (e.g. branches generated before Decide focus existed).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const focusOf = (m: any): string => {
        if (typeof m?.focus === 'string' && m.focus) return m.focus
        const v = Number(m?.visual_connection?.score)
        const e = Number(m?.emotional_connection?.score)
        if (!Number.isFinite(v) || !Number.isFinite(e)) return 'unknown'
        if (v >= 0.7 && e >= 0.7) return 'both'
        return v >= e ? 'visual' : 'emotional'
      }
      const textOf = (branch: unknown) =>
        (branch as { text?: unknown })?.text
      // Global caption → assessment index across ALL branches, so each joke is
      // paired with its OWN clarity/recoverability entry even when the three
      // fan-outs aren't index-aligned or a step was re-run out of sync. A miss
      // returns null ("re-run this step") — never a different caption's entry
      // (the old per-branch positional fallback caused mismatches).
      const indexByCaption = (branches: unknown[]): Map<string, unknown> => {
        const m = new Map<string, unknown>()
        for (const b of branches) {
          for (const x of toArr(parseJsonLoose(textOf(b)))) {
            const key = norm((x as { caption?: unknown })?.caption)
            if (key && !m.has(key)) m.set(key, x)
          }
        }
        return m
      }
      const alignByCaption = indexByCaption(aB)
      const clarityByCaption = indexByCaption(cB)
      const recoverByCaption = indexByCaption(rB)

      // The branch bundle accumulated { moment, reactions, captions } along the
      // way; pull the reaction text so a joke can trace back to what emotional
      // reaction produced it (either reaction variant fills its own key).
      const bundleOf = (b: unknown): Record<string, unknown> =>
        (b as { bundle?: Record<string, unknown> })?.bundle ?? {}
      const reactionText = (bd: Record<string, unknown>): string =>
        String(bd?.reactions ?? bd?.reactionsEmoReason ?? '')

      // One joke per caption. Enumerate from the ALIGNMENT branches only — that
      // is the spine carrying each caption together with its moment, reaction
      // and scores. Clarity/recoverability are looked up by caption (above), so
      // they never add or drop jokes if their fan-outs are out of sync. Dedup by
      // caption guards against a branch being run twice.
      const jokes: unknown[] = []
      const seen = new Set<string>()
      for (const branch of aB) {
        const m = momentObj(branch)
        const moment = momentText(m)
        const focus = focusOf(m)
        const reaction = reactionText(bundleOf(branch))
        const aList = toArr(parseJsonLoose(textOf(branch))) as any[] // eslint-disable-line @typescript-eslint/no-explicit-any
        for (const entry of aList) {
          const caption =
            typeof entry === 'string' ? entry : entry?.caption ?? ''
          const key = norm(caption)
          if (!key || seen.has(key)) continue
          seen.add(key)
          jokes.push({
            moment,
            focus,
            reaction,
            caption,
            alignment:
              entry && typeof entry === 'object'
                ? entry
                : alignByCaption.get(key) ?? null,
            reference_clarity: clarityByCaption.get(key) ?? null,
            reference_recoverability: recoverByCaption.get(key) ?? null,
          })
        }
      }
      return jokes
    },
  },
  {
    key: 'rank',
    kind: 'transform',
    title: 'Rank all jokes',
    description:
      'Pure code: ranks jokes by alignment on their focused dimension, after filtering out any joke with a weak (<0.4) reference score.',
    note:
      'RANKING POLICY\n' +
      '1) Filter out anything really bad: drop jokes where reference_clarity OR ' +
      'reference_recoverability is below 0.4.\n' +
      '2) Maximize alignment: rank the survivors by the alignment score on the ' +
      'joke’s focus — emotional→emotional_alignment, visual→content_alignment, ' +
      'both→min(the two). Filtered-out jokes are listed last.',
    output: {
      name: 'ranking',
      description: 'jokes ranked best→worst; filtered-out ones listed last',
      isList: true,
    },
    rewrites: {},
    inputs: [
      {
        slot: 'jokes',
        description: 'all jokes with their three assessments',
        binding: { kind: 'op', opKey: 'collect' },
      },
    ],
    transform: (vals) => {
      const jokes = Array.isArray(vals.jokes)
        ? vals.jokes
        : parseJsonLoose(vals.jokes)
      if (!Array.isArray(jokes)) return []
      const num = (x: unknown): number | null => {
        const n = Number(x)
        return Number.isFinite(n) ? n : null
      }
      const THRESHOLD = 0.4
      const scored = jokes.map((j) => {
        const focus = j?.focus ?? 'unknown'
        const emo = num(j?.alignment?.emotional_alignment)
        const con = num(j?.alignment?.content_alignment)
        const clarity = num(j?.reference_clarity?.reference_clarity)
        const recover = num(j?.reference_recoverability?.reference_recoverability)
        let focusedAlignment: number | null
        if (focus === 'emotional') focusedAlignment = emo
        else if (focus === 'visual') focusedAlignment = con
        else if (focus === 'both')
          focusedAlignment =
            emo != null && con != null ? Math.min(emo, con) : emo ?? con
        else focusedAlignment = emo != null && con != null ? (emo + con) / 2 : emo ?? con
        // Guardrail: only fail on a score that is present and below threshold.
        const fails: string[] = []
        if (clarity != null && clarity < THRESHOLD)
          fails.push(`reference_clarity ${clarity} < ${THRESHOLD}`)
        if (recover != null && recover < THRESHOLD)
          fails.push(`reference_recoverability ${recover} < ${THRESHOLD}`)
        return { j, focus, emo, con, clarity, recover, focusedAlignment, fails }
      })
      const byAlign = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
        (b.focusedAlignment ?? -1) - (a.focusedAlignment ?? -1)
      const passed = scored.filter((s) => s.fails.length === 0).sort(byAlign)
      const failed = scored.filter((s) => s.fails.length > 0).sort(byAlign)
      return [...passed, ...failed].map((s, i) => ({
        rank: s.fails.length === 0 ? i + 1 : null,
        status: s.fails.length === 0 ? 'ranked' : 'filtered out',
        caption: s.j?.caption ?? '',
        focus: s.focus,
        focused_alignment: s.focusedAlignment,
        scores: {
          emotional_alignment: s.emo,
          content_alignment: s.con,
          reference_clarity: s.clarity,
          reference_recoverability: s.recover,
        },
        reason:
          s.fails.length === 0
            ? `focus=${s.focus}; focused alignment=${s.focusedAlignment}`
            : `filtered: ${s.fails.join('; ')}`,
        moment: s.j?.moment ?? '',
        reaction: s.j?.reaction ?? '',
        // Provenance: the per-op assessments each score came from, kept so the
        // UI can trace a score back to the reason (and step) that produced it.
        evidence: {
          alignment: s.j?.alignment ?? null,
          reference_clarity: s.j?.reference_clarity ?? null,
          reference_recoverability: s.j?.reference_recoverability ?? null,
        },
      }))
    },
  },
  {
    key: 'rankAlignOnly',
    kind: 'transform',
    title: 'Rank all jokes — VARIANT (alignment only)',
    description:
      'Pure code: ranks jokes purely by alignment on their focused dimension. No reference-score filtering.',
    note:
      'RANKING POLICY (alignment only)\n' +
      'Rank every joke by the alignment score on its focus — ' +
      'emotional→emotional_alignment, visual→content_alignment, both→min(the two). ' +
      'If the image is a meme, ALSO require meme fit: blend the focused alignment ' +
      'with meme_alignment via min. No filtering on reference clarity/recoverability.',
    output: {
      name: 'rankingAlignOnly',
      description:
        'jokes ranked best→worst by focused alignment (meme jokes also blended with meme_alignment)',
      isList: true,
    },
    rewrites: {},
    inputs: [
      {
        slot: 'jokes',
        description: 'all jokes with their assessments',
        binding: { kind: 'op', opKey: 'collect' },
      },
    ],
    transform: (vals) => {
      const jokes = Array.isArray(vals.jokes)
        ? vals.jokes
        : parseJsonLoose(vals.jokes)
      if (!Array.isArray(jokes)) return []
      const num = (x: unknown): number | null => {
        const n = Number(x)
        return Number.isFinite(n) ? n : null
      }
      // Blend a 0..1 factor into the running score via min (guards nulls): the
      // joke must satisfy every present factor, not average its way past one.
      const blendMin = (a: number | null, b: number | null): number | null =>
        b == null ? a : a == null ? b : Math.min(a, b)
      const scored = jokes.map((j) => {
        const focus = j?.focus ?? 'unknown'
        const emo = num(j?.alignment?.emotional_alignment)
        const con = num(j?.alignment?.content_alignment)
        const isMeme = j?.alignment?.is_meme === true
        const meme = num(j?.alignment?.meme_alignment)
        const touch = num(j?.alignment?.touchstone_alignment)
        let base: number | null
        if (focus === 'emotional') base = emo
        else if (focus === 'visual') base = con
        else if (focus === 'both')
          base = emo != null && con != null ? Math.min(emo, con) : emo ?? con
        else base = emo != null && con != null ? (emo + con) / 2 : emo ?? con
        // The joke must ALSO land the specific touchstone, and (if a meme) fit the
        // template. Blend both in with min so a strong scene score can't rescue a
        // caption that misses the touchstone or ignores the template.
        let focusedAlignment = blendMin(base, touch)
        if (isMeme) focusedAlignment = blendMin(focusedAlignment, meme)
        return { j, focus, emo, con, isMeme, meme, touch, focusedAlignment }
      })
      scored.sort((a, b) => (b.focusedAlignment ?? -1) - (a.focusedAlignment ?? -1))
      return scored.map((s, i) => ({
        rank: i + 1,
        caption: s.j?.caption ?? '',
        focus: s.focus,
        is_meme: s.isMeme,
        focused_alignment: s.focusedAlignment,
        scores: {
          emotional_alignment: s.emo,
          content_alignment: s.con,
          touchstone_alignment: s.touch,
          ...(s.isMeme ? { meme_alignment: s.meme } : {}),
        },
        reason:
          `focus=${s.focus}; blended` +
          (s.touch != null ? ` touchstone=${s.touch}` : '') +
          (s.isMeme && s.meme != null ? ` meme=${s.meme}` : '') +
          ` → ${s.focusedAlignment}`,
        moment: s.j?.moment ?? '',
        reaction: s.j?.reaction ?? '',
        evidence: {
          alignment: s.j?.alignment ?? null,
          reference_clarity: s.j?.reference_clarity ?? null,
          reference_recoverability: s.j?.reference_recoverability ?? null,
        },
      }))
    },
  },
]

const IMAGE_FIELDS: { field: ImageField; label: string }[] = [
  { field: 'imageDescription', label: '(image) cached description' },
  { field: 'additionalContext', label: '(image) additional context' },
  { field: 'celebrityRecognition', label: '(image) recognized content' },
]

const imageFieldValue = (img: OpsImage, field: ImageField): string => {
  if (field === 'imageDescription') return img.imageDescription ?? ''
  if (field === 'additionalContext') return img.additionalContext ?? ''
  return img.celebrityRecognition ?? ''
}

// Tolerant JSON parse: accepts a value that's already parsed, or a string that
// may be wrapped in ```json fences. Returns null when it can't parse.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseJsonLoose = (value: unknown): any => {
  if (value != null && typeof value !== 'string') return value
  if (typeof value !== 'string') return null
  const cleaned = value
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s)
    } catch {
      return undefined
    }
  }
  let out = tryParse(cleaned)
  if (out !== undefined) return out
  // Extract the first JSON array/object substring (handles prose wrapping).
  const start = cleaned.search(/[[{]/)
  const end = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'))
  const sub = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned
  out = tryParse(sub)
  if (out !== undefined) return out
  // Repair unquoted object keys ({ caption: ... } -> { "caption": ... }), a
  // common LLM slip when the prompt example used loose JSON.
  const repaired = sub.replace(
    /([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g,
    '$1"$2"$3'
  )
  out = tryParse(repaired)
  return out !== undefined ? out : null
}

// Coerce any resolved value into a string suitable for prompt substitution.
const asPromptString = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : value == null
      ? ''
      : JSON.stringify(value, null, 2)

const stringifyResult = (v: unknown): string =>
  v == null
    ? '(not run yet)'
    : typeof v === 'string'
      ? v
      : JSON.stringify(v, null, 2)

// A short label for one scored moment (used in fan-out result blocks).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const momentLabel = (m: any): string => {
  const orig = m?.item ?? m
  const text =
    typeof orig === 'string'
      ? orig
      : orig?.context ?? orig?.content ?? orig?.text ?? JSON.stringify(orig)
  const v = m?.visual_connection?.score
  const e = m?.emotional_connection?.score
  const rel = m?.relevance_score
  const scores =
    v != null || e != null
      ? ` [v:${v ?? '?'} e:${e ?? '?'}]`
      : rel != null
        ? ` [score:${rel}]`
        : ''
  const s = String(text)
  return (s.length > 90 ? `${s.slice(0, 90)}…` : s) + scores
}

// One result row from a fan-out run: the source item, the model's output, and
// a `bundle` of named values accumulated along this branch (so a later fan-out
// can pull several per-branch values — e.g. alignment needs both the captions
// and the reaction for the same moment).
type FanResult = {
  label: string
  item: unknown
  text: string
  bundle?: Record<string, unknown>
}

const isFanResult = (x: unknown): x is FanResult =>
  !!x &&
  typeof x === 'object' &&
  'text' in x &&
  'item' in x &&
  'label' in x &&
  typeof (x as { text: unknown }).text === 'string'

// When fanning out, an item can be a raw moment (from a filter) OR an upstream
// branch result (from another fan-out). These extract the right pieces so a
// branch can flow through several ops.
const fanItemValue = (item: unknown): string =>
  isFanResult(item)
    ? `Columbia moment:\n${stringifyResult(item.item)}\n\nReaction:\n${item.text}`
    : asPromptString(item)

const fanItemLabel = (item: unknown): string =>
  isFanResult(item) ? momentLabel(item.item) : momentLabel(item)

const fanItemSource = (item: unknown): unknown =>
  isFanResult(item) ? item.item : item

const applyRewrites = (text: string, rewrites: Record<string, string>): string => {
  let out = text
  for (const [oldVar, slot] of Object.entries(rewrites)) {
    out = out.split(`\${${oldVar}}`).join(`\${${slot}}`)
  }
  return out
}

// A binding the server resolver fills at run time: nothing to wire in the UI,
// and no client-side value to resolve before the call.
const isServerResolved = (
  b: Binding
): b is Extract<Binding, { kind: 'corpus' | 'studentBrain' }> =>
  b.kind === 'corpus' || b.kind === 'studentBrain'

const encodeBinding = (b: Binding): string =>
  b.kind === 'op'
    ? `op:${b.opKey}`
    : b.kind === 'image'
      ? `image:${b.field}`
      : b.kind === 'studentBrain'
        ? 'studentBrain'
        : b.kind === 'off'
          ? 'off'
          : b.kind === 'clustering'
            ? `clustering:${b.id}`
            : 'corpus'

const decodeBinding = (v: string, clusterings: SavedClusteringMeta[] = []): Binding => {
  if (v.startsWith('op:')) return { kind: 'op', opKey: v.slice(3) }
  if (v.startsWith('image:'))
    return { kind: 'image', field: v.slice(6) as ImageField }
  if (v === 'studentBrain') return { kind: 'studentBrain' }
  if (v === 'off') return { kind: 'off' }
  if (v.startsWith('clustering:')) {
    const id = v.slice('clustering:'.length)
    return { kind: 'clustering', id, name: clusterings.find((c) => c.id === id)?.name ?? id }
  }
  return { kind: 'corpus' }
}

// One line per saved clustering for the runtime-slot picker.
const clusteringOptionLabel = (c: SavedClusteringMeta): string =>
  `${c.name} · ${c.postCount} posts · last ${c.windowDays} days`

type RunState = { status: 'idle' | 'loading' | 'done' | 'error'; text?: string; error?: string }

const resultPre =
  'overflow-auto whitespace-pre-wrap rounded-md bg-[rgb(var(--panel)/0.6)] p-2 font-mono text-[11px] leading-snug text-[rgb(var(--ink))] dark:bg-[rgb(var(--panel)/0.2)]'

const outLabel =
  'text-[10px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]'
const outPanel =
  'rounded-md border border-[rgb(var(--gloss)/0.4)] bg-[rgb(var(--panel)/0.6)] p-2 dark:border-[rgb(var(--gloss)/0.12)] dark:bg-[rgb(var(--panel)/0.2)]'

// Maps each score key in a ranked joke to the op that produced it, plus where
// that op's evidence (the model's own `reason`) lives on the joke's `evidence`
// bundle. This is the static lineage: which step to open to fix a bad score.
const SCORE_SOURCE: Record<
  string,
  { opKey: string; label: string; evidenceKey: string; reasonKey?: string }
> = {
  emotional_alignment: {
    opKey: 'alignment',
    label: 'Alignment analysis',
    evidenceKey: 'alignment',
  },
  content_alignment: {
    opKey: 'alignment',
    label: 'Alignment analysis',
    evidenceKey: 'alignment',
  },
  meme_alignment: {
    opKey: 'alignment',
    label: 'Alignment analysis',
    evidenceKey: 'alignment',
    reasonKey: 'meme_reason',
  },
  touchstone_alignment: {
    opKey: 'alignment',
    label: 'Alignment analysis',
    evidenceKey: 'alignment',
    reasonKey: 'touchstone_reason',
  },
  reference_clarity: {
    opKey: 'refClarity',
    label: 'Reference clarity',
    evidenceKey: 'reference_clarity',
  },
  reference_recoverability: {
    opKey: 'refRecover',
    label: 'Reference recoverability (blind)',
    evidenceKey: 'reference_recoverability',
  },
  meme_format_alignment: {
    opKey: 'memeCaptionAlignment',
    label: 'Check meme format alignment',
    evidenceKey: 'memeAlign',
    reasonKey: 'reason',
  },
}

const SCORE_LABEL: Record<string, string> = {
  emotional_alignment: 'emotional',
  content_alignment: 'content',
  meme_alignment: 'meme',
  touchstone_alignment: 'touchstone',
  reference_clarity: 'ref clarity',
  reference_recoverability: 'ref recover',
  meme_format_alignment: 'meme format',
}

// The transform ops whose output is a list of ranked jokes (rendered as cards).
const RANK_OPS = new Set(['rank', 'rankAlignOnly', 'rankMemeCaptions'])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RankedJoke = Record<string, any>

const scoreTone = (v: number | null): string =>
  v == null
    ? 'text-[rgb(var(--muted))]'
    : v >= 0.7
      ? 'text-emerald-600 dark:text-emerald-400'
      : v >= 0.4
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-rose-600 dark:text-rose-400'

// Ranking output as cards: each score is a button that expands its evidence
// (the model's reason) and offers a jump to the step that produced it — so a
// bad score traces back to the exact prompt to improve.
function RankingOutput({
  jokes,
  onJumpToOp,
  onTraceJoke,
}: {
  jokes: RankedJoke[]
  onJumpToOp: (opKey: string) => void
  onTraceJoke: (joke: RankedJoke) => void
}) {
  // `${jokeIdx}:${scoreKey}` of the currently expanded evidence, if any.
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="flex h-full flex-col">
      <p className={outLabel}>{jokes.length} jokes</p>
      <div className="mt-1 flex min-h-0 flex-1 flex-col gap-2 overflow-auto pb-1">
        {jokes.map((j, i) => {
          const filtered = j?.status === 'filtered out'
          const scores: Record<string, number | null> = j?.scores ?? {}
          return (
            <div key={i} className={`${outPanel} ${filtered ? 'opacity-60' : ''}`}>
              {/* Click the joke → see its full pipeline trace in the side panel */}
              <button
                type="button"
                onClick={() => onTraceJoke(j)}
                title="click to trace this joke through every step"
                className="group flex w-full items-baseline gap-2 text-left"
              >
                <span className="font-mono text-[11px] font-semibold text-[rgb(var(--accent-strong))]">
                  {j?.rank != null ? `#${j.rank}` : '—'}
                </span>
                <span className="flex-1 text-[13px] font-medium text-[rgb(var(--ink))] group-hover:underline">
                  {j?.caption || '(no caption)'}
                </span>
                <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-[rgb(var(--muted))] opacity-0 transition group-hover:opacity-100">
                  trace ▸
                </span>
              </button>
              <p className="mt-0.5 text-[10px] text-[rgb(var(--muted))]">
                focus: {j?.focus ?? 'unknown'}
                {j?.focused_alignment != null
                  ? ` · focused alignment ${j.focused_alignment}`
                  : ''}
                {filtered ? ' · filtered out' : ''}
              </p>
              {/* score chips — click one to see why + trace to its step */}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {Object.entries(scores).map(([key, val]) => {
                  const cellKey = `${i}:${key}`
                  const isOpen = open === cellKey
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setOpen(isOpen ? null : cellKey)}
                      title="click to see why / trace to the step"
                      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition ${
                        isOpen
                          ? 'border-[rgb(var(--primary))] bg-[rgb(var(--primary)/0.1)]'
                          : 'border-[rgb(var(--gloss)/0.4)] hover:border-[rgb(var(--primary))] dark:border-[rgb(var(--gloss)/0.15)]'
                      }`}
                    >
                      <span className="text-[rgb(var(--muted))]">
                        {SCORE_LABEL[key] ?? key}
                      </span>{' '}
                      <span className={`font-semibold ${scoreTone(val)}`}>
                        {val == null ? '—' : val}
                      </span>
                    </button>
                  )
                })}
              </div>
              {/* expanded evidence for the clicked score */}
              {open?.startsWith(`${i}:`)
                ? (() => {
                    const key = open.slice(String(i).length + 1)
                    const src = SCORE_SOURCE[key]
                    const ev = src ? j?.evidence?.[src.evidenceKey] : null
                    const reason = ev?.[src?.reasonKey ?? 'reason'] ?? null
                    const inferred = ev?.inferred_reference ?? null
                    return (
                      <div className="mt-1.5 rounded border border-[rgb(var(--gloss)/0.3)] bg-[rgb(var(--panel)/0.5)] p-2 text-[11px] dark:border-[rgb(var(--gloss)/0.12)] dark:bg-[rgb(var(--panel)/0.2)]">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
                          why this score
                        </p>
                        <p className="mt-0.5 text-[rgb(var(--ink))]">
                          {reason ??
                            '(no recorded reason — re-run this step to capture it)'}
                        </p>
                        {inferred ? (
                          <p className="mt-1 text-[rgb(var(--muted))]">
                            blind guess: “{inferred}”
                          </p>
                        ) : null}
                        {src ? (
                          <button
                            type="button"
                            onClick={() => onJumpToOp(src.opKey)}
                            className="mt-1.5 text-[10px] font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                          >
                            open “{src.label}” step ▸
                          </button>
                        ) : null}
                      </div>
                    )
                  })()
                : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Copies text to the clipboard with a brief "Copied" confirmation.
function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          // clipboard blocked — ignore
        }
      }}
      className="shrink-0 rounded-md border border-[rgb(var(--gloss)/0.6)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.2)]"
    >
      {copied ? 'Copied ✓' : label}
    </button>
  )
}

// Editable textarea for a pinned default output. Keeps its own draft; "Save
// default" pushes it up. Remounted (via key) when the detail op changes so the
// draft always starts from the current default.
// Edits one prompt field of a flavor step, from the ops detail side panel.
// Saves straight to the flavor's DB step (the same rows the flavor editor
// edits), so the change applies everywhere the flavor runs.
function StepPromptEditor({
  stepId,
  flavorId,
  field,
  initial,
  preClass,
  onSaved,
}: {
  stepId: number
  flavorId: number
  field: 'systemPrompt' | 'userPrompt'
  initial: string
  preClass: string
  onSaved: () => void
}) {
  const [draft, setDraft] = useState(initial)
  // Baseline the draft is compared against; advances to the draft on save.
  const [baseline, setBaseline] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = draft !== baseline
  return (
    <div>
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          setSaved(false)
          setError(null)
        }}
        rows={10}
        spellCheck={false}
        className={`${preClass} block w-full resize-y focus:border-[rgb(var(--primary))] focus:outline-none`}
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={async () => {
            setSaving(true)
            setError(null)
            const res = await updateStepPromptsAction({
              stepId,
              flavorId,
              [field]: draft,
            })
            setSaving(false)
            if (res.ok) {
              setBaseline(draft)
              setSaved(true)
              onSaved()
            } else {
              setError(res.error ?? 'Save failed.')
            }
          }}
          disabled={!dirty || saving}
          className="rounded-md bg-[rgb(var(--primary))] px-2.5 py-1 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save to flavor'}
        </button>
        {error ? (
          <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">{error}</span>
        ) : saved && !dirty ? (
          <span className="text-[11px] font-semibold text-[rgb(var(--primary))]">Saved ✓</span>
        ) : dirty ? (
          <span className="text-[11px] text-[rgb(var(--muted))]">unsaved changes</span>
        ) : null}
      </div>
    </div>
  )
}

type DiagnosisStep = { title: string; scope: string; prompt: string; output: string }

type ChatMsg = { role: 'user' | 'assistant'; content: string }

const DIAGNOSE_MODELS = [
  { id: 'gpt-4o-2024-08-06', label: 'gpt-4o (fast)' },
  { id: 'o3', label: 'o3 (reasoning)' },
  { id: 'o4-mini', label: 'o4-mini (reasoning)' },
  { id: 'gpt-5', label: 'gpt-5' },
]

// Conversational root-cause helper inside the joke trace: the user says what's
// wrong and can keep pushing back; the model reasons over every step's prompt +
// output to localize the faulty step and refine as the conversation continues.
// Step titles it names are clickable → jump to that op.
function DiagnosePanel({
  caption,
  steps,
  onJumpToTitle,
}: {
  caption: string
  steps: DiagnosisStep[]
  onJumpToTitle: (title: string) => void
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [model, setModel] = useState(DIAGNOSE_MODELS[0].id)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const stepTitles = steps.map((s) => s.title)
  const mentionedSteps = (text: string) =>
    stepTitles.filter((t) => text.toLowerCase().includes(t.toLowerCase()))

  const send = () => {
    const text = input.trim()
    if (!text || pending) return
    const next: ChatMsg[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    setError(null)
    startTransition(async () => {
      const res = await diagnoseJokeAction({
        providerModelId: model,
        caption,
        steps,
        messages: next,
      })
      if (res.ok && res.text) {
        setMessages((m) => [...m, { role: 'assistant', content: res.text as string }])
      } else {
        setError(res.error ?? 'Diagnosis failed.')
      }
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-[rgb(var(--ink))]">
          Diagnose this joke
        </h3>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="rounded-md border border-[rgb(var(--gloss)/0.5)] bg-[rgb(var(--panel)/0.7)] px-2 py-1 text-[11px] text-[rgb(var(--ink))] outline-none dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.2)]"
        >
          {DIAGNOSE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-1 text-[12px] text-[rgb(var(--muted))]">
        Say what’s wrong, then keep talking — push back if it’s off. It reasons
        over every step’s prompt + output to find where the problem starts.
      </p>

      <div className="mt-3 flex-1 space-y-3 overflow-auto">
        {messages.length === 0 ? (
          <p className="text-[12px] text-[rgb(var(--muted))]">
            e.g. “this doesn’t land the class-registration reference — too generic.”
          </p>
        ) : null}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="ml-6 rounded-lg bg-[rgb(var(--primary)/0.1)] p-2 text-[12px] text-[rgb(var(--ink))]">
              {m.content}
            </div>
          ) : (
            <div key={i} className="mr-2">
              <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-[rgb(var(--ink))]">
                {m.content}
              </p>
              {mentionedSteps(m.content).length ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {mentionedSteps(m.content).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => onJumpToTitle(t)}
                      className="rounded border border-[rgb(var(--gloss)/0.4)] px-1.5 py-0.5 text-[10px] font-semibold text-[rgb(var(--accent-strong))] transition hover:border-[rgb(var(--primary))] dark:border-[rgb(var(--gloss)/0.15)]"
                    >
                      open {t} ▸
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )
        )}
        {pending ? (
          <p className="text-[12px] text-[rgb(var(--muted))]">Thinking…</p>
        ) : null}
        {error ? (
          <pre className="whitespace-pre-wrap rounded-lg bg-[rgb(var(--panel)/0.6)] p-2 text-[11px] text-[rgb(var(--accent-strong))] dark:bg-[rgb(var(--panel)/0.25)]">
            {error}
          </pre>
        ) : null}
      </div>

      <div className="mt-2 shrink-0">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send()
            }
          }}
          rows={3}
          placeholder={
            messages.length
              ? 'Reply… (⌘/Ctrl+Enter to send)'
              : 'What don’t you like about this joke? (⌘/Ctrl+Enter to send)'
          }
          className="w-full rounded-lg border border-[rgb(var(--gloss)/0.5)] bg-[rgb(var(--panel)/0.6)] p-2 text-[12px] text-[rgb(var(--ink))] outline-none focus:ring-1 focus:ring-[rgb(var(--primary))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.2)]"
        />
        <button
          type="button"
          onClick={send}
          disabled={pending || !input.trim()}
          className="mt-2 rounded-md bg-[rgb(var(--primary))] px-3 py-1.5 text-xs font-semibold text-[rgb(var(--on-primary))] transition hover:brightness-110 disabled:opacity-50"
        >
          {pending ? 'Analyzing…' : messages.length ? 'Send' : 'Find the problem'}
        </button>
      </div>
    </div>
  )
}

// Render an operation's output(s), shown to the RIGHT of its card:
//   • ranking  → cards with clickable, traceable scores
//   • fan-out  → one column per branch output (side by side)
//   • transform → a single panel with a kept-count + JSON
//   • single LLM → a single panel with the text
//   • not run / loading → a faint placeholder
function renderOutputs(
  op: OpSpec,
  value: unknown,
  status: RunState['status'],
  onJumpToOp: (opKey: string) => void,
  onTraceJoke: (joke: RankedJoke) => void
) {
  if (status === 'loading')
    return (
      <div className="flex h-full items-start rounded-md border border-dashed border-[rgb(var(--gloss)/0.5)] p-3 text-xs text-[rgb(var(--muted))] dark:border-[rgb(var(--gloss)/0.15)]">
        Running…
      </div>
    )
  if (value == null)
    return (
      <div className="flex h-full items-start rounded-md border border-dashed border-[rgb(var(--gloss)/0.5)] p-3 text-xs text-[rgb(var(--muted))] dark:border-[rgb(var(--gloss)/0.15)]">
        output appears here after you run
      </div>
    )

  if (op.fanOutOver && Array.isArray(value) && value.length === 0)
    return (
      <div className={`${outPanel} h-full text-xs text-[rgb(var(--muted))]`}>
        No items to run.
      </div>
    )

  // Any branch list (FanResult[]) → one column per branch.
  const fanRows =
    Array.isArray(value) && value.length > 0 && isFanResult(value[0])
      ? (value as FanResult[])
      : null
  if (fanRows) {
    const rows = fanRows
    return (
      <div className="flex h-full flex-col">
        <p className={outLabel}>
          {rows.length} branch{rows.length === 1 ? '' : 'es'}
        </p>
        <div className="mt-1 flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1">
          {rows.map((r, i) => (
            <div key={i} className={`${outPanel} flex w-[300px] shrink-0 flex-col overflow-auto`}>
              <p className="font-mono text-[10px] font-semibold text-[rgb(var(--accent-strong))]">
                branch {i + 1}
              </p>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[rgb(var(--panel)/0.5)] p-1.5 font-mono text-[10px] leading-snug text-[rgb(var(--muted))] dark:bg-[rgb(var(--panel)/0.25)]">
                {stringifyResult(r.item)}
              </pre>
              <p className="mt-2 text-[9px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--accent-strong))]">
                {op.output.name}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-[rgb(var(--ink))]">
                {r.text}
              </p>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Ranking output → cards with clickable, traceable scores.
  if (RANK_OPS.has(op.key) && Array.isArray(value)) {
    return (
      <RankingOutput
        jokes={value as RankedJoke[]}
        onJumpToOp={onJumpToOp}
        onTraceJoke={onTraceJoke}
      />
    )
  }

  // Transform list → count + readable layout.
  if (op.kind === 'transform' && Array.isArray(value)) {
    return (
      <div className="flex h-full flex-col">
        <p className={outLabel}>{value.length} kept</p>
        <div className={`${outPanel} mt-1 min-h-0 flex-1 overflow-auto`}>
          <JsonTree data={value} />
        </div>
      </div>
    )
  }

  // Single scalar output — JSON gets the readable layout, prose stays as-is.
  const parsed = parseJsonLoose(value)
  if (parsed !== null && typeof parsed === 'object') {
    return (
      <div className={`${outPanel} h-full overflow-auto`}>
        <JsonTree data={parsed} />
      </div>
    )
  }
  // Long prose (S2's stance paragraph) → one sentence per line so it can be
  // scanned. Same words, just line breaks at sentence boundaries.
  if (typeof value === 'string' && value.trim().length > 240) {
    const sentences = value
      .trim()
      .split(/(?<=[.!?])\s+(?=[A-Z“"'])/)
      .filter(Boolean)
    if (sentences.length > 1) {
      return (
        <div className={`${outPanel} h-full space-y-1.5 overflow-auto`}>
          {sentences.map((s, i) => (
            <p
              key={i}
              className="font-sans text-[12px] leading-snug text-[rgb(var(--ink))]"
            >
              {s}
            </p>
          ))}
        </div>
      )
    }
  }
  return <pre className={`${resultPre} h-full`}>{stringifyResult(value)}</pre>
}

// ---- Flavor-driven pipeline ----------------------------------------------
// Derives the ops DAG from the flavor's OWN steps: one llm op per step, wired
// by the ${...} placeholders its prompts actually reference. This is what any
// flavor without a hand-built pipeline below gets, so the ops page always
// shows the flavor you're on — never another flavor's hardcoded DAG.

const PLACEHOLDER_PATTERN = /\$\{([^}]+)\}/g

// Prompt placeholders that map to built-in bindings rather than step outputs.
const BUILTIN_SLOTS: Record<string, Binding> = {
  imageDescription: { kind: 'image', field: 'imageDescription' },
  imageAdditionalContext: { kind: 'image', field: 'additionalContext' },
  celebrityRecognition: { kind: 'image', field: 'celebrityRecognition' },
  allCommunityContexts: { kind: 'corpus' },
  studentBrainOutput: { kind: 'studentBrain' },
  topByVelocity: { kind: 'studentBrain' },
  topByVolume: { kind: 'studentBrain' },
  recentlyAdded: { kind: 'studentBrain' },
  activeMemories: { kind: 'studentBrain' },
  persistentMemories: { kind: 'studentBrain' },
  dormantMemories: { kind: 'studentBrain' },
}

const BUILTIN_SLOT_DESCRIPTIONS: Record<string, string> = {
  allCommunityContexts: 'the community context corpus (sampled server-side)',
  studentBrainOutput:
    'the Student Brain prompt-time retrieval payload (fetched server-side)',
  topByVelocity: 'Student Brain memories sorted by velocity (fetched server-side)',
  topByVolume: 'Student Brain memories sorted by volume (fetched server-side)',
  recentlyAdded: 'Student Brain memories sorted by recently added (fetched server-side)',
  activeMemories: 'Student Brain active memories (fetched server-side)',
  persistentMemories: 'Student Brain persistent memories (fetched server-side)',
  dormantMemories: 'Student Brain dormant memories (fetched server-side)',
}

// A human title for a derived op: the step's description if it has one, else
// the persona from "You are a/an/the ..." in its system prompt.
const titleFromStep = (s: OpsStep): string => {
  const desc = s.description.trim().split('\n')[0]
  if (desc) return desc.slice(0, 70)
  const persona = s.systemPrompt.match(/you are (?:an? |the )?([^.\n]{3,70})/i)
  return persona ? persona[1].trim() : `Step ${s.orderBy}`
}

const buildFlavorOpSpecs = (steps: OpsStep[]): OpSpec[] => {
  const sorted = [...steps].sort((a, b) => a.orderBy - b.orderBy)
  const titles = new Map(sorted.map((s) => [s.orderBy, titleFromStep(s)]))
  return sorted.map((s) => {
    const placeholders = new Set<string>()
    for (const m of (s.systemPrompt + '\n' + s.userPrompt).matchAll(PLACEHOLDER_PATTERN)) {
      placeholders.add(m[1].trim())
    }
    const inputs: InputSlot[] = []
    for (const name of placeholders) {
      const stepRef = name.match(/^step(\d+)Output$/)
      if (stepRef) {
        const n = Number(stepRef[1])
        // A forward/self reference can't be wired; leave the placeholder to the
        // server resolver rather than declaring an unsatisfiable input.
        if (n >= s.orderBy) continue
        inputs.push({
          slot: name,
          description: `output of step ${n} (${titles.get(n) ?? 'missing step'})`,
          binding: { kind: 'op', opKey: `step${n}` },
        })
      } else if (BUILTIN_SLOTS[name]) {
        inputs.push({
          slot: name,
          description:
            BUILTIN_SLOT_DESCRIPTIONS[name] ?? `cached image field "${name}"`,
          binding: BUILTIN_SLOTS[name],
          optional: true,
        })
      }
      // Unknown placeholders stay in the prompt untouched — the server
      // resolver's built-ins (or nothing) handle them, same as the app.
    }
    return {
      key: `step${s.orderBy}`,
      kind: 'llm' as const,
      fromOrderBy: s.orderBy,
      title: `S${s.orderBy} · ${titles.get(s.orderBy)}`,
      description: s.description.trim() || s.systemPrompt.trim().split('\n')[0].slice(0, 140),
      output: {
        name: `step${s.orderBy}Output`,
        description: `output of step ${s.orderBy} (${titles.get(s.orderBy)})`,
      },
      rewrites: {},
      inputs,
    }
  })
}

// ---- Visual lanes: the branch structure of a read-fan-out pipeline --------
// A step titled "Scene read N" starts a lane; each step that (transitively)
// depends on exactly ONE read joins that read's lane, and a step that depends
// on several reads gets the shared "all reads" lane. Steps before/outside the
// reads stay unlaned. Derived from titles + default bindings only, so flavors
// without "Scene read" steps render exactly as before.
type OpLane = {
  kind: 'read' | 'merge'
  label: string
  color: string
  isRoot: boolean
  title: string
}

const LANE_COLORS = ['#0ea5e9', '#a855f7', '#f59e0b', '#10b981', '#ef4444', '#14b8a6']
const MERGE_COLOR = '#6366f1'

const computeLanes = (specs: OpSpec[]): Map<string, OpLane> => {
  const lanes = new Map<string, OpLane>()
  const roots = specs
    .map((op) => {
      // Only a step NAMED "Scene read N" is a root — steps that merely mention
      // a read in their title ("Captions: scene read 1 ...") are lane members.
      const m = op.title.replace(/^S\d+\s*·\s*/i, '').match(/^scene read\s*(\d+)/i)
      return m ? { key: op.key, n: Number(m[1]), title: op.title } : null
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.n - b.n)
  if (!roots.length) return lanes

  const rootKeys = new Set(roots.map((r) => r.key))
  const depsByKey = new Map<string, string[]>(
    specs.map((op) => [
      op.key,
      op.inputs.flatMap((i) => (i.binding.kind === 'op' ? [i.binding.opKey] : [])),
    ])
  )
  // opKey -> which read roots it transitively depends on (roots include themselves)
  const reach = new Map<string, Set<string>>()
  const visit = (k: string): Set<string> => {
    const seen = reach.get(k)
    if (seen) return seen
    const acc = new Set<string>()
    reach.set(k, acc)
    if (rootKeys.has(k)) acc.add(k)
    for (const d of depsByKey.get(k) ?? []) visit(d).forEach((r) => acc.add(r))
    return acc
  }
  const laneOfRoot = new Map(
    roots.map((r, i) => [
      r.key,
      {
        kind: 'read' as const,
        label: `read ${r.n}`,
        color: LANE_COLORS[i % LANE_COLORS.length],
        title: r.title,
      },
    ])
  )
  for (const op of specs) {
    const rs = [...visit(op.key)]
    if (rs.length === 1) {
      const base = laneOfRoot.get(rs[0])!
      lanes.set(op.key, { ...base, isRoot: rootKeys.has(op.key) })
    } else if (rs.length > 1) {
      lanes.set(op.key, {
        kind: 'merge',
        label: 'all reads',
        color: MERGE_COLOR,
        isRoot: false,
        title: 'combines every scene read',
      })
    }
  }
  return lanes
}

// Per-flavor pipeline overrides. A flavor id listed here runs its OWN copy of
// the ops DAG (independent of every other flavor), so you can edit its
// structure without touching the original. Flavors NOT listed here get a
// pipeline derived from their own DB steps by buildFlavorOpSpecs above.
// DEFAULT_OP_SPECS is the hand-built DAG for 1508 (and its clone 1513).
const FLAVOR_PIPELINES: Record<number, OpSpec[]> = {
  1508: DEFAULT_OP_SPECS,
  1513: OP_SPECS_1513,
}

export default function OpsClient({
  flavorId,
  flavorSlug,
  userId,
  steps,
  imageSets,
  models,
}: {
  flavorId: number
  flavorSlug: string
  userId: string
  steps: OpsStep[]
  models: ModelChoice[]
  imageSets: OpsImageSet[]
}) {
  const router = useRouter()
  const [allStepsModel, setAllStepsModel] = useState<ModelChoice | null>(null)

  // The pipeline this flavor runs: its own hand-built copy if registered,
  // else a DAG derived from the flavor's own DB steps.
  const OP_SPECS = useMemo(
    () => FLAVOR_PIPELINES[flavorId] ?? buildFlavorOpSpecs(steps),
    [flavorId, steps]
  )

  const stepByOrder = useMemo(() => {
    const m = new Map<number, OpsStep>()
    steps.forEach((s) => m.set(s.orderBy, s))
    return m
  }, [steps])

  const opByKey = useMemo(() => {
    const m = new Map<string, OpSpec>()
    OP_SPECS.forEach((o) => m.set(o.key, o))
    return m
  }, [OP_SPECS])

  // Branch lanes ("Scene read N" + its dependents) for the nav and card accents.
  const lanes = useMemo(() => computeLanes(OP_SPECS), [OP_SPECS])

  const [setId, setSetId] = useState<number>(imageSets[0]?.id ?? 0)
  const activeSet = imageSets.find((s) => s.id === setId) ?? imageSets[0]
  const [imageId, setImageId] = useState<string>(
    activeSet?.images[0]?.id ?? ''
  )
  const image = activeSet?.images.find((i) => i.id === imageId) ?? null

  // Editable bindings: opKey -> slot -> Binding (seeded from the specs).
  const [bindings, setBindings] = useState<Record<string, Record<string, Binding>>>(
    () => {
      const b: Record<string, Record<string, Binding>> = {}
      OP_SPECS.forEach((op) => {
        b[op.key] = {}
        op.inputs.forEach((inp) => {
          b[op.key][inp.slot] = inp.binding
        })
      })
      return b
    }
  )

  // Run results: opKey -> imageId -> value. Value is a string (scalar LLM),
  // an array/object (transform), or FanResult[] (fan-out).
  const [outputs, setOutputs] = useState<
    Record<string, Record<string, unknown>>
  >({})
  // When each output was generated: opKey -> imageId -> epoch ms, so stale
  // results are obvious at a glance.
  const [outputTimes, setOutputTimes] = useState<
    Record<string, Record<string, number>>
  >({})
  const [runState, setRunState] = useState<Record<string, RunState>>({})
  // True while "Run all" is walking the pipeline top-to-bottom.
  const [runningAll, setRunningAll] = useState(false)
  // Batch run: which images are ticked, and the state of the run over them.
  const [batchIds, setBatchIds] = useState<string[]>([])
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchDone, setBatchDone] = useState(0)
  const [batchRunId, setBatchRunId] = useState<string | null>(null)
  const [batchExport, setBatchExport] = useState<QuickStudyRow[] | null>(null)
  const [archiving, setArchiving] = useState(false)
  // Per-image complaints about the final step's output shape (see finalCaptions).
  const [batchWarnings, setBatchWarnings] = useState<string[]>([])
  const [batchMsg, setBatchMsg] = useState<string | null>(null)
  // Outputs the user has "pinned" as a default: opKey -> imageId -> the fixed
  // value. A pin is PER IMAGE: with that image selected the op is not
  // regenerated (Run / Run all use the pinned value and downstream steps read
  // it); other images keep their own generated outputs. Editable in the panel.
  const [pinned, setPinned] = useState<
    Record<string, Record<string, unknown>>
  >({})

  // Which operation's full-detail panel is open (null = none).
  const [detailKey, setDetailKey] = useState<string | null>(null)
  // Which operation's jokes sidebar is open (image + formatted captions,
  // made for screenshots). null = closed.
  const [jokesKey, setJokesKey] = useState<string | null>(null)
  // Which op's Quick-Study-JSON side panel is open (null = none), and whether
  // its copy button just fired.
  const [studyJsonKey, setStudyJsonKey] = useState<string | null>(null)
  const [studyJsonCopied, setStudyJsonCopied] = useState(false)

  // Pulls every {caption, ...} object out of an op output, whatever its shape
  // (captions[], jokes_by_candidate[].jokes[], FanResult[] with JSON text...).
  const extractJokes = (
    value: unknown
  ): { caption: string; scores: [string, number][] }[] => {
    const out: { caption: string; scores: [string, number][] }[] = []
    const SCORE_KEYS = [
      'fit',
      'dynamic_alignment',
      'cast_derivation',
      'mapping_overall',
      'overall',
    ]
    const walk = (node: unknown) => {
      if (typeof node === 'string') {
        if (node.includes('"caption"')) walk(parseJsonLoose(node))
        return
      }
      if (Array.isArray(node)) {
        node.forEach(walk)
        return
      }
      if (node && typeof node === 'object') {
        const rec = node as Record<string, unknown>
        if (typeof rec.caption === 'string' && rec.caption.trim()) {
          const scores: [string, number][] = []
          for (const k of SCORE_KEYS) {
            if (typeof rec[k] === 'number')
              scores.push([k.replace(/_/g, ' '), rec[k] as number])
          }
          out.push({ caption: rec.caption.trim(), scores })
        }
        Object.values(rec).forEach(walk)
      }
    }
    walk(value)
    if (!out.length) {
      // Extractor steps output bare captions with no { caption } wrapper:
      // a JSON array of strings (S12/S13-style) or a numbered list (S11).
      const parsed = parseJsonLoose(value)
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string' && item.trim())
            out.push({ caption: item.trim(), scores: [] })
        }
      } else if (typeof value === 'string') {
        for (const line of value.split('\n')) {
          const m = line.match(/^\s*\d+[.)]\s+(.+)/)
          if (m) out.push({ caption: m[1].trim(), scores: [] })
        }
      }
    }
    return out
  }
  // Which operation's formatted-captions share panel is open (null = none).
  const [shareKey, setShareKey] = useState<string | null>(null)
  // A ranked joke whose full pipeline trace is shown in the side panel, and
  // which step in that trace is currently open (-1 = none).
  const [traceJoke, setTraceJoke] = useState<RankedJoke | null>(null)
  const [traceStep, setTraceStep] = useState<number>(0)

  // Harness run (scripts/context-recovery-harness): cached step outputs plus
  // per-caption structural cast-check results, loaded from a manifest exported
  // by export-ops-manifest.mjs. Local dev only — the manifest lives on disk.
  const [harnessCast, setHarnessCast] = useState<
    Record<string, HarnessCastCard[]>
  >({})
  const [harnessJudgeModel, setHarnessJudgeModel] = useState<string | null>(null)
  const [harnessLoading, setHarnessLoading] = useState(false)
  const [harnessMsg, setHarnessMsg] = useState<string | null>(null)
  const [castPanelOpen, setCastPanelOpen] = useState(false)

  // --- Persistence: generated outputs (and bindings/selection) are kept in
  // localStorage per flavor, so a reload doesn't wipe everything. `loaded`
  // gates the save effect so the first mount (defaults) can't clobber what was
  // saved before we hydrate.
  const storageKey = `ops-state:${flavorId}`
  const [loaded, setLoaded] = useState(false)
  // Operation keys the user has collapsed. For step-backed ops (keys like
  // "step6") the DB's is_hidden flag is the source of truth; only keys of
  // hand-built pipeline ops (1508/1513) still persist via localStorage.
  const [hidden, setHidden] = useState<string[]>(() =>
    steps.filter((s) => s.isHidden).map((s) => `step${s.orderBy}`)
  )

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const saved = JSON.parse(raw)
        if (saved.outputs) setOutputs(saved.outputs)
        if (saved.outputTimes) setOutputTimes(saved.outputTimes)
        if (saved.bindings) setBindings(saved.bindings)
        if (typeof saved.setId === 'number') setSetId(saved.setId)
        if (typeof saved.imageId === 'string') setImageId(saved.imageId)
        if (Array.isArray(saved.hidden)) {
          // Step-backed keys ("step6") now come from the DB — only restore
          // saved keys for ops without a backing step (hand-built pipelines).
          const extra = (saved.hidden as string[]).filter(
            (k) => !/^step\d+$/.test(k)
          )
          if (extra.length)
            setHidden((prev) => [...new Set([...prev, ...extra])])
        }
        if (saved.pinnedByImage && typeof saved.pinnedByImage === 'object')
          setPinned(saved.pinnedByImage)
      }
    } catch {
      // ignore corrupt/blocked storage
    }
    // URL params (shareable links) win over saved state: ?set=<id>&image=<uuid>
    try {
      const params = new URLSearchParams(window.location.search)
      const urlSet = Number(params.get('set'))
      if (imageSets.some((s) => s.id === urlSet)) setSetId(urlSet)
      const urlImage = params.get('image')
      if (urlImage) {
        const owner = imageSets.find((s) => s.images.some((i) => i.id === urlImage))
        if (owner) {
          setSetId(owner.id)
          setImageId(urlImage)
        }
      }
    } catch {
      // ignore malformed URLs
    }
    setLoaded(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the selection in the URL so ops links are shareable.
  useEffect(() => {
    if (!loaded) return
    const params = new URLSearchParams(window.location.search)
    params.set('set', String(setId))
    if (imageId) params.set('image', imageId)
    else params.delete('image')
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
  }, [loaded, setId, imageId])

  // Mirror the current selection into an ops2 link. ops2 honors the same
  // ?set=&run=&image= params, so the whole query string carries across.
  const [ops2Search, setOps2Search] = useState('')
  useEffect(() => {
    if (!loaded) return
    setOps2Search(window.location.search)
  }, [loaded, setId, imageId])

  useEffect(() => {
    if (!loaded) return
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          outputs,
          outputTimes,
          bindings,
          setId,
          imageId,
          // Step-backed hides live in the DB; only persist the rest.
          hidden: hidden.filter((k) => !/^step\d+$/.test(k)),
          pinnedByImage: pinned,
        })
      )
    } catch {
      // ignore quota/blocked storage
    }
  }, [loaded, storageKey, outputs, outputTimes, bindings, setId, imageId, hidden, pinned])

  const toggleHidden = (key: string) => {
    const nowHidden = !hidden.includes(key)
    setHidden((prev) =>
      nowHidden ? [...prev, key] : prev.filter((k) => k !== key)
    )
    // Persist to the step row when this op is backed by a DB step; revert the
    // optimistic update if the save fails (e.g. migration not applied yet).
    const stepRef = key.match(/^step(\d+)$/)
    const step = stepRef ? stepByOrder.get(Number(stepRef[1])) : undefined
    if (step) {
      void setStepHiddenAction({
        stepId: step.id,
        flavorId,
        hidden: nowHidden,
      }).then((res) => {
        if (!res.ok)
          setHidden((prev) =>
            nowHidden ? prev.filter((k) => k !== key) : [...prev, key]
          )
      })
    }
  }

  // "8:33 pm" for today's results; older ones get a "Jul 10" prefix.
  const fmtRanAt = (ms: number) => {
    const d = new Date(ms)
    const time = d
      .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      .toLowerCase()
    return d.toDateString() === new Date().toDateString()
      ? time
      : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
  }

  const clearSaved = () => {
    try {
      localStorage.removeItem(storageKey)
    } catch {
      // ignore
    }
    setOutputs({})
    setOutputTimes({})
    setRunState({})
  }

  // Fill the step cards from the harness's cached run so every intermediate
  // output (S1–S13 per image + cast-classifier results) is inspectable here
  // without re-running anything.
  const loadHarnessRun = () => {
    setHarnessLoading(true)
    setHarnessMsg(null)
    void loadHarnessManifestAction(flavorId)
      .then((res) => {
        if (!res.ok || !res.manifest) {
          setHarnessMsg(res.error ?? 'Failed to load harness run.')
          return
        }
        const m = res.manifest
        const stepOut: Record<string, Record<string, unknown>> = {}
        const stepTimes: Record<string, Record<string, number>> = {}
        const cast: Record<string, HarnessCastCard[]> = {}
        let stepCount = 0
        const notes: string[] = []
        for (const img of m.images) {
          for (const [ord, text] of Object.entries(img.steps)) {
            const key = `step${ord}`
            ;(stepOut[key] ??= {})[img.id] = text
            ;(stepTimes[key] ??= {})[img.id] = m.generatedAt
            stepCount += 1
          }
          if (img.cast.length) cast[img.id] = img.cast
          if (img.note) notes.push(`${img.id.slice(0, 8)}: ${img.note}`)
        }
        setOutputs((p) => {
          const next = { ...p }
          for (const [k, v] of Object.entries(stepOut))
            next[k] = { ...next[k], ...v }
          return next
        })
        setOutputTimes((p) => {
          const next = { ...p }
          for (const [k, v] of Object.entries(stepTimes))
            next[k] = { ...next[k], ...v }
          return next
        })
        setHarnessCast(cast)
        setHarnessJudgeModel(m.judgeModel)
        // Jump to the harness's image set if we're not already on it.
        if (m.setId !== setId && imageSets.some((s) => s.id === m.setId)) {
          setSetId(m.setId)
          const first = m.images[0]?.id
          if (first) setImageId(first)
        }
        setHarnessMsg(
          `Loaded ${stepCount} step outputs across ${m.images.length} images` +
            (notes.length ? ` — partial: ${notes.join('; ')}` : '')
        )
      })
      .finally(() => setHarnessLoading(false))
  }

  const setBinding = (opKey: string, slot: string, b: Binding) =>
    setBindings((prev) => ({
      ...prev,
      [opKey]: { ...prev[opKey], [slot]: b },
    }))

  // Saved Sidechat clusterings (the /sidechat-events archive) that a runtime
  // slot can be pointed at instead of the live corpus / Student Brain.
  const [clusterings, setClusterings] = useState<SavedClusteringMeta[]>([])
  const [clusteringsNote, setClusteringsNote] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await listClusteringsAction()
        if (cancelled) return
        if (res.ok === false) {
          setClusteringsNote(res.error)
          return
        }
        setClusterings(res.clusterings)
        if (res.tableMissing) setClusteringsNote('No saved clusterings: the archive table has not been created yet.')
        else if (res.clusterings.length === 0) setClusteringsNote('No saved clusterings yet — save one from Sidechat events.')
      } catch (e) {
        if (!cancelled) setClusteringsNote(e instanceof Error ? e.message : 'Could not list saved clusterings.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  // A clustering's prompt text, loaded once per id and shared by every run.
  const clusteringTextCache = useRef(new Map<string, Promise<string>>())
  const clusteringText = (id: string): Promise<string> => {
    let pending = clusteringTextCache.current.get(id)
    if (!pending) {
      pending = loadClusteringAction(id).then((res) => {
        if (res.ok === false) throw new Error(res.error)
        return clusteringToContextText(res.clusters)
      })
      pending.catch(() => clusteringTextCache.current.delete(id))
      clusteringTextCache.current.set(id, pending)
    }
    return pending
  }

  // Pinned value of an op for a given image (undefined = not pinned for it).
  const pinnedFor = (opKey: string, imgId: string): unknown =>
    pinned[opKey] != null && imgId in pinned[opKey]
      ? pinned[opKey][imgId]
      : undefined

  // Pin the op's current output as its fixed default FOR THE SELECTED IMAGE.
  const pinOutput = (opKey: string) => {
    if (!image) return
    const val = outputs[opKey]?.[image.id]
    if (val == null) return // nothing generated yet to pin
    const imgId = image.id
    setPinned((p) => ({ ...p, [opKey]: { ...p[opKey], [imgId]: val } }))
  }

  const unpinOutput = (opKey: string) => {
    if (!image) return
    const imgId = image.id
    setPinned((p) => {
      const forOp = { ...p[opKey] }
      delete forOp[imgId]
      const next = { ...p }
      if (Object.keys(forOp).length === 0) delete next[opKey]
      else next[opKey] = forOp
      return next
    })
  }

  // Manual values are pinned per image, including before the first generation.
  const savePinnedText = (opKey: string, text: string) => {
    if (!image) return
    const value = parseManualStepOutput(text)
    const imgId = image.id
    setPinned((current) => ({ ...current, [opKey]: { ...current[opKey], [imgId]: value } }))
    setRunState((current) => ({ ...current, [opKey]: { status: 'done' } }))
  }

  // Resolve a binding to its value for the current image. Returns null when an
  // upstream operation hasn't produced its output yet.
  const opIndex = (key: string) => OP_SPECS.findIndex((o) => o.key === key)

  // Human-readable label for a binding's source (used in the detail panel).
  const bindingLabel = (b: Binding): string => {
    if (b.kind === 'op')
      return `${opByKey.get(b.opKey)?.title ?? b.opKey} → ${
        opByKey.get(b.opKey)?.output.name ?? ''
      }`
    if (b.kind === 'image')
      return IMAGE_FIELDS.find((f) => f.field === b.field)?.label ?? b.field
    if (b.kind === 'studentBrain') return 'student brain · fetched at runtime'
    if (b.kind === 'off') return 'unchecked · sent empty'
    if (b.kind === 'clustering') return `saved clustering · ${b.name}`
    return 'corpus · sampled at runtime'
  }

  const setErr = (key: string, error: string) =>
    setRunState((p) => ({ ...p, [key]: { status: 'error', error } }))

  const store = (key: string, imgId: string, value: unknown) => {
    setOutputs((p) => ({ ...p, [key]: { ...p[key], [imgId]: value } }))
    setOutputTimes((p) => ({ ...p, [key]: { ...p[key], [imgId]: Date.now() } }))
  }

  // Core op runner. By default it reads upstream outputs from React state and
  // writes results back to it. "Run all" passes a ctx whose getOut/putOut share a
  // local overlay, so each step sees the fresh output of the one before it (React
  // state hasn't flushed mid-loop). Returns false if the op blocked or failed.
  //
  // A batch run additionally passes `img` (the image to run against, which is not
  // the one selected in the UI), `record` (called once per model call with the
  // rendered prompts and raw output, for the run archive) and `onError`.
  const handleRun = async (
    op: OpSpec,
    ctx?: {
      getOut: (opKey: string) => unknown
      putOut: (key: string, value: unknown) => void
      img?: OpsImage
      record?: (rec: OpsRunStepRecord) => void
      onError?: (opKey: string, error: string) => void
    }
  ): Promise<boolean> => {
    const target = ctx?.img ?? image
    if (!target) return false
    const imgId = target.id
    const getOut =
      ctx?.getOut ??
      ((k: string) => pinnedFor(k, imgId) ?? outputs[k]?.[imgId] ?? null)
    const putOut =
      ctx?.putOut ?? ((k: string, value: unknown) => store(k, imgId, value))
    const fail = (key: string, error: string) => {
      setErr(key, error)
      ctx?.onError?.(key, error)
    }

    // Pinned default (for THIS image): the op is frozen — don't call the model,
    // keep the pinned value (downstream reads it via getOut). Mark done, move on.
    if (pinnedFor(op.key, imgId) !== undefined) {
      const value = pinnedFor(op.key, imgId)
      putOut(op.key, value)
      ctx?.record?.({
        opKey: op.key,
        opTitle: `[Pinned / manual value] ${op.title}`,
        position: opIndex(op.key),
        stepOrderBy: op.fromOrderBy ?? null,
        providerModelId: null,
        output: stringifyResult(value),
        durationMs: 0,
      })
      setRunState((p) => ({ ...p, [op.key]: { status: 'done' } }))
      return true
    }

    // Resolve every input value. Block if an upstream op output isn't ready.
    const values: Record<string, unknown> = {}
    for (const inp of op.inputs) {
      const b = bindings[op.key]?.[inp.slot] ?? inp.binding
      if (isServerResolved(b)) continue
      let value: unknown
      if (b.kind === 'image') value = imageFieldValue(target, b.field)
      else if (b.kind === 'op') value = getOut(b.opKey)
      else if (b.kind === 'off') value = '' // unchecked: the placeholder resolves to nothing
      else {
        // A saved Sidechat clustering, sent as text so the server skips its
        // own corpus sample / Student Brain fetch for this slot.
        try {
          value = await clusteringText(b.id)
        } catch (err) {
          fail(
            op.key,
            `Input "${inp.slot}": could not load saved clustering "${b.name}" — ${
              err instanceof Error ? err.message : String(err)
            }`
          )
          return false
        }
      }
      if (value === null || value === undefined) {
        if (inp.optional) continue // op handles the missing value itself
        const fromTitle =
          b.kind === 'op' ? opByKey.get(b.opKey)?.title ?? b.opKey : 'its source'
        fail(
          op.key,
          `Input "${inp.slot}" isn't available yet — run ${fromTitle} first.`
        )
        return false
      }
      values[inp.slot] = value
    }

    // ---- transform: pure JS, no model ----
    if (op.kind === 'transform') {
      try {
        const out = op.transform ? op.transform(values) : null
        putOut(op.key, out)
        setRunState((p) => ({ ...p, [op.key]: { status: 'done' } }))
        return true
      } catch (err) {
        fail(op.key, err instanceof Error ? err.message : 'Transform failed.')
        return false
      }
    }

    // ---- llm: needs a configured model/step ----
    const step = op.fromOrderBy != null ? stepByOrder.get(op.fromOrderBy) : undefined
    if (!step || !(allStepsModel?.provider_model_id ?? step.providerModelId)) {
      fail(op.key, 'No model configured for this step.')
      return false
    }

    const runOnce = async (
      overrides: Record<string, string>,
      branch?: { index: number; label: string }
    ) => {
      const priorOutputs: Record<string, string> = {}
      for (const [k, v] of Object.entries(values)) priorOutputs[k] = asPromptString(v)
      // Run-context constants, available to any prompt as ${imageUrl},
      // ${flavorId}, ${flavorName}, ${userId} (e.g. the Quick Study export
      // step). Explicit slot values above win over these.
      priorOutputs.imageUrl ??= target.url
      priorOutputs.flavorId ??= String(flavorId)
      priorOutputs.flavorName ??= flavorSlug
      priorOutputs.userId ??= userId
      Object.assign(priorOutputs, overrides)
      const providerModelId = allStepsModel?.provider_model_id ?? op.providerModelId ?? step.providerModelId
      const supportsTemperature = allStepsModel?.is_temperature_supported ?? step.isTemperatureSupported
      const temperature = !supportsTemperature ? null :
        op.temperature != null
          ? op.temperature // explicit op override wins (knows its model supports it)
          : step.temperature ?? 0.7
      const includeImage = op.includeImage ?? step.includeImage
      const startedAt = Date.now()
      const result = await runStepAction({
        imageId: imgId,
        systemPrompt:
          op.systemPrompt ?? applyRewrites(step.systemPrompt, op.rewrites),
        userPrompt:
          (op.userPrompt ?? applyRewrites(step.userPrompt, op.rewrites)) +
          (op.appendUserPrompt ?? ''),
        providerModelId,
        temperature,
        includeImage,
        isTemperatureSupported: supportsTemperature,
        priorOutputs,
      })
      // Archive the call exactly as it went out, so the run can be analyzed or
      // recreated later. Only batch runs pass a recorder.
      ctx?.record?.({
        opKey: op.key,
        opTitle: op.title,
        position: opIndex(op.key),
        branchIndex: branch?.index ?? null,
        branchLabel: branch?.label ?? null,
        humorFlavorStepId: step.id ?? null,
        stepOrderBy: step.orderBy ?? null,
        providerModelId,
        temperature,
        includeImage,
        // runStepAction returns the prompts with ${vars} already substituted.
        systemPrompt: result.resolvedSystemPrompt ?? null,
        userPrompt: result.resolvedUserPrompt ?? null,
        priorOutputs,
        output: result.ok ? result.text ?? null : null,
        error: result.ok ? null : result.error ?? 'Run failed.',
        durationMs: Date.now() - startedAt,
      })
      return result
    }

    // ---- fan-out: run once per element of the list slot ----
    if (op.fanOutOver) {
      const raw = values[op.fanOutOver]
      const items = Array.isArray(raw) ? raw : parseJsonLoose(raw)
      if (!Array.isArray(items)) {
        fail(op.key, `Input "${op.fanOutOver}" is not a list to fan out over.`)
        return false
      }
      if (items.length === 0) {
        putOut(op.key, [])
        setRunState((p) => ({ ...p, [op.key]: { status: 'done' } }))
        return true
      }
      setRunState((p) => ({ ...p, [op.key]: { status: 'loading' } }))
      // Run one branch (by index), writing its result in place so branch order
      // is preserved regardless of which finishes first.
      const results: FanResult[] = new Array(items.length)
      const runBranch = async (i: number) => {
        const item = items[i]
        // Values carried in from the parent branch (empty for the first fan-out).
        const parentBundle: Record<string, unknown> = isFanResult(item)
          ? { ...(item.bundle ?? {}) }
          : {}
        // Per-branch slot overrides: bundle-mapped slots, plus the iterated slot.
        const overrides: Record<string, string> = {}
        for (const [slot, key] of Object.entries(op.bundleSlots ?? {})) {
          overrides[slot] = asPromptString(parentBundle[key])
        }
        if (!(op.fanOutOver in (op.bundleSlots ?? {}))) {
          overrides[op.fanOutOver] = fanItemValue(item)
        }
        const r = await runOnce(overrides, { index: i, label: fanItemLabel(item) })
        const text =
          r.ok && r.text != null ? r.text : `⚠ ${r.error ?? 'failed'}`
        // Pass this branch's accumulated values forward.
        const bundle: Record<string, unknown> = { ...parentBundle }
        if (!('moment' in bundle)) bundle.moment = fanItemSource(item)
        bundle[op.output.name] = text
        results[i] = {
          label: fanItemLabel(item),
          item: fanItemSource(item),
          text,
          bundle,
        }
      }
      // Run branches in parallel, but capped so we don't hit provider rate limits.
      const CONCURRENCY = 5
      let nextIndex = 0
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
          while (nextIndex < items.length) {
            const i = nextIndex++
            await runBranch(i)
          }
        })
      )
      putOut(op.key, results)
      setRunState((p) => ({ ...p, [op.key]: { status: 'done' } }))
      return true
    }

    // ---- plain single LLM call ----
    setRunState((p) => ({ ...p, [op.key]: { status: 'loading' } }))
    const result = await runOnce({})
    if (result.ok && result.text != null) {
      putOut(op.key, result.text)
      setRunState((p) => ({ ...p, [op.key]: { status: 'done' } }))
      return true
    } else {
      fail(op.key, result.error ?? 'Run failed.')
      return false
    }
  }

  // Runs every non-hidden op top-to-bottom. Sequential because each step depends
  // on the one before it; the overlay threads fresh outputs through the chain
  // (React state hasn't flushed yet). Stops at the first step that fails/blocks.
  // Run every non-hidden op from startIdx to the end, in order. Ops before
  // startIdx are not re-run — downstream steps read their existing outputs.
  //
  // Archived to ops_runs exactly like a batch run (one image), so single runs
  // leave the same record: the rendered prompts and raw output of every model
  // call. Best-effort — if archiving fails the run still happens.
  const runFrom = async (startIdx: number) => {
    if (!image || runningAll) return
    setRunningAll(true)
    const imgId = image.id
    const overlay: Record<string, unknown> = {}
    const getOut = (k: string) =>
      k in overlay
        ? overlay[k]
        : pinnedFor(k, imgId) ?? outputs[k]?.[imgId] ?? null
    const putOut = (k: string, value: unknown) => {
      overlay[k] = value
      store(k, imgId, value)
    }

    const startOp = OP_SPECS[startIdx]
    let runId: string | null = null
    let runImageId: string | null = null
    const created = await createOpsRunAction({
      flavorId,
      flavorSlug,
      setId: activeSet?.id ?? null,
      setSlug: activeSet?.slug ?? null,
      label:
        startIdx > 0
          ? `${flavorSlug} · 1 image · from ${startOp?.title ?? `op ${startIdx + 1}`}`
          : `${flavorSlug} · 1 image`,
      imageCount: 1,
      spec: runSpec(),
    })
    if (created.ok && created.runId) {
      runId = created.runId
      const started = await startOpsRunImageAction({
        runId: created.runId,
        imageId: imgId,
        imageUrl: image.url,
        position: 0,
      })
      if (started.ok && started.runImageId) runImageId = started.runImageId
    }
    const buffer: OpsRunStepRecord[] = []
    let flushChain: Promise<unknown> = Promise.resolve()
    const flush = () => {
      if (!runId || !runImageId || !buffer.length) return
      const batch = buffer.splice(0, buffer.length)
      const id = runImageId
      const rid = runId
      flushChain = flushChain.then(() =>
        saveOpsRunStepsAction({ runId: rid, runImageId: id, steps: batch }).catch(
          () => undefined
        )
      )
    }
    let chainError: string | null = null
    let failedOp: string | null = null

    try {
      for (const op of OP_SPECS.slice(startIdx)) {
        if (hidden.includes(op.key)) continue
        const ok = await handleRun(op, {
          getOut,
          putOut,
          record: (rec) => {
            buffer.push(rec)
            if (buffer.length >= 4) flush()
          },
          onError: (key, error) => {
            if (chainError == null) {
              chainError = error
              failedOp = opByKey.get(key)?.title ?? key
            }
          },
        })
        flush()
        if (!ok) break // a dependency failed or was blocked — stop the chain
      }
    } finally {
      flush()
      await flushChain
      if (runId && runImageId) {
        const finalValue = finalOp ? getOut(finalOp.key) : null
        const { captions } = finalCaptions(finalValue)
        await finishOpsRunImageAction({
          runImageId,
          status: chainError ? 'error' : 'done',
          error: chainError ? `${failedOp}: ${chainError}` : null,
          outputs: overlay,
          finalOutput:
            typeof finalValue === 'string' ? finalValue : JSON.stringify(finalValue ?? null),
          captions,
        }).catch(() => undefined)
        await finishOpsRunAction({
          runId,
          status: chainError ? 'error' : 'done',
          exportJson: null,
          exportWarning: chainError ? `${failedOp}: ${chainError}` : null,
          captionCount: captions.length,
        }).catch(() => undefined)
      }
      setRunningAll(false)
    }
  }

  const runAll = () => runFrom(0)

  // ---------------------------------------------------------------------------
  // Batch run: the whole pipeline over several images, archived to ops_runs.
  // ---------------------------------------------------------------------------

  // The last non-hidden op — its output is the export's source of captions.
  const finalOp = [...OP_SPECS].reverse().find((o) => !hidden.includes(o.key)) ?? null

  // A JSON-safe snapshot of everything that determined this run, so it can be
  // analyzed — or rebuilt in ops — later. Functions (transform) are dropped.
  const runSpec = () => ({
    flavorId,
    flavorSlug,
    hidden,
    bindings,
    pinned,
    finalOpKey: finalOp?.key ?? null,
    ops: OP_SPECS.map((o) => ({
      key: o.key,
      title: o.title,
      kind: o.kind,
      fromOrderBy: o.fromOrderBy ?? null,
      fanOutOver: o.fanOutOver ?? null,
      bundleSlots: o.bundleSlots ?? null,
      providerModelId: o.providerModelId ?? null,
      temperature: o.temperature ?? null,
      includeImage: o.includeImage ?? null,
      systemPrompt: o.systemPrompt ?? null,
      userPrompt: o.userPrompt ?? null,
      appendUserPrompt: o.appendUserPrompt ?? null,
      rewrites: o.rewrites ?? null,
      inputs: o.inputs.map((i) => ({
        slot: i.slot,
        optional: i.optional ?? false,
        binding: bindings[o.key]?.[i.slot] ?? i.binding,
      })),
      output: o.output,
    })),
    steps: steps.map((s) => ({
      id: s.id,
      orderBy: s.orderBy,
      description: s.description,
      systemPrompt: s.systemPrompt,
      userPrompt: s.userPrompt,
      providerModelId: s.providerModelId,
      temperature: s.temperature,
      includeImage: s.includeImage,
      isHidden: s.isHidden,
    })),
  })

  // Mirror the export to localStorage so the gallery page (a separate route)
  // can render it. Written after every image, not just at the end, so a batch
  // that is interrupted still leaves the images it finished.
  //
  // `items` carries one entry per image ATTEMPTED — including images that
  // produced nothing. The rows alone can't show those: an image with no
  // captions contributes no rows, so it would silently vanish from the gallery,
  // which is the one case worth seeing.
  const saveGallery = (rows: QuickStudyRow[], items: GalleryItem[]) => {
    try {
      window.localStorage.setItem(
        `ops-gallery:${flavorId}`,
        JSON.stringify({
          savedAt: new Date().toISOString(),
          flavorSlug,
          setSlug: activeSet?.slug ?? null,
          rows,
          items,
        })
      )
    } catch {
      // Quota — the export is still on the page and downloadable.
    }
  }

  const runBatch = async () => {
    if (batchRunning) return
    const targets = (activeSet?.images ?? []).filter((i) => batchIds.includes(i.id))
    if (!targets.length) return

    setBatchRunning(true)
    setBatchMsg(null)
    setBatchWarnings([])
    setBatchExport(null)
    setBatchRunId(null)
    setBatchDone(0)

    // Archiving is best-effort: if the tables aren't there (or the session is
    // stale) the run still happens and still exports — we just say so.
    let runId: string | null = null
    const created = await createOpsRunAction({
      flavorId,
      flavorSlug,
      setId: activeSet?.id ?? null,
      setSlug: activeSet?.slug ?? null,
      label: `${flavorSlug} · ${targets.length} image${targets.length === 1 ? '' : 's'}`,
      imageCount: targets.length,
      spec: runSpec(),
    })
    if (created.ok && created.runId) {
      runId = created.runId
      setBatchRunId(created.runId)
    } else {
      setBatchMsg(`Not saving this run: ${created.error ?? 'unknown error'}`)
    }

    const rows: QuickStudyRow[] = []
    const warnings: string[] = []
    const items: GalleryItem[] = []

    const runOneImage = async (img: OpsImage, position: number) => {
      let runImageId: string | null = null
      if (runId) {
        const started = await startOpsRunImageAction({
          runId,
          imageId: img.id,
          imageUrl: img.url,
          position,
        })
        if (started.ok && started.runImageId) runImageId = started.runImageId
      }

      // Step records are flushed in chunks while the image runs, chained so
      // they land in order and a long pipeline never posts one huge request.
      const buffer: OpsRunStepRecord[] = []
      let flushChain: Promise<unknown> = Promise.resolve()
      const flush = () => {
        if (!runId || !runImageId || !buffer.length) return
        const batch = buffer.splice(0, buffer.length)
        const id = runImageId
        const rid = runId
        flushChain = flushChain.then(() =>
          saveOpsRunStepsAction({ runId: rid, runImageId: id, steps: batch }).catch(
            () => undefined
          )
        )
      }

      const overlay: Record<string, unknown> = {}
      const getOut = (k: string) =>
        k in overlay ? overlay[k] : pinnedFor(k, img.id) ?? outputs[k]?.[img.id] ?? null
      const putOut = (k: string, value: unknown) => {
        overlay[k] = value
        store(k, img.id, value)
      }
      let imageError: string | null = null
      let failedOp: string | null = null

      for (const op of OP_SPECS) {
        if (hidden.includes(op.key)) continue
        const ok = await handleRun(op, {
          getOut,
          putOut,
          img,
          record: (rec) => {
            buffer.push(rec)
            if (buffer.length >= 4) flush()
          },
          onError: (key, error) => {
            if (imageError == null) {
              imageError = error
              failedOp = opByKey.get(key)?.title ?? key
            }
          },
        })
        flush()
        if (!ok) break // a dependency failed or was blocked — stop this image
      }
      flush()
      await flushChain

      const finalValue = finalOp ? getOut(finalOp.key) : null
      const { captions, warning } = finalCaptions(finalValue)
      // Say WHY there are no captions. A step that failed halfway stops the
      // chain, so the final step never runs — reporting only "no output" would
      // point at the wrong step.
      const label = img.url.split('/').pop() ?? img.id
      const problem = imageError
        ? `${failedOp} failed, so the pipeline stopped before the final step — ${imageError}`
        : warning
      if (problem) warnings.push(`${label}: ${problem}`)
      const imgRows = quickStudyRows(captions, {
        imageUrl: img.url,
        flavorId,
        flavorName: flavorSlug,
        userId,
      })
      rows.push(...imgRows)
      items.push({
        imageId: img.id,
        imageUrl: img.url,
        captions,
        problem: problem ?? null,
      })
      saveGallery(rows, items)

      if (runId && runImageId) {
        await finishOpsRunImageAction({
          runImageId,
          status: imageError ? 'error' : 'done',
          error: imageError ? `${failedOp}: ${imageError}` : null,
          outputs: overlay,
          finalOutput: typeof finalValue === 'string' ? finalValue : JSON.stringify(finalValue ?? null),
          captions,
        }).catch(() => undefined)
      }
      setBatchDone((n) => n + 1)
    }

    try {
      // Four images at a time: each one already fans out internally, so this
      // is a balance against provider rate limits. Was 2, which left a
      // 16-step gemini-2.5-pro pipeline (~1 min on the big caption steps)
      // running for hours on a 9-image set. Drop it back if 429s appear.
      const CONCURRENCY = 4
      let next = 0
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
          while (next < targets.length) {
            const i = next++
            await runOneImage(targets[i], i)
          }
        })
      )
      setBatchExport(rows)
      setBatchWarnings(warnings)
      if (runId) {
        await finishOpsRunAction({
          runId,
          status: 'done',
          exportJson: rows,
          exportWarning: warnings.length ? warnings.join('\n') : null,
          captionCount: rows.length,
        }).catch(() => undefined)
      }
    } finally {
      setBatchRunning(false)
    }
  }

  // --- Recovering a run that wasn't archived --------------------------------
  // A batch that ran before archiving worked still left every step's output in
  // the outputs store (which survives reloads), so the run can be rebuilt from
  // it after the fact. What can't be rebuilt is the resolved prompt text: it
  // was only ever held in the record buffer, which needs a run to write to. The
  // templates are still exact, so they go in — labelled, so a recovered step is
  // never mistaken for a record of what was actually sent.
  const RECOVERED_NOTE =
    '[RECOVERED RUN — this is the prompt TEMPLATE from the step definition. ' +
    'The resolved text that was actually sent was not captured for this run.]'
  const recoveredPrompt = (t?: string | null) =>
    t ? `${RECOVERED_NOTE}\n\n${t}` : null

  // Images that have at least one stored output: the ticked ones, or the whole
  // set when nothing is ticked.
  const archivableImages = () => {
    const pool = activeSet?.images ?? []
    const chosen = batchIds.length ? pool.filter((i) => batchIds.includes(i.id)) : pool
    const liveOps = OP_SPECS.filter((o) => !hidden.includes(o.key))
    return chosen.filter((i) => liveOps.some((o) => outputs[o.key]?.[i.id] != null))
  }

  const archiveExisting = async () => {
    if (archiving || batchRunning) return
    const targets = archivableImages()
    const liveOps = OP_SPECS.filter((o) => !hidden.includes(o.key))
    if (!targets.length) {
      setBatchMsg('No stored outputs to archive for these images.')
      return
    }

    setArchiving(true)
    setBatchMsg(null)
    setBatchWarnings([])
    // Get it onto disk before anything can go wrong. A stale session makes the
    // first server action re-render this page, which redirects to /login and
    // kills this loop mid-flight — so the file has to be written first.
    downloadFullRun()
    try {
      const created = await createOpsRunAction({
        flavorId,
        flavorSlug,
        setId: activeSet?.id ?? null,
        setSlug: activeSet?.slug ?? null,
        label: `${flavorSlug} · ${targets.length} image${targets.length === 1 ? '' : 's'} (recovered)`,
        imageCount: targets.length,
        spec: { ...runSpec(), recovered: true },
      })
      if (!(created.ok && created.runId)) {
        setBatchMsg(`Could not save: ${created.error ?? 'unknown error'}`)
        return
      }
      const runId = created.runId
      setBatchRunId(runId)

      const rows: QuickStudyRow[] = []
      const warnings: string[] = []
      const items: GalleryItem[] = []
      for (let position = 0; position < targets.length; position++) {
        const img = targets[position]
        const started = await startOpsRunImageAction({
          runId,
          imageId: img.id,
          imageUrl: img.url,
          position,
        })
        const runImageId = started.ok && started.runImageId ? started.runImageId : null

        const overlay: Record<string, unknown> = {}
        const records: OpsRunStepRecord[] = []
        for (const op of liveOps) {
          const value = outputs[op.key]?.[img.id]
          if (value == null) continue
          overlay[op.key] = value
          const step = op.fromOrderBy != null ? stepByOrder.get(op.fromOrderBy) : undefined
          const base = {
            opKey: op.key,
            opTitle: op.title,
            position: opIndex(op.key),
            humorFlavorStepId: step?.id ?? null,
            stepOrderBy: step?.orderBy ?? null,
            providerModelId: step?.providerModelId ?? null,
            temperature: step?.temperature ?? null,
            includeImage: step?.includeImage ?? null,
            systemPrompt: recoveredPrompt(step?.systemPrompt),
            userPrompt: recoveredPrompt(step?.userPrompt),
          }
          // A fan-out stored one FanResult per branch — keep them as separate
          // step rows, the same shape a live run writes.
          const branches = Array.isArray(value) ? value.filter(isFanResult) : []
          if (branches.length) {
            branches.forEach((b, i) =>
              records.push({ ...base, branchIndex: i, branchLabel: b.label, output: b.text })
            )
          } else {
            records.push({
              ...base,
              output: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
            })
          }
        }

        if (runImageId) {
          for (let i = 0; i < records.length; i += 8) {
            await saveOpsRunStepsAction({
              runId,
              runImageId,
              steps: records.slice(i, i + 8),
            }).catch(() => undefined)
          }
        }

        const finalValue = finalOp ? outputs[finalOp.key]?.[img.id] ?? null : null
        const { captions, warning } = finalCaptions(finalValue)
        const label = img.url.split('/').pop() ?? img.id
        if (warning) warnings.push(`${label}: ${warning}`)
        rows.push(
          ...quickStudyRows(captions, {
            imageUrl: img.url,
            flavorId,
            flavorName: flavorSlug,
            userId,
          })
        )
        items.push({
          imageId: img.id,
          imageUrl: img.url,
          captions,
          problem: warning,
        })

        if (runImageId) {
          await finishOpsRunImageAction({
            runImageId,
            status: captions.length ? 'done' : 'error',
            error: captions.length ? null : warning,
            outputs: overlay,
            finalOutput:
              typeof finalValue === 'string'
                ? finalValue
                : JSON.stringify(finalValue ?? null),
            captions,
          }).catch(() => undefined)
        }
      }

      setBatchExport(rows)
      setBatchWarnings(warnings)
      saveGallery(rows, items)
      await finishOpsRunAction({
        runId,
        status: 'done',
        exportJson: rows,
        exportWarning: warnings.length ? warnings.join('\n') : null,
        captionCount: rows.length,
      }).catch(() => undefined)
      setBatchMsg(
        `Archived ${targets.length} image${targets.length === 1 ? '' : 's'} — ${rows.length} captions saved.`
      )
    } finally {
      setArchiving(false)
    }
  }

  // Everything the browser still holds about these images, as one file. Saved
  // independently of the database, so the run is never one failed insert away
  // from being lost.
  const downloadFullRun = () => {
    const targets = archivableImages()
    const liveOps = OP_SPECS.filter((o) => !hidden.includes(o.key))
    const payload = {
      exportedAt: new Date().toISOString(),
      flavorId,
      flavorSlug,
      setSlug: activeSet?.slug ?? null,
      note:
        'Outputs recovered from the ops page store. Prompts are the step ' +
        'TEMPLATES — the resolved text sent to the model was not captured.',
      spec: runSpec(),
      images: targets.map((img) => ({
        imageId: img.id,
        imageUrl: img.url,
        outputs: Object.fromEntries(
          liveOps
            .filter((o) => outputs[o.key]?.[img.id] != null)
            .map((o) => [o.key, outputs[o.key][img.id]])
        ),
        ranAt: Object.fromEntries(
          liveOps
            .filter((o) => outputTimes[o.key]?.[img.id] != null)
            .map((o) => [o.key, new Date(outputTimes[o.key][img.id]).toISOString()])
        ),
        captions: finalCaptions(finalOp ? outputs[finalOp.key]?.[img.id] ?? null : null)
          .captions,
      })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${flavorSlug}-${activeSet?.slug ?? 'set'}-full-run.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const copyBatchExport = async () => {
    if (!batchExport) return
    await navigator.clipboard.writeText(JSON.stringify(batchExport, null, 2))
    setBatchMsg(`Copied ${batchExport.length} captions.`)
  }

  const downloadBatchExport = () => {
    if (!batchExport) return
    const blob = new Blob([JSON.stringify(batchExport, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${flavorSlug}-${activeSet?.slug ?? 'set'}-quick-study.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const card =
    'w-[400px] max-w-full rounded-xl border border-[rgb(var(--gloss)/0.5)] bg-[rgb(var(--panel)/0.85)] p-3 shadow-[0_20px_60px_-40px_rgb(var(--shadow))] dark:border-[rgb(var(--gloss)/0.12)] dark:bg-[rgb(var(--panel)/0.5)]'
  const chip =
    'rounded bg-[rgb(var(--primary)/0.12)] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[rgb(var(--accent-strong))]'
  const selectClass =
    'rounded-md border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.7)] px-2 py-1 text-[12px] text-[rgb(var(--ink))] outline-none focus:ring-1 focus:ring-[rgb(var(--primary))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.2)]'

  // Pulls a flat caption list out of an op's output, if it is joke-shaped:
  // an array of groups with jokes as strings or { caption } objects (S5's
  // format), or a plain array of caption strings. Null if not caption-like.
  const extractCaptions = (value: unknown): string[] | null => {
    const parsed = parseJsonLoose(value)
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    const captions: string[] = []
    for (const item of parsed) {
      if (typeof item === 'string') {
        captions.push(item)
      } else if (item && typeof item === 'object' && Array.isArray((item as { jokes?: unknown }).jokes)) {
        for (const j of (item as { jokes: unknown[] }).jokes) {
          if (typeof j === 'string') captions.push(j)
          else if (j && typeof j === 'object' && typeof (j as { caption?: unknown }).caption === 'string') {
            captions.push((j as { caption: string }).caption)
          }
        }
      }
    }
    return captions.length ? captions : null
  }

  // Derived data for the share panel: captions from the shared op's output
  // for the selected image (pinned value wins, same as the detail panel).
  const shareCaptions =
    shareKey && image
      ? extractCaptions(pinnedFor(shareKey, image.id) ?? outputs[shareKey]?.[image.id])
      : null

  // Captions from the last visible step's output for the selected image,
  // shown under the big preview (pinned value wins, same as the detail panel).
  const previewCaptions =
    finalOp && image
      ? finalCaptions(
          pinnedFor(finalOp.key, image.id) ??
            outputs[finalOp.key]?.[image.id] ??
            null
        ).captions
      : []

  // Derived data for the open detail panel.
  const detailOp = detailKey ? opByKey.get(detailKey) ?? null : null
  const detailStep =
    detailOp?.fromOrderBy != null
      ? stepByOrder.get(detailOp.fromOrderBy) ?? null
      : null
  const detailPinned =
    detailOp != null &&
    image != null &&
    pinnedFor(detailOp.key, image.id) !== undefined
  const detailResult = detailOp
    ? detailPinned
      ? pinnedFor(detailOp.key, image!.id)
      : image
        ? outputs[detailOp.key]?.[image.id]
        : undefined
    : undefined
  const detailCanPin =
    detailOp != null &&
    !detailPinned &&
    image != null &&
    outputs[detailOp.key]?.[image.id] != null
  const detailLabel = 'text-[11px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]'
  const detailPre =
    'mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-[rgb(var(--panel)/0.6)] p-3 font-mono text-[11px] leading-relaxed text-[rgb(var(--ink))] dark:bg-[rgb(var(--panel)/0.25)]'
  // Prompt boxes get a visible border so they read as distinct blocks.
  const detailPromptPre = `${detailPre} border border-[rgb(var(--gloss)/0.4)] dark:border-[rgb(var(--gloss)/0.2)]`
  // A prompt is editable in place when it really is the flavor step's own text:
  // not an inline spec prompt, and not transformed into slot names by rewrites
  // (editing rewritten text would save slot names into the DB step).
  const detailPromptsEditable =
    detailOp != null &&
    detailStep != null &&
    Object.keys(detailOp.rewrites).length === 0

  // Build the ordered pipeline trace for one ranked joke: shared upstream steps
  // (same for every joke from this image) come from `outputs`; the branch-specific
  // steps come from the joke itself (its reaction, caption, and per-op evidence).
  const traceStages = (
    joke: RankedJoke
  ): {
    opKey: string | null
    title: string
    scope: string
    body: string
    image?: string
  }[] => {
    const shared = (opKey: string) =>
      image ? outputs[opKey]?.[image.id] : undefined
    const asText = (v: unknown) =>
      typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v, null, 2)
    return [
      { opKey: null, title: 'Image', scope: 'input', body: '(no image selected)', image: image?.url ?? undefined },
      { opKey: 'recognize', title: 'Image recognition', scope: 'shared', body: asText(shared('recognize')) },
      { opKey: 'describe', title: 'Scene description', scope: 'shared', body: asText(shared('describe')) },
      { opKey: 'toneCeleb', title: 'Emotional tone', scope: 'shared', body: asText(shared('toneCeleb')) },
      { opKey: 'relevant', title: 'Relevant moments', scope: 'shared', body: asText(shared('relevant')) },
      { opKey: 'focus', title: 'Chosen moment + focus', scope: 'this joke', body: `focus: ${joke?.focus ?? 'unknown'}\n\n${joke?.moment ?? ''}` },
      { opKey: 'reaction', title: 'Reaction', scope: 'this joke', body: joke?.reaction || '(not recorded — re-run “Collect all jokes”)' },
      { opKey: 'caption', title: 'Caption', scope: 'this joke', body: joke?.caption ?? '' },
      { opKey: 'alignment', title: 'Alignment analysis', scope: 'this joke', body: asText(joke?.evidence?.alignment) },
      { opKey: 'refClarity', title: 'Reference clarity', scope: 'this joke', body: asText(joke?.evidence?.reference_clarity) },
      { opKey: 'refRecover', title: 'Reference recoverability', scope: 'this joke', body: asText(joke?.evidence?.reference_recoverability) },
      { opKey: null, title: 'Final ranking', scope: 'result', body: asText({ rank: joke?.rank, status: joke?.status, focused_alignment: joke?.focused_alignment, scores: joke?.scores }) },
    ]
  }

  // The prompt (system + user + append) an op ran with — used to give the joke
  // diagnosis the full per-step reasoning material, not just outputs.
  const promptForOp = (opKey: string | null): string => {
    if (!opKey) return ''
    const op = opByKey.get(opKey)
    if (!op) return ''
    if (op.kind === 'transform')
      return op.note ? `Code transform.\n${op.note}` : 'Code transform (no prompt).'
    const s = op.fromOrderBy != null ? stepByOrder.get(op.fromOrderBy) : undefined
    const sys = op.systemPrompt ?? (s ? applyRewrites(s.systemPrompt, op.rewrites) : '')
    const usr =
      (op.userPrompt ?? (s ? applyRewrites(s.userPrompt, op.rewrites) : '')) +
      (op.appendUserPrompt ?? '')
    return `SYSTEM:\n${sys}\n\nUSER:\n${usr}`
  }

  return (
    <div className="flex items-start gap-4">
      {/* Left nav — jump to any step */}
      <nav className="sticky top-4 hidden max-h-[calc(100vh-2rem)] w-56 shrink-0 flex-col overflow-auto rounded-xl border border-[rgb(var(--gloss)/0.5)] bg-[rgb(var(--panel)/0.85)] p-2 lg:flex dark:border-[rgb(var(--gloss)/0.12)] dark:bg-[rgb(var(--panel)/0.5)]">
        <button
          type="button"
          onClick={runAll}
          disabled={!image || runningAll}
          title="Run every non-hidden step in order (each depends on the one before it)"
          className="mb-1 flex w-full items-center justify-center gap-2 rounded-md bg-[rgb(var(--primary))] px-2 py-2 text-[12px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {runningAll ? '⏳ Running all…' : '▶ Run all'}
        </button>
        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
          Steps
        </p>
        {OP_SPECS.map((op, i) => {
          const isHidden = hidden.includes(op.key)
          const navRs = runState[op.key]?.status ?? 'idle'
          const lane = lanes.get(op.key)
          return (
            <button
              key={op.key}
              type="button"
              onClick={() =>
                document
                  .getElementById(`op-${op.key}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
              // Members of a read lane indent under their read; the merge lane
              // ("all reads") sits back at full width.
              style={lane && lane.kind === 'read' && !lane.isRoot ? { paddingLeft: 18 } : undefined}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition hover:bg-[rgb(var(--primary)/0.12)] hover:text-[rgb(var(--ink))] ${
                navRs === 'loading'
                  ? 'animate-pulse bg-[rgb(var(--primary)/0.18)] font-semibold text-[rgb(var(--ink))]'
                  : 'text-[rgb(var(--muted))]'
              }`}
            >
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: lane?.color ?? 'transparent' }}
                title={lane?.title}
              />
              <span className="font-mono text-[10px] opacity-50">{i + 1}</span>
              <span className={`flex-1 truncate ${isHidden ? 'opacity-50' : ''}`}>
                {op.title}
              </span>
              {navRs === 'loading' ? (
                <span className="shrink-0" title="Running">
                  ⏳
                </span>
              ) : navRs === 'error' ? (
                <span className="shrink-0" title={runState[op.key]?.error ?? 'Failed'}>
                  ⚠️
                </span>
              ) : isHidden ? (
                <span className="text-[8px] uppercase tracking-[0.15em] opacity-60">
                  hidden
                </span>
              ) : null}
            </button>
          )
        })}
      </nav>

      {/* Main column: image picker + the operations */}
      <div className="min-w-0 flex-1 space-y-3">
      {/* Run all — small screens only: the left nav (which holds the primary
          button) is display:hidden below lg, so this sticky bar keeps the
          button reachable at the top of the viewport. */}
      <div className="sticky top-2 z-40 lg:hidden">
        <button
          type="button"
          onClick={runAll}
          disabled={!image || runningAll}
          title="Run every non-hidden step in order (each depends on the one before it)"
          className="flex w-full items-center justify-center gap-2 rounded-md bg-[rgb(var(--primary))] px-2 py-2 text-[12px] font-semibold text-white shadow-[0_10px_30px_-12px_rgb(var(--shadow))] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {runningAll ? '⏳ Running all…' : '▶ Run all'}
        </button>
      </div>
      {/* Image picker */}
      <div className="w-full max-w-4xl rounded-xl border border-[rgb(var(--gloss)/0.5)] bg-[rgb(var(--panel)/0.85)] p-3 shadow-[0_20px_60px_-40px_rgb(var(--shadow))] dark:border-[rgb(var(--gloss)/0.12)] dark:bg-[rgb(var(--panel)/0.5)]">
        <div className="flex flex-col gap-4 md:flex-row">
          {/* Left: set select + thumbnails */}
          <div className="min-w-0 md:w-[360px] md:shrink-0">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
                Run against image
              </span>
              <select
                className={selectClass}
                value={setId}
                onChange={(e) => {
                  const id = Number(e.target.value)
                  setSetId(id)
                  const first = imageSets.find((s) => s.id === id)?.images[0]?.id ?? ''
                  setImageId(first)
                  setBatchIds([]) // ticks belong to the set they were made in
                }}
              >
                {imageSets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.slug}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={loadHarnessRun}
                disabled={harnessLoading}
                title="Fill every step with the cached outputs from the context-recovery-harness run (dev only)"
                className="ml-auto rounded-md border border-[rgb(var(--gloss)/0.6)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] disabled:opacity-50 dark:border-[rgb(var(--gloss)/0.15)]"
              >
                {harnessLoading ? '⏳ Loading…' : '⤓ Harness run'}
              </button>
              {image && harnessCast[image.id]?.length ? (
                <button
                  type="button"
                  onClick={() => setCastPanelOpen(true)}
                  title="Structural cast-classifier results for this image's captions (from the harness run)"
                  className="rounded-md border border-[rgb(var(--gloss)/0.6)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)]"
                >
                  🎭 Cast check
                </button>
              ) : null}
              <button
                type="button"
                onClick={clearSaved}
                className="rounded-md border border-[rgb(var(--gloss)/0.6)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)]"
              >
                Clear saved
              </button>
            </div>
            <p className="mt-1 text-[10px] text-[rgb(var(--muted))]">
              Generated outputs are saved in this browser and restored on reload.
            </p>
            {harnessMsg ? (
              <p className="mt-1 text-[10px] text-[rgb(var(--accent-strong))]">
                {harnessMsg}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {(activeSet?.images ?? []).map((img) => {
                // 📌 badge: this image has a pinned "Recognize content" output.
                const hasRecognizePin =
                  pinned.recognize != null && img.id in pinned.recognize
                const ticked = batchIds.includes(img.id)
                return (
                  <div key={img.id} className="relative h-16 w-16">
                    <button
                      type="button"
                      onClick={() => setImageId(img.id)}
                      className={`h-16 w-16 overflow-hidden rounded-lg border-2 transition ${
                        img.id === imageId
                          ? 'border-[rgb(var(--primary))]'
                          : 'border-transparent opacity-70 hover:opacity-100'
                      }`}
                      title={
                        hasRecognizePin
                          ? 'Recognize content is pinned for this image'
                          : undefined
                      }
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url} alt="" className="h-full w-full object-cover" />
                    </button>
                    {hasRecognizePin ? (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute right-0.5 top-0.5 rounded bg-[rgb(var(--panel)/0.9)] px-0.5 text-[10px] leading-none shadow"
                      >
                        📌
                      </span>
                    ) : null}
                    {/* Batch tick — selects this image for "Run batch". */}
                    <button
                      type="button"
                      onClick={() =>
                        setBatchIds((prev) =>
                          prev.includes(img.id)
                            ? prev.filter((id) => id !== img.id)
                            : [...prev, img.id]
                        )
                      }
                      title={ticked ? 'Remove from batch' : 'Add to batch'}
                      className={`absolute left-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded border text-[10px] leading-none shadow transition ${
                        ticked
                          ? 'border-[rgb(var(--primary))] bg-[rgb(var(--primary))] text-white'
                          : 'border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.9)] text-transparent hover:text-[rgb(var(--muted))]'
                      }`}
                    >
                      ✓
                    </button>
                  </div>
                )
              })}
            </div>
            {/* Batch bar: run the whole pipeline over every ticked image. */}
            <div className="mt-3 rounded-lg border border-[rgb(var(--gloss)/0.5)] bg-[rgb(var(--panel)/0.5)] p-2 dark:border-[rgb(var(--gloss)/0.15)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold text-[rgb(var(--muted))]">
                  Batch: {batchIds.length} selected
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setBatchIds((activeSet?.images ?? []).map((i) => i.id))
                  }
                  className="rounded-md border border-[rgb(var(--gloss)/0.6)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)]"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setBatchIds([])}
                  className="rounded-md border border-[rgb(var(--gloss)/0.6)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)]"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={runBatch}
                  disabled={!batchIds.length || batchRunning || runningAll}
                  title="Run every non-hidden step on each ticked image, save the run, and build the Quick Study export from the final step"
                  className="ml-auto rounded-md bg-[rgb(var(--primary))] px-2 py-1 text-[11px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {batchRunning
                    ? `⏳ ${batchDone}/${batchIds.length}…`
                    : `▶ Run batch (${batchIds.length})`}
                </button>
                <a
                  href={`/humor-flavor/${flavorId}/ops/runs`}
                  className="rounded-md border border-[rgb(var(--gloss)/0.6)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)]"
                >
                  Saved runs →
                </a>
                <a
                  href={`/humor-flavor/${flavorId}/ops2${ops2Search}`}
                  title="Open this set, run, and image in the Flavor Inspector (ops2) trace view"
                  className="rounded-md border border-[rgb(var(--gloss)/0.6)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)]"
                >
                  Open in Flavor Inspector (ops2) →
                </a>
              </div>
              {/* Rescue a run that finished without being archived: every step's
                  output is still in the outputs store. */}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={archiveExisting}
                  disabled={archiving || batchRunning}
                  title="Downloads the full run JSON first, then saves the outputs already on this page as a run. Prompts are saved as templates, since the resolved text wasn't captured."
                  className="rounded-md border border-[rgb(var(--gloss)/0.6)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--accent-strong))] transition hover:brightness-110 disabled:opacity-40 dark:border-[rgb(var(--gloss)/0.15)]"
                >
                  {archiving ? '⏳ Archiving…' : '⇪ Archive outputs already on this page'}
                </button>
                <button
                  type="button"
                  onClick={downloadFullRun}
                  title="Download every stored output for these images as one JSON file"
                  className="rounded-md border border-[rgb(var(--gloss)/0.6)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)]"
                >
                  ⤓ Full run JSON
                </button>
              </div>
              {batchMsg ? (
                <p className="mt-1 text-[10px] text-[rgb(var(--accent-strong))]">
                  {batchMsg}
                </p>
              ) : null}
              {batchWarnings.length ? (
                <div className="mt-1 rounded border border-amber-500/40 bg-amber-500/10 p-1.5">
                  <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                    ⚠ The final step ({finalOp?.title ?? '—'}) didn’t output a clean
                    caption list for every image:
                  </p>
                  <ul className="mt-0.5 list-disc pl-4 text-[10px] text-amber-700 dark:text-amber-300">
                    {batchWarnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {batchExport ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold text-[rgb(var(--muted))]">
                    {batchExport.length} caption
                    {batchExport.length === 1 ? '' : 's'} exported
                  </span>
                  <button
                    type="button"
                    onClick={copyBatchExport}
                    className="rounded-md border border-[rgb(var(--gloss)/0.6)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)]"
                  >
                    Copy JSON
                  </button>
                  <button
                    type="button"
                    onClick={downloadBatchExport}
                    className="rounded-md border border-[rgb(var(--gloss)/0.6)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)]"
                  >
                    ⤓ Download
                  </button>
                  <a
                    // The saved run's own page when this batch reached the
                    // database; otherwise the browser-local view of it.
                    href={
                      batchRunId
                        ? `/humor-flavor/${flavorId}/ops/gallery/${batchRunId}`
                        : `/humor-flavor/${flavorId}/ops/gallery`
                    }
                    target="_blank"
                    rel="noreferrer"
                    title="See every image with the captions this batch produced"
                    className="rounded-md border border-[rgb(var(--gloss)/0.6)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--accent-strong))] transition hover:brightness-110 dark:border-[rgb(var(--gloss)/0.15)]"
                  >
                    🖼 View images + captions
                  </a>
                  {batchRunId ? (
                    <a
                      href={`/humor-flavor/${flavorId}/ops/runs/${batchRunId}`}
                      className="rounded-md border border-[rgb(var(--gloss)/0.6)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)]"
                    >
                      View this run →
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {/* Right: big preview of the selected image + its URL */}
          {image ? (
            <div className="min-w-0 flex-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt="selected image"
                className="max-h-72 w-auto max-w-full rounded-lg border border-[rgb(var(--gloss)/0.4)] object-contain dark:border-[rgb(var(--gloss)/0.12)]"
              />
              {previewCaptions.length ? (
                <div className="mt-3">
                  <ul className="space-y-1">
                    {previewCaptions.map((c, i) => (
                      <li
                        key={i}
                        className="rounded-md bg-[rgb(var(--panel)/0.6)] px-2 py-1 text-[12px] leading-snug text-[rgb(var(--ink))] dark:bg-[rgb(var(--panel)/0.25)]"
                      >
                        {c}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))] opacity-60">
                    Captions — {finalOp?.title}
                  </p>
                </div>
              ) : null}
              <div className="mt-3 opacity-60">
                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
                  Image URL
                </p>
                <div className="mt-1 flex items-start gap-2">
                  <a
                    href={image.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 break-all rounded-md bg-[rgb(var(--panel)/0.6)] px-2 py-1 font-mono text-[10px] leading-snug text-[rgb(var(--muted))] hover:underline dark:bg-[rgb(var(--panel)/0.25)]"
                  >
                    {image.url}
                  </a>
                  <CopyButton text={image.url} label="Copy URL" />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <BulkModelSelect models={models} disabled={runningAll || batchRunning || Object.values(runState).some((state) => state.status === 'loading')}
        onApply={setAllStepsModel} description="Use one model for all LLM steps in this experiment, including steps with their own model overrides. Pinned values are kept. Save permanent model choices on the flavor page." />
      {allStepsModel ? <button type="button" className="text-xs underline" disabled={runningAll || batchRunning || Object.values(runState).some((state) => state.status === 'loading')} onClick={() => setAllStepsModel(null)}>Restore configured models</button> : null}

      {/* Operations stacked down the page; each row is the card (left) with its
          output(s) to the right. A fan-out renders one column per branch.
          Hidden ops collapse in place to a small bar. */}
      <div className="space-y-3">
        {OP_SPECS.map((op) => {
        const lane = lanes.get(op.key)
        if (hidden.includes(op.key)) {
          return (
            <div
              key={op.key}
              id={`op-${op.key}`}
              style={lane ? { borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: lane.color } : undefined}
              className="flex w-[400px] max-w-full scroll-mt-4 items-center gap-2 rounded-lg border border-dashed border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.4)] px-3 py-1.5 dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.15)]"
            >
              <span className="truncate text-xs font-semibold text-[rgb(var(--muted))]">
                {op.title}
              </span>
              <span className="text-[10px] uppercase tracking-[0.15em] text-[rgb(var(--muted))]">
                hidden
              </span>
              <button
                type="button"
                onClick={() => toggleHidden(op.key)}
                className="ml-auto rounded-md border border-[rgb(var(--gloss)/0.6)] px-2 py-0.5 text-[11px] font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.2)]"
                title="Show this step"
              >
                show
              </button>
            </div>
          )
        }
        const idx = opIndex(op.key)
        const isPinned = image != null && pinnedFor(op.key, image.id) !== undefined
        const rs = runState[op.key] ?? { status: 'idle' }
        const step =
          op.fromOrderBy != null ? stepByOrder.get(op.fromOrderBy) : undefined
        const takesImage =
          op.kind !== 'transform' && Boolean(op.includeImage ?? step?.includeImage)
        const upstream = OP_SPECS.slice(0, idx)
        const result = isPinned
          ? pinnedFor(op.key, image!.id)
          : image
            ? outputs[op.key]?.[image.id]
            : undefined
        const canPin =
          !isPinned && image != null && outputs[op.key]?.[image.id] != null
        const ranAt = image ? outputTimes[op.key]?.[image.id] : undefined
        const runLabel =
          rs.status === 'loading'
            ? 'Running…'
            : op.kind === 'transform'
              ? 'Run (code)'
              : op.fanOutOver
                ? 'Run (per item)'
                : 'Run operation'

        return (
          <div key={op.key} id={`op-${op.key}`} className="flex scroll-mt-4 items-stretch gap-3">
          <div
            onClick={() => setDetailKey(op.key)}
            style={
              lane && !isPinned
                ? { borderLeftWidth: 3, borderLeftColor: lane.color }
                : undefined
            }
            className={`${card} relative shrink-0 cursor-pointer transition hover:border-[rgb(var(--primary)/0.6)] hover:shadow-[0_24px_70px_-40px_rgb(var(--primary-deep)/0.7)] ${
              isPinned
                ? 'border-2 border-amber-500 dark:border-amber-400'
                : ''
            }`}
          >
            <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setJokesKey(op.key)
                }}
                className="rounded-md border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel))] px-2 py-0.5 text-[11px] font-semibold text-[rgb(var(--muted))] shadow-sm transition hover:border-[rgb(var(--accent-strong))] hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.2)]"
                title="Show this step's captions with the image (screenshot view)"
              >
                jokes
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setStudyJsonCopied(false)
                  setStudyJsonKey(op.key)
                }}
                className="rounded-md border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel))] px-2 py-0.5 text-[11px] font-semibold text-[rgb(var(--muted))] shadow-sm transition hover:border-[rgb(var(--accent-strong))] hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.2)]"
                title="Show this step's captions as Quick Study JSON (image_id + caption + flavor/user rows) — view/copy only, not a step output"
              >
                study json
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleHidden(op.key)
                }}
                className="rounded-md border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel))] px-2 py-0.5 text-[11px] font-semibold text-[rgb(var(--muted))] shadow-sm transition hover:border-[rgb(var(--accent-strong))] hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.2)]"
                title="Hide this step"
              >
                hide
              </button>
            </div>
            {isPinned ? (
              <div className="mb-2 -mt-1 flex items-center gap-2 rounded-md bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                <span aria-hidden>📌</span>
                <span>DEFAULT OUTPUT for this image — won’t regenerate</span>
              </div>
            ) : null}
            <div className="flex flex-wrap items-start justify-between gap-2 pr-24">
              <div>
                {lane ? (
                  <span
                    className="mb-1 inline-block rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.15em]"
                    style={{ backgroundColor: `${lane.color}22`, color: lane.color }}
                    title={lane.title}
                  >
                    {lane.label}
                  </span>
                ) : null}
                <h3 className="text-sm font-semibold leading-tight">{op.title}</h3>
                <p className="mt-0.5 max-w-xl text-xs leading-snug text-[rgb(var(--muted))]">
                  {op.description}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-right font-mono text-[10px] text-[rgb(var(--muted))]">
                  {op.kind === 'transform'
                    ? 'code transform'
                    : allStepsModel?.provider_model_id ?? op.providerModelId ?? step?.providerModelId ?? 'no model'}
                  {op.kind === 'transform' ? null : (
                    <>
                      <br />
                      temp:{' '}
                      {allStepsModel && !allStepsModel.is_temperature_supported ? 'n/a' : op.temperature != null
                        ? op.temperature
                        : (allStepsModel?.is_temperature_supported ?? step?.isTemperatureSupported)
                          ? step?.temperature ?? 0.7
                          : 'n/a'}
                    </>
                  )}
                  {op.fanOutOver ? (
                    <>
                      <br />
                      <span className="text-[rgb(var(--accent-strong))]">
                        ⑂ per ${`{${op.fanOutOver}}`}
                      </span>
                    </>
                  ) : null}
                  {takesImage ? (
                    <>
                      <br />
                      <span className="text-[rgb(var(--primary))]">takes image: yes</span>
                    </>
                  ) : null}
                </span>
                {takesImage && image ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.url}
                      alt="input image"
                      className="h-12 w-12 rounded-md border border-[rgb(var(--gloss)/0.5)] object-cover dark:border-[rgb(var(--gloss)/0.2)]"
                    />
                  </>
                ) : null}
              </div>
            </div>

            {op.note ? (
              <pre className="mt-2 whitespace-pre-wrap rounded-md border border-[rgb(var(--primary)/0.4)] bg-[rgb(var(--primary)/0.08)] p-2 font-sans text-[11px] leading-snug text-[rgb(var(--ink))]">
                {op.note}
              </pre>
            ) : null}

            {/* INPUTS — the wire list */}
            <div className="mt-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
                Inputs
              </p>
              <div className="mt-1 space-y-1">
                {op.inputs.length === 0 ? (
                  <p className="rounded-md bg-[rgb(var(--panel)/0.5)] px-2 py-1 text-xs text-[rgb(var(--muted))] dark:bg-[rgb(var(--panel)/0.2)]">
                    none — reads the image directly
                  </p>
                ) : null}
                {op.inputs.map((inp) => {
                  const b = bindings[op.key]?.[inp.slot] ?? inp.binding
                  const isFixed = isServerResolved(inp.binding)
                  return (
                    <div
                      key={inp.slot}
                      className="rounded-md bg-[rgb(var(--panel)/0.5)] px-2 py-1 dark:bg-[rgb(var(--panel)/0.2)]"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <code className={chip}>${`{${inp.slot}}`}</code>
                        {inp.optional ? (
                          <span className="rounded bg-[rgb(var(--panel)/0.7)] px-1 py-0.5 text-[9px] font-semibold uppercase tracking-[0.15em] text-[rgb(var(--muted))] dark:bg-[rgb(var(--panel)/0.3)]">
                            optional
                          </span>
                        ) : null}
                        <span className="text-xs text-[rgb(var(--muted))]">
                          {inp.description}
                        </span>
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-1 text-xs">
                        <span className="shrink-0 text-[rgb(var(--muted))]">
                          ◀ bound to
                        </span>
                        {isFixed ? (
                          <>
                            <label
                              className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-[rgb(var(--ink))]"
                              onClick={(e) => e.stopPropagation()}
                              title={`Unchecked: ${'${' + inp.slot + '}'} is sent as an empty string`}
                            >
                              <input
                                type="checkbox"
                                checked={b.kind !== 'off'}
                                onChange={(e) =>
                                  setBinding(op.key, inp.slot, e.target.checked ? inp.binding : { kind: 'off' })
                                }
                              />
                              send
                            </label>
                            <select
                              className={`${selectClass} min-w-0 flex-1`}
                              value={b.kind === 'off' ? encodeBinding(inp.binding) : encodeBinding(b)}
                              disabled={b.kind === 'off'}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                setBinding(op.key, inp.slot, decodeBinding(e.target.value, clusterings))
                              }
                              title="Where this slot's text comes from"
                            >
                              <option value={encodeBinding(inp.binding)}>
                                {bindingLabel(inp.binding)}
                              </option>
                              <optgroup label="Saved Sidechat clusterings">
                                {clusterings.map((c) => (
                                  <option key={c.id} value={`clustering:${c.id}`}>
                                    {clusteringOptionLabel(c)}
                                  </option>
                                ))}
                                {clusterings.length === 0 ? (
                                  <option value="__none" disabled>
                                    {clusteringsNote ?? 'loading…'}
                                  </option>
                                ) : null}
                              </optgroup>
                            </select>
                            <a
                              href={b.kind === 'clustering' ? '/sidechat-events' : '/sidechat-topics'}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="shrink-0 text-[11px] font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                              title={
                                b.kind === 'clustering'
                                  ? 'Open the saved-clusterings archive this slot reads from'
                                  : 'Browse clustered raw Sidechat posts — the source material behind these contexts'
                              }
                            >
                              {b.kind === 'clustering' ? 'Sidechat events ↗' : 'Sidechat topics ↗'}
                            </a>
                          </>
                        ) : (
                          <select
                            className={`${selectClass} min-w-0 flex-1`}
                            value={encodeBinding(b)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              setBinding(op.key, inp.slot, decodeBinding(e.target.value))
                            }
                          >
                            <optgroup label="Upstream operations">
                              {upstream.map((u) => (
                                <option key={u.key} value={`op:${u.key}`}>
                                  {u.title} → {u.output.name}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="Built-in image fields">
                              {IMAGE_FIELDS.map((f) => (
                                <option key={f.field} value={`image:${f.field}`}>
                                  {f.label}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* OUTPUT */}
            <div className="mt-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
                Output
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <code className={chip}>${`{${op.output.name}}`}</code>
                {op.output.isList ? (
                  <span className="rounded bg-[rgb(var(--accent-strong)/0.15)] px-1 py-0.5 font-mono text-[9px] font-semibold text-[rgb(var(--accent-strong))]">
                    list
                  </span>
                ) : null}
                <span className="text-[rgb(var(--muted))]">
                  {op.output.description}
                </span>
              </div>
            </div>

            {image ? <ManualStepValue key={`${op.key}:${image.id}:${isPinned}`} initial={result == null ? '' : stringifyResult(result)}
              disabled={rs.status === 'loading' || runningAll || batchRunning}
              onApply={(text) => savePinnedText(op.key, text)}
              onClear={isPinned ? () => unpinOutput(op.key) : undefined} /> : null}

            {/* RUN / PIN */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {isPinned ? (
                <>
                  <span className="rounded-md bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                    using pinned default
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      unpinOutput(op.key)
                    }}
                    className="rounded-md border border-amber-500/60 px-2.5 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-300"
                    title="Unpin (this image) — let the step regenerate again"
                  >
                    Unpin
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDetailKey(op.key)
                    }}
                    className="text-xs font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                    title="Edit the default output in the side panel"
                  >
                    edit default ▸
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleRun(op)
                    }}
                    disabled={rs.status === 'loading' || !image}
                    className="rounded-md bg-[rgb(var(--primary))] px-2.5 py-1 text-xs font-semibold text-[rgb(var(--on-primary))] transition hover:brightness-110 disabled:opacity-50"
                  >
                    {runLabel}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      void runFrom(idx)
                    }}
                    disabled={rs.status === 'loading' || runningAll || !image}
                    className="rounded-md border border-[rgb(var(--primary)/0.6)] px-2.5 py-1 text-xs font-semibold text-[rgb(var(--accent-strong))] transition hover:bg-[rgb(var(--primary)/0.1)] disabled:opacity-50"
                    title="Run this step, then every non-hidden step after it, in order (earlier steps keep their existing outputs)"
                  >
                    ▶▶ Run to end
                  </button>
                  {canPin ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        pinOutput(op.key)
                      }}
                      className="rounded-md border border-amber-500/60 px-2.5 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-300"
                      title="Make this the default output for THIS image — stops regenerating it; downstream steps use it"
                    >
                      📌 Make default
                    </button>
                  ) : null}
                  {rs.status === 'error' ? (
                    <span className="text-xs text-[rgb(var(--accent-strong))]">
                      {rs.error}
                    </span>
                  ) : null}
                  {ranAt != null && rs.status !== 'loading' ? (
                    <span
                      className="ml-auto font-mono text-[10px] text-[rgb(var(--muted))]"
                      title="When this result was generated"
                    >
                      {fmtRanAt(ranAt)}
                    </span>
                  ) : null}
                </>
              )}
              {image &&
              extractCaptions(
                pinnedFor(op.key, image.id) ?? outputs[op.key]?.[image.id]
              ) ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setShareKey(op.key)
                  }}
                  className="rounded-md border border-[rgb(var(--primary)/0.5)] px-2.5 py-1 text-xs font-semibold text-[rgb(var(--primary))] transition hover:bg-[rgb(var(--primary)/0.08)]"
                  title="Numbered captions above the image, ready to share"
                >
                  🖼 View formatted captions
                </button>
              ) : null}
            </div>
            </div>

            {/* Output(s) to the right of the card; fan-out → N columns */}
            <div className="min-w-0 flex-1">
              {isPinned ? (
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-600 dark:text-amber-400">
                  <span aria-hidden>📌</span>
                  <span>pinned default output</span>
                </div>
              ) : null}
              {renderOutputs(op, result, isPinned ? 'done' : rs.status, (k) => {
                setTraceJoke(null)
                setDetailKey(k)
              }, (joke) => {
                setDetailKey(null)
                setTraceStep(0)
                setTraceJoke(joke)
              })}
            </div>
          </div>
          )
        })}
      </div>
      </div>

      {/* Cast-check sidebar: per-caption structural cast-classifier results
          recovered from the harness run (figures → candidate entities, code
          verdict, and the human rating where one exists). */}
      {castPanelOpen && image && harnessCast[image.id]?.length
        ? (() => {
            const cards = harnessCast[image.id]
            const bandName: Record<string, string> = {
              '1': 'got it',
              '0.5': 'partly',
              '0': 'lost',
            }
            return (
              <div
                className="fixed inset-0 z-50 flex justify-end bg-[rgb(var(--shadow)/0.2)]"
                onMouseDown={() => setCastPanelOpen(false)}
              >
                <aside
                  className="flex h-screen w-[640px] max-w-[90vw] flex-col border-l border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.98)] p-5 shadow-[0_0_80px_-20px_rgb(var(--primary-deep)/0.5)] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--ambient-base-1)/0.98)]"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[rgb(var(--ink))]">
                        Structural cast check · {cards.length} captions
                      </h3>
                      <p className="mt-0.5 text-[11px] text-[rgb(var(--muted))]">
                        {harnessJudgeModel ?? 'judge'} enumerates figures +
                        candidate entities; code computes the verdict (orphan /
                        ambiguous / unplaceable / collision / cardinality).
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCastPanelOpen(false)}
                      className="rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-3 py-1 text-xs font-semibold text-[rgb(var(--accent-strong))] transition hover:-translate-y-0.5 dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.1)]"
                    >
                      Close
                    </button>
                  </div>
                  <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                    {cards.map((c) => (
                      <div
                        key={c.id}
                        className="rounded-xl border border-[rgb(var(--gloss)/0.5)] bg-[rgb(var(--panel)/0.7)] p-3 dark:border-[rgb(var(--gloss)/0.12)]"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-[rgb(var(--primary)/0.12)] px-2 py-0.5 font-mono text-[10px] text-[rgb(var(--accent-strong))]">
                            {c.register}
                          </span>
                          <span className="font-mono text-[10px] text-[rgb(var(--muted))]">
                            S{c.stepOrderBy}
                          </span>
                          {c.verdict == null ? (
                            <span className="rounded-full bg-[rgb(var(--muted)/0.15)] px-2 py-0.5 text-[10px] font-bold text-[rgb(var(--muted))]">
                              NOT JUDGED
                            </span>
                          ) : c.verdict.pass === false ? (
                            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-600 dark:text-red-400">
                              FAIL
                            </span>
                          ) : c.verdict.pass === true ? (
                            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                              PASS
                            </span>
                          ) : (
                            <span className="rounded-full bg-[rgb(var(--muted)/0.15)] px-2 py-0.5 text-[10px] font-bold text-[rgb(var(--muted))]">
                              NO PARSE
                            </span>
                          )}
                          {c.human != null ? (
                            <span
                              title="Your blind rating from the eval page"
                              className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400"
                            >
                              you: {bandName[String(c.human)] ?? c.human}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1.5 text-sm font-medium leading-snug text-[rgb(var(--ink))]">
                          {c.caption}
                        </p>
                        {c.humanNote ? (
                          <p className="mt-1 border-l-2 border-amber-500/60 pl-2 text-[11px] text-amber-700 dark:text-amber-400">
                            your note: {c.humanNote}
                          </p>
                        ) : null}
                        {c.verdict?.pass === false && c.verdict.reasons.length ? (
                          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] text-red-600 dark:text-red-400">
                            {c.verdict.reasons.map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        ) : null}
                        {c.judge?.figures?.length ? (
                          <div className="mt-2 text-[11px] text-[rgb(var(--muted))]">
                            <p className="font-semibold uppercase tracking-[0.15em] text-[10px]">
                              figure → candidates
                            </p>
                            <ul className="mt-0.5 space-y-0.5">
                              {c.judge.figures.map((f, i) => (
                                <li key={i}>
                                  <span className="text-[rgb(var(--ink))]">
                                    {f.anchor}
                                  </span>{' '}
                                  →{' '}
                                  {f.candidates?.length
                                    ? f.candidates.join(' / ')
                                    : '(nobody)'}
                                </li>
                              ))}
                            </ul>
                            <p className="mt-1">
                              expected in frame:{' '}
                              {c.judge.entities_expected_in_image?.join(', ') ||
                                '—'}
                            </p>
                          </div>
                        ) : null}
                        {c.judgeRaw ? (
                          <details className="mt-1.5">
                            <summary className="cursor-pointer text-[10px] text-[rgb(var(--muted))]">
                              raw classifier JSON
                            </summary>
                            <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-[rgb(var(--ambient-base-1)/0.06)] p-2 font-mono text-[10px] leading-relaxed text-[rgb(var(--muted))] dark:bg-[rgb(var(--gloss)/0.06)]">
                              {c.judgeRaw}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </aside>
              </div>
            )
          })()
        : null}

      {/* Jokes sidebar: the image + this op's captions, made for screenshots. */}
      {jokesKey
        ? (() => {
            const op = opByKey.get(jokesKey)
            const value = image
              ? pinnedFor(jokesKey, image.id) ?? outputs[jokesKey]?.[image.id]
              : undefined
            const jokes = extractJokes(value)
            return (
              <div
                className="fixed inset-0 z-50 flex justify-end bg-[rgb(var(--shadow)/0.2)]"
                onMouseDown={() => setJokesKey(null)}
              >
                <aside
                  className="flex h-screen w-[560px] max-w-[90vw] flex-col border-l border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.98)] p-5 shadow-[0_0_80px_-20px_rgb(var(--primary-deep)/0.5)] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--ambient-base-1)/0.98)]"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold text-[rgb(var(--ink))]">
                      Jokes · {op?.title ?? jokesKey}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setJokesKey(null)}
                      className="rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-3 py-1 text-xs font-semibold text-[rgb(var(--accent-strong))] transition hover:-translate-y-0.5 dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.1)]"
                    >
                      Close
                    </button>
                  </div>
                  <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
                    {jokes.length ? (
                      <ol className="space-y-0.5">
                        {jokes.map((j, i) => (
                          <li
                            key={i}
                            className="flex gap-2 text-sm leading-snug text-[rgb(var(--ink))]"
                          >
                            <span className="shrink-0 font-mono text-[11px] text-[rgb(var(--muted))]">
                              {i + 1}.
                            </span>
                            <span className="min-w-0 font-medium">
                              {j.caption}
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-sm text-[rgb(var(--muted))]">
                        No captions found in this step&apos;s output for the
                        selected image — run the step first.
                      </p>
                    )}
                    {image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={image.url}
                        alt="Meme"
                        className="mt-3 w-full rounded-xl object-contain"
                      />
                    ) : null}
                  </div>
                </aside>
              </div>
            )
          })()
        : null}

      {/* Quick Study JSON side panel — the step's captions assembled into the
          export row format (image_id + caption + flavor/user), view/copy only. */}
      {studyJsonKey
        ? (() => {
            const op = opByKey.get(studyJsonKey)
            const value = image
              ? pinnedFor(studyJsonKey, image.id) ?? outputs[studyJsonKey]?.[image.id]
              : undefined
            const rows = extractJokes(value).map((j) => ({
              image_id: image?.url ?? '',
              caption: j.caption,
              flavor_id: String(flavorId),
              flavor_name: flavorSlug,
              user_id: userId,
            }))
            const json = JSON.stringify(rows, null, 2)
            return (
              <div
                className="fixed inset-0 z-50 flex justify-end bg-[rgb(var(--shadow)/0.2)]"
                onMouseDown={() => setStudyJsonKey(null)}
              >
                <aside
                  className="flex h-screen w-[560px] max-w-[90vw] flex-col border-l border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.98)] p-5 shadow-[0_0_80px_-20px_rgb(var(--primary-deep)/0.5)] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--ambient-base-1)/0.98)]"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold text-[rgb(var(--ink))]">
                      Quick Study JSON · {op?.title ?? studyJsonKey}
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(json).then(() => {
                            setStudyJsonCopied(true)
                          })
                        }}
                        disabled={!rows.length}
                        className="rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-3 py-1 text-xs font-semibold text-[rgb(var(--accent-strong))] transition hover:-translate-y-0.5 disabled:opacity-50 dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.1)]"
                      >
                        {studyJsonCopied ? '✓ Copied' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setStudyJsonKey(null)}
                        className="rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-3 py-1 text-xs font-semibold text-[rgb(var(--accent-strong))] transition hover:-translate-y-0.5 dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.1)]"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
                    {rows.length ? (
                      <pre className={resultPre}>{json}</pre>
                    ) : (
                      <p className="text-sm text-[rgb(var(--muted))]">
                        No captions found in this step&apos;s output for the
                        selected image — run the step first.
                      </p>
                    )}
                    <p className="mt-2 text-[11px] text-[rgb(var(--muted))]">
                      {rows.length} row{rows.length === 1 ? '' : 's'} · built
                      from this step&apos;s captions + the current image URL,
                      flavor, and signed-in user. View/copy only — nothing is
                      written to the pipeline.
                    </p>
                  </div>
                </aside>
              </div>
            )
          })()
        : null}

      {/* Per-joke pipeline trace — menu of steps on the left, full output on the right. */}
      {traceJoke
        ? (() => {
            const stages = traceStages(traceJoke)
            const active = traceStep >= 0 ? stages[traceStep] ?? null : null
            return (
              <aside className="fixed right-0 top-0 z-50 flex h-screen w-[880px] max-w-[96vw] flex-col overflow-hidden border-l border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel))] shadow-[0_0_80px_-20px_rgb(var(--shadow))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--ambient-base-1))]">
                {/* Header */}
                <div className="shrink-0 border-b border-[rgb(var(--gloss)/0.3)] p-5 dark:border-[rgb(var(--gloss)/0.12)]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold">Joke pipeline</h2>
                      <p className="mt-1 text-sm text-[rgb(var(--muted))]">
                        {traceJoke?.rank != null ? `#${traceJoke.rank} · ` : ''}
                        “{traceJoke?.caption || '(no caption)'}”
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTraceJoke(null)}
                      className="rounded-md px-2 py-1 text-lg leading-none text-[rgb(var(--muted))] transition hover:text-[rgb(var(--ink))]"
                      aria-label="Close"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Body: step menu (left) + full step output (right) */}
                <div className="flex min-h-0 flex-1">
                  <nav className="w-[184px] shrink-0 overflow-auto border-r border-[rgb(var(--gloss)/0.3)] p-2 dark:border-[rgb(var(--gloss)/0.12)]">
                    <button
                      type="button"
                      onClick={() => setTraceStep(-2)}
                      className={`mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] font-semibold transition ${
                        traceStep === -2
                          ? 'bg-[rgb(var(--primary)/0.14)] text-[rgb(var(--ink))]'
                          : 'text-[rgb(var(--accent-strong))] hover:bg-[rgb(var(--panel)/0.6)] dark:hover:bg-[rgb(var(--panel)/0.3)]'
                      }`}
                    >
                      <span aria-hidden>🔧</span>
                      <span className="flex-1 truncate">Diagnose this joke</span>
                    </button>
                    <div className="my-1 border-t border-[rgb(var(--gloss)/0.25)] dark:border-[rgb(var(--gloss)/0.12)]" />
                    {stages.map((s, i) => {
                      const open = i === traceStep
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setTraceStep(open ? -1 : i)}
                          className={`mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] transition ${
                            open
                              ? 'bg-[rgb(var(--primary)/0.14)] font-semibold text-[rgb(var(--ink))]'
                              : 'text-[rgb(var(--muted))] hover:bg-[rgb(var(--panel)/0.6)] dark:hover:bg-[rgb(var(--panel)/0.3)]'
                          }`}
                        >
                          <span className="font-mono text-[10px] opacity-60">
                            {i + 1}
                          </span>
                          <span className="flex-1 truncate">{s.title}</span>
                          <span className="text-[10px] opacity-60">
                            {open ? '▾' : '▸'}
                          </span>
                        </button>
                      )
                    })}
                  </nav>

                  <div className="min-w-0 flex-1 overflow-auto p-4">
                    {traceStep === -2 ? (
                      <DiagnosePanel
                        caption={traceJoke?.caption ?? ''}
                        steps={stages.map((s) => ({
                          title: s.title,
                          scope: s.scope,
                          prompt: promptForOp(s.opKey),
                          output: s.image ? '[the source image]' : s.body,
                        }))}
                        onJumpToTitle={(title) => {
                          const n = (t: string) => t.toLowerCase().trim()
                          const stage =
                            stages.find((s) => n(s.title) === n(title)) ??
                            stages.find(
                              (s) =>
                                n(s.title).includes(n(title)) ||
                                n(title).includes(n(s.title))
                            )
                          if (stage?.opKey) {
                            setTraceJoke(null)
                            setDetailKey(stage.opKey)
                          }
                        }}
                      />
                    ) : active ? (
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-baseline gap-2">
                            <h3 className="text-[15px] font-semibold text-[rgb(var(--ink))]">
                              {active.title}
                            </h3>
                            <span className="rounded bg-[rgb(var(--primary)/0.1)] px-1 py-0.5 text-[9px] font-semibold uppercase tracking-[0.15em] text-[rgb(var(--accent-strong))]">
                              {active.scope}
                            </span>
                          </div>
                          {active.opKey ? (
                            <button
                              type="button"
                              onClick={() => {
                                const k = active.opKey as string
                                setTraceJoke(null)
                                setDetailKey(k)
                              }}
                              className="shrink-0 text-[11px] font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                            >
                              open step ▸
                            </button>
                          ) : null}
                        </div>
                        {active.image ? (
                          <figure className="mt-2 overflow-hidden rounded-lg border border-[rgb(var(--gloss)/0.4)] bg-white p-4 dark:border-[rgb(var(--gloss)/0.12)]">
                            <figcaption className="mb-3">
                              <p className="text-[24px] font-semibold leading-tight text-black">
                                {traceJoke?.caption || '(no caption)'}
                              </p>
                            </figcaption>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={active.image}
                              alt="source image for this joke"
                              className="h-auto w-full max-w-full rounded"
                            />
                          </figure>
                        ) : (
                          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-[rgb(var(--panel)/0.6)] p-3 font-mono text-[12px] leading-relaxed text-[rgb(var(--ink))] dark:bg-[rgb(var(--panel)/0.25)]">
                            {active.body || '(no output — run this step)'}
                          </pre>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-[rgb(var(--muted))]">
                        Select a step on the left to see its full output.
                      </p>
                    )}
                  </div>
                </div>
              </aside>
            )
          })()
        : null}

      {/* Formatted-captions share panel: numbered punchlines above the image. */}
      {shareKey && shareCaptions && image ? (
        <aside className="fixed right-0 top-0 z-[60] flex h-screen w-[520px] max-w-[92vw] flex-col overflow-auto border-l border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel))] p-6 shadow-[0_0_80px_-20px_rgb(var(--shadow))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--ambient-base-1))]">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-xl font-semibold">Formatted captions</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(
                    shareCaptions.map((c, i) => `${i + 1}. ${c}`).join('\n')
                  )
                }}
                className="rounded-md border border-[rgb(var(--gloss)/0.6)] px-2.5 py-1 text-xs font-semibold text-[rgb(var(--muted))] transition hover:border-[rgb(var(--primary))] hover:text-[rgb(var(--primary))] dark:border-[rgb(var(--gloss)/0.2)]"
                title="Copy the numbered captions as text"
              >
                Copy text
              </button>
              <button
                type="button"
                onClick={() => setShareKey(null)}
                className="rounded-md border border-[rgb(var(--gloss)/0.6)] px-2.5 py-1 text-xs font-semibold text-[rgb(var(--muted))] transition hover:border-[rgb(var(--accent-strong))] hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.2)]"
              >
                Close ✕
              </button>
            </div>
          </div>
          <ol className="mb-4 list-decimal space-y-2 pl-6 text-[15px] leading-snug">
            {shareCaptions.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt="meme"
            className="w-full rounded-lg border border-[rgb(var(--gloss)/0.4)] dark:border-[rgb(var(--gloss)/0.15)]"
          />
        </aside>
      ) : null}

      {/* Full-detail side panel — no dimming; the page stays interactive. */}
      {detailOp ? (
        <aside className="fixed right-0 top-0 z-50 flex h-screen w-[560px] max-w-[92vw] flex-col overflow-auto border-l border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel))] p-6 shadow-[0_0_80px_-20px_rgb(var(--shadow))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--ambient-base-1))]">
          <div>
            {/* Sticky within the scrolling panel: title + close stay visible.
                Negative margins cancel the aside's p-6 so the bar spans edge
                to edge and scrolled content can't peek above it. */}
            <div className="sticky top-0 z-10 -mx-6 -mt-6 mb-2 flex items-start justify-between gap-4 border-b border-[rgb(var(--gloss)/0.3)] bg-[rgb(var(--panel))] px-6 pb-3 pt-6 dark:border-[rgb(var(--gloss)/0.12)] dark:bg-[rgb(var(--ambient-base-1))]">
              <div>
                <h2 className="text-xl font-semibold">{detailOp.title}</h2>
                <p className="mt-1 text-sm text-[rgb(var(--muted))]">
                  {detailOp.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailKey(null)}
                className="rounded-md px-2 py-1 text-lg leading-none text-[rgb(var(--muted))] transition hover:text-[rgb(var(--ink))]"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <p className="mt-2 font-mono text-[11px] text-[rgb(var(--muted))]">
              {detailOp.kind === 'transform' ? (
                'code transform — runs locally, no model'
              ) : (
                <>
                  model:{' '}
                  {allStepsModel?.provider_model_id ?? detailOp.providerModelId ?? detailStep?.providerModelId ?? 'none'}{' '}
                  · temp:{' '}
                  {allStepsModel && !allStepsModel.is_temperature_supported ? 'n/a' : detailOp.temperature != null
                    ? detailOp.temperature
                    : (allStepsModel?.is_temperature_supported ?? detailStep?.isTemperatureSupported)
                      ? detailStep?.temperature ?? 0.7
                      : 'n/a'}{' '}
                  · sees image:{' '}
                  {(detailOp.includeImage ?? detailStep?.includeImage)
                    ? 'yes'
                    : 'no'}
                </>
              )}
              {detailOp.fanOutOver
                ? ` · fans out over ${detailOp.fanOutOver}`
                : ''}
            </p>

            {/* Inputs */}
            <div className="mt-4">
              <p className={detailLabel}>Inputs</p>
              <div className="mt-1 space-y-1">
                {detailOp.inputs.length === 0 ? (
                  <p className="text-xs text-[rgb(var(--muted))]">
                    none — reads the image directly
                  </p>
                ) : (
                  detailOp.inputs.map((inp) => (
                    <div key={inp.slot} className="text-xs">
                      <code className={chip}>${`{${inp.slot}}`}</code>{' '}
                      <span className="text-[rgb(var(--muted))]">
                        {inp.description}
                      </span>
                      <span className="text-[rgb(var(--muted))]">
                        {' '}
                        ◀ {bindingLabel(bindings[detailOp.key]?.[inp.slot] ?? inp.binding)}
                      </span>
                      {isServerResolved(inp.binding) ? (
                        <a
                          href="/sidechat-topics"
                          target="_blank"
                          rel="noreferrer"
                          className="ml-2 font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                          title="Browse clustered raw Sidechat posts — the source material behind these contexts"
                        >
                          Sidechat topics ↗
                        </a>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Output */}
            <div className="mt-4">
              <p className={detailLabel}>Output</p>
              <div className="mt-1 text-xs">
                <code className={chip}>${`{${detailOp.output.name}}`}</code>{' '}
                <span className="text-[rgb(var(--muted))]">
                  {detailOp.output.description}
                </span>
              </div>
            </div>

            {/* Prompts (expressed in slot names), or a note for code ops */}
            {detailOp.kind === 'transform' ? (
              <div className="mt-4">
                <p className={detailLabel}>Logic</p>
                <p className="mt-1 text-xs text-[rgb(var(--muted))]">
                  Runs in code — no prompt. Keeps moments where the average OR the
                  highest of the visual/emotional scores is ≥ 0.7.
                </p>
              </div>
            ) : (
              <>
                <div className="mt-4">
                  <p className={detailLabel}>
                    System prompt{detailOp.systemPrompt != null ? ' (inline)' : ''}
                  </p>
                  {detailOp.systemPrompt == null && detailPromptsEditable ? (
                    <StepPromptEditor
                      key={`${detailStep!.id}:system`}
                      stepId={detailStep!.id}
                      flavorId={flavorId}
                      field="systemPrompt"
                      initial={detailStep!.systemPrompt}
                      preClass={detailPromptPre}
                      onSaved={() => router.refresh()}
                    />
                  ) : (
                    <pre className={detailPromptPre}>
                      {(detailOp.systemPrompt ??
                        applyRewrites(
                          detailStep?.systemPrompt ?? '',
                          detailOp.rewrites
                        )) || '(empty)'}
                    </pre>
                  )}
                </div>
                <div className="mt-3">
                  <p className={detailLabel}>
                    User prompt{detailOp.userPrompt != null ? ' (inline)' : ''}
                  </p>
                  {detailOp.userPrompt == null && detailPromptsEditable ? (
                    <StepPromptEditor
                      key={`${detailStep!.id}:user`}
                      stepId={detailStep!.id}
                      flavorId={flavorId}
                      field="userPrompt"
                      initial={detailStep!.userPrompt}
                      preClass={detailPromptPre}
                      onSaved={() => router.refresh()}
                    />
                  ) : (
                    <pre className={detailPromptPre}>
                      {(detailOp.userPrompt ??
                        applyRewrites(
                          detailStep?.userPrompt ?? '',
                          detailOp.rewrites
                        )) || '(empty)'}
                    </pre>
                  )}
                  {!detailPromptsEditable && detailStep != null ? (
                    <p className="mt-1 text-[11px] text-[rgb(var(--muted))]">
                      Shown in slot names (this op rewrites the step&apos;s
                      variables), so it can&apos;t be edited here — edit the
                      step in the flavor editor instead.
                    </p>
                  ) : null}
                </div>
                {detailOp.appendUserPrompt ? (
                  <div className="mt-3">
                    <p className={detailLabel}>
                      ↳ appended to user prompt (this op’s additions)
                    </p>
                    <pre
                      className={`${detailPre} border border-[rgb(var(--primary)/0.4)]`}
                    >
                      {detailOp.appendUserPrompt}
                    </pre>
                  </div>
                ) : null}
              </>
            )}

            {/* Output — pinned default (editable) or the latest generated result */}
            <div className="mt-3">
              {detailPinned ? (
                <>
                  <div className="mb-1 flex items-center gap-2 rounded-md bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                    <span aria-hidden>📌</span>
                    <span>
                      DEFAULT OUTPUT — pinned for THIS image. Won’t regenerate
                      while this image is selected.
                    </span>
                  </div>
                  <p className={detailLabel}>Edit default output</p>
                  <ManualStepValue
                    key={`${detailOp.key}:${image?.id ?? ''}`}
                    initial={stringifyResult(detailResult)}
                    disabled={runningAll || batchRunning || runState[detailOp.key]?.status === 'loading'}
                    onApply={(text) => savePinnedText(detailOp.key, text)}
                  />
                  <button
                    type="button"
                    onClick={() => unpinOutput(detailOp.key)}
                    className="mt-2 rounded-md border border-amber-500/60 px-2.5 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-300"
                  >
                    Unpin default (let it regenerate)
                  </button>
                </>
              ) : (
                <>
                  <p className={detailLabel}>
                    Latest output {image ? '(for selected image)' : ''}
                  </p>
                  <pre className={detailPre}>{stringifyResult(detailResult)}</pre>
                  {detailCanPin ? (
                    <button
                      type="button"
                      onClick={() => pinOutput(detailOp.key)}
                      className="mt-2 rounded-md border border-amber-500/60 px-2.5 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-300"
                      title="Make this the default output for THIS image — stops regenerating it; downstream steps use it"
                    >
                      📌 Make this the default output
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  )
}
