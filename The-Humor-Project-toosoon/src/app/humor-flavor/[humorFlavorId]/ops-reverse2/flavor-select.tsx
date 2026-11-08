'use client'

// "Flavor being inspected" dropdown in the Inspector header — navigates to the
// same surface for another text-first flavor.
import { useRouter } from 'next/navigation'

export default function FlavorSelect({
  flavors,
  currentId,
}: {
  flavors: { id: number; slug: string }[]
  currentId: number
}) {
  const router = useRouter()
  return (
    <label className="flex items-baseline gap-2 text-sm">
      <span className="opacity-60">Flavor being inspected:</span>
      <select
        className="max-w-md rounded-lg border border-[rgb(var(--muted)/0.4)] bg-[rgb(var(--panel))] px-2 py-1 text-sm"
        value={currentId}
        onChange={(e) => router.push(`/humor-flavor/${e.target.value}/ops-reverse2`)}
      >
        {flavors.map((f) => (
          <option key={f.id} value={f.id}>
            {f.slug} ({f.id})
          </option>
        ))}
      </select>
    </label>
  )
}
