'use client'

// The style constants and two atoms shared by the POV Joke Maker's surface and
// its premise-first result block. They live here rather than in either
// component so the two files do not have to import from each other.

import { useState } from 'react'

import { JsonTree } from '@/components/json-tree'

export const SECTION =
  'scroll-mt-6 rounded-2xl bg-[rgb(var(--panel)/0.55)] p-8 dark:bg-[rgb(var(--panel)/0.2)]'
export const SECTION_NUMBER =
  'text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))]'
export const SECTION_TITLE = 'mt-2 text-2xl font-semibold'
export const GOAL_TEXT =
  'mt-3 max-w-3xl text-sm leading-relaxed text-[rgb(var(--muted))]'
export const BIG_BUTTON =
  'rounded-lg bg-[rgb(var(--accent-strong))] px-7 py-3.5 text-base font-bold text-white shadow-md transition hover:brightness-110 disabled:opacity-40'
export const SMALL_BUTTON =
  'rounded-lg border border-[rgb(var(--gloss)/0.5)] px-3.5 py-2 text-sm font-semibold transition hover:bg-[rgb(var(--panel)/0.8)] disabled:opacity-40 dark:border-[rgb(var(--gloss)/0.2)]'
export const TEXTAREA =
  'w-full rounded-lg border border-[rgb(var(--gloss)/0.5)] bg-transparent p-3 text-sm leading-relaxed dark:border-[rgb(var(--gloss)/0.2)]'
export const FIELD_LABEL = 'block text-sm font-semibold'
export const FIELD_HELP = 'mt-1 text-xs text-[rgb(var(--muted))]'

// Renders nothing when the model omitted the field or returned null — the
// composite children (value plus an " — explanation" tail) are flattened
// first, so a field whose parts are all missing disappears entirely rather
// than leaving a dangling label.
export function Field({
  term,
  children,
}: {
  term: string
  children?: React.ReactNode
}) {
  const parts = (Array.isArray(children) ? children : [children]).filter(
    (part) => typeof part === 'string' || typeof part === 'number'
  )
  const text = parts.join('').trim()
  if (!text) return null
  // The label is the quiet part and the value is the dark part — the reverse
  // reads as a wall of identical bold-then-grey lines with nothing standing
  // out, which is what these blocks looked like before.
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
        {term}
      </dt>
      <dd className="mt-0.5 text-sm leading-relaxed">{text}</dd>
    </div>
  )
}

// A copy button that says it copied. Used wherever a caption is the thing
// being taken away from the page.
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={SMALL_BUTTON}
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  )
}

// A step's raw output text, laid out the way the Flavor Maker lays out any
// step's JSON (the shared JsonTree): every key an uppercase label, lists of
// like objects as a comparison table, scores in colour. Falls back to the raw
// text when the output is not JSON. Code fences around the JSON are tolerated,
// since some models wrap their output in them.
export function StructuredOutput({ text }: { text: string }) {
  const trimmed = text.trim()
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let parsed: unknown = null
  let ok = false
  try {
    parsed = JSON.parse(unfenced)
    ok = true
  } catch {
    ok = false
  }
  if (!ok) {
    return (
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-relaxed">
        {text}
      </pre>
    )
  }
  return (
    <div className="space-y-4">
      <JsonTree data={parsed} />
      <div>
        <CopyButton text={text} label="Copy the raw JSON" />
      </div>
    </div>
  )
}
