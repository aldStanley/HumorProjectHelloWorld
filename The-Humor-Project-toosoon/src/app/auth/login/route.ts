import { NextResponse } from 'next/server'

import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  const requestUrl = new URL(request.url)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  const origin = siteUrl ?? requestUrl.origin

  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
  if (!siteUrl) {
    return NextResponse.redirect(
      `${origin}/login?message=` +
        encodeURIComponent(
          'Site URL is not configured. Please try again later.'
        ),
      303
    )
  }

  const redirectTo = new URL('/auth/callback', siteUrl)

  if (!googleClientId) {
    return NextResponse.redirect(
      `${origin}/login?message=` +
        encodeURIComponent(
          'Google login is not configured. Please try again later.'
        ),
      303
    )
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectTo.toString(),
      queryParams: { client_id: googleClientId },
    },
  })

  if (error || !data?.url) {
    return NextResponse.redirect(
      `${origin}/login?message=` +
        encodeURIComponent('Unable to sign in right now. Please try again.'),
      303
    )
  }

  return NextResponse.redirect(data.url, 303)
}
