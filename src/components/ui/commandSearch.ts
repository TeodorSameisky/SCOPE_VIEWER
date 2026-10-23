import type { LucideIcon } from 'lucide-react'

/** A command of the command palette */
export interface Command {
  /** Stable id, remembered for "recently used" */
  id: string
  label: string
  /** Section, shown next to the label (and searched), e.g. "View" */
  group: string
  /** More words the command is found by */
  keywords?: string
  /** Keyboard shortcut shown on the right */
  hint?: string
  icon?: LucideIcon
  /** A setting that is on: shown with a check mark */
  checked?: boolean
  /** Colour dot instead of an icon (channels, callouts) */
  color?: string
  run: () => void
}

/** Ids of the recently run commands, most recent first */
export const MAX_RECENT_COMMANDS = 8

/**
 * The commands matching a query, best first. Every word of the query must occur in the label,
 * the group or the keywords. Labels that start with the query rank first, then labels with a
 * word starting with the first query word, then other matches in the label, then matches in the
 * group or keywords only; within a rank recently used commands come first, then the list order.
 * Without a query: recently used commands, then all others in list order.
 */
export function searchCommands(commands: Command[], query: string, recent: string[] = []): Command[] {
  const q = query.trim().toLowerCase()
  const recency = (c: Command) => {
    const i = recent.indexOf(c.id)
    return i < 0 ? recent.length : i
  }
  const words = q.split(/\s+/).filter(Boolean)
  const ranked: { c: Command; rank: number; recent: number; index: number }[] = []
  commands.forEach((c, index) => {
    const label = c.label.toLowerCase()
    if (!words.length) {
      ranked.push({ c, rank: 0, recent: recency(c), index })
      return
    }
    const haystack = `${label} ${c.group.toLowerCase()} ${(c.keywords ?? '').toLowerCase()}`
    if (!words.every((w) => haystack.includes(w))) return
    const rank = label.startsWith(q) ? 0 : label.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(words[0])) ? 1 : label.includes(words[0]) ? 2 : 3
    ranked.push({ c, rank, recent: recency(c), index })
  })
  return ranked.sort((a, b) => a.rank - b.rank || a.recent - b.recent || a.index - b.index).map((r) => r.c)
}

/** The recent list after running a command */
export function rememberCommand(recent: string[], id: string): string[] {
  return [id, ...recent.filter((x) => x !== id)].slice(0, MAX_RECENT_COMMANDS)
}
