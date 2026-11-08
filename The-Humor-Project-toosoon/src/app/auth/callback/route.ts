import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import type { ProfileAdminFlag } from '@/types/profile'

const FALLBACK_SITE_URL = 'http://localhost:3003'

const getConfiguredSiteOrigin = () => {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (!siteUrl) {
    return null
  }

  try {
    return new URL(siteUrl).origin
  } catch {
    return null
  }
}

const getRequestOrigin = (request: NextRequest) => {
  const configuredSiteOrigin = getConfiguredSiteOrigin()
  if (configuredSiteOrigin) {
    return configuredSiteOrigin
  }

  const forwardedHost =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const forwardedProto =
    request.headers.get('x-forwarded-proto') ??
    (forwardedHost?.includes('localhost') ? 'http' : 'https')

  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`
  }

  return FALLBACK_SITE_URL
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const origin = getRequestOrigin(request)

  // Provider failures return an error instead of an authorization code.
  // Do not forward error_description: it can contain OAuth credentials/codes.
  if (requestUrl.searchParams.has('error')) {
    const message =
      requestUrl.searchParams.get('error') === 'access_denied'
        ? 'Google sign-in was cancelled or denied. Please try again.'
        : 'Google sign-in failed. Check the Google client ID and matching client secret in Supabase, then try again.'

    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(message)}`
    )
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent('No code provided')}`
    )
  }

  const supabase = await createClient()
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(
    code
  )

  if (exchangeError) {
    console.error('Error exchanging code for session:', exchangeError)
    await supabase.auth.signOut({ scope: 'local' })
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent('Failed to exchange code')}`
    )
  }

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      console.error('Error getting user:', userError)
      await supabase.auth.signOut({ scope: 'local' })
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(
          'Failed to get user information'
        )}`
      )
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('is_superadmin,is_matrix_admin')
      .eq('id', user.id)
      .single<ProfileAdminFlag>()

    if (profileError) {
      console.error('Error checking profile:', profileError)
      await supabase.auth.signOut({ scope: 'local' })
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent('Error checking user profile')}`
      )
    }

    const hasAccess =
      profile?.is_superadmin === true || profile?.is_matrix_admin === true

    if (!hasAccess) {
      console.error('User lacks admin access:', user.id)
      await supabase.auth.signOut({ scope: 'local' })
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(
          'Access denied. Superadmin or matrix admin privileges required.'
        )}`
      )
    }

    console.log('Successfully authenticated admin:', user.id)
    return NextResponse.redirect(new URL('/', origin), 303)
  } catch (error) {
    console.error('Unexpected error in auth callback:', error)
    await supabase.auth.signOut({ scope: 'local' })
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        'An unexpected error occurred during sign in'
      )}`
    )
  }
}
