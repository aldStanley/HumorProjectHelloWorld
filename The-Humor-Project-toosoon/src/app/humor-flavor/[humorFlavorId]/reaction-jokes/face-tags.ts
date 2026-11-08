// Emotion tags for the faces in an image set.
//
// A frame wants "a disappointed face" or "a smug face". The set's images
// carry prose descriptions, and matching those by keyword was wrong more
// often than right (2026-09-07: "I don't think these are the smirking
// images"). So the faces are tagged once, by one model call over the
// descriptions, with one to three emotions each from the closed EMOTIONS
// list, and the frames select by tag. The tags are cached in the browser per
// set id; "tag them again" replaces them.
import { EMOTIONS } from './frames'

export type FaceTags = Record<string, string[]>

export const faceTagsKey = (setId: number) => `face-tags:${setId}`

type Face = { id: string; description: string; who: string }

// Short ids in the prompt: a model retypes a UUID wrong about one time in
// five, and a two-digit id comes back reliably.
const shortId = (i: number) => `img-${String(i + 1).padStart(2, '0')}`

export const buildTagPrompt = (faces: Face[]): string =>
  `You are tagging reaction images by the emotion the person or character visibly shows, from a written description of each image.

Tag each image with ONE to THREE emotions from this list, most visible first. Use ONLY these words, exactly as written:
${EMOTIONS.join(', ')}

Judge the FACE and BODY LANGUAGE the description reports, not the scene, the character's reputation, or the mood of the sentence. "Smug" and "smirking" mean visible self-satisfaction; "confident" means calm certainty; do not tag those unless the description says so. A description that mentions laughing AT someone while looking distressed is "distressed", not "laughing". "pretend-sad" means sadness that is visibly performed or exaggerated: a theatrical pout, mock sobbing, fake tears, a wobbling lip played for effect. Real, unperformed sadness is "sad" or "crying", not "pretend-sad".

Images:
${JSON.stringify(faces.map((f, i) => ({ image_id: shortId(i), who: f.who || null, description: f.description.slice(0, 500) })), null, 2)}

Return ONLY valid JSON of this shape, one entry per image, every image_id from the list above:
{"faces": [{"image_id": "<EXACT image_id from the list>", "emotions": ["<word from the list>", "<word from the list>"]}]}`

// Maps the short ids back to the real ones and drops words not in the list.
export const parseTagOutput = (text: string, faces: Face[]): FaceTags | null => {
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
    const parsed = JSON.parse(cleaned) as { faces?: { image_id?: string; emotions?: string[] }[] }
    if (!Array.isArray(parsed.faces)) return null
    const allowed = new Set<string>(EMOTIONS)
    const out: FaceTags = {}
    parsed.faces.forEach((f) => {
      const m = /^img-(\d+)$/.exec(f.image_id ?? '')
      const face = m ? faces[Number(m[1]) - 1] : undefined
      if (!face) return
      const tags = (f.emotions ?? []).map((e) => String(e).toLowerCase().trim()).filter((e) => allowed.has(e))
      if (tags.length) out[face.id] = tags
    })
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}
