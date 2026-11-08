'use client'

// The voice prompt for one persona, rendered as markdown inside a bounded,
// scrolling box, with a small menu of its subheadings on the left so a
// 25k-character prompt can be read and jumped around rather than scrolled.
//
// What is DISPLAYED is a lightly prepared copy of what is SENT: the file's
// older persona texts mark their sections with bare numbered lines ("1.
// Deadly Serious About Ridiculous Things") rather than markdown headings, so
// for display those lines become level-3 headings. The text sent to the
// model is the file's text, untouched.
import { useMemo, useRef } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'

// `nth` is which occurrence of this text the heading is (1-based), so two
// sections with the same title still each get their own menu entry.
type Heading = { key: string; level: number; text: string; nth: number }

// A short numbered line with no sentence-ending period is a section title in
// the older persona texts, not a list item.
const NUMBERED_TITLE = /^(\d+)\. (?=[A-Z“"])([^\n]{3,80}?)\**\s*$/

export const prepareForDisplay = (text: string): string =>
  text
    .split('\n')
    .map((line) => {
      const m = NUMBERED_TITLE.exec(line)
      return m && !/[.!?]$/.test(m[2].trim()) ? `### ${m[1]}. ${m[2].trim()}` : line
    })
    .join('\n')

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export const headingsOf = (markdown: string): Heading[] => {
  const seen = new Map<string, number>()
  return markdown
    .split('\n')
    .map((line) => /^(#{1,3}) (.+)$/.exec(line))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => {
      const text = m[2].replace(/\*+/g, '').trim()
      const nth = (seen.get(text) ?? 0) + 1
      seen.set(text, nth)
      const base = slug(text) || 'section'
      return { key: nth === 1 ? base : `${base}-${nth}`, level: m[1].length, text, nth }
    })
}

// Plain text of a heading's children, so the rendered heading gets an id
// readers can link to.
const textOf = (node: React.ReactNode): string =>
  Array.isArray(node)
    ? node.map(textOf).join('')
    : typeof node === 'string' || typeof node === 'number'
      ? String(node)
      : node && typeof node === 'object' && 'props' in node
        ? textOf((node as { props: { children?: React.ReactNode } }).props.children)
        : ''

export function PersonaPromptView({ text, personaName }: { text: string; personaName: string }) {
  const markdown = useMemo(() => prepareForDisplay(text), [text])
  const headings = useMemo(() => headingsOf(markdown), [markdown])
  const box = useRef<HTMLDivElement>(null)

  // The id is derived from the heading's own text, never from render order:
  // React renders each heading component twice in development (Strict Mode),
  // so any render-order counter drifts and the menu jumps to the wrong place.
  const heading =
    (Tag: 'h1' | 'h2' | 'h3', className: string) =>
    ({ children }: { children?: React.ReactNode }) => (
      <Tag id={slug(textOf(children))} className={`scroll-mt-3 ${className}`}>
        {children}
      </Tag>
    )
  const components: Components = {
    h1: heading('h1', 'mt-8 text-base font-semibold first:mt-0'),
    h2: heading('h2', 'mt-6 text-sm font-semibold'),
    h3: heading('h3', 'mt-5 text-sm font-semibold text-[rgb(var(--muted))]'),
    p: ({ children }) => <p className="mt-3 text-sm leading-relaxed">{children}</p>,
    ul: ({ children }) => <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">{children}</ul>,
    ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed">{children}</ol>,
    blockquote: ({ children }) => (
      <blockquote className="mt-3 border-l-2 border-[rgb(var(--gloss)/0.6)] pl-3 text-sm italic">{children}</blockquote>
    ),
    hr: () => <hr className="my-5 border-[rgb(var(--gloss)/0.4)]" />,
    a: ({ children, href }) => (
      <a href={href} className="underline" target="_blank" rel="noreferrer">{children}</a>
    ),
  }

  // Find the rendered heading by its text (the nth one with that text), in
  // document order, and scroll the box to it.
  const jump = (h: Heading) => {
    const els = Array.from(box.current?.querySelectorAll<HTMLElement>('h1, h2, h3') ?? [])
    const el = els.filter((e) => (e.textContent ?? '').trim() === h.text)[h.nth - 1]
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  return (
    <div
      ref={box}
      className="mt-2 max-h-[40rem] overflow-y-auto rounded-xl border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.35)] dark:border-[rgb(var(--gloss)/0.25)] dark:bg-[rgb(var(--panel)/0.15)]"
    >
      <div className="grid grid-cols-1 md:grid-cols-[11rem_minmax(0,1fr)]">
        <nav
          aria-label={`Sections of the ${personaName} prompt`}
          className="border-b border-[rgb(var(--gloss)/0.4)] p-4 md:sticky md:top-0 md:self-start md:border-b-0 md:border-r dark:border-[rgb(var(--gloss)/0.15)]"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[rgb(var(--muted))]">
            Sections
          </p>
          {headings.length ? (
            <ul className="mt-2 space-y-1">
              {headings.map((h) => (
                <li key={h.key} style={{ paddingLeft: `${(h.level - 1) * 0.6}rem` }}>
                  <button
                    type="button"
                    onClick={() => jump(h)}
                    className={`text-left leading-snug hover:text-[rgb(var(--accent-strong))] ${
                      h.level === 1 ? 'text-[12px] font-semibold' : 'text-[11px] text-[rgb(var(--muted))]'
                    }`}
                  >
                    {h.text}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-[rgb(var(--muted))]">
              This prompt has no subheadings.
            </p>
          )}
        </nav>
        <div className="min-w-0 p-5">
          <ReactMarkdown components={components}>{markdown}</ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
