import Link from 'next/link'

import FlavorWorkbench from '@/components/flavor-workbench'
import { GlobalViewsMenu } from '@/components/tool-directory'
import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

export default async function HomePage() {
  const supabase = await createClient({ readOnly: true })
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // The flavor tooling is login-only; Find Meme lives on its own public page
  // at /find-meme, linked from the side menu.
  const { data: humorFlavors } = user
    ? await supabase
        .from('humor_flavors')
        .select(
          'id, slug, description, created_datetime_utc, modified_datetime_utc, is_pinned'
        )
        .order('created_datetime_utc', { ascending: false })
    : { data: null }

  // The user's hearts (RLS already scopes rows to the signed-in user).
  const { data: favoriteRows } = user
    ? await supabase
        .from('humor_flavor_favorites')
        .select('flavor_id')
        .eq('is_favorite', true)
    : { data: null }
  const favoriteIds = new Set((favoriteRows ?? []).map((r) => r.flavor_id))

  // Direction per flavor: reverse (text-first) flavors are the ones with an
  // R1 chain step — there is no schema flag. One query covers all flavors.
  const { data: reverseStepRows } = user
    ? await supabase
        .from('humor_flavor_steps')
        .select('humor_flavor_id')
        .like('description', 'R1%')
    : { data: null }
  const textFirstIds = new Set(
    (reverseStepRows ?? []).map((r) => r.humor_flavor_id)
  )

  const flavorsWithFavorites = (humorFlavors ?? []).map((f) => ({
    ...f,
    is_favorite: favoriteIds.has(f.id),
    direction: textFirstIds.has(f.id)
      ? ('text-first' as const)
      : ('image-first' as const),
  }))

  return (
    <main className="relative flex min-h-screen flex-col">
      <AppHeader titleHref={null} showLogout={Boolean(user)} />

      <div className="mx-auto flex w-full max-w-7xl flex-1 items-start gap-4 px-4 py-4">
        {user ? (
          <>
            <aside className="hidden w-44 shrink-0 lg:block">
              <div className="sticky top-4">
                <GlobalViewsMenu />
              </div>
            </aside>
            <div className="min-w-0 flex-1">
              <FlavorWorkbench flavors={flavorsWithFavorites} />
              <div className="mt-6 lg:hidden">
                <GlobalViewsMenu />
              </div>
            </div>
          </>
        ) : (
          <p className="px-2 text-sm text-[rgb(var(--muted))]">
            Team member?{' '}
            <Link
              href="/login"
              className="font-semibold text-[rgb(var(--accent-strong))] hover:underline"
            >
              Log in
            </Link>{' '}
            for the flavor tools. Or try{' '}
            <Link
              href="/find-meme"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-[rgb(var(--accent-strong))] hover:underline"
            >
              Find Meme for Columbia Context
            </Link>
            .
          </p>
        )}
      </div>
    </main>
  )
}
