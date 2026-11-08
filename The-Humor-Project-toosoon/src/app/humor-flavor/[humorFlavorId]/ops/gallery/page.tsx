import { flavorPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import AppHeader from '@/components/app-header'

import GalleryClient from './gallery-client'

// The images-and-captions view of the last batch run. It reads the export the
// ops page mirrored into localStorage, so it works whether or not the run was
// archived to the database.
export const generateMetadata = flavorPageMetadata('ops/gallery')

export default async function OpsGalleryPage({
  params,
}: {
  params: Promise<{ humorFlavorId: string }>
}) {
  const { humorFlavorId } = await params
  const flavorId = Number.parseInt(humorFlavorId, 10)
  if (!Number.isFinite(flavorId)) notFound()

  return (
    <main className="relative flex min-h-screen flex-col">
      <AppHeader />
      <div className="flex w-full flex-1 flex-col px-6 py-12">
        <div className="max-w-3xl space-y-3">
          <Link
            href={`/humor-flavor/${flavorId}/ops`}
            className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
          >
            Back to ops
          </Link>
          <h1 className="text-3xl font-semibold sm:text-4xl">
            <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent">
              Images &amp; captions
            </span>
          </h1>
        </div>

        <div className="mt-8 max-w-4xl">
          <GalleryClient flavorId={flavorId} />
        </div>
      </div>
    </main>
  )
}
