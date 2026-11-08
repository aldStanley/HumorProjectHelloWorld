'use client'

// "Kill" a run stuck at 'running'. Runs execute in the browser, so a closed
// tab strands the row — this marks it canceled and refreshes the list.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { cancelOpsRunAction } from '../run-actions'

export default function CancelRunButton({ runId }: { runId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const cancel = () => {
    setError(null)
    startTransition(async () => {
      const res = await cancelOpsRunAction({ runId })
      if (!res.ok) {
        setError(res.error ?? 'Could not cancel.')
        return
      }
      router.refresh()
    })
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={cancel}
        disabled={pending}
        title="This run's tab is gone — nothing is executing. Mark the row canceled."
        className="rounded border border-[rgb(var(--gloss)/0.6)] px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 transition hover:brightness-110 disabled:opacity-50 dark:border-[rgb(var(--gloss)/0.15)] dark:text-rose-400"
      >
        {pending ? '…' : '✕ kill'}
      </button>
      {error ? (
        <span title={error} className="text-[10px] text-rose-600 dark:text-rose-400">
          ⚠
        </span>
      ) : null}
    </span>
  )
}
