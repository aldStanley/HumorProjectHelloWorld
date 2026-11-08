import type { ReactNode } from 'react'
import type { Metadata } from 'next'

import './globals.css'
import { TimeZoneProvider } from '@/components/timezone-context'

const perfGuardScript =
  process.env.NODE_ENV === 'development'
    ? `
(() => {
  if (
    typeof performance === 'undefined' ||
    typeof performance.measure !== 'function'
  ) {
    return;
  }
  const originalMeasure = performance.measure.bind(performance);
  performance.measure = (name, startOrMeasureOptions, endMark) => {
    try {
      if (startOrMeasureOptions && typeof startOrMeasureOptions === 'object') {
        const { start, end, duration } = startOrMeasureOptions;
        if (typeof duration === 'number' && duration < 0) {
          return;
        }
        if (typeof start === 'number' && typeof end === 'number' && end < start) {
          return;
        }
      }
      return originalMeasure(name, startOrMeasureOptions, endMark);
    } catch (error) {
      const message =
        error && typeof error.message === 'string' ? error.message : '';
      if (message.includes('negative time stamp')) {
        return;
      }
      throw error;
    }
  };
})();
`
    : ''

const themeScript = `
(() => {
  const storageKey = 'theme';
  const stored = localStorage.getItem(storageKey);
  const theme =
    stored === 'light' || stored === 'dark' || stored === 'system'
      ? stored
      : 'system';
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.theme = theme;
  root.style.colorScheme = resolved;
})();
`

const siteTitle = process.env.NEXT_PUBLIC_SITE_TITLE ?? 'The Matrix'
const deploymentEnv =
  process.env.NEXT_PUBLIC_ENVIRONMENT ??
  process.env.VERCEL_ENV ??
  process.env.NODE_ENV ??
  'development'
const colorEnv = deploymentEnv === 'production' ? 'production' : 'non-production'

// Pages set only their own part ("Flavor 1540 · ops-reverse"); the template
// prefixes the site title so every tab still says where it lives.
export const metadata: Metadata = {
  title: { default: siteTitle, template: `${siteTitle}: %s` },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning data-env={colorEnv}>
      <head>
        {perfGuardScript ? (
          <script dangerouslySetInnerHTML={{ __html: perfGuardScript }} />
        ) : null}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen antialiased">
        <TimeZoneProvider>{children}</TimeZoneProvider>
      </body>
    </html>
  )
}
