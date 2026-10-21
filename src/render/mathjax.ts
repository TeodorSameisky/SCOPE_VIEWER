/**
 * TeX → SVG with MathJax. Imported only on demand (see tex.ts), as MathJax is several
 * hundred kB. Glyphs are output as plain paths, so the SVG needs no fonts and can be
 * rasterised for image exports.
 */
import { mathjax } from '@mathjax/src/js/mathjax.js'
import { TeX } from '@mathjax/src/js/input/tex.js'
import { SVG } from '@mathjax/src/js/output/svg.js'
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js'
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js'
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js'
import { MathJaxNewcmFont } from '@mathjax/mathjax-newcm-font/js/svg.js'
import type { TexSvg } from './tex'

// The font loads rarer glyph ranges (arrows, double-struck, …) when first needed: bundle each
// as its own chunk and hand them to MathJax by file name
const FONT_DIR = '/node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/'
const dynamicFiles = import.meta.glob('/node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/*.js')
mathjax.asyncLoad = (name: string) => {
  const load = dynamicFiles[FONT_DIR + name.slice(name.lastIndexOf('/') + 1)]
  return load ? load() : Promise.reject(new Error(`MathJax file not available: ${name}`))
}

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)
const doc = mathjax.document('', {
  InputJax: new TeX({
    packages: ['base', 'ams'],
    // Report errors to the caller (the callout then shows its source) instead of rendering them
    formatError: (_jax: unknown, err: Error) => {
      throw err
    },
  }),
  // No inline line breaks: they would split a formula into several <svg> pieces
  OutputJax: new SVG({ fontData: MathJaxNewcmFont, fontCache: 'none', linebreaks: { inline: false } }),
})

export async function texToSvg(tex: string, display: boolean): Promise<TexSvg> {
  const node = await doc.convertPromise(tex, { display, containerWidth: 1e6 })
  const svg = adaptor.tags(node, 'svg')[0]
  const viewBox = svg && adaptor.getAttribute(svg, 'viewBox')
  if (!viewBox) throw new Error('MathJax returned no SVG')
  // viewBox is in 1/1000 em with the baseline at y = 0
  const [, minY, w, h] = viewBox.split(/\s+/).map(Number)
  return { viewBox, body: adaptor.innerHTML(svg), width: w / 1000, ascent: -minY / 1000, descent: (h + minY) / 1000 }
}
