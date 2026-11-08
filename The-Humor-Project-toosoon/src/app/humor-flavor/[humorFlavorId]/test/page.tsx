import { flavorPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

import StudyImageSetPanel from './study-image-set-panel'

type StudyImageSet = {
  id: number
  slug: string
  description: string | null
}

type StudyImageSetImageMappingRow = {
  study_image_set_id: number
  image:
    | { id: string; url: string | null; additional_context: string | null }
    | { id: string; url: string | null; additional_context: string | null }[]
    | null
}

export const generateMetadata = flavorPageMetadata('test')

export default async function HumorFlavorTestPage({
  params,
}: {
  params: Promise<{ humorFlavorId: string }>
}) {
  const { humorFlavorId } = await params
  const flavorId = Number.parseInt(humorFlavorId, 10)

  if (!Number.isFinite(flavorId)) {
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

  const { data: flavor, error: flavorError } = await supabase
    .from('humor_flavors')
    .select('id, slug, description')
    .eq('id', flavorId)
    .maybeSingle()

  if (flavorError || !flavor) {
    notFound()
  }

  let studyImageSets: StudyImageSet[] = []
  let studyImageSetError: string | null = null
  let studyImageSetMappingError: string | null = null
  let studyImageSetMappings: StudyImageSetImageMappingRow[] = []

  const { data: imageSets, error: imageSetsError } = await supabase
    .from('study_image_sets')
    .select('id, slug, description')
    .order('slug', { ascending: true })

  if (imageSetsError) {
    studyImageSetError = imageSetsError.message
  } else {
    studyImageSets = (imageSets ?? []) as StudyImageSet[]
  }

  if (studyImageSets.length) {
    const { data: mappingRows, error: mappingsError } = await supabase
      .from('study_image_set_image_mappings')
      .select('study_image_set_id, image:images ( id, url, additional_context )')
      .in(
        'study_image_set_id',
        studyImageSets.map((set) => set.id)
      )
      .order('id', { ascending: true })

    if (mappingsError) {
      studyImageSetMappingError = mappingsError.message
    } else {
      studyImageSetMappings =
        (mappingRows ?? []) as StudyImageSetImageMappingRow[]
    }
  }

  const studyImageSetImages = new Map<
    number,
    { id: string; url: string; additional_context: string | null }[]
  >()

  studyImageSetMappings.forEach((mapping) => {
    const image = Array.isArray(mapping.image)
      ? mapping.image[0] ?? null
      : mapping.image

    if (!image?.url) {
      return
    }
    const existing = studyImageSetImages.get(mapping.study_image_set_id) ?? []
    existing.push({
      id: image.id,
      url: image.url,
      additional_context: image.additional_context ?? null,
    })
    studyImageSetImages.set(mapping.study_image_set_id, existing)
  })

  const studyImageSetImagesById: Record<
    string,
    { id: string; url: string; additional_context: string | null }[]
  > = {}

  studyImageSetImages.forEach((images, setId) => {
    studyImageSetImagesById[String(setId)] = images
  })

  const studyImageSetBadge = studyImageSetError
    ? 'Unavailable'
    : `${studyImageSets.length} sets`

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_18%,rgb(var(--ambient-spot-1)/0.5),transparent_48%),radial-gradient(circle_at_82%_8%,rgb(var(--ambient-spot-2)/0.32),transparent_42%),radial-gradient(circle_at_30%_85%,rgb(var(--ambient-spot-3)/0.38),transparent_55%),linear-gradient(130deg,rgb(var(--ambient-base-1)/1),rgb(var(--ambient-base-2)/0.7),rgb(var(--ambient-base-3)/0.45))] dark:bg-[radial-gradient(circle_at_18%_18%,rgb(var(--ambient-spot-1)/0.12),transparent_48%),radial-gradient(circle_at_78%_15%,rgb(var(--ambient-spot-2)/0.18),transparent_45%),linear-gradient(140deg,rgb(var(--ambient-base-1)/0.98),rgb(var(--ambient-base-2)/0.98),rgb(var(--ambient-base-3)/0.99))]" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(120deg,rgb(var(--gloss)/0.7),rgb(var(--gloss)/0)_55%)] opacity-80 mix-blend-screen dark:opacity-40" />
      <div className="pointer-events-none absolute -left-20 top-1/3 h-72 w-72 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-spot-1)/0.75),rgb(var(--ambient-orb-left-2)/0.35),transparent_70%)] blur-3xl animate-float dark:bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-spot-1)/0.18),rgb(var(--ambient-orb-left-2)/0.12),transparent_70%)]" />
      <div className="pointer-events-none absolute right-[-6rem] top-16 h-60 w-60 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-right-1)/0.6),rgb(var(--ambient-orb-right-2)/0.2),transparent_72%)] blur-3xl animate-sway dark:bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-right-1)/0.16),rgb(var(--ambient-orb-right-2)/0.12),transparent_72%)]" />
      <div className="pointer-events-none absolute bottom-[-7rem] left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-bottom-1)/0.6),rgb(var(--ambient-spot-1)/0.3),transparent_70%)] blur-3xl animate-drift dark:bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-bottom-1)/0.14),rgb(var(--ambient-spot-2)/0.1),transparent_70%)]" />

      <AppHeader />

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-start px-6 py-16">
        <div className="flex w-full flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl space-y-4">
            <Link
              href={`/humor-flavor/${flavor.id}`}
              className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
            >
              Back to flavor
            </Link>
            <p className="text-xs uppercase tracking-[0.4em] text-[rgb(var(--muted))]">
              Test
            </p>
            <h1 className="text-3xl font-semibold sm:text-4xl md:text-5xl">
              <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent drop-shadow-[0_6px_22px_rgb(var(--headline-accent-strong)/0.35)]">
                Study image sets
              </span>
            </h1>
            <p className="text-base text-[rgb(var(--muted))] sm:text-lg">
              {flavor.description ?? 'Study image sets for this humor flavor.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center rounded-full border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-[rgb(var(--primary-deep))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.55)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--primary-bright))]">
              {studyImageSetBadge}
            </span>
          </div>
        </div>

        <section className="gloss-panel mt-10 rounded-[32px] border border-[rgb(var(--primary)/0.35)] bg-[linear-gradient(140deg,rgb(var(--primary-bright)/0.22),rgb(var(--primary)/0.12))] p-6 shadow-[0_30px_70px_-48px_rgb(var(--primary-deep)/0.4)] backdrop-blur dark:border-[rgb(var(--primary)/0.25)] dark:bg-[linear-gradient(140deg,rgb(var(--primary-deep)/0.25),rgb(var(--primary)/0.1))]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-[rgb(var(--muted))]">
                Study image sets
              </p>
              <h2 className="mt-3 text-2xl font-semibold">
                Study image set library
              </h2>
              <p className="mt-2 text-sm text-[rgb(var(--muted))]">
                Choose an image set to test your flavor.
              </p>
            </div>
            <span className="inline-flex items-center rounded-full border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-[rgb(var(--primary-deep))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.55)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--primary-bright))]">
              {studyImageSetBadge}
            </span>
          </div>

          <StudyImageSetPanel
            humorFlavorId={flavor.id}
            captionHref={`/humor-flavor/${flavor.id}/captions`}
            imageSets={studyImageSets}
            imageSetImages={studyImageSetImagesById}
            imageSetsError={studyImageSetError}
            mappingError={studyImageSetMappingError}
          />

        </section>
      </div>
    </main>
  )
}
