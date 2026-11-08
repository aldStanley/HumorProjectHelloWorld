'use server'

// Saves a workshop chat to the database (table reaction_joke_workshops, one
// row per conversation, rewritten after every answer and every heart), so
// every chat is kept beyond the browser record (Lydia, 2026-09-09: "I want
// to save all the chats"). The row's id is the page's chat id; a new chat
// about the same joke is a new row.
import { createClient } from '@/utils/supabase/server'

export type SaveWorkshopInput = {
  chatId: string
  flavorId: number
  persona: string
  moment: string
  joke: string
  jokeKey: string
  analysis: unknown | null
  messages: { role: 'user' | 'assistant'; content: string; at: string }[]
  hearted: { caption: string; note?: string; asked_for?: string; hearted_at: string }[]
  model?: string
  reasoningEffort?: string
}

export type SaveWorkshopResult = { ok: boolean; savedAt?: string; error?: string }

export async function saveWorkshopAction(input: SaveWorkshopInput): Promise<SaveWorkshopResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return { ok: false, error: 'You must be signed in.' }
  const now = new Date().toISOString()
  const { error } = await supabase.from('reaction_joke_workshops').upsert(
    {
      id: input.chatId,
      flavor_id: input.flavorId,
      profile_id: user.id,
      persona: input.persona,
      moment: input.moment,
      joke: input.joke,
      joke_key: input.jokeKey,
      analysis: input.analysis ?? null,
      messages: input.messages,
      hearted: input.hearted,
      model: input.model ?? null,
      reasoning_effort: input.reasoningEffort ?? null,
      modified_datetime_utc: now,
    },
    { onConflict: 'id' }
  )
  if (error) {
    console.error('Failed to save workshop chat.', error)
    return {
      ok: false,
      error: /relation .* does not exist|schema cache/i.test(error.message)
        ? 'Not saved: the reaction_joke_workshops table does not exist yet. Run supabase/migrations/20260909000000_reaction_joke_workshops.sql in the Supabase SQL editor.'
        : `Not saved: ${error.message}`,
    }
  }
  return { ok: true, savedAt: now }
}
