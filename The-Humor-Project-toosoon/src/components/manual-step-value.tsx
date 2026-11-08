'use client'

import { useEffect, useState } from 'react'

// Keep drafts separate from active outputs: downstream runs only see applied values.
export default function ManualStepValue({ initial = '', onApply, onClear, disabled }: {
  initial?: string
  onApply: (text: string) => void
  onClear?: () => void
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(initial)
  const [message, setMessage] = useState('')
  useEffect(() => { setDraft(initial); setMessage('') }, [initial])
  return (
    <details className="mt-3 rounded-lg border border-[rgb(var(--primary)/0.3)] p-3" onClick={(event) => event.stopPropagation()}>
      <summary className="cursor-pointer text-xs font-semibold">Enter / reuse a step value</summary>
      <p className="my-2 text-xs text-[rgb(var(--muted))]">Paste text or JSON from another run. Applying a value skips generation for this step until you clear it. Use the same format as this step’s normal output.</p>
      <textarea aria-label="Manual step output" value={draft} disabled={disabled} onChange={(event) => { setDraft(event.target.value); setMessage('') }} rows={6} spellCheck={false}
        className="w-full resize-y rounded-md border border-[rgb(var(--primary)/0.3)] bg-[rgb(var(--panel))] p-2 font-mono text-xs text-[rgb(var(--ink))]"
        placeholder="Enter a value or paste output from another run…" />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <button type="button" disabled={disabled || !draft.trim()} className="rounded-md bg-[rgb(var(--primary))] px-3 py-1.5 font-semibold text-[rgb(var(--on-primary))] disabled:opacity-50" onClick={() => {
          try { onApply(draft); setMessage('Manual value applied.') }
          catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to apply value.') }
        }}>Use manual value</button>
        {onClear ? <button type="button" disabled={disabled} className="rounded-md border border-[rgb(var(--primary)/0.3)] px-3 py-1.5" onClick={() => { onClear(); setMessage('Manual value cleared. Generation is enabled.') }}>Clear manual value</button> : null}
        <span role="status">{message}</span>
      </div>
    </details>
  )
}
