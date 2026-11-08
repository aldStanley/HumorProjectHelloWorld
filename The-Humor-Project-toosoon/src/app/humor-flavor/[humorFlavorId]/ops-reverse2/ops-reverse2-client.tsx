'use client'

/* eslint-disable react/no-danger */
// ops-reverse2 client: the Reverse Flavor Inspector's interactive shell —
// run picker, moment strip, per-candidate trace pager.
// Read-only over archived runs: editing prompts and re-running live on the
// Reverse Flavor Maker (ops-reverse), which archives every chain it executes.
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { OPS2_CSS, type DbStep } from '../ops2/trace-lib'

import {
  buildReverseWorkbench,
  parseIntent,
  renderIntentCard,
  renderStepPromptChanges,
  SXS_CSS,
  type RevArchStep,
  type RevWorkbench,
  type SpecStep,
} from './reverse-trace-lib'

type MomentRow = {
  runImageId: string
  position: number
  status: string
  error: string | null
  imageUrl: string | null
  moment: string
  outputs: Record<string, unknown>
}

type Props = {
  flavorId: number
  flavorSlug: string
  steps: DbStep[]
  runs: { id: string; label: string }[]
  runId: string | null
  runLabel: string
  specSteps: SpecStep[]
  moments: MomentRow[]
  momentId: string | null
  arch: RevArchStep[]
  // Baseline RUN of the same flavor whose prompt snapshot the diffs compare
  // against (prompts get edited between runs).
  diffSource: {
    label: string
    steps: { orderBy: number; description: string; systemPrompt: string; userPrompt: string }[]
  } | null
  diffRunId: string | null
  flavorIntent: string
  setUrlByKey: Record<string, string>
}

// The selected trace: image + caption + verdict pinned in a sticky left rail
// (ops2 pattern). Which trace is selected is chosen by the step-2 caption
// picker at the top of the page.
function TracePager({ wb, idx }: { wb: RevWorkbench; idx: number }) {
  const sel = wb.traces[Math.min(idx, wb.traces.length - 1)] ?? null
  if (!sel) return null
  return (
    <div className="tracepage">
      <aside className="tracerail" dangerouslySetInnerHTML={{ __html: sel.railHtml }} />
      <div dangerouslySetInnerHTML={{ __html: sel.chainHtml }} />
    </div>
  )
}

export default function OpsReverse2Client(props: Props) {
  const router = useRouter()
  const [traceIdx, setTraceIdx] = useState(0)
  // Input-value sidebar: opened by clicking a ${...} read in any prompt
  // column. Values come from the archived call's prior_outputs.
  const [inspect, setInspect] = useState<{ title: string; sub: string; value: string } | null>(null)

  useEffect(() => {
    if (!inspect) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInspect(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inspect])

  // Delegated: catches every a.readlink rendered inside the workbench HTML
  // (traces AND step cards).
  const onReadClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a.readlink') as HTMLElement | null
    if (!a) return
    e.preventDefault()
    const slot = a.dataset.slot || ''
    const stepN = Number(a.dataset.step)
    const branch = a.dataset.branch || ''
    const row =
      props.arch.find(
        (r) => (r.stepOrderBy ?? r.position) === stepN && (r.branchLabel ?? '') === branch
      ) ?? null
    const raw = row?.priorOutputs?.[slot]
    setInspect({
      title: `\${${slot}}`,
      sub: `as read by ${row?.opTitle ?? `step ${stepN}`}${branch ? ` · ${branch}` : ''}`,
      value: raw == null ? '(not archived for this call)' : String(raw),
    })
  }

  // JSON values read better pretty-printed; everything else verbatim.
  const prettyValue = (v: string) => {
    try {
      return JSON.stringify(JSON.parse(v), null, 2)
    } catch {
      return v
    }
  }

  const selMoment = props.moments.find((m) => m.runImageId === props.momentId) ?? null
  const wb = useMemo(
    () =>
      selMoment
        ? buildReverseWorkbench({
            flavorId: props.flavorId,
            label: `${props.runLabel} · moment ${selMoment.position + 1}/${props.moments.length}`,
            outputs: selMoment.outputs as Record<string, unknown>,
            arch: props.arch,
            specSteps: props.specSteps,
            dbSteps: props.steps,
            momentStatus: selMoment.status,
            momentError: selMoment.error,
            diffSource: props.diffSource?.steps.length ? props.diffSource : null,
            diffIntent: props.flavorIntent,
            setUrlByKey: props.setUrlByKey,
          })
        : null,
    [selMoment, props]
  )

  // Per-step prompt diffs: THIS run's spec snapshot vs the baseline run's spec
  // snapshot (what actually ran each time) — only steps that actually differ.
  // Runs archived before spec snapshots existed fall back to current DB steps.
  const intent = useMemo(() => parseIntent(props.flavorIntent), [props.flavorIntent])
  const promptDiffs = useMemo(() => {
    if (!props.diffSource?.steps.length) return []
    const out: { orderBy: number; description: string; html: string }[] = []
    const cur = props.specSteps.length
      ? props.specSteps.map((s) => ({
          orderBy: s.orderBy,
          description: s.description,
          systemPrompt: s.systemPrompt,
          userPrompt: s.userPrompt,
        }))
      : props.steps
    for (const s of cur) {
      // description only — an orderBy fallback would diff renumbered steps
      // against the wrong sibling; no match = new step, diffed as all-added
      const src = props.diffSource.steps.find((x) => x.description === s.description)
      const html = renderStepPromptChanges(
        { systemPrompt: src?.systemPrompt ?? '', userPrompt: src?.userPrompt ?? '' },
        { systemPrompt: s.systemPrompt, userPrompt: s.userPrompt },
        'baseline run',
        intent.entries
      )
      if (html) out.push({ orderBy: s.orderBy, description: s.description, html })
    }
    return out
  }, [props.diffSource, props.specSteps, props.steps, intent])

  const setParam = (key: 'run' | 'moment', value: string) => {
    const q = new URLSearchParams(window.location.search)
    if (value) q.set(key, value)
    else q.delete(key)
    if (key === 'run') q.delete('moment')
    router.push(`?${q.toString()}`)
  }

  const inputStyle = { background: 'var(--panel)', borderColor: 'var(--line)' }

  return (
    <div className="ops2root -mx-6 mt-4 px-6 py-2" onClick={onReadClick}>
      <style dangerouslySetInnerHTML={{ __html: OPS2_CSS + SXS_CSS }} />

      {/* sticky toolbar: run picker + diff-source picker + anchors */}
      <div
        className="sticky top-0 z-10 -mx-6 border-b px-6 py-2 text-sm"
        style={{ background: 'var(--bg)', borderColor: 'var(--line)' }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs" style={{ color: 'var(--dim)' }}>
            run being inspected
          </label>
          <select
            className="rounded border px-2 py-1"
            style={inputStyle}
            value={props.runId ?? ''}
            onChange={(e) => setParam('run', e.target.value)}
          >
            {props.runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <nav className="ml-auto flex gap-3">
            <a href={`/humor-flavor/${props.flavorId}/ops-reverse2/compare${props.runId ? `?a=${props.runId}` : ''}`}>
              compare two runs →
            </a>
            {props.diffSource ? <a href="#changes">prompt changes</a> : null}
            <a href="#traces">caption trace</a>
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <label className="text-xs" style={{ color: 'var(--dim)' }}>
            tracing differences vs this earlier run of the same flavor (optional)
          </label>
          <select
            className="rounded border px-2 py-1"
            style={inputStyle}
            value={props.diffRunId ?? ''}
            onChange={(e) => {
              const q = new URLSearchParams(window.location.search)
              q.set('diff', e.target.value || 'none')
              router.push(`?${q.toString()}`)
            }}
          >
            <option value="">— none —</option>
            {props.runs
              .filter((r) => r.id !== props.runId)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
          </select>
        </div>
      </div>

      {/* selection flow: pick a moment, then pick one of its captions to trace */}
      {props.moments.length ? (
        <section className="pt-3">
          <h2>To see a trace for a caption</h2>
          <div className="text-sm">
            1. Select a <b>moment</b> in this batch:
          </div>
          <div className="py-2">
            <table className="grid vboard" style={{ tableLayout: 'fixed', width: '100%' }}>
              <tbody>
                {props.moments.map((m) => {
                  const selected = m.runImageId === props.momentId
                  return (
                    <tr
                      key={m.runImageId}
                      onClick={() => {
                        setTraceIdx(0)
                        setParam('moment', m.runImageId)
                      }}
                      style={{
                        cursor: 'pointer',
                        background: selected ? 'rgb(255 221 0 / 0.4)' : undefined,
                        boxShadow: selected ? 'inset 4px 0 0 rgb(245 200 0)' : undefined,
                        fontWeight: selected ? 600 : undefined,
                      }}
                      title={selected ? undefined : 'click to select — the row expands to the full moment text'}
                    >
                      <td style={{ width: 36 }}>{m.position + 1}</td>
                      <td
                        style={
                          selected
                            ? undefined
                            : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
                        }
                      >
                        {m.moment || `moment ${m.position + 1}`}
                        {m.status !== 'done' ? (
                          <span className="chip bad-chip" style={{ marginLeft: 8 }}>
                            {m.status}
                            {m.error ? ` — ${m.error.slice(0, 80)}` : ''}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {wb ? (
            <>
              <div className="pt-6 text-sm">
                2. Select a <b>caption</b> for this moment to trace — all {wb.traces.length}{' '}
                jokes the pipeline wrote, ✔ ranked and ✘ dropped (click a row):
              </div>
              <div className="overflow-x-auto py-2">
                <table className="grid vboard">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>image</th>
                      <th className="cap-col">caption</th>
                      <th>entity</th>
                      <th>pov</th>
                      <th>alignment</th>
                      <th>verdict</th>
                      <th>why dropped</th>
                      <th>trace</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wb.traces.map((t) => (
                      <tr
                        key={t.idx}
                        onClick={() => {
                          setTraceIdx(t.idx)
                          document.getElementById('traces')?.scrollIntoView({ behavior: 'smooth' })
                        }}
                        style={{
                          cursor: 'pointer',
                          background: t.idx === traceIdx ? 'rgb(255 221 0 / 0.4)' : undefined,
                          boxShadow: t.idx === traceIdx ? 'inset 4px 0 0 rgb(245 200 0)' : undefined,
                        }}
                        title={`trace “${t.caption}”`}
                      >
                        <td>{t.idx + 1}</td>
                        <td>
                          {t.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={t.imageUrl} alt={t.imageKey} style={{ width: 72, borderRadius: 6 }} />
                          ) : (
                            <span className="mono small">{t.imageKey}</span>
                          )}
                        </td>
                        <td>“{t.caption}”</td>
                        <td>{t.entity ?? '—'}</td>
                        <td>
                          {t.alt ? (
                            <span className="chip" style={{ background: 'var(--accent)', color: 'var(--bg)' }}>
                              ALT
                            </span>
                          ) : (
                            <span className="chip">Me</span>
                          )}{' '}
                          {t.entity ? (
                            t.anchored ? (
                              <span className="chip good-chip" title="entity string appears verbatim in the moment">
                                named
                              </span>
                            ) : (
                              <span className="chip" title="entity does not appear verbatim in the moment — the model abstracted it from the text">
                                abstracted
                              </span>
                            )
                          ) : null}
                        </td>
                        <td>
                          {t.alignment != null ? (
                            <span className={`pill ${t.alignment >= 0.7 ? 'sc-hi' : t.alignment >= 0.4 ? 'sc-mid' : 'sc-lo'}`}>
                              {Math.round(t.alignment * 100) / 100}
                            </span>
                          ) : (
                            <span className="pill sc-none">—</span>
                          )}
                        </td>
                        <td>
                          {t.kind === 'selected' ? (
                            <b style={{ color: 'var(--good)', whiteSpace: 'nowrap' }}>✔ ranked #{t.rank ?? '?'}</b>
                          ) : (
                            <b style={{ color: 'var(--bad)', whiteSpace: 'nowrap' }}>✘ dropped</b>
                          )}
                        </td>
                        <td className="small">
                          {t.kind === 'dropped' ? (
                            t.reason ?? <span className="dim">no reason archived</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          <a className="tracelink" href="#traces">
                            trace →
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {wb ? (
        <>
          <h2 id="traces">
            Caption trace — how caption {Math.min(traceIdx, wb.traces.length - 1) + 1} was made
          </h2>
          <p className="max-w-4xl text-sm" style={{ color: 'var(--dim)' }}>
            This section follows the caption you selected above through every step that produced
            it — the moment analysis, the image selection that brought in its image, the
            caption-writing branch, and the final ranking verdict — so you can see why it came
            out the way it did. Each step shows the prompt it ran with on the left and its
            output on the right.
          </p>
          <TracePager wb={wb} idx={traceIdx} />
        </>
      ) : (
        <p className="py-6" style={{ color: 'var(--dim)' }}>
          {props.runLabel}
        </p>
      )}

      {/* what this run changes vs the baseline run — the same changed blocks
          are also boxed ✚ in place inside each changed step's node above */}
      {props.diffSource ? (
        <section id="changes" className="py-2">
          <h2>Prompt changes — what this run changed vs the baseline run</h2>
          <p className="max-w-4xl text-sm" style={{ color: 'var(--dim)' }}>
            This section shows the prompt edits you made between the two runs, so you can
            connect a change in the outputs to the change that caused it. It diffs this
            run&apos;s archived prompts against baseline run <b>{props.diffSource.label}</b>,
            step by step. The same changed blocks are also boxed ✚ inside each changed
            step&apos;s node in the caption trace above.
          </p>
          {props.diffSource.steps.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--dim)' }}>
              the baseline run predates prompt archiving — no snapshot to diff against
            </p>
          ) : (
            <>
              {intent.global ? (
                <div className="max-w-4xl" dangerouslySetInnerHTML={{ __html: renderIntentCard(intent.global) }} />
              ) : null}
              {promptDiffs.length ? (
                promptDiffs.map((d) => (
                  <div key={d.orderBy} className="mb-4">
                    <div className="text-sm font-semibold">
                      S{d.orderBy} · {d.description}
                    </div>
                    <div dangerouslySetInnerHTML={{ __html: d.html }} />
                  </div>
                ))
              ) : (
                <p className="text-sm" style={{ color: 'var(--dim)' }}>
                  prompts are identical in both runs
                </p>
              )}
            </>
          )}
        </section>
      ) : null}

      {/* input-value sidebar */}
      {inspect ? (
        <aside
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            width: 'min(600px, 92vw)',
            height: '100vh',
            zIndex: 40,
            background: 'var(--panel)',
            borderLeft: '1px solid var(--line)',
            boxShadow: '-16px 0 40px rgb(0 0 0 / 0.18)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            className="flex items-baseline gap-3 border-b px-4 py-3"
            style={{ borderColor: 'var(--line)' }}
          >
            <span className="mono text-sm font-bold" style={{ color: 'var(--addr-ink)' }}>
              {inspect.title}
            </span>
            <span className="text-xs" style={{ color: 'var(--dim)' }}>
              {inspect.sub}
            </span>
            <button
              className="ml-auto rounded px-2 py-0.5 text-sm font-semibold"
              style={{ background: 'var(--chip-bg)', color: 'var(--ink)' }}
              onClick={() => setInspect(null)}
              title="close (Esc)"
            >
              ✕ close
            </button>
          </div>
          <pre
            className="mono"
            style={{
              flex: 1,
              overflow: 'auto',
              margin: 0,
              padding: '12px 16px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 12,
              lineHeight: 1.5,
              color: 'var(--ink)',
              background: 'var(--prompt-bg)',
            }}
          >
            {prettyValue(inspect.value)}
          </pre>
          <div
            className="border-t px-4 py-2 text-xs"
            style={{ borderColor: 'var(--line)', color: 'var(--dim)' }}
          >
            {inspect.value.length.toLocaleString()} characters · archived verbatim from this call&apos;s
            prior_outputs
          </div>
        </aside>
      ) : null}
    </div>
  )
}
