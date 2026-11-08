// Shared types for the KLIPY search, kept out of klipy-actions.ts because a
// 'use server' module is meant to export only async server actions.
//
// KlipySearchResult is ONE object with optional fields rather than the
// discriminated union `{ok:true;results} | {ok:false;error}` it wants to be:
// this project compiles with "strict": false, and with strictNullChecks off
// TypeScript does not narrow discriminated unions — `if (res.ok)` fails to
// eliminate the other branch, so reading `res.error` after it is a type
// error. Verified with an isolated probe: a purely local union fails the same
// way, so this is the tsconfig, not these types. Every other action result in
// this codebase (RunStepResult, ListProfilesResult, …) is shaped the same way
// for the same reason.

export type KlipyResult = {
  id: string
  title: string
  slug: string
  // Small looping file for the results grid.
  previewUrl: string
  previewWidth: number
  previewHeight: number
  // What gets paired with the caption when this result is chosen.
  fullUrl: string
  fullKind: 'image' | 'video'
}

export type KlipySearchResult = {
  ok: boolean
  results?: KlipyResult[]
  error?: string
}

export const KLIPY_MEDIA_TYPES = ['gifs', 'stickers', 'clips'] as const
export type KlipyMediaType = (typeof KLIPY_MEDIA_TYPES)[number]
