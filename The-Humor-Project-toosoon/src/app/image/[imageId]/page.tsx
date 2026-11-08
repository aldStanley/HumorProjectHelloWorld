import { pageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

type ImageDetailRow = {
  id: string
  url: string | null
  image_description: string | null
  created_datetime_utc: string
  additional_context: string | null
  celebrity_recognition: string | null
}

const formatDate = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

export const metadata = pageMetadata('image')

export default async function ImageDetailPage({
  params,
}: {
  params: Promise<{ imageId: string }>
}) {
  const { imageId } = await params

  if (!imageId) {
    notFound()
  }

  const supabase = await createClient({ readOnly: true })
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  const { data: image, error: imageError } = await supabase
    .from('images')
    .select(
      'id, url, image_description, created_datetime_utc, additional_context, celebrity_recognition'
    )
    .eq('id', imageId)
    .maybeSingle()

  if (imageError || !image) {
    notFound()
  }

  const imageRow = image as ImageDetailRow
  const imageUrl = imageRow.url ?? null
  const imageAlt = imageRow.image_description ?? 'Image preview'

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_18%,rgb(var(--ambient-spot-1)/0.5),transparent_48%),radial-gradient(circle_at_82%_8%,rgb(var(--ambient-spot-2)/0.32),transparent_42%),radial-gradient(circle_at_30%_85%,rgb(var(--ambient-spot-3)/0.38),transparent_55%),linear-gradient(130deg,rgb(var(--ambient-base-1)/1),rgb(var(--ambient-base-2)/0.7),rgb(var(--ambient-base-3)/0.45))] dark:bg-[radial-gradient(circle_at_18%_18%,rgb(var(--ambient-spot-1)/0.12),transparent_48%),radial-gradient(circle_at_78%_15%,rgb(var(--ambient-spot-2)/0.18),transparent_45%),linear-gradient(140deg,rgb(var(--ambient-base-1)/0.98),rgb(var(--ambient-base-2)/0.98),rgb(var(--ambient-base-3)/0.99))]" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(120deg,rgb(var(--gloss)/0.7),rgb(var(--gloss)/0)_55%)] opacity-80 mix-blend-screen dark:opacity-40" />
      <div className="pointer-events-none absolute -left-20 top-1/3 h-72 w-72 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-spot-1)/0.75),rgb(var(--ambient-orb-left-2)/0.35),transparent_70%)] blur-3xl animate-float dark:bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-spot-1)/0.18),rgb(var(--ambient-orb-left-2)/0.12),transparent_70%)]" />
      <div className="pointer-events-none absolute right-[-6rem] top-16 h-60 w-60 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-right-1)/0.6),rgb(var(--ambient-orb-right-2)/0.2),transparent_72%)] blur-3xl animate-sway dark:bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-right-1)/0.16),rgb(var(--ambient-orb-right-2)/0.12),transparent_72%)]" />
      <div className="pointer-events-none absolute bottom-[-7rem] left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-bottom-1)/0.6),rgb(var(--ambient-spot-1)/0.3),transparent_70%)] blur-3xl animate-drift dark:bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-bottom-1)/0.14),rgb(var(--ambient-spot-2)/0.1),transparent_70%)]" />

      <AppHeader />

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-start px-6 py-16">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
          >
            Back to Matrix
          </Link>
          <span className="inline-flex items-center rounded-full border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.7)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.4)] dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--muted))]">
            {formatDate(imageRow.created_datetime_utc)}
          </span>
        </div>

        <div className="mt-4 max-w-2xl space-y-4">
          <p className="text-xs uppercase tracking-[0.4em] text-[rgb(var(--muted))]">
            Image details
          </p>
          <h1 className="text-3xl font-semibold sm:text-4xl md:text-5xl">
            <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent drop-shadow-[0_6px_22px_rgb(var(--headline-accent-strong)/0.35)]">
              Image #{imageRow.id.slice(0, 8)}
            </span>
          </h1>
          <p className="text-base text-[rgb(var(--muted))] sm:text-lg">
            Full-size image preview without cropping.
          </p>
        </div>

        <div className="mt-10 grid gap-6">
          <section className="gloss-panel rounded-[32px] border border-[rgb(var(--ambient-spot-3)/0.7)] bg-[linear-gradient(140deg,rgb(var(--ambient-base-1)/0.9),rgb(var(--ambient-spot-1)/0.5))] p-6 shadow-[0_30px_70px_-48px_rgb(var(--ambient-spot-2)/0.55)] backdrop-blur dark:border-[rgb(var(--ambient-spot-2)/0.2)] dark:bg-[linear-gradient(140deg,rgb(var(--ambient-base-1)/0.2),rgb(var(--ambient-base-3)/0.3))]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[rgb(var(--muted))]">
                  Image preview
                </p>
                <h2 className="mt-3 text-2xl font-semibold">Full image</h2>
                <p className="mt-2 text-sm text-[rgb(var(--muted))]">
                  The image is shown without cropping or trimming.
                </p>
              </div>
              <span className="inline-flex items-center rounded-full border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-[rgb(var(--accent-strong))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.55)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--accent))]">
                {imageUrl ? 'Image loaded' : 'No image'}
              </span>
            </div>

            <div className="mt-6 grid gap-4">
              <div className="mx-auto w-full max-w-[920px] rounded-[28px] border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.9)] p-4 shadow-[0_18px_40px_-30px_rgb(var(--accent-strong)/0.45)] dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.05)]">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={imageAlt}
                    className="mx-auto h-auto max-w-full object-contain"
                  />
                ) : (
                  <div className="flex min-h-[320px] w-full items-center justify-center rounded-[20px] bg-[linear-gradient(135deg,rgb(var(--ambient-orb-right-1)/0.3),rgb(var(--ambient-orb-bottom-1)/0.6))] text-xs font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))/0.8] dark:text-[rgb(var(--muted))/0.7]">
                    No image available
                  </div>
                )}
              </div>

              <div className="rounded-[28px] border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] p-5 shadow-[0_18px_40px_-30px_rgb(var(--accent-strong)/0.35)] backdrop-blur dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.1)]">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[rgb(var(--muted))]">
                  Description
                </p>
                <p className="mt-3 text-base text-[rgb(var(--ink))] dark:text-[rgb(var(--ink)/0.9)]">
                  {imageRow.image_description ?? 'No description provided.'}
                </p>
              </div>

              {imageRow.additional_context ? (
                <div className="rounded-[28px] border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] p-5 shadow-[0_18px_40px_-30px_rgb(var(--accent-strong)/0.35)] backdrop-blur dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.1)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[rgb(var(--muted))]">
                    Additional context
                  </p>
                  <p className="mt-3 text-base text-[rgb(var(--ink))] dark:text-[rgb(var(--ink)/0.9)]">
                    {imageRow.additional_context}
                  </p>
                </div>
              ) : null}

              {imageRow.celebrity_recognition ? (
                <div className="rounded-[28px] border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] p-5 shadow-[0_18px_40px_-30px_rgb(var(--accent-strong)/0.35)] backdrop-blur dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.1)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[rgb(var(--muted))]">
                    Celebrity recognition
                  </p>
                  <p className="mt-3 text-base text-[rgb(var(--ink))] dark:text-[rgb(var(--ink)/0.9)]">
                    {imageRow.celebrity_recognition}
                  </p>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
