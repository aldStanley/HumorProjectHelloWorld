import { NextResponse } from 'next/server'

import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  const requestUrl = new URL(request.url)
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? requestUrl.origin

  const supabase = await createClient()
  const { error } = await supabase.auth.signOut({ scope: 'local' })

  if (error) {
    console.error('Error signing out:', error)
    return NextResponse.redirect(
      `${origin}/login?message=` +
        encodeURIComponent('Unable to sign out right now. Please try again.'),
      303
    )
  }

  return NextResponse.redirect(`${origin}/login`, 303)
}
