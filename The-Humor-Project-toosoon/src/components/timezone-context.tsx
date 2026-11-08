'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

type TimeZoneContextValue = {
  timeZone: string
  timeZoneOptions: string[]
  setTimeZone: (nextTimeZone: string) => void
}

const TIMEZONE_STORAGE_KEY = 'timezone'
const FALLBACK_TIMEZONE = 'UTC'

const TimeZoneContext = createContext<TimeZoneContextValue | undefined>(
  undefined
)

const getSystemTimeZone = () => {
  if (typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function') {
    return FALLBACK_TIMEZONE
  }

  return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIMEZONE
}

const getTimeZoneOptions = (systemTimeZone: string) => {
  if (typeof Intl === 'undefined' || typeof Intl.supportedValuesOf !== 'function') {
    return [systemTimeZone]
  }

  const options = Intl.supportedValuesOf('timeZone')
  return options.includes(systemTimeZone)
    ? options
    : [systemTimeZone, ...options]
}

const ensureTimeZoneOption = (options: string[], timeZone: string) =>
  options.includes(timeZone) ? options : [timeZone, ...options]

const fallbackValue: TimeZoneContextValue = {
  timeZone: FALLBACK_TIMEZONE,
  timeZoneOptions: [FALLBACK_TIMEZONE],
  setTimeZone: () => undefined,
}

export function TimeZoneProvider({ children }: { children: ReactNode }) {
  const [timeZone, setTimeZoneState] = useState(FALLBACK_TIMEZONE)
  const [timeZoneOptions, setTimeZoneOptions] = useState<string[]>([
    FALLBACK_TIMEZONE,
  ])

  useEffect(() => {
    const systemTimeZone = getSystemTimeZone()
    const storedTimeZone = window.localStorage.getItem(TIMEZONE_STORAGE_KEY)
    const initialTimeZone = storedTimeZone || systemTimeZone
    const options = ensureTimeZoneOption(
      getTimeZoneOptions(systemTimeZone),
      initialTimeZone
    )

    setTimeZoneOptions(options)
    setTimeZoneState(initialTimeZone)
  }, [])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== TIMEZONE_STORAGE_KEY) {
        return
      }

      const nextTimeZone = event.newValue || getSystemTimeZone()
      setTimeZoneState(nextTimeZone)
      setTimeZoneOptions((prev) => ensureTimeZoneOption(prev, nextTimeZone))
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const setTimeZone = (nextTimeZone: string) => {
    setTimeZoneState(nextTimeZone)
    setTimeZoneOptions((prev) => ensureTimeZoneOption(prev, nextTimeZone))
    window.localStorage.setItem(TIMEZONE_STORAGE_KEY, nextTimeZone)
  }

  const value = useMemo(
    () => ({
      timeZone,
      timeZoneOptions,
      setTimeZone,
    }),
    [timeZone, timeZoneOptions]
  )

  return <TimeZoneContext.Provider value={value}>{children}</TimeZoneContext.Provider>
}

export const useTimeZone = () => useContext(TimeZoneContext) ?? fallbackValue
