import { createServerClient } from '@supabase/ssr'
import { getSupabaseAuthCookieOptions } from '@/utils/supabase/authCookies'
import { NextResponse, type NextRequest } from 'next/server'

import { getSupabasePublicEnv } from '@/utils/supabase/env'

const publicRoutes = ['/login', '/auth/login', '/auth/callback', '/auth/logout']

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const { supabaseUrl, supabasePublicKey } = getSupabasePublicEnv()
  const supabase = createServerClient(supabaseUrl, supabasePublicKey, {
    cookieOptions: getSupabaseAuthCookieOptions(supabaseUrl),
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value)
        })
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        })
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  const {
    data: { session },
  } = await supabase.auth.getSession()

  const path = request.nextUrl.pathname
  const isPublicRoute = publicRoutes.some((route) => path.startsWith(route))

  if (!session && !isPublicRoute) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/login'
    redirectUrl.searchParams.set('redirectedFrom', path)
    return NextResponse.redirect(redirectUrl)
  }

  if (session && path.startsWith('/login')) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/'
    return NextResponse.redirect(redirectUrl)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
}
