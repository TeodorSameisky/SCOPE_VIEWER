import { useEffect, useState } from 'react'

/**
 * useState that is remembered in localStorage (per browser). Used for UI
 * conveniences such as which panels are open; falls back to the initial value
 * when storage is unavailable.
 */
export function usePersistentState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) return initial
      const parsed = JSON.parse(raw)
      // Merge objects so new fields get their defaults
      return initial && typeof initial === 'object' && !Array.isArray(initial) ? { ...initial, ...parsed } : parsed
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // storage unavailable: keep the value for this page view only
    }
  }, [key, value])
  return [value, setValue]
}
