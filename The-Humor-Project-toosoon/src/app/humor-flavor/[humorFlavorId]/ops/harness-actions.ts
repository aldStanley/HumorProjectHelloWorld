'use server'

import fs from 'node:fs'
import path from 'node:path'

import { createClient } from '@/utils/supabase/server'

// Cast-classifier card recovered from the harness cache (judge-cast.mjs).
export type HarnessCastCard = {
  id: string
  stepOrderBy: number
  register: string
  caption: string
  context: string
  judge?: {
    figures?: { anchor?: string; candidates?: string[] }[]
    entities_in_caption?: string[]
    entities_expected_in_image?: string[]
  } | null
  judgeRaw?: string
  verdict: {
    pass: boolean | null
    reasons: string[]
    flags: Record<string, number | boolean>
  } | null
  human?: number
  humanNote?: string | null
}

export type HarnessImageEntry = {
  id: string
  url: string
  steps: Record<string, string>
  missingSteps: number[]
  note?: string
  cast: HarnessCastCard[]
}

export type HarnessManifest = {
  flavorId: number
  setId: number
  judgeModel: string
  generatedAt: number
  stepOrderBys: number[]
  images: HarnessImageEntry[]
}

export type LoadHarnessResult = {
  ok: boolean
  manifest?: HarnessManifest
  error?: string
}

// Reads the manifest exported by
// scripts/context-recovery-harness/export-ops-manifest.mjs. Local-dev only by
// nature: the harness cache lives on the dev machine, so on deployed builds
// the file simply doesn't exist and we return a friendly error.
export async function loadHarnessManifestAction(
  flavorId: number
): Promise<LoadHarnessResult> {
  const supabase = await createClient({ readOnly: true })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in.' }
  }

  const file = path.join(
    process.cwd(),
    'scripts',
    'context-recovery-harness',
    'runs',
    `ops-manifest-${flavorId}.json`
  )
  if (!fs.existsSync(file)) {
    return {
      ok: false,
      error: `No harness run found for flavor ${flavorId}. Run: node scripts/context-recovery-harness/export-ops-manifest.mjs --flavor ${flavorId} (local dev only).`,
    }
  }

  try {
    const manifest = JSON.parse(
      fs.readFileSync(file, 'utf8')
    ) as HarnessManifest
    return { ok: true, manifest }
  } catch (e) {
    return {
      ok: false,
      error: `Unable to read harness manifest: ${
        e instanceof Error ? e.message : String(e)
      }`,
    }
  }
}
