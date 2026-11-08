'use client'

/* eslint-disable react/no-danger */
// ops2 client: the trace workbench for an archived run, with the ops-page
// functions ported in — image thumbnail strip, per-step live progress,
// archive-the-rerun (so an AFTER run becomes a first-class ops_run), and the
// full-run JSON export in the same shape ops produces.
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { runStepAction, saveStepPromptAction } from '../chiltrix/actions'
import { finalCaptions } from '../ops/export-format'
import {
  createOpsRunAction,
  finishOpsRunAction,
  finishOpsRunImageAction,
  saveOpsRunStepsAction,
  startOpsRunImageAction,
  type OpsRunStepRecord,
} from '../ops/run-actions'

import { buildWorkbench, OPS2_CSS, type ArchStep, type DbStep, type Workbench } from './trace-lib'

// One trace at a time: a caption strip on top, then the selected trace as its
// own page — image + caption + verdict pinned in a sticky left rail.
function TracePager({ wb, idx, onSelect }: { wb: Workbench; idx: number; onSelect: (i: number) => void }) {
  const sel = wb.traces[Math.min(idx, wb.traces.length - 1)] ?? null
  return (
    <>
      {/* compact pager — the verdict board already lists every caption in full */}
      <div className="capstrip">
        {wb.traces.map((t) => (
          <button
            key={t.idx}
            className="capbtn"
            data-active={t.idx === (sel?.idx ?? -1)}
            data-kind={t.kind}
            title={`“${t.caption}”`}
            onClick={() => onSelect(t.idx)}
          >
            <span className="tno">{t.idx + 1}</span>
            <span className="mark" style={{ color: t.kind === 'selected' ? 'var(--good)' : 'var(--bad)' }}>
              {t.kind === 'selected' ? '✔' : t.kind === 'dropped' ? '✘' : ''}
            </span>
          </button>
        ))}
      </div>
      {sel ? (
        <div className="tracepage">
          <aside className="tracerail" dangerouslySetInnerHTML={{ __html: sel.railHtml }} />
          <div dangerouslySetInnerHTML={{ __html: sel.chainHtml }} />
        </div>
      ) : null}
    </>
  )
}

type Props = {
  flavorId: number
  flavorSlug: string
  steps: DbStep[]
  runs: { id: string; label: string }[]
  runId: string | null
  runLabel: string
  setId: number | null
  setSlug: string | null
  images: { imageId: string; imageUrl: string | null }[]
  imageId: string | null
  imageUrl: string | null
  additionalContext: string | null
  arch: ArchStep[]
}

type StepStatus = 'pending' | 'running' | 'done' | 'error'

export default function Ops2Client(props: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [editStepId, setEditStepId] = useState<number | null>(null)
  const [draftSys, setDraftSys] = useState('')
  const [draftUsr, setDraftUsr] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const [rerunFrom, setRerunFrom] = useState<number | ''>('')
  const [progress, setProgress] = useState<Record<number, StepStatus>>({})
  const [rerunStatus, setRerunStatus] = useState('')
  const [afterArch, setAfterArch] = useState<ArchStep[] | null>(null)
  const [afterFrom, setAfterFrom] = useState<number | null>(null)
  const [traceIdx, setTraceIdx] = useState(0)
  const [afterTraceIdx, setAfterTraceIdx] = useState(0)
  const [running, setRunning] = useState(false)
  const [archiving, setArchiving] = useState(false)
  // Unarchived outputs recovered from the classic ops page's localStorage
  // (`ops-state:<flavorId>` — outputs[opKey][imageId]).
  const [localArch, setLocalArch] = useState<ArchStep[] | null>(null)
  const [localMsg, setLocalMsg] = useState('')

  const loadLocal = (silent = false) => {
    try {
      const raw = localStorage.getItem(`ops-state:${props.flavorId}`)
      if (!raw) { if (!silent) setLocalMsg('no ops-state in localStorage for this flavor'); return }
      const saved = JSON.parse(raw)
      const outputs: Record<string, Record<string, string>> = saved.outputs || {}
      const imgId: string | null = props.imageId ?? saved.imageId ?? null
      if (!imgId) { if (!silent) setLocalMsg('ops-state has no image selection'); return }
      const priors: Record<string, string> = {}
      const arch: ArchStep[] = []
      for (const s of [...props.steps].sort((a, b) => a.orderBy - b.orderBy)) {
        const out = outputs[`step${s.orderBy}`]?.[imgId]
        if (out == null) continue
        arch.push({
          opKey: `step${s.orderBy}`,
          opTitle: `S${s.orderBy} · ${s.description}`,
          stepOrderBy: s.orderBy,
          providerModelId: s.providerModelId,
          includeImage: s.includeImage,
          systemPrompt: s.systemPrompt,
          userPrompt: s.userPrompt,
          priorOutputs: { ...priors },
          output: out,
          error: null,
        })
        priors[String(s.orderBy)] = out
      }
      if (!arch.length) { if (!silent) setLocalMsg(`ops-state has no step outputs for image ${imgId.slice(0, 8)}`); return }
      setLocalArch(arch)
      setLocalMsg(`loaded ${arch.length} step outputs from the ops page's local store (image ${imgId.slice(0, 8)}) — unarchived; prompts shown are the current DB templates`)
    } catch {
      if (!silent) setLocalMsg('could not read/parse ops-state from localStorage')
    }
  }
  // If the archive is empty, try the ops local store automatically.
  useEffect(() => {
    if (!props.arch.length) loadLocal(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.runId, props.imageId])

  const effArch = props.arch.length ? props.arch : localArch ?? []
  const wb = useMemo(
    () =>
      effArch.length
        ? buildWorkbench({
            flavorId: props.flavorId,
            steps: props.steps,
            arch: effArch,
            imageUrl: props.imageUrl,
            additionalContext: props.additionalContext,
            label: (props.arch.length ? props.runLabel : 'ops page local store — unarchived') +
              (props.imageId ? ` · image ${props.imageId.slice(0, 8)}` : ''),
          })
        : null,
    [effArch, props]
  )
  const afterWb = useMemo(
    () =>
      afterArch
        ? buildWorkbench({
            flavorId: props.flavorId,
            steps: props.steps,
            arch: afterArch,
            imageUrl: props.imageUrl,
            additionalContext: props.additionalContext,
            label: `AFTER — re-run from S${afterFrom} with current DB prompts`,
          })
        : null,
    [afterArch, afterFrom, props]
  )

  const editStep = props.steps.find((s) => s.id === editStepId) ?? null
  const openEditor = (s: DbStep) => {
    setEditStepId(s.id)
    setDraftSys(s.systemPrompt)
    setDraftUsr(s.userPrompt)
    setSaveMsg('')
  }
  const save = async (kind: 'system' | 'user') => {
    if (!editStep) return
    setSaveMsg('saving…')
    const r = await saveStepPromptAction({
      flavorId: props.flavorId,
      stepId: editStep.id,
      kind,
      value: kind === 'system' ? draftSys : draftUsr,
    })
    setSaveMsg(r.ok ? `${kind} prompt saved ✓ — re-run from S${editStep.orderBy} to test it` : r.error || 'save failed')
    if (r.ok) startTransition(() => router.refresh())
  }

  const orderOf = (a: ArchStep) => a.stepOrderBy ?? Number((a.opKey.match(/\d+/) || [])[0])

  const rerun = async () => {
    if (!props.imageId || rerunFrom === '') return
    const startN = rerunFrom as number
    setRunning(true)
    setAfterArch(null)
    setAfterFrom(startN)
    const todo = props.steps.filter((s) => s.orderBy >= startN).sort((a, b) => a.orderBy - b.orderBy)
    setProgress(Object.fromEntries(todo.map((s) => [s.orderBy, 'pending' as StepStatus])))
    const priors: Record<string, string> = {}
    for (const a of effArch) {
      const n = orderOf(a)
      if (Number.isFinite(n) && n < startN && a.output) priors[String(n)] = a.output
    }
    const newArch: ArchStep[] = effArch.filter((a) => orderOf(a) < startN).map((a) => ({ ...a }))
    for (const s of todo) {
      setProgress((p) => ({ ...p, [s.orderBy]: 'running' }))
      setRerunStatus(`S${s.orderBy} · ${s.description.slice(0, 60)} (${s.providerModelId})`)
      const t0 = Date.now()
      const r = await runStepAction({
        imageId: props.imageId,
        systemPrompt: s.systemPrompt,
        userPrompt: s.userPrompt,
        providerModelId: s.providerModelId,
        temperature: s.temperature,
        includeImage: s.includeImage,
        isTemperatureSupported: s.isTemperatureSupported,
        priorOutputs: { ...priors },
      })
      if (!r.ok || !r.text) {
        setProgress((p) => ({ ...p, [s.orderBy]: 'error' }))
        setRerunStatus(`S${s.orderBy} failed: ${r.error || 'no output'}`)
        setRunning(false)
        return
      }
      priors[String(s.orderBy)] = r.text
      setProgress((p) => ({ ...p, [s.orderBy]: 'done' }))
      newArch.push({
        opKey: `step${s.orderBy}`,
        opTitle: `S${s.orderBy} · ${s.description}`,
        stepOrderBy: s.orderBy,
        providerModelId: s.providerModelId,
        includeImage: s.includeImage,
        systemPrompt: r.resolvedSystemPrompt ?? s.systemPrompt,
        userPrompt: r.resolvedUserPrompt ?? s.userPrompt,
        priorOutputs: { ...priors },
        output: r.text,
        error: null,
        durationMs: Date.now() - t0,
      } as ArchStep & { durationMs: number })
    }
    setRerunStatus(`done — S${startN}–S${todo[todo.length - 1]?.orderBy} re-ran. AFTER workbench below; archive it to keep it.`)
    setAfterArch(newArch)
    setRunning(false)
  }

  // Persist the AFTER run through the same run-actions the ops batch runner uses.
  const archiveAfter = async () => {
    if (!afterArch || !props.imageId) return
    setArchiving(true)
    setRerunStatus('archiving the AFTER run…')
    const created = await createOpsRunAction({
      flavorId: props.flavorId,
      flavorSlug: props.flavorSlug,
      setId: props.setId,
      setSlug: props.setSlug,
      label: `ops2 re-run from S${afterFrom} (base ${props.runId?.slice(0, 8) ?? '—'})`,
      imageCount: 1,
      spec: {
        source: 'ops2',
        baseRunId: props.runId,
        rerunFrom: afterFrom,
        steps: props.steps.map((s) => ({
          orderBy: s.orderBy,
          description: s.description,
          systemPrompt: s.systemPrompt,
          userPrompt: s.userPrompt,
          providerModelId: s.providerModelId,
          includeImage: s.includeImage,
          temperature: s.temperature,
        })),
      },
    })
    if (!created.ok || !created.runId) {
      setRerunStatus(`archive failed: ${created.error || 'could not create run'}`)
      setArchiving(false)
      return
    }
    const img = await startOpsRunImageAction({
      runId: created.runId,
      imageId: props.imageId,
      imageUrl: props.imageUrl ?? '',
      position: 0,
    })
    if (!img.ok || !img.runImageId) {
      setRerunStatus(`archive failed: ${img.error || 'could not start image'}`)
      setArchiving(false)
      return
    }
    const records: OpsRunStepRecord[] = afterArch.map((a, i) => ({
      opKey: a.opKey,
      opTitle: a.opTitle,
      position: i,
      branchIndex: null,
      branchLabel: null,
      humorFlavorStepId: props.steps.find((s) => s.orderBy === a.stepOrderBy)?.id ?? null,
      stepOrderBy: a.stepOrderBy,
      providerModelId: a.providerModelId,
      temperature: null,
      includeImage: a.includeImage,
      systemPrompt: a.systemPrompt,
      userPrompt: a.userPrompt,
      priorOutputs: a.priorOutputs,
      output: a.output,
      error: a.error,
      durationMs: (a as ArchStep & { durationMs?: number }).durationMs ?? null,
    }))
    await saveOpsRunStepsAction({ runId: created.runId, runImageId: img.runImageId, steps: records })
    const outputs = Object.fromEntries(afterArch.map((a) => [a.opKey, a.output]))
    const last = afterArch[afterArch.length - 1]
    const caps = finalCaptions(last?.output ?? null).captions
    await finishOpsRunImageAction({
      runImageId: img.runImageId,
      status: 'done',
      outputs,
      finalOutput: last?.output ?? null,
      captions: caps,
    })
    await finishOpsRunAction({
      runId: created.runId,
      status: 'done',
      exportJson: exportPayload(afterArch),
      exportWarning: null,
      captionCount: caps.length,
    })
    setArchiving(false)
    setRerunStatus('archived ✓ — switching to the new run')
    router.push(`?run=${created.runId}&image=${props.imageId}`)
  }

  const exportPayload = (arch: ArchStep[]) => ({
    exportedAt: new Date().toISOString(),
    flavorId: props.flavorId,
    flavorSlug: props.flavorSlug,
    setSlug: props.setSlug,
    note: 'Exported from ops2. Prompts are as archived (resolved for batch runs, templates otherwise).',
    spec: {
      steps: props.steps.map((s) => ({
        orderBy: s.orderBy,
        description: s.description,
        systemPrompt: s.systemPrompt,
        userPrompt: s.userPrompt,
        providerModelId: s.providerModelId,
        includeImage: s.includeImage,
        temperature: s.temperature,
      })),
    },
    images: [
      {
        imageId: props.imageId,
        imageUrl: props.imageUrl,
        outputs: Object.fromEntries(arch.map((a) => [a.opKey, a.output])),
        captions: finalCaptions(arch[arch.length - 1]?.output ?? null).captions,
      },
    ],
  })
  const download = (arch: ArchStep[], suffix: string) => {
    const blob = new Blob([JSON.stringify(exportPayload(arch), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${props.flavorSlug}-${props.setSlug ?? 'set'}-${suffix}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const setParam = (key: 'run' | 'image', value: string) => {
    const q = new URLSearchParams(window.location.search)
    q.set(key, value)
    if (key === 'run') q.delete('image')
    router.push(`?${q.toString()}`)
  }

  const btn = 'rounded px-3 py-1 text-sm font-semibold disabled:opacity-40'
  const btnStyle = { background: 'var(--accent)', color: 'var(--bg)' }
  const inputStyle = { background: 'var(--panel)', borderColor: 'var(--line)' }

  return (
    <div className="ops2root -mx-6 mt-4 px-6 py-2">
      <style dangerouslySetInnerHTML={{ __html: OPS2_CSS }} />

      {/* sticky toolbar: pickers + run controls + anchors */}
      <div
        className="sticky top-0 z-10 -mx-6 flex flex-wrap items-center gap-3 border-b px-6 py-2 text-sm"
        style={{ background: 'var(--bg)', borderColor: 'var(--line)' }}
      >
        <select className="rounded border px-2 py-1" style={inputStyle} value={props.runId ?? ''} onChange={(e) => setParam('run', e.target.value)}>
          {props.runs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <span className="flex items-center gap-2">
          from{' '}
          <select className="rounded border px-2 py-1" style={inputStyle} value={rerunFrom} onChange={(e) => setRerunFrom(e.target.value ? Number(e.target.value) : '')}>
            <option value="">step…</option>
            {props.steps.map((s) => (
              <option key={s.id} value={s.orderBy}>
                S{s.orderBy} · {s.description.slice(0, 36)}
              </option>
            ))}
          </select>
          <button className={btn} style={btnStyle} disabled={running || rerunFrom === '' || !props.imageId} onClick={rerun}>
            {running ? 'running…' : 're-run'}
          </button>
        </span>
        {wb ? (
          <button className={btn} style={{ background: 'var(--chip-bg)', color: 'var(--ink)' }} onClick={() => download(effArch, 'run')}>
            ⤓ run JSON
          </button>
        ) : null}
        <button className={btn} style={{ background: 'var(--chip-bg)', color: 'var(--ink)' }} onClick={() => loadLocal(false)} title="read outputs saved by the classic ops page (localStorage), for runs that were never archived">
          ⭯ ops local data
        </button>
        <nav className="ml-auto flex gap-3">
          <a href="#verdict">verdict</a>
          <a href="#diagnostics">diagnostics</a>
          <a href="#traces">traces</a>
          <a href="#steps">steps</a>
          {afterWb ? <a href="#after" className="good">after</a> : null}
        </nav>
      </div>

      {/* image thumbnail strip */}
      {props.images.length > 1 || props.images[0]?.imageUrl ? (
        <div className="flex flex-wrap gap-2 py-3">
          {props.images.map((i) => (
            <button
              key={i.imageId}
              onClick={() => setParam('image', i.imageId)}
              className="overflow-hidden rounded-lg border-2"
              style={{ borderColor: i.imageId === props.imageId ? 'var(--accent)' : 'var(--line)' }}
              title={i.imageId}
            >
              {i.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={i.imageUrl} alt={i.imageId.slice(0, 8)} className="h-20 w-20 object-cover" />
              ) : (
                <span className="mono small block h-20 w-20 p-1">{i.imageId.slice(0, 8)}</span>
              )}
            </button>
          ))}
        </div>
      ) : null}

      {/* per-step progress */}
      {Object.keys(progress).length ? (
        <div className="flex flex-wrap items-center gap-1 py-1">
          {Object.entries(progress).map(([n, st]) => (
            <span
              key={n}
              className="pill"
              style={{
                background: st === 'done' ? 'var(--good-bg)' : st === 'running' ? 'var(--mid-bg)' : st === 'error' ? 'var(--bad-bg)' : 'var(--chip-bg)',
                color: st === 'done' ? 'var(--good)' : st === 'running' ? 'var(--mid)' : st === 'error' ? 'var(--bad)' : 'var(--dim)',
              }}
            >
              S{n} {st === 'done' ? '✓' : st === 'running' ? '…' : st === 'error' ? '✗' : ''}
            </span>
          ))}
          <span className="small" style={{ color: 'var(--dim)' }}>{rerunStatus}</span>
        </div>
      ) : rerunStatus ? (
        <div className="py-1 text-sm" style={{ color: 'var(--dim)' }}>{rerunStatus}</div>
      ) : null}
      {localMsg ? <div className="py-1 text-sm" style={{ color: 'var(--mid)' }}>{localMsg}</div> : null}

      {/* prompt editor */}
      <details className="mb-2">
        <summary className="cursor-pointer text-sm" style={{ color: 'var(--accent)' }}>
          edit a step&apos;s prompts (current DB — the next re-run uses these)
        </summary>
        <div className="flex flex-col gap-2 py-2">
          <select
            className="w-fit rounded border px-2 py-1 text-sm"
            style={inputStyle}
            value={editStepId ?? ''}
            onChange={(e) => {
              const s = props.steps.find((x) => x.id === Number(e.target.value))
              if (s) openEditor(s)
            }}
          >
            <option value="">choose step…</option>
            {props.steps.map((s) => (
              <option key={s.id} value={s.id}>
                S{s.orderBy} · {s.description.slice(0, 60)}
              </option>
            ))}
          </select>
          {editStep ? (
            <>
              <div className="text-xs" style={{ color: 'var(--dim)' }}>
                system — {props.flavorId}.S{editStep.orderBy}.prompt.system
              </div>
              <textarea
                className="h-40 w-full rounded border p-2 font-mono text-xs"
                style={{ background: 'var(--prompt-bg)', borderColor: 'var(--line)', color: 'var(--ink)' }}
                value={draftSys}
                onChange={(e) => setDraftSys(e.target.value)}
              />
              <button className={`${btn} w-fit`} style={btnStyle} onClick={() => save('system')}>
                save system
              </button>
              <div className="text-xs" style={{ color: 'var(--dim)' }}>
                user — {props.flavorId}.S{editStep.orderBy}.prompt.user
              </div>
              <textarea
                className="h-64 w-full rounded border p-2 font-mono text-xs"
                style={{ background: 'var(--prompt-bg)', borderColor: 'var(--line)', color: 'var(--ink)' }}
                value={draftUsr}
                onChange={(e) => setDraftUsr(e.target.value)}
              />
              <button className={`${btn} w-fit`} style={btnStyle} onClick={() => save('user')}>
                save user
              </button>
              {saveMsg ? <div className="text-sm">{saveMsg}</div> : null}
            </>
          ) : null}
        </div>
      </details>

      {wb ? (
        <>
          <header className="wb" dangerouslySetInnerHTML={{ __html: wb.headerHtml }} />
          <h2 id="verdict">The verdict — {wb.captionCount} captions</h2>
          <div
            onClick={(e) => {
              const a = (e.target as HTMLElement).closest('a.tracelink')
              if (!a) return
              e.preventDefault()
              const m = (a.getAttribute('href') || '').match(/#trace-(\d+)/)
              if (m) {
                setTraceIdx(Number(m[1]))
                document.getElementById('traces')?.scrollIntoView({ behavior: 'smooth' })
              }
            }}
            dangerouslySetInnerHTML={{ __html: wb.verdictHtml }}
          />
          <h2 id="diagnostics">
            What the machinery noticed <span className="dim small">(recomputed mechanically — not the model&apos;s opinion)</span>
          </h2>
          <div dangerouslySetInnerHTML={{ __html: wb.diagnosticsHtml }} />
          <h2 id="traces">Trace — one caption at a time, gate to ground</h2>
          <TracePager wb={wb} idx={traceIdx} onSelect={setTraceIdx} />
          <h2 id="steps">Every step, through the template</h2>
          <div dangerouslySetInnerHTML={{ __html: wb.stepsHtml }} />
        </>
      ) : (
        <p className="py-6" style={{ color: 'var(--dim)' }}>
          No archived step data for this selection, and nothing recoverable from the ops page&apos;s local store
          for this image. Run the pipeline from the classic ops page (batch run) to create an archived run, use
          &ldquo;⭯ ops local data&rdquo; after an unarchived ops run, or re-run from S1 above to generate one now.
        </p>
      )}

      {afterWb ? (
        <>
          <h2 id="after" style={{ borderColor: 'var(--good)' }}>
            AFTER — re-run from S{afterFrom} with current DB prompts
            <span className="ml-3 inline-flex gap-2">
              <button className={btn} style={btnStyle} disabled={archiving} onClick={archiveAfter}>
                {archiving ? 'archiving…' : '💾 archive as a run'}
              </button>
              <button className={btn} style={{ background: 'var(--chip-bg)', color: 'var(--ink)' }} onClick={() => download(afterArch!, `after-S${afterFrom}`)}>
                ⤓ after JSON
              </button>
            </span>
          </h2>
          <div
            onClick={(e) => {
              const a = (e.target as HTMLElement).closest('a.tracelink')
              if (!a) return
              e.preventDefault()
              const m = (a.getAttribute('href') || '').match(/#trace-(\d+)/)
              if (m) setAfterTraceIdx(Number(m[1]))
            }}
            dangerouslySetInnerHTML={{ __html: afterWb.verdictHtml }}
          />
          <h3>after · diagnostics</h3>
          <div dangerouslySetInnerHTML={{ __html: afterWb.diagnosticsHtml }} />
          <h3>after · trace</h3>
          <TracePager wb={afterWb} idx={afterTraceIdx} onSelect={setAfterTraceIdx} />
        </>
      ) : null}
    </div>
  )
}
