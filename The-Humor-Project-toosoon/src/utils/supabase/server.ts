'use server'

import { createServerClient } from '@supabase/ssr'
import { getSupabaseAuthCookieOptions } from '@/utils/supabase/authCookies'
import { cookies } from 'next/headers'

import { getSupabasePublicEnv } from './env'

type CreateClientOptions = {
  readOnly?: boolean
}

export const createClient = async (
  options: CreateClientOptions = {}
) => {
  const cookieStore = await cookies()
  const { supabaseUrl, supabasePublicKey } = getSupabasePublicEnv()
  const { readOnly = false } = options

  return createServerClient(supabaseUrl, supabasePublicKey, {
    cookieOptions: getSupabaseAuthCookieOptions(supabaseUrl),
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        if (readOnly) {
          return
        }
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        } catch (error) {
          console.error('Error setting cookies:', error)
        }
      },
    },
  })
}
