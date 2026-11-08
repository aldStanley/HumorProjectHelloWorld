const getTrimmedEnvValue = (value: string | undefined) => {
  if (!value) {
    return null
  }

  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : null
}

export const getSupabasePublicKey = () =>
  getTrimmedEnvValue(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
  getTrimmedEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

export const getSupabasePublicEnv = () => {
  const supabaseUrl = getTrimmedEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const supabasePublicKey = getSupabasePublicKey()

  if (!supabaseUrl || !supabasePublicKey) {
    throw new Error(
      'Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    )
  }

  return { supabaseUrl, supabasePublicKey }
}
