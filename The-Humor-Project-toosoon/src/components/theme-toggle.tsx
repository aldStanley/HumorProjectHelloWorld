'use client'

import { useEffect, useState, type ReactElement, type SVGProps } from 'react'

type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme'

const getStoredTheme = (): ThemePreference => {
  if (typeof window === 'undefined') {
    return 'system'
  }

  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored
  }

  return 'system'
}

const applyTheme = (theme: ThemePreference) => {
  const root = document.documentElement
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  root.classList.toggle('dark', resolved === 'dark')
  root.dataset.theme = theme
  root.style.colorScheme = resolved
}

type IconType = (props: SVGProps<SVGSVGElement>) => ReactElement

type ThemeOption = {
  value: ThemePreference
  label: string
  Icon: IconType
}

const options: ThemeOption[] = [
  { value: 'light', label: 'Light Mode', Icon: SunIcon },
  { value: 'dark', label: 'Dark Mode', Icon: MoonIcon },
  { value: 'system', label: 'System Mode', Icon: SystemIcon },
]

type ThemeToggleProps = {
  variant?: 'default' | 'inline'
  className?: string
}

export default function ThemeToggle({
  variant = 'default',
  className,
}: ThemeToggleProps) {
  const [theme, setTheme] = useState<ThemePreference>('system')

  useEffect(() => {
    const initial = getStoredTheme()
    setTheme(initial)
    applyTheme(initial)

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      const current = getStoredTheme()
      if (current === 'system') {
        applyTheme('system')
      }
    }

    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  const updateTheme = (next: ThemePreference) => {
    setTheme(next)
    window.localStorage.setItem(STORAGE_KEY, next)
    applyTheme(next)
  }

  const baseClasses =
    'group relative inline-flex h-8 w-8 items-center justify-center rounded-full text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))]'
  const activeClasses =
    'bg-[rgb(var(--gloss)/0.25)] text-[rgb(var(--foreground))] shadow-[inset_0_0_0_1px_rgb(var(--gloss)/0.7)] dark:bg-[rgb(var(--gloss)/0.15)]'
  const inactiveClasses =
    'text-[rgb(var(--muted))] hover:bg-[rgb(var(--panel)/0.95)] hover:text-[rgb(var(--foreground))] dark:hover:bg-[rgb(var(--panel)/0.2)]'
  const iconClasses = 'h-4 w-4'
  const tooltipClasses =
    'pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 translate-y-1 scale-95 whitespace-nowrap rounded-full bg-[rgb(var(--panel)/0.95)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--ink))] opacity-0 shadow-[0_12px_24px_-16px_rgb(var(--accent-strong)/0.45)] transition-all duration-200 group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:scale-100 group-focus-visible:opacity-100 dark:bg-[rgb(var(--shadow-strong)/0.95)] dark:text-[rgb(var(--accent))]'

  const containerClasses = [
    variant === 'default'
      ? 'gloss-panel inline-flex flex-wrap gap-2 rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[linear-gradient(130deg,rgb(var(--gloss)/0.95),rgb(var(--gloss)/0.6))] p-1.5 shadow-[0_22px_50px_-32px_rgb(var(--primary-deep)/0.6)] backdrop-blur dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[linear-gradient(130deg,rgb(var(--gloss)/0.12),rgb(var(--gloss)/0.03))]'
      : 'inline-flex flex-wrap gap-2',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={containerClasses}>
      {options.map((option) => {
        const isActive = theme === option.value

        const Icon = option.Icon

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => updateTheme(option.value)}
            className={`${baseClasses} ${
              isActive ? activeClasses : inactiveClasses
            }`}
          >
            <Icon className={iconClasses} aria-hidden="true" focusable="false" />
            <span className="sr-only">{option.label}</span>
            <span aria-hidden="true" className={tooltipClasses}>
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function SunIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <circle cx="12" cy="12" r="4" strokeWidth="2" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364-6.364-1.414 1.414M7.05 16.95l-1.414 1.414M18.95 16.95l-1.414-1.414M7.05 7.05 5.636 5.636"
      />
    </svg>
  )
}

function MoonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M12 3c.132 0 .263.002.394.004A9 9 0 1 0 21 12.6 7.5 7.5 0 0 1 12 3Z"
      />
    </svg>
  )
}

function SystemIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <rect x="3" y="4" width="18" height="12" rx="2" strokeWidth="2" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M8 20h8M12 16v4"
      />
    </svg>
  )
}
