import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

import { useVuePdfEmbed } from './composables'
import VuePdfEmbed from './VuePdfEmbed.vue'
import {
  preloadTextLayerCache,
  preloadTextLayerCacheAll,
  type PreloadResult,
  type PreloadOptions,
} from './utils/preloadCache'
import {
  createCacheManager,
  getDefaultCacheManager,
  setDefaultCacheStrategy,
  type CacheManager,
} from './services/cacheManager'
import type {
  CacheStrategy,
  CacheConfiguration,
  IndexedDbCacheOptions,
} from './types'

if (window?.Vue) {
  window.VuePdfEmbed = VuePdfEmbed
  window.useVuePdfEmbed = useVuePdfEmbed
}

if (!GlobalWorkerOptions?.workerSrc) {
  GlobalWorkerOptions.workerSrc = PdfWorker
}

let initialized = false
export function initPdfjsWorker() {
  if (initialized) return
  GlobalWorkerOptions.workerSrc = PdfWorker
  initialized = true
}

export {
  useVuePdfEmbed,
  preloadTextLayerCache,
  preloadTextLayerCacheAll,
  createCacheManager,
  getDefaultCacheManager,
  setDefaultCacheStrategy,
}
export type {
  PreloadResult,
  PreloadOptions,
  CacheStrategy,
  CacheConfiguration,
  IndexedDbCacheOptions,
  CacheManager,
}
export default VuePdfEmbed
