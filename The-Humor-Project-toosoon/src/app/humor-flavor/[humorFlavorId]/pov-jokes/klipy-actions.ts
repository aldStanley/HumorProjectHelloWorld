'use server'

// KLIPY search for the POV Joke Maker. The API key stays on the server: it is
// a path segment in KLIPY's URLs, so calling from the browser would put it in
// every request the network tab can see.
//
// This exists because klipy.com's own /player pages refuse to be framed
// (X-Frame-Options), so a pasted embed renders as "klipy.com refused to
// connect". The API hands back direct static.klipy.com media URLs, which embed
// fine — so the page searches and gets a usable URL instead of asking the user
// to paste one that cannot work.
import { createClient } from '@/utils/supabase/server'

import {
  KLIPY_MEDIA_TYPES,
  type KlipyMediaType,
  type KlipyResult,
  type KlipySearchResult,
} from './klipy-types'

type KlipyFile = {
  url?: string
  width?: number
  height?: number
}

type KlipyItem = {
  id?: number | string
  slug?: string
  title?: string
  file?: Record<string, Record<string, KlipyFile>>
}


export async function searchKlipyAction(input: {
  query: string
  mediaType?: KlipyMediaType
  perPage?: number
}): Promise<KlipySearchResult> {
  const supabase = await createClient({ readOnly: true })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in to search for images.' }
  }

  const query = input.query.trim()
  if (!query) return { ok: false, error: 'Type something to search for.' }

  const apiKey = process.env.KLIPY_API_KEY
  if (!apiKey) {
    return {
      ok: false,
      error:
        'Missing KLIPY_API_KEY in the server environment. Add it to .env and restart the dev server.',
    }
  }

  const mediaType: KlipyMediaType = KLIPY_MEDIA_TYPES.includes(
    input.mediaType as KlipyMediaType
  )
    ? (input.mediaType as KlipyMediaType)
    : 'gifs'
  // KLIPY rejects per_page outside 8-50.
  const perPage = Math.min(50, Math.max(8, input.perPage ?? 24))

  const url =
    `https://api.klipy.com/api/v1/${apiKey}/${mediaType}/search` +
    `?q=${encodeURIComponent(query)}&per_page=${perPage}&page=1`

  let payload: unknown
  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) {
      const detail = await response.text()
      return {
        ok: false,
        error: `KLIPY returned ${response.status}: ${detail.slice(0, 200)}`,
      }
    }
    payload = await response.json()
  } catch (err) {
    return {
      ok: false,
      error: `Could not reach KLIPY: ${
        err instanceof Error ? err.message : String(err)
      }`,
    }
  }

  const items = (payload as { data?: { data?: KlipyItem[] } })?.data?.data
  if (!Array.isArray(items)) {
    return { ok: false, error: 'KLIPY returned no readable results.' }
  }

  const results = items
    .map((item): KlipyResult | null => {
      const file = item.file ?? {}
      // Small first for the grid, largest first for the chosen pairing.
      const preview =
        file.sm?.webp?.url ??
        file.sm?.gif?.url ??
        file.xs?.gif?.url ??
        file.md?.gif?.url
      const previewMeta = file.sm?.webp ?? file.sm?.gif ?? file.xs?.gif ?? file.md?.gif
      const fullGif = file.md?.gif?.url ?? file.hd?.gif?.url
      const fullVideo = file.md?.mp4?.url ?? file.hd?.mp4?.url
      const full = fullGif ?? fullVideo
      if (!preview || !full) return null
      return {
        id: String(item.id ?? item.slug ?? preview),
        title: (item.title ?? '').trim() || 'Untitled',
        slug: item.slug ?? '',
        previewUrl: preview,
        previewWidth: previewMeta?.width ?? 165,
        previewHeight: previewMeta?.height ?? 117,
        fullUrl: full,
        fullKind: fullGif ? 'image' : 'video',
      }
    })
    .filter((result): result is KlipyResult => result !== null)

  return { ok: true, results }
}
