import { pageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

import SidechatEventsClient from './events-client'

// Sidechat Event Clusters — the "what happened on campus this week" tool.
// Design decisions are recorded in ./sidechat-events-rationale.md.
export const metadata = pageMetadata('sidechat-events')

export default async function SidechatEventsPage() {
  const supabase = await createClient({ readOnly: true })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  return (
    <main className="relative flex min-h-screen flex-col">
      <AppHeader />
      <div className="flex w-full flex-1 flex-col px-6 py-12">
        <div className="max-w-3xl space-y-3">
          <p className="text-xs uppercase tracking-[0.4em] text-[rgb(var(--muted))]">
            Sidechat × Student Brain
          </p>
          <h1 className="text-3xl font-semibold sm:text-4xl">
            <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent">
              Sidechat Event Clusters
            </span>
          </h1>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[rgb(var(--muted))]">
            <li>
              Pulls the last few days of Columbia Sidechat posts from the live Student Brain
              feed and groups them by the specific happening each post was about.
            </li>
            <li>
              Events that drew more than one post come first, ranked by upvotes, so the
              moments the campus actually shared are at the top.
            </li>
            <li>
              One cluster is one specific happening, never a theme. Posts that are pure
              vibes or personal one-offs are kept separate at the bottom.
            </li>
            <li>
              To compare the feed against the Student Brain&rsquo;s own topics instead, use{' '}
              <Link href="/sidechat-topics" className="text-[rgb(var(--accent-strong))] hover:underline">
                Sidechat topics
              </Link>
              .
            </li>
          </ul>
        </div>

        <div className="mt-8">
          <SidechatEventsClient />
        </div>
      </div>
    </main>
  )
}
