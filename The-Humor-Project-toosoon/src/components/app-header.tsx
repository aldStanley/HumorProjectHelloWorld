'use client'

import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Bell } from 'lucide-react'

import ThemeToggle from '@/components/theme-toggle'
import TimezoneSelect from '@/components/timezone-select'
import AppSwitcher from '@/components/app-switcher'

type AppHeaderProps = {
  showLogout?: boolean
  titleHref?: string | null
}

const siteTitle = process.env.NEXT_PUBLIC_SITE_TITLE ?? 'The Matrix'

export default function AppHeader({
  showLogout = true,
  titleHref,
}: AppHeaderProps) {
  const router = useRouter()
  const resolvedTitleHref = titleHref === undefined ? '/' : titleHref

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0)
  const [notificationsOpen, setNotificationsOpen] = useState(false)

  const searchContainerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const notificationsRef = useRef<HTMLDivElement>(null)

  const SEARCH_PAGES = [
    { label: 'Overview Dashboard', value: '/', category: 'Pages' },
    { label: 'Find Meme Scanner', value: '/find-meme', category: 'Content' },
    { label: 'Caption Generator', value: '/caption', category: 'Content' },
    { label: 'Image Gallery', value: '/image', category: 'Content' },
    { label: 'Humor Flavors List', value: '/humor-flavor', category: 'Humor Config' },
    { label: 'Humor Flavor Steps', value: '/humor-flavor-step', category: 'Humor Config' },
  ]

  const filteredSearchPages = SEARCH_PAGES.filter(p =>
    p.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.category.toLowerCase().includes(searchQuery.toLowerCase())
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setSearchOpen(false)
      }
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedSearchIndex((prev) =>
        prev < filteredSearchPages.length - 1 ? prev + 1 : 0
      )
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedSearchIndex((prev) =>
        prev > 0 ? prev - 1 : filteredSearchPages.length - 1
      )
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filteredSearchPages[selectedSearchIndex]) {
        handleSelectPage(filteredSearchPages[selectedSearchIndex].value)
      }
    } else if (e.key === 'Escape') {
      setSearchOpen(false)
    }
  }

  const handleSelectPage = (path: string) => {
    router.push(path)
    setSearchOpen(false)
    setSearchQuery("")
  }

  return (
    <div className="relative">
      <header className="sticky top-0 z-30 w-full border-b border-[rgb(var(--panel)/0.4)] bg-[rgb(var(--panel)/0.85)] backdrop-blur px-4 py-1.5 select-none">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
          {/* Left Side: Branding */}
          {resolvedTitleHref ? (
            <Link
              href={resolvedTitleHref}
              className="group flex items-center"
            >
              <span className="text-sm font-semibold text-[rgb(var(--on-panel))] transition group-hover:text-[rgb(var(--accent-strong))]">
                {siteTitle}
              </span>
            </Link>
          ) : (
            <div className="flex items-center">
              <span className="text-sm font-semibold text-[rgb(var(--on-panel))]">
                {siteTitle}
              </span>
            </div>
          )}

          {/* Middle Corner - Search Bar */}
          <div 
            onClick={() => setSearchOpen(true)}
            className="hidden max-w-xs flex-1 md:block relative mx-4 cursor-pointer hover:opacity-80 transition-opacity"
          >
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <Search className="h-4 w-4 text-[rgb(var(--muted))]" />
            </div>
            <input
              type="text"
              placeholder="Search matrix (Press ⌘K)"
              className="h-8 w-full rounded-lg border border-[rgb(var(--muted)/0.4)] bg-[rgb(var(--gloss)/0.05)] pl-9 pr-3 text-xs focus:outline-none cursor-pointer text-[rgb(var(--foreground))]"
              readOnly
            />
          </div>

          {/* Right Side: Actions */}
          <div className="flex items-center gap-3">
            <TimezoneSelect />
            <span
              aria-hidden="true"
              className="hidden h-5 w-px bg-[rgb(var(--panel)/0.7)] dark:bg-[rgb(var(--panel)/0.15)] sm:block"
            />
            <ThemeToggle variant="inline" />
            <span
              aria-hidden="true"
              className="hidden h-5 w-px bg-[rgb(var(--panel)/0.7)] dark:bg-[rgb(var(--panel)/0.15)] sm:block"
            />

            {/* Notifications */}
            <div className="relative" ref={notificationsRef}>
              <button
                onClick={() => setNotificationsOpen(!notificationsOpen)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[rgb(var(--muted)/0.4)] bg-[rgb(var(--gloss)/0.05)] hover:bg-[rgb(var(--gloss)/0.15)] transition-colors relative focus:outline-none text-[rgb(var(--foreground))]"
              >
                <Bell className="h-4 w-4" />
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
              </button>
              {notificationsOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 origin-top-right overflow-hidden rounded-xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel))] p-4 shadow-2xl focus:outline-none z-50 dark:border-[rgb(var(--gloss)/0.15)]">
                  <div className="flex items-center justify-between border-b border-[rgb(var(--gloss)/0.5)] pb-2 mb-2">
                    <span className="font-semibold text-xs text-[rgb(var(--foreground))]">Notifications</span>
                    <span className="text-[10px] text-indigo-500 font-medium cursor-pointer hover:underline">Mark all read</span>
                  </div>
                  <div className="space-y-3">
                    <div className="text-[11px] leading-tight text-[rgb(var(--muted))]">
                      <p className="font-semibold text-[rgb(var(--foreground))]">Meme scan complete</p>
                      <p className="mt-0.5">Found 8 matching captions for target query</p>
                      <span className="text-[9px] text-[rgb(var(--muted))]">5 mins ago</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <AppSwitcher />
            {showLogout ? (
              <>
                <span
                  aria-hidden="true"
                  className="hidden h-5 w-px bg-[rgb(var(--panel)/0.7)] dark:bg-[rgb(var(--panel)/0.15)] sm:block"
                />
                <form action="/auth/logout" method="post">
                  <button
                    type="submit"
                    className="inline-flex h-8 items-center justify-center rounded-lg border border-[rgb(var(--muted)/0.4)] bg-[rgb(var(--gloss)/0.05)] px-3 text-xs font-medium text-[rgb(var(--muted))] transition hover:bg-[rgb(var(--gloss)/0.15)] hover:text-[rgb(var(--foreground))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))]"
                  >
                    Log out
                  </button>
                </form>
              </>
            ) : null}
          </div>
        </div>
      </header>

      {/* Command Search Overlay Modal */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSearchOpen(false)} />
          <div
            ref={searchContainerRef}
            className="relative w-full max-w-lg rounded-xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel))] p-0 shadow-2xl overflow-hidden flex flex-col max-h-[60vh] z-50 dark:border-[rgb(var(--gloss)/0.15)]"
          >
            <div className="flex items-center border-b border-[rgb(var(--gloss)/0.5)] px-3 py-1 bg-[rgb(var(--gloss)/0.05)]">
              <Search className="h-4 w-4 mr-2 text-[rgb(var(--muted))]" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSelectedSearchIndex(0);
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder="Type a page name or category to search..."
                className="h-11 w-full bg-transparent text-xs focus:outline-none text-[rgb(var(--foreground))]"
                autoFocus
              />
              <button
                onClick={() => setSearchOpen(false)}
                className="text-[10px] bg-[rgb(var(--gloss)/0.1)] px-1.5 py-0.5 rounded text-[rgb(var(--muted))] hover:bg-[rgb(var(--gloss)/0.2)]"
              >
                ESC
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filteredSearchPages.length === 0 ? (
                <div className="text-center py-6 text-xs text-[rgb(var(--muted))]">
                  No matching pages found.
                </div>
              ) : (
                filteredSearchPages.map((page, index) => {
                  const isSelected = index === selectedSearchIndex;
                  return (
                    <button
                      key={page.value}
                      onClick={() => handleSelectPage(page.value)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between transition-colors ${
                        isSelected 
                          ? "bg-[linear-gradient(120deg,rgb(var(--primary-deep)),rgb(var(--primary)))] text-[rgb(var(--on-primary))] shadow"
                          : "text-[rgb(var(--foreground))] hover:bg-[rgb(var(--gloss)/0.1)]"
                      }`}
                    >
                      <span>{page.label}</span>
                      <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        isSelected ? "bg-black/20 text-[rgb(var(--on-primary))]" : "bg-[rgb(var(--gloss)/0.1)] text-[rgb(var(--muted))]"
                      }`}>
                        {page.category}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
