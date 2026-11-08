import Link from 'next/link'

import type { HumorFlavor } from './humor-flavor-picker'

// The per-flavor tool menu shown next to the flavor picker: select a flavor
// on the left, pick a tool here. Entries are live links once a flavor is
// selected; the off-direction group is greyed out. Global (non-flavor) views
// live in GlobalViewsMenu, rendered in the page's side menu.

type ToolEntry = {
  name: string
  path: string
  blurb: string
}

const FORWARD_TOOLS: ToolEntry[] = [
  {
    name: 'Batch Runner',
    path: 'ops',
    blurb: 'Batch-run the pipeline over an image set (same page as the Flavor Maker).',
  },
  {
    name: 'Flavor Maker',
    path: 'ops',
    blurb: 'Build the pipeline and run it over an image set.',
  },
  {
    name: 'Flavor Inspector',
    path: 'ops2',
    blurb: 'Step-by-step trace of an archived forward run.',
  },
  {
    name: 'Runs',
    path: 'ops/runs',
    blurb: 'Every archived forward run, with the full prompt record.',
  },
]

const REVERSE_TOOLS: ToolEntry[] = [
  {
    name: 'Batch Runner',
    path: 'reverse',
    blurb: 'The live context → image runner.',
  },
  {
    name: 'Flavor Maker',
    path: 'ops-reverse',
    blurb: 'Run chains and study batches over moments.',
  },
  {
    name: 'Flavor Inspector',
    path: 'ops-reverse2',
    blurb: 'Per-moment trace of an archived run, with diffs.',
  },
  {
    name: 'Compare two Text-first Caption Batches',
    path: 'ops-reverse2/compare',
    blurb: 'Two archived runs, outputs side by side, matched by moment.',
  },
  {
    name: 'Runs',
    path: 'ops-reverse/runs',
    blurb: 'Every archived run for the flavor.',
  },
]

// Flavors whose only input is a moment — no image at either end. These are
// neither image-first nor context→image, so the group is never greyed out:
// the picker's direction flag only distinguishes those two kinds.
const MOMENT_TOOLS: ToolEntry[] = [
  {
    name: 'POV Joke Maker',
    path: 'pov-jokes',
    blurb:
      'One moment in: find the points of view worth joking from, then write jokes for the ones you pick.',
  },
  {
    name: 'Reaction Joke Maker',
    path: 'reaction-jokes',
    blurb:
      'Pick moments, read them as students, pick one persona from the versioned persona files; one simple call per moment writes as many reaction jokes as you ask for in that voice, with or without the student read.',
  },
  {
    name: 'Persona Premise Funnel',
    path: 'persona-funnel',
    blurb:
      'One moment in, run as a funnel: break it into moments, scan personas against each, and keep the comic premises that are not duplicates of each other. Writes captions one premise at a time.',
  },
]

// Tools that take no flavor at all — campus context you pick a moment FROM.
// Absolute hrefs; always live regardless of the flavor selection.
const CONTEXT_TOOLS: { name: string; href: string; blurb: string }[] = [
  {
    name: 'Sidechat Event Clusters',
    href: '/sidechat-events',
    blurb:
      'Fetch the last few days of Sidechat posts and group them by the specific happening behind each one, ranked by upvotes. Save a clustering to come back to it.',
  },
]

// The pre-Maker/Inspector flavor tools, mirroring the "probably deprecated"
// group on the flavor page. Kept reachable, but visually quiet.
const DEPRECATED_TOOLS: { name: string; path: string }[] = [
  { name: 'Add step', path: 'humor-flavor-step/new' },
  { name: 'Captions', path: 'captions' },
  { name: 'Test', path: 'test' },
  { name: 'Matrix', path: 'matrix' },
  { name: 'The Chiltrix', path: 'chiltrix' },
]

const GLOBAL_VIEWS: { name: string; href: string; blurb: string }[] = [
  {
    name: 'Run archive',
    href: '/runs',
    blurb: 'All runs, all flavors, forward and reverse.',
  },
  {
    name: 'Daily jokes',
    href: '/daily-jokes',
    blurb: 'The daily joke feed.',
  },
  {
    name: 'Sidechat event clusters',
    href: '/sidechat-events',
    blurb: 'Recent Sidechat posts grouped by the specific event behind each one.',
  },
  {
    name: 'Sidechat topics',
    href: '/sidechat-topics',
    blurb: 'Recent Sidechat posts compared against the Student Brain\'s own topics.',
  },
  {
    name: 'Find Meme for Columbia Context',
    href: '/find-meme',
    blurb: 'Describe a moment, get the 3 best-fit meme templates with jokes.',
  },
]

function ToolGroup({
  title,
  tools,
  flavorId,
  muted,
}: {
  title: string
  tools: ToolEntry[]
  flavorId: number | null
  muted: boolean
}) {
  return (
    <div className={muted ? 'opacity-50' : undefined}>
      <h3 className="mb-2 text-xs font-semibold text-[rgb(var(--muted))]">
        {title}
        {muted ? " — not this flavor's kind" : ''}
      </h3>
      <ul className="space-y-1.5">
        {tools.map((tool) => (
          <li key={`${tool.path}-${tool.name}`} className="flex flex-col">
            {flavorId ? (
              <Link
                href={`/humor-flavor/${flavorId}/${tool.path}`}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] font-medium text-[rgb(var(--accent-strong))] hover:underline"
              >
                {tool.name}
              </Link>
            ) : (
              <span className="text-[13px] font-medium text-[rgb(var(--ink))]">
                {tool.name}
              </span>
            )}
            <span className="text-[11px] text-[rgb(var(--muted))]">
              {tool.blurb}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function ToolDirectory({
  selected,
}: {
  selected?: HumorFlavor | null
}) {
  const flavorId = selected?.id ?? null
  const isTextFirst = selected?.direction === 'text-first'

  const forwardGroup = (
    <ToolGroup
      title="Image-First (image → caption)"
      tools={FORWARD_TOOLS}
      flavorId={flavorId}
      muted={Boolean(selected) && isTextFirst}
    />
  )
  const reverseGroup = (
    <ToolGroup
      title="Text-First (context → image)"
      tools={REVERSE_TOOLS}
      flavorId={flavorId}
      muted={Boolean(selected) && !isTextFirst}
    />
  )

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold">Pick a tool</h2>
        {selected ? (
          <p className="mt-0.5 flex min-w-0 items-baseline gap-1 text-xs text-[rgb(var(--muted))]">
            <span className="min-w-0 truncate" title={selected.slug}>
              For <span className="font-semibold">{selected.slug}</span>
            </span>
            <span aria-hidden>·</span>
            <Link
              href={`/humor-flavor/${selected.id}`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 font-medium text-[rgb(var(--accent-strong))] hover:underline"
            >
              open flavor page →
            </Link>
          </p>
        ) : (
          <p className="mt-0.5 truncate text-xs text-[rgb(var(--muted))]">
            Select a flavor on the left to make these links live.
          </p>
        )}
      </div>

      <div className="space-y-8 pb-2">
        {forwardGroup}
        {reverseGroup}
        <ToolGroup
          title="Moment-First (moment → points of view → jokes)"
          tools={MOMENT_TOOLS}
          flavorId={flavorId}
          muted={false}
        />

        <div>
          <h3 className="mb-2 text-xs font-semibold text-[rgb(var(--muted))]">
            Campus Context (Sidechat posts → events) — needs no flavor
          </h3>
          <ul className="space-y-1.5">
            {CONTEXT_TOOLS.map((tool) => (
              <li key={tool.href} className="flex flex-col">
                <Link
                  href={tool.href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[13px] font-medium text-[rgb(var(--accent-strong))] hover:underline"
                >
                  {tool.name}
                </Link>
                <span className="text-[11px] text-[rgb(var(--muted))]">{tool.blurb}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="opacity-60">
          <h3 className="mb-1.5 text-xs font-semibold text-[rgb(var(--muted))]">
            Probably deprecated
          </h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {DEPRECATED_TOOLS.map((tool) =>
              flavorId ? (
                <Link
                  key={tool.path}
                  href={`/humor-flavor/${flavorId}/${tool.path}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] font-medium text-[rgb(var(--accent-strong))] hover:underline"
                >
                  {tool.name}
                </Link>
              ) : (
                <span
                  key={tool.path}
                  className="text-[12px] font-medium text-[rgb(var(--ink))]"
                >
                  {tool.name}
                </span>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function GlobalViewsMenu() {
  return (
    <nav className="space-y-1">
      <h3 className="mb-2 text-xs font-semibold text-[rgb(var(--muted))]">
        Other tools
      </h3>
      {GLOBAL_VIEWS.map((view) => (
        <Link
          key={view.href}
          href={view.href}
          target="_blank"
          rel="noreferrer"
          title={view.blurb}
          className="block rounded-md px-1.5 py-1 text-[13px] text-[rgb(var(--ink))] transition hover:bg-[rgb(var(--panel)/0.8)] hover:text-[rgb(var(--accent-strong))] dark:hover:bg-[rgb(var(--panel)/0.15)]"
        >
          {view.name}
        </Link>
      ))}
    </nav>
  )
}
