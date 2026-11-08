import { pageMetadata } from '@/utils/page-metadata'
import { redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

import SidechatTopicsClient from './topics-client'

export const metadata = pageMetadata('sidechat-topics')

export default async function SidechatTopicsPage() {
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
              Topics with their raw posts
            </span>
          </h1>
          <p className="text-sm text-[rgb(var(--muted))]">
            Raw Sidechat posts grouped two ways. <strong>Event clusters</strong> builds
            bottom-up from the posts — one cluster = one specific happening, never a
            theme rollup. <strong>Brain topics</strong> shows the Student Brain&rsquo;s own
            clusters (the same retrieval{' '}
            <code className="text-xs">{'${studentBrainOutput}'}</code> sees) with posts
            assigned under them, so you can compare what the brain thinks against what
            the feed actually contains. Posts are ordered by upvotes throughout.
          </p>
        </div>

        <div className="mt-8">
          <SidechatTopicsClient />
        </div>
      </div>
    </main>
  )
}
