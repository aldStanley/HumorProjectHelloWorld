'use server'

// Saves a frozen copy of the current run to the database (table
// reaction_joke_shares) and returns the id that goes in the share link,
// ?share=<id>. The run otherwise lives only in the sharer's browser record,
// so nothing else could put it in front of someone else. Every press makes
// a new row; a snapshot never changes after it is written.
import { randomBytes } from 'node:crypto'

import { createClient } from '@/utils/supabase/server'

import type { RunSnapshot } from './run-record'

export type ShareRunResult = { ok: true; id: string } | { ok: false; error: string }

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
const shortId = (): string =>
  Array.from(randomBytes(12), (b) => ALPHABET[b % ALPHABET.length]).join('')

export async function shareRunAction(flavorId: number, snapshot: RunSnapshot): Promise<ShareRunResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return { ok: false, error: 'You must be signed in.' }
  const id = shortId()
  const { error } = await supabase.from('reaction_joke_shares').insert({
    id,
    flavor_id: flavorId,
    profile_id: user.id,
    persona: snapshot.personaName,
    moment_count: snapshot.moments.length,
    hearted_count: snapshot.hearted.length,
    snapshot,
  })
  if (error) {
    console.error('Failed to share the run.', error)
    return {
      ok: false,
      error: /relation .* does not exist|schema cache/i.test(error.message)
        ? 'Not shared: the reaction_joke_shares table does not exist yet. Run supabase/migrations/20260917000000_reaction_joke_shares.sql in the Supabase SQL editor.'
        : `Not shared: ${error.message}`,
    }
  }
  return { ok: true, id }
}
