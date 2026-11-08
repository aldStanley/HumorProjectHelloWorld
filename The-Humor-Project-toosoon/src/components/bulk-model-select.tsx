'use client'

import { useState } from 'react'

export type ModelChoice = {
  id: number
  name: string
  provider_model_id: string
  is_temperature_supported: boolean
}

export default function BulkModelSelect({ models, onApply, disabled, description }: {
  models: ModelChoice[]
  onApply: (model: ModelChoice) => void | Promise<void>
  disabled?: boolean
  description: string
}) {
  const [modelId, setModelId] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  return (
    <div className="rounded-lg border border-[rgb(var(--primary)/0.3)] bg-[rgb(var(--panel)/0.6)] p-3 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-col gap-1 font-semibold">
          Model for all steps
          <select value={modelId} disabled={disabled || pending} onChange={(event) => {
            setModelId(event.target.value)
            setMessage('')
          }} className="rounded-md border border-[rgb(var(--primary)/0.3)] bg-[rgb(var(--panel))] px-3 py-2 text-[rgb(var(--ink))]">
            <option value="">Choose a model…</option>
            {models.map((model) => <option key={model.id} value={model.id}>{model.name} ({model.provider_model_id})</option>)}
          </select>
        </label>
        <button type="button" disabled={disabled || pending || !modelId} onClick={async () => {
          const model = models.find((entry) => entry.id === Number(modelId))
          if (!model) return
          setPending(true)
          setMessage('')
          try {
            await onApply(model)
            setMessage('Model applied to all steps.')
          } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Unable to change models.')
          } finally {
            setPending(false)
          }
        }} className="rounded-md bg-[rgb(var(--primary))] px-3 py-2 font-semibold text-[rgb(var(--on-primary))] disabled:opacity-50">
          {pending ? 'Applying…' : 'Apply to all steps'}
        </button>
        <p role="status" className="text-xs">{message}</p>
      </div>
      <p className="mt-2 text-xs text-[rgb(var(--muted))]">{description}</p>
    </div>
  )
}
