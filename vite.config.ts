import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Shown in the help popover and written into analysis files and reports
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  test: {
    // Worktrees of parallel Claude Code sessions live in .claude/worktrees: not part of this checkout
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
})
