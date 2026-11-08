'use client'

import { useState, useTransition } from 'react'

import { saveFlavorFavorite } from './actions'

type Props = {
  flavorId: number
  flavorSlug: string
  initialIsFavorite: boolean
}

// Compact heart toggle for the workbench pages (ops / ops-reverse). Heart-only:
// the comment saved on the flavor page is left untouched.
export default function FlavorHeart({
  flavorId,
  flavorSlug,
  initialIsFavorite,
}: Props) {
  const [isFavorite, setIsFavorite] = useState(initialIsFavorite)
  const [pending, startTransition] = useTransition()

  const toggle = () => {
    const next = !isFavorite
    setIsFavorite(next)
    startTransition(async () => {
      const res = await saveFlavorFavorite({ flavorId, isFavorite: next })
      if (!res.ok) setIsFavorite(!next)
    })
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={isFavorite}
      aria-label={
        isFavorite
          ? `Remove ${flavorSlug} from favorites`
          : `Add ${flavorSlug} to favorites`
      }
      title={isFavorite ? 'Unfavorite' : 'Favorite'}
      className={`rounded-full px-1.5 py-0.5 text-2xl leading-none transition disabled:opacity-50 ${
        isFavorite
          ? 'text-[rgb(var(--accent-strong))]'
          : 'text-[rgb(var(--muted)/0.6)] hover:text-[rgb(var(--accent-strong))]'
      }`}
    >
      <span aria-hidden>{isFavorite ? '♥' : '♡'}</span>
    </button>
  )
}
