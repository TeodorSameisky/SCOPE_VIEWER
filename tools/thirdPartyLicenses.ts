import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

/** Build tools whose runtime helpers (module preload, CommonJS interop) are in every bundle */
const BUILD_RUNTIME = ['vite', 'rolldown']

/** Packages whose license file does not tell the whole story */
const NOTES: Record<string, string> = {
  '@mathjax/mathjax-newcm-font':
    'The package ships no license file; its package.json declares Apache-2.0 (full text under\n' +
    '@mathjax/src). Its glyph outlines are derived from the New Computer Modern fonts by Antonis\n' +
    'Tsolomitis, licensed under the GUST Font License or GPL-3.0 with font exception\n' +
    '(https://ctan.org/pkg/newcomputermodern).',
}

const RULE = '='.repeat(80)

interface Pkg {
  name: string
  version: string
  license: string
  url?: string
  text: string
}

function readPackage(dir: string): Pkg {
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f))
  // Vite's LICENSE.md continues with the licenses of its own (build-time) dependencies
  const text = file ? readFileSync(path.join(dir, file), 'utf8').split(/^# Licenses of bundled dependencies/m)[0].trim() : ''
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  return { name: pkg.name, version: pkg.version, license: pkg.license ?? 'see license text', url: pkg.homepage ?? repo?.replace(/^git\+/, ''), text }
}

/**
 * Writes the licenses of all npm packages bundled into the app to `fileName` next to
 * index.html: minification drops their license comments, and MIT, ISC and Apache-2.0
 * all ask for the notice to travel with the code. `extra` lists packages that end up in
 * files outside the Rollup bundle (e.g. the Workbox runtime in the service worker).
 */
export function thirdPartyLicenses(fileName = 'third-party-licenses.txt', extra: string[] = []): Plugin {
  let root = process.cwd()
  return {
    name: 'third-party-licenses',
    configResolved(config) {
      root = config.root
    },
    configureServer(server) {
      server.middlewares.use(`/${fileName}`, (_req, res) => res.end('The list of third-party licenses is created by `npm run build`.\n'))
    },
    generateBundle(_options, bundle) {
      const dirs = new Set([...BUILD_RUNTIME, ...extra].map((name) => path.join(root, 'node_modules', name)))
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        for (const id of chunk.moduleIds) {
          const m = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(id.replace(/^\0/, ''))
          if (m) dirs.add(m[1])
        }
      }
      const pkgs = [...dirs].filter((d) => existsSync(path.join(d, 'package.json'))).map(readPackage)
      const unique = [...new Map(pkgs.map((p) => [`${p.name}@${p.version}`, p])).values()].sort((a, b) => a.name.localeCompare(b.name))
      const own = readFileSync(path.join(root, 'LICENSE'), 'utf8').trim()
      const sections = unique.map((p) => {
        const body = [NOTES[p.name], p.text].filter(Boolean).join('\n\n') || '(no license file in the package)'
        return [RULE, `${p.name} ${p.version} - ${p.license}`, p.url, '', body].filter((l) => l !== undefined).join('\n')
      })
      const source = [
        'Scope Viewer - licenses',
        '',
        own,
        '',
        'The application contains code from the following open-source packages,',
        'used under the licenses reproduced below.',
        '',
        ...sections.flatMap((s) => [s, '']),
      ].join('\n')
      this.emitFile({ type: 'asset', fileName, source })
    },
  }
}
