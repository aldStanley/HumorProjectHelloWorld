import { pageMetadata } from '@/utils/page-metadata'
import AppHeader from '@/components/app-header'

export const metadata = pageMetadata('login')

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const message = params.message ?? params.error
  const displayMessage = Array.isArray(message) ? message[0] : message

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_20%,rgb(var(--ambient-spot-1)/0.45),transparent_48%),radial-gradient(circle_at_82%_10%,rgb(var(--ambient-spot-2)/0.32),transparent_42%),radial-gradient(circle_at_25%_85%,rgb(var(--ambient-spot-3)/0.38),transparent_56%),linear-gradient(130deg,rgb(var(--ambient-base-1)/1),rgb(var(--ambient-base-2)/0.7),rgb(var(--ambient-base-3)/0.45))] dark:bg-[radial-gradient(circle_at_20%_20%,rgb(var(--ambient-spot-1)/0.12),transparent_48%),radial-gradient(circle_at_75%_20%,rgb(var(--ambient-spot-2)/0.18),transparent_45%),linear-gradient(140deg,rgb(var(--ambient-base-1)/0.98),rgb(var(--ambient-base-2)/0.98),rgb(var(--ambient-base-3)/0.99))]" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(120deg,rgb(var(--gloss)/0.7),rgb(var(--gloss)/0)_55%)] opacity-80 mix-blend-screen dark:opacity-40" />
      <div className="pointer-events-none absolute -left-20 top-1/3 h-72 w-72 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-spot-1)/0.75),rgb(var(--ambient-orb-left-2)/0.35),transparent_70%)] blur-3xl animate-float dark:bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-spot-1)/0.18),rgb(var(--ambient-orb-left-2)/0.12),transparent_70%)]" />
      <div className="pointer-events-none absolute right-[-6rem] top-16 h-60 w-60 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-right-1)/0.6),rgb(var(--ambient-orb-right-2)/0.2),transparent_72%)] blur-3xl animate-sway dark:bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-right-1)/0.16),rgb(var(--ambient-orb-right-2)/0.12),transparent_72%)]" />
      <div className="pointer-events-none absolute bottom-[-7rem] left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-bottom-1)/0.6),rgb(var(--ambient-spot-1)/0.3),transparent_70%)] blur-3xl animate-drift dark:bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-bottom-1)/0.14),rgb(var(--ambient-spot-2)/0.1),transparent_70%)]" />

      <AppHeader showLogout={false} />

      <div className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-xl">
          <div className="gloss-panel rounded-[34px] border border-[rgb(var(--gloss)/0.7)] bg-[linear-gradient(140deg,rgb(var(--gloss)/0.96),rgb(var(--gloss)/0.6))] p-8 shadow-[0_32px_80px_-55px_rgb(var(--primary-deep)/0.7)] backdrop-blur dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[linear-gradient(140deg,rgb(var(--gloss)/0.08),rgb(var(--gloss)/0.02))] sm:p-10">
            <div className="space-y-4">
              <p className="text-xs uppercase tracking-[0.4em] text-[rgb(var(--muted))]">
                The Matrix
              </p>
              <h1 className="text-3xl font-semibold sm:text-4xl">
                <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent drop-shadow-[0_6px_22px_rgb(var(--headline-accent-strong)/0.35)]">
                  Welcome back
                </span>
              </h1>
              <p className="text-sm text-[rgb(var(--muted))] sm:text-base">
                Sign in with Google to test humor flavors.
              </p>
              {displayMessage ? (
                <p className="rounded-2xl border border-[rgb(var(--primary)/0.35)] bg-[rgb(var(--primary)/0.12)] px-4 py-3 text-sm font-semibold text-[rgb(var(--accent-strong))] shadow-[0_12px_30px_-24px_rgb(var(--primary-deep)/0.6)] dark:border-[rgb(var(--primary)/0.3)] dark:bg-[rgb(var(--primary)/0.1)]">
                  {displayMessage}
                </p>
              ) : null}
            </div>

            <form action="/auth/login" method="post" className="mt-6 space-y-4">
              <button
                type="submit"
                className="group flex w-full items-center gap-3 rounded-2xl border border-[rgb(var(--gloss)/0.6)] bg-[linear-gradient(120deg,rgb(var(--primary-deep)),rgb(var(--primary)),rgb(var(--primary-bright)))] px-4 py-3 text-sm font-semibold text-[rgb(var(--on-primary))] shadow-[0_22px_45px_-30px_rgb(var(--primary-deep)/0.85)] transition hover:-translate-y-0.5 hover:shadow-[0_28px_55px_-32px_rgb(var(--primary-deep)/0.9)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.1)]"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[rgb(var(--panel)/0.9)] shadow-[inset_0_0_0_1px_rgb(var(--gloss)/0.8)]">
                  <GoogleIcon />
                </span>
                <span className="flex-1 text-center text-xs uppercase tracking-[0.24em] sm:text-sm">
                  Sign in with Google
                </span>
              </button>
              <p className="text-xs text-[rgb(var(--muted))]">
                Access is limited to approved users.
              </p>
            </form>

          </div>
        </div>
      </div>
    </main>
  )
}

function GoogleIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" focusable="false">
      <defs>
        <linearGradient id="googleAmberGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgb(var(--primary-bright))" />
          <stop offset="45%" stopColor="rgb(var(--primary))" />
          <stop offset="100%" stopColor="rgb(var(--primary-deep))" />
        </linearGradient>
      </defs>
      <path
        fill="url(#googleAmberGradient)"
        d="M21.35 11.1h-9.17v2.92h5.32c-.24 1.36-1.44 4-5.32 4-3.2 0-5.81-2.66-5.81-5.94 0-3.28 2.61-5.94 5.81-5.94 1.82 0 3.04.77 3.74 1.44l2.55-2.46C16.94 3.5 14.75 2.5 12 2.5 6.98 2.5 3 6.48 3 11.5S6.98 20.5 12 20.5c6.15 0 8.5-4.33 8.5-7.41 0-.5-.05-.89-.15-1.99Z"
      />
    </svg>
  )
}
