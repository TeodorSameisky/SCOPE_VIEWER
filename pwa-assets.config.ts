import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

/**
 * App icons for the installable app, generated from the logo with
 *   npx pwa-assets-generator
 * The PNGs are committed in public/, so the deployment build does not need to run this.
 */
const background = '#0b0e13'

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    // Maskable / Apple icons are cropped by the OS: put the logo on the app background with padding
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background } },
  },
  images: ['public/favicon.svg'],
})
