import { pageMetadata } from '@/utils/page-metadata'
import AppHeader from '@/components/app-header'
import FindMeme from '@/components/find-meme'
import { createClient } from '@/utils/supabase/server'

// Public page: the full "Find Meme for Columbia Context" experience, with the
// whole community-context list to browse. No login required.
export const metadata = pageMetadata('find-meme')

export default async function FindMemePage() {
  const supabase = await createClient({ readOnly: true })
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: contextRows } = await supabase
    .from('community_contexts')
    .select('content')
    .order('id', { ascending: true })

  const contexts = (contextRows ?? [])
    .map((r) => r.content as string)
    .filter(Boolean)

  return (
    <main className="relative flex min-h-screen flex-col">
      <AppHeader showLogout={Boolean(user)} />
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">
        <FindMeme contexts={contexts} />
      </div>
    </main>
  )
}
