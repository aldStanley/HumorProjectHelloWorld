import type { SupabaseClient } from '@supabase/supabase-js'

// Who started a run. ops_runs stores only profile_id, and a bare UUID tells a
// reader nothing — so look the profiles up and show a name (or the email).
//
// Fetched separately rather than as an embedded select: if profiles is
// unreadable for this user, a missing name degrades to the short id instead of
// failing the whole runs query.

type ProfileRow = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
}

export const nameOf = (p: ProfileRow | undefined, profileId: string | null) => {
  const full = [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim()
  if (full) return full
  if (p?.email) return p.email
  return profileId ? profileId.slice(0, 8) : '—'
}

// profileId -> display name, for every id passed in that we can read.
export const namesByProfileId = async (
  // The untyped server client; the ops tables aren't in the generated types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  profileIds: (string | null | undefined)[]
): Promise<Map<string, string>> => {
  const ids = Array.from(new Set(profileIds.filter(Boolean) as string[]))
  const out = new Map<string, string>()
  if (!ids.length) return out

  const { data } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, email')
    .in('id', ids)

  const rows = (data ?? []) as ProfileRow[]
  ids.forEach((id) => {
    out.set(id, nameOf(rows.find((r) => r.id === id), id))
  })
  return out
}
