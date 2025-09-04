<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, toRef, watch } from 'vue'
import { AnnotationLayer, TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFLinkService } from 'pdfjs-dist/web/pdf_viewer.mjs'
import type {
  OnProgressParameters,
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
} from 'pdfjs-dist'

import type {
  PasswordRequestParams,
  Source,
  CacheStrategy,
  CacheConfiguration,
  TextLayerProgressParams,
} from './types'
import {
  addPrintStyles,
  createPrintIframe,
  downloadPdf,
  emptyElement,
  releaseChildCanvases,
} from './utils'
import { useVuePdfEmbed } from './composables'
import { type CacheStats } from './services/textLayerCache'
import { CacheManager } from './services/cacheManager'

const props = withDefaults(
  defineProps<{
    /**
     * Whether to enable an annotation layer.
     */
    annotationLayer?: boolean
    /**
     * Cache strategy to use for text layer caching.
     */
    cacheStrategy?: CacheStrategy
    /**
     * Database name for IndexedDB cache (when using indexeddb strategy).
     */
    cacheIndexedDbName?: string
    /**
     * Number of days to keep cached content (IndexedDB only).
     */
    cacheExpirationDays?: number
    /**
     * Whether to enable text layer caching.
     */
    enableTextLayerCache?: boolean
    /**
     * Desired page height.
     */
    height?: number
    /**
     * Root element identifier (inherited by page containers with page number
     * postfixes).
     */
    id?: string
    /**
     * Path for annotation icons, including trailing slash.
     */
    imageResourcesPath?: string
    /**
     * Document navigation service.
     */
    linkService?: PDFLinkService
    /**
     * Maximum number of pages to keep in text layer cache.
     */
    maxTextLayerCacheSize?: number
    /**
     * Page number(s) to display.
     */
    page?: number | number[]
    /**
     * Page numbers to preload into text layer cache.
     */
    preloadTextLayerPages?: number[]
    /**
     * Desired page rotation angle.
     */
    rotation?: number
    /**
     * Desired ratio of canvas size to document size.
     */
    scale?: number
    /**
     * Source of the document to display.
     */
    source: Source
    /**
     * Whether to enable a text layer.
     */
    textLayer?: boolean
    /**
     * Desired page width.
     */
    width?: number
  }>(),
  {
    cacheStrategy: 'memory',
    cacheExpirationDays: 7,
    enableTextLayerCache: true,
    maxTextLayerCacheSize: 100,
    rotation: 0,
    scale: 1,
  }
)

const emit = defineEmits<{
  (e: 'internal-link-clicked', value: number): void
  (e: 'loaded', value: PDFDocumentProxy): void
  (e: 'loading-failed', value: Error): void
  (e: 'password-requested', value: PasswordRequestParams): void
  (e: 'progress', value: OnProgressParameters): void
  (e: 'rendered'): void
  (e: 'rendering-failed', value: Error): void
  (e: 'text-layer-progress', value: TextLayerProgressParams): void
}>()

const pageNums = shallowRef<number[]>([])
const pageScales = ref<number[]>([])
const root = shallowRef<HTMLDivElement | null>(null)
// Use non-reactive tracking to avoid triggering watchers
const textLayerCompletedPages = new Set<number>()

let renderingController: { isAborted: boolean; promise: Promise<void> } | null =
  null

// Create cache manager instance based on props
const cacheManager = computed(() => {
  if (!props.enableTextLayerCache) {
    return null
  }

  const config: CacheConfiguration = {
    strategy: props.cacheStrategy,
    memoryMaxSize: props.maxTextLayerCacheSize,
    indexedDbOptions: {
      databaseName: props.cacheIndexedDbName || 'vue-pdf-embed-cache',
      expirationDays: props.cacheExpirationDays,
      maxEntries: props.maxTextLayerCacheSize * 10, // More entries for persistent cache
    },
  }

  return new CacheManager(config)
})

const cache = computed(() => cacheManager.value?.getCache() || null)

const { doc } = useVuePdfEmbed({
  onError: (e) => {
    pageNums.value = []
    emit('loading-failed', e)
  },
  onPasswordRequest({ callback, isWrongPassword }) {
    emit('password-requested', { callback, isWrongPassword })
  },
  onProgress: (progressParams) => {
    emit('progress', progressParams)
  },
  source: toRef(props, 'source'),
})

const linkService = computed(() => {
  if (!doc.value || !props.annotationLayer) {
    return null
  } else if (props.linkService) {
    return props.linkService
  }

  const service = new PDFLinkService()
  service.setDocument(doc.value)
  service.setViewer({
    scrollPageIntoView: ({ pageNumber }: { pageNumber: number }) => {
      emit('internal-link-clicked', pageNumber)
    },
  })
  return service
})

/**
 * Downloads the PDF document.
 * @param filename - Predefined filename to save.
 */
const download = async (filename: string) => {
  if (!doc.value) {
    return
  }

  const data = await doc.value.getData()
  const metadata = await doc.value.getMetadata()
  const suggestedFilename =
    // @ts-expect-error: contentDispositionFilename is not typed
    filename ?? metadata.contentDispositionFilename ?? ''
  downloadPdf(data, suggestedFilename)
}

/**
 * Returns an array of the actual page width and height based on props and
 * aspect ratio.
 * @param ratio - Page aspect ratio.
 */
const getPageDimensions = (ratio: number): [number, number] => {
  let width: number
  let height: number

  if (props.height && !props.width) {
    height = props.height
    width = height / ratio
  } else {
    width = props.width ?? root.value!.clientWidth
    height = width * ratio
  }

  return [width, height]
}

/**
 * Preloads text layer content for specific pages into cache.
 * @param pages - Page numbers to preload.
 */
const preloadTextLayer = async (pages: number[]) => {
  if (!doc.value || !cache.value) {
    return
  }

  await Promise.all(
    pages.map(async (pageNum) => {
      try {
        // Check if already cached
        // Use doc.value for cache key (it has fingerprint)
        const cacheKey = doc.value!
        const cached = await cache.value!.get(cacheKey, pageNum)
        if (cached) {
          return
        }

        // Load and cache the page's text content
        const page = await doc.value!.getPage(pageNum)
        const textContent = await page.getTextContent()
        await cache.value!.set(cacheKey, pageNum, textContent)
      } catch (error) {
        console.warn(`Failed to preload text layer for page ${pageNum}:`, error)
      }
    })
  )
}

/**
 * Preloads text layer content for all pages in the document.
 */
const preloadAllTextLayers = async () => {
  if (!doc.value || !cache.value) {
    return
  }

  const allPages = [...Array(doc.value.numPages + 1).keys()].slice(1)
  await preloadTextLayer(allPages)
}

/**
 * Gets current text layer cache statistics.
 */
const getTextLayerCacheStats = (): CacheStats => {
  return (
    cache.value?.getStats() || {
      size: 0,
      maxSize: 0,
      hitRate: 0,
      totalRequests: 0,
      hitCount: 0,
      missCount: 0,
    }
  )
}

/**
 * Clears the text layer cache.
 */
const clearTextLayerCache = async () => {
  if (cache.value) {
    await cache.value.clear()
  }
}

/**
 * Gets information about the current cache strategy and storage.
 */
const getCacheInfo = async () => {
  if (!cacheManager.value) {
    return { strategy: 'disabled' }
  }
  return cacheManager.value.getStorageInfo()
}

/**
 * Switches the cache strategy at runtime.
 */
const switchCacheStrategy = async (strategy: CacheStrategy) => {
  if (cacheManager.value) {
    await cacheManager.value.switchStrategy(strategy)
  }
}

/**
 * Prints a PDF document via the browser interface.
 * @param dpi - Print resolution.
 * @param filename - Predefined filename to save.
 * @param allPages - Whether to ignore the page prop and print all pages.
 */
const print = async (dpi = 300, filename = '', allPages = false) => {
  if (!doc.value) {
    return
  }

  const printUnits = dpi / 72
  const styleUnits = 96 / 72
  let container: HTMLDivElement
  let iframe: HTMLIFrameElement
  let title: string | undefined

  try {
    container = window.document.createElement('div')
    container.style.display = 'none'
    window.document.body.appendChild(container)
    iframe = await createPrintIframe(container)

    const pageNums =
      props.page && !allPages
        ? Array.isArray(props.page)
          ? props.page
          : [props.page]
        : [...Array(doc.value.numPages + 1).keys()].slice(1)

    await Promise.all(
      pageNums.map(async (pageNum, i) => {
        const page = await doc.value!.getPage(pageNum)
        const viewport = page.getViewport({
          scale: 1,
          rotation: 0,
        })

        if (i === 0) {
          const sizeX = (viewport.width * printUnits) / styleUnits
          const sizeY = (viewport.height * printUnits) / styleUnits
          addPrintStyles(iframe, sizeX, sizeY)
        }

        const canvas = window.document.createElement('canvas')
        canvas.width = viewport.width * printUnits
        canvas.height = viewport.height * printUnits
        container.appendChild(canvas)
        const canvasClone = canvas.cloneNode() as HTMLCanvasElement
        iframe.contentWindow!.document.body.appendChild(canvasClone)

        await page.render({
          canvasContext: canvas.getContext('2d')!,
          intent: 'print',
          transform: [printUnits, 0, 0, printUnits, 0, 0],
          viewport,
        }).promise

        canvasClone.getContext('2d')!.drawImage(canvas, 0, 0)
      })
    )

    if (filename) {
      title = window.document.title
      window.document.title = filename
    }

    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
  } finally {
    if (title) {
      window.document.title = title
    }

    releaseChildCanvases(container!)
    container!.parentNode?.removeChild(container!)
  }
}

/**
 * Renders the PDF document as canvas element(s) and additional layers.
 */
const render = async () => {
  if (!doc.value || renderingController?.isAborted) {
    return
  }

  try {
    pageNums.value = props.page
      ? Array.isArray(props.page)
        ? props.page
        : [props.page]
      : [...Array(doc.value.numPages + 1).keys()].slice(1)
    pageScales.value = Array(pageNums.value.length).fill(1)

    // Reset completed pages tracking for new render cycle
    textLayerCompletedPages.clear()

    await Promise.all(
      pageNums.value.map(async (pageNum, i) => {
        const page = await doc.value!.getPage(pageNum)
        if (renderingController?.isAborted) {
          return
        }
        const pageRotation =
          ((props.rotation % 90 === 0 ? props.rotation : 0) + page.rotate) % 360
        const [canvas, div1, div2] = Array.from(
          root.value!.getElementsByClassName('vue-pdf-embed__page')[i].children
        ) as [HTMLCanvasElement, HTMLDivElement, HTMLDivElement]
        const isTransposed = !!((pageRotation / 90) % 2)
        const viewWidth = page.view[2] - page.view[0]
        const viewHeight = page.view[3] - page.view[1]
        const [actualWidth, actualHeight] = getPageDimensions(
          isTransposed ? viewWidth / viewHeight : viewHeight / viewWidth
        )
        const cssWidth = `${Math.floor(actualWidth)}px`
        const cssHeight = `${Math.floor(actualHeight)}px`
        const pageWidth = isTransposed ? viewHeight : viewWidth
        const pageScale = actualWidth / pageWidth
        const viewport = page.getViewport({
          scale: pageScale,
          rotation: pageRotation,
        })

        pageScales.value[i] = pageScale

        canvas.style.display = 'block'
        canvas.style.width = cssWidth
        canvas.style.height = cssHeight

        const renderTasks = [
          renderPage(
            page,
            viewport.clone({
              scale: viewport.scale * window.devicePixelRatio * props.scale,
            }),
            canvas
          ),
        ]

        if (props.textLayer) {
          renderTasks.push(
            renderPageTextLayer(
              page,
              viewport.clone({
                dontFlip: true,
              }),
              div1,
              pageNums.value.length
            )
          )
        }

        if (props.annotationLayer) {
          renderTasks.push(
            renderPageAnnotationLayer(
              page,
              viewport.clone({
                dontFlip: true,
              }),
              div2 || div1
            )
          )
        }

        return Promise.all(renderTasks)
      })
    )

    if (!renderingController?.isAborted) {
      emit('rendered')
    }
  } catch (e) {
    pageNums.value = []
    pageScales.value = []

    if (!renderingController?.isAborted) {
      emit('rendering-failed', e as Error)
    }
  }
}

/**
 * Renders the page content.
 * @param page - Page proxy.
 * @param viewport - Page viewport.
 * @param canvas - HTML canvas.
 */
const renderPage = async (
  page: PDFPageProxy,
  viewport: PageViewport,
  canvas: HTMLCanvasElement
) => {
  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({
    canvasContext: canvas.getContext('2d')!,
    viewport,
  }).promise
}

/**
 * Renders the annotation layer for the specified page.
 * @param page - Page proxy.
 * @param viewport - Page viewport.
 * @param container - HTML container.
 */
const renderPageAnnotationLayer = async (
  page: PDFPageProxy,
  viewport: PageViewport,
  container: HTMLDivElement
) => {
  emptyElement(container)
  new AnnotationLayer({
    accessibilityManager: null,
    annotationCanvasMap: null,
    annotationEditorUIManager: null,
    div: container,
    page,
    structTreeLayer: null,
    viewport,
  }).render({
    annotations: await page.getAnnotations(),
    div: container,
    imageResourcesPath: props.imageResourcesPath,
    linkService: linkService.value!,
    page,
    renderForms: false,
    viewport,
  })
}

/**
 * Renders the text layer for the specified page.
 * @param page - Page proxy.
 * @param viewport - Page viewport.
 * @param container - HTML container.
 */
const renderPageTextLayer = async (
  page: PDFPageProxy,
  viewport: PageViewport,
  container: HTMLElement,
  totalPages: number = 1
) => {
  const totalStartTime = performance.now()
  console.log(`🔄 TextLayer render started for page ${page.pageNumber}`)

  // Step 1: Clear container
  const emptyStartTime = performance.now()
  emptyElement(container)
  const emptyTime = performance.now() - emptyStartTime
  console.log(`  ⏱️  Container cleared: ${emptyTime.toFixed(2)}ms`)

  let textContent
  let cacheHit = false

  // Step 2: Try to get from cache first
  const cacheStartTime = performance.now()
  if (cache.value) {
    console.log(
      `  🔍 Cache type: ${cacheManager.value?.getActualCacheType() || 'unknown'}`
    )
    // Use doc.value for cache key if available (it has fingerprint), otherwise use props.source
    const cacheKey = doc.value || props.source
    textContent = await cache.value.get(cacheKey, page.pageNumber)
    cacheHit = !!textContent
  }
  const cacheTime = performance.now() - cacheStartTime

  // Detailed cache timing analysis
  if (cacheTime > 100) {
    console.warn(
      `  ⚠️  SLOW cache lookup (${cacheHit ? 'HIT' : 'MISS'}): ${cacheTime.toFixed(2)}ms - Consider switching cache strategy`
    )
  } else if (cacheTime > 10) {
    console.log(
      `  ⏱️  Cache lookup (${cacheHit ? 'HIT' : 'MISS'}): ${cacheTime.toFixed(2)}ms - Performance acceptable`
    )
  } else {
    console.log(
      `  ⚡ Fast cache lookup (${cacheHit ? 'HIT' : 'MISS'}): ${cacheTime.toFixed(2)}ms`
    )
  }

  // Step 3: Get text content from PDF if not cached
  let extractTime = 0
  let cacheStoreTime = 0
  if (!textContent) {
    const extractStartTime = performance.now()
    textContent = await page.getTextContent()
    extractTime = performance.now() - extractStartTime
    console.log(`  ⏱️  Text extraction from PDF: ${extractTime.toFixed(2)}ms`)

    // Step 4: Store in cache
    if (cache.value) {
      const cacheStoreStartTime = performance.now()
      // Use doc.value for cache key if available (it has fingerprint), otherwise use props.source
      const cacheKey = doc.value || props.source
      await cache.value.set(cacheKey, page.pageNumber, textContent)
      cacheStoreTime = performance.now() - cacheStoreStartTime
      console.log(`  ⏱️  Cache storage: ${cacheStoreTime.toFixed(2)}ms`)
    }
  }

  // Step 5: Analyze text content complexity
  const itemCount = textContent.items.length
  const textLength = textContent.items.reduce((sum, item) => {
    return (
      sum + (typeof item === 'object' && 'str' in item ? item.str.length : 0)
    )
  }, 0)
  console.log(
    `  📊 Text complexity: ${itemCount} items, ${textLength} characters`
  )

  // Step 6: Create and render TextLayer
  const renderStartTime = performance.now()
  const textLayer = new TextLayer({
    container,
    textContentSource: textContent,
    viewport,
  })

  await textLayer.render()
  const renderTime = performance.now() - renderStartTime
  console.log(`  ⏱️  TextLayer.render(): ${renderTime.toFixed(2)}ms`)

  // Final timing summary
  const totalTime = performance.now() - totalStartTime

  console.log(
    `✅ TextLayer page ${page.pageNumber} completed in ${totalTime.toFixed(2)}ms`
  )
  console.log(
    `   📈 Breakdown: Empty=${emptyTime.toFixed(1)}ms, Cache=${cacheTime.toFixed(1)}ms, Extract=${extractTime.toFixed(1)}ms, Store=${cacheStoreTime.toFixed(1)}ms, Render=${renderTime.toFixed(1)}ms`
  )
  console.log(
    `   🎯 Cache: ${cacheHit ? '✅ HIT' : '❌ MISS'}, Items: ${itemCount}, Chars: ${textLength}`
  )

  // Track completed page
  textLayerCompletedPages.add(page.pageNumber)
  const completedCount = textLayerCompletedPages.size
  const percentage = totalPages > 0 ? (completedCount / totalPages) * 100 : 100

  // Emit progress event with accurate tracking
  emit('text-layer-progress', {
    currentPage: completedCount,
    totalPages,
    percentage,
    renderTime: totalTime,
    cacheHit,
    pageNumber: page.pageNumber,
  })
}

watch(
  doc,
  (newDoc) => {
    if (newDoc) {
      emit('loaded', newDoc)
    }
  },
  { immediate: true }
)

// Watch for changes to cache configuration and recreate cache manager
watch(
  () =>
    [
      props.cacheStrategy,
      props.maxTextLayerCacheSize,
      props.cacheIndexedDbName,
      props.cacheExpirationDays,
      props.enableTextLayerCache,
    ] as const,
  () => {
    // Cache manager will be recreated automatically via computed property
    // No need to manually clear cache when switching strategies
  }
)

// Watch for preload pages prop changes
watch(
  () => [doc.value, props.preloadTextLayerPages] as const,
  ([newDoc, newPreloadPages]) => {
    if (newDoc && newPreloadPages && cache.value) {
      preloadTextLayer(newPreloadPages).catch((error) => {
        console.warn('Failed to preload text layer pages:', error)
      })
    }
  },
  { immediate: true }
)

// Watch for document changes
watch(
  doc,
  async (newDoc) => {
    if (newDoc) {
      if (renderingController) {
        renderingController.isAborted = true
        await renderingController.promise
      }

      releaseChildCanvases(root.value)
      renderingController = {
        isAborted: false,
        promise: render(),
      }

      await renderingController.promise
      renderingController = null
    }
  },
  { immediate: true }
)

// Watch for prop changes that require re-rendering
watch(
  () => [
    props.annotationLayer,
    props.height,
    props.imageResourcesPath,
    props.page,
    props.rotation,
    props.scale,
    props.textLayer,
    props.width,
  ],
  async () => {
    if (doc.value) {
      if (renderingController) {
        renderingController.isAborted = true
        await renderingController.promise
      }

      releaseChildCanvases(root.value)
      renderingController = {
        isAborted: false,
        promise: render(),
      }

      await renderingController.promise
      renderingController = null
    }
  }
)

onBeforeUnmount(() => {
  releaseChildCanvases(root.value)
})

defineExpose({
  doc,
  download,
  print,
  preloadTextLayer,
  preloadAllTextLayers,
  getTextLayerCacheStats,
  clearTextLayerCache,
  getCacheInfo,
  switchCacheStrategy,
})
</script>

<template>
  <div :id="id" ref="root" class="vue-pdf-embed">
    <div v-for="(pageNum, i) in pageNums" :key="pageNum">
      <slot name="before-page" :page="pageNum" />

      <div
        :id="id && `${id}-${pageNum}`"
        class="vue-pdf-embed__page"
        :style="{
          '--scale-factor': pageScales[i],
          position: 'relative',
        }"
      >
        <canvas />

        <div v-if="textLayer" class="textLayer" />

        <div v-if="annotationLayer" class="annotationLayer" />
      </div>

      <slot name="after-page" :page="pageNum" />
    </div>
  </div>
</template>
