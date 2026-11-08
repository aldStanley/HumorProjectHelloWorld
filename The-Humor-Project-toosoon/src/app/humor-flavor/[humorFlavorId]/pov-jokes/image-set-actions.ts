'use server'

// Loads a study image set for the POV Joke Maker's pairing stage: the images
// with the text the pairing prompt matches against. Same tables as the
// reverse surfaces (study_image_sets → study_image_set_image_mappings →
// images); nothing here is written.
import { createClient } from '@/utils/supabase/server'

export type PairableImage = {
  id: string
  url: string
  // What the image visibly shows, as stored on the image row.
  description: string
  // Names from the celebrity-recognition JSON, joined, or empty.
  who: string
}

export type ImageSetResult =
  | {
      ok: true
      set: { id: number; slug: string; description: string }
      images: PairableImage[]
    }
  | { ok: false; error: string }

type ImageRel =
  | {
      id: string
      url: string | null
      image_description: string | null
      celebrity_recognition: string | null
    }
  | {
      id: string
      url: string | null
      image_description: string | null
      celebrity_recognition: string | null
    }[]
  | null

const firstOf = <T,>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? value[0] ?? null : value

// celebrity_recognition is a JSON string like {"content":[{"name":...}]}.
// A row that does not parse just has nobody recognized in it.
const namesFrom = (raw: string | null): string => {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw) as { content?: { name?: string }[] }
    return (parsed.content ?? [])
      .map((c) => (c.name ?? '').trim())
      .filter(Boolean)
      .join(', ')
  } catch {
    return ''
  }
}

export async function loadImageSetAction(setId: number): Promise<ImageSetResult> {
  const supabase = await createClient({ readOnly: true })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return { ok: false, error: 'You must be signed in.' }
  if (!Number.isFinite(setId)) return { ok: false, error: 'That is not an image set id.' }

  const { data: set, error: setError } = await supabase
    .from('study_image_sets')
    .select('id, slug, description')
    .eq('id', setId)
    .maybeSingle()
  if (setError) return { ok: false, error: setError.message }
  if (!set) return { ok: false, error: `There is no image set ${setId}.` }

  const { data: rows, error: rowsError } = await supabase
    .from('study_image_set_image_mappings')
    .select(
      'id, image:images ( id, url, image_description, celebrity_recognition )'
    )
    .eq('study_image_set_id', setId)
    .order('id', { ascending: true })
  if (rowsError) return { ok: false, error: rowsError.message }

  const images: PairableImage[] = []
  ;((rows ?? []) as { image: ImageRel }[]).forEach((row) => {
    const image = firstOf(row.image)
    if (!image?.url) return
    images.push({
      id: image.id,
      url: image.url,
      description: (image.image_description ?? '').trim(),
      who: namesFrom(image.celebrity_recognition),
    })
  })

  return {
    ok: true,
    set: { id: set.id, slug: set.slug ?? '', description: set.description ?? '' },
    images,
  }
}
