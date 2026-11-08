// Headless port of the flavor-1513 ops pipeline (OP_SPECS_1513 in
// src/app/humor-flavor/[humorFlavorId]/ops/ops-client.tsx):
//   recognize -> memeRelevantContext -> cuContextMemeCaption (fan-out x3)
//   -> memeCaptionAlignment (fan-out) -> rank, plus optional naiveMemeCaption.
// The prompt constants below are copied VERBATIM from ops-client.tsx — if you
// edit the pipeline there, keep these in sync.
import { callOpenAI, parseJsonLoose, asPromptString, substitute } from './lib.mjs'

export const CAPTION_MODEL = 'gpt-4o-2024-08-06'

export const AMENDMENT_HEADER =
  '--------------------------------------\n' +
  'ADDITIONAL GUIDANCE (applies on top of everything above):'

// ops-client.tsx MEME_FORMAT_CLAUSE
export const MEME_FORMAT_CLAUSE =
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

// ops-client.tsx OP_SPECS_1513 'recognize'.appendUserPrompt
export const RECOGNIZE_APPEND =
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
  'says/implies, or null>, "confidence": <0..1> }'

// ops-client.tsx 'naiveMemeCaption'
const NAIVE_SYSTEM = 'You are writing the text for a meme.'
const NAIVE_USER =
  'You are writing the text for a meme. Come up with something that fits this ' +
  'template (use the recognized content below and the attached image).\n\n' +
  'Recognized content:\n${recognizedContent}\n\n' +
  'Here are some topics you can pick from:\n' +
  '- relationship/romantic conflicts\n' +
  '- school / academic conflicts\n' +
  '- political conflicts\n' +
  '- self-deprecation\n' +
  '- sibling conflicts' +
  MEME_FORMAT_CLAUSE

// ops-client.tsx 'memeRelevantContext'
const CONTEXT_SYSTEM =
  'You find Columbia/Barnard (CU) community context relevant to filling in a ' +
  'meme. You only respond in JSON.'
const CONTEXT_USER =
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
  ']'

// ops-client.tsx 'cuContextMemeCaption' (exported for the context-first lab)
export const CAPTION_SYSTEM = 'You are writing the text for a meme.'
export const CAPTION_USER =
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
  '}'

// ops-client.tsx 'memeCaptionAlignment' (the judge; exported for the lab)
export const ALIGN_SYSTEM =
  'You judge how well a caption fits a meme template’s format. You only respond ' +
  'in JSON.'
export const ALIGN_USER =
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
  '}'

// The recognize user prompt = the flavor's step-1 prompt (from the DB) + the
// hardcoded meme-verdict append + the optimizer's current amendment.
export const buildRecognizeUserPrompt = (stepUserPrompt, amendment) =>
  stepUserPrompt +
  RECOGNIZE_APPEND +
  (amendment ? '\n\n' + AMENDMENT_HEADER + '\n' + amendment : '')

// Runs the full pipeline for one image. ctx:
//   { apiKey, steps (by order_by), contextsText, includeNaive, limit }
// Returns a plain-JSON result object (also used by the report).
export async function runPipelineForImage(ctx, image, amendment) {
  const { apiKey, steps, contextsText, includeNaive, limit } = ctx
  const s1 = steps[1]
  const baseVars = {
    imageDescription: image.image_description ?? '',
    imageAdditionalContext: image.additional_context ?? '',
    allCommunityContexts: contextsText,
  }
  const result = { imageId: image.id, url: image.url, branches: [] }

  // 1. Recognize content. In pinned mode (ctx.pinRecognize) the "amendment"
  //    IS the recognize output — same as pinning the op in the ops page — and
  //    no model is called. Otherwise: DB step-1 model & temperature, image
  //    attached, amendment appended to the prompt.
  const recognizeText = ctx.pinRecognize
    ? amendment
    : await limit(() =>
        callOpenAI({
          apiKey,
          model: s1.providerModelId,
          systemPrompt: substitute(s1.systemPrompt, baseVars),
          userPrompt: substitute(buildRecognizeUserPrompt(s1.userPrompt, amendment), baseVars),
          temperature: s1.isTemperatureSupported ? s1.temperature ?? 0.7 : null,
          imageUrl: image.url,
        })
      )
  result.recognizeText = recognizeText
  result.recognizePinned = Boolean(ctx.pinRecognize)
  const recognizeParsed = parseJsonLoose(recognizeText)
  // The meme verdict is normally under a "meme" key, but a hand-pinned JSON
  // may BE the verdict object itself — accept both shapes.
  result.meme =
    recognizeParsed && typeof recognizeParsed === 'object' && !Array.isArray(recognizeParsed)
      ? recognizeParsed.meme ??
        ('template_name' in recognizeParsed || 'is_meme' in recognizeParsed
          ? recognizeParsed
          : null)
      : null
  const vars = { ...baseVars, recognizedContent: recognizeText }

  // 2. Naive meme caption (optional baseline; not scored by the judge).
  if (includeNaive) {
    try {
      result.naiveText = await limit(() =>
        callOpenAI({
          apiKey,
          model: CAPTION_MODEL,
          systemPrompt: NAIVE_SYSTEM,
          userPrompt: substitute(NAIVE_USER, vars),
          temperature: 0.7,
          imageUrl: image.url,
        })
      )
    } catch (err) {
      result.naiveText = `⚠ ${err?.message ?? err}`
    }
  }

  // 3. Find meme-relevant CU context (no image; whole corpus in the prompt).
  const momentsText = await limit(() =>
    callOpenAI({
      apiKey,
      model: CAPTION_MODEL,
      systemPrompt: CONTEXT_SYSTEM,
      userPrompt: substitute(CONTEXT_USER, vars),
      temperature: 0.7,
    })
  )
  result.momentsText = momentsText
  const moments = parseJsonLoose(momentsText)
  if (!Array.isArray(moments) || moments.length === 0) {
    result.error = 'memeRelevantContext did not return a JSON list of moments'
    return result
  }

  // 4+5. Per moment: write the CU caption, then judge its format alignment.
  await Promise.all(
    moments.map(async (moment, i) => {
      const branch = { index: i, moment }
      result.branches[i] = branch
      try {
        const captionText = await limit(() =>
          callOpenAI({
            apiKey,
            model: CAPTION_MODEL,
            systemPrompt: CAPTION_SYSTEM,
            userPrompt: substitute(CAPTION_USER, {
              ...vars,
              memeRelevantContext: asPromptString(moment),
            }),
            temperature: 0.7,
            imageUrl: image.url,
          })
        )
        branch.captionText = captionText
        const captionParsed = parseJsonLoose(captionText)
        branch.caption =
          captionParsed && typeof captionParsed === 'object'
            ? captionParsed.caption ?? captionText
            : captionText

        // The judge sees the caption op's FULL raw output, same as the app.
        const alignText = await limit(() =>
          callOpenAI({
            apiKey,
            model: CAPTION_MODEL,
            systemPrompt: ALIGN_SYSTEM,
            userPrompt: substitute(ALIGN_USER, { ...vars, memeCaption: captionText }),
            temperature: 0.2,
            imageUrl: image.url,
          })
        )
        branch.alignText = alignText
        const a = parseJsonLoose(alignText)
        if (a && typeof a === 'object' && !Array.isArray(a)) {
          const n = Number(a.meme_format_alignment)
          branch.score = Number.isFinite(n) ? n : null
          branch.alignReason = a.reason ?? ''
          branch.requiredSetup = a.required_setup ?? ''
          branch.requiredSetupPresent = a.required_setup_present ?? null
        } else {
          branch.score = null
        }
      } catch (err) {
        branch.error = String(err?.message ?? err)
      }
    })
  )

  return result
}

// Per-image score rollup: all branch scores, their mean, and the best one.
export const imageScores = (perImageResult) => {
  const scores = (perImageResult.branches ?? [])
    .map((b) => b.score)
    .filter((s) => Number.isFinite(s))
  const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
  const top = scores.length ? Math.max(...scores) : null
  return { scores, mean, top }
}
