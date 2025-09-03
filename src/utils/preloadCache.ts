import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import { textLayerCache } from '../services/textLayerCache'
import type { Source } from '../types'

export interface PreloadResult {
  success: boolean
  cached: number
  failed: number
  totalPages: number
  errors?: Array<{ page: number; error: Error }>
}

export interface PreloadOptions {
  onProgress?: (loaded: number, total: number) => void
  timeout?: number
  skipCached?: boolean
}

export interface PreloadPageError {
  page: number
  error: Error
}

/**
 * Preloads TextLayer cache for specific pages of a PDF document.
 * This allows for instant TextLayer rendering when the component mounts.
 *
 * @param source - PDF source (URL, ArrayBuffer, Uint8Array, or PDFDocumentProxy)
 * @param pages - Array of page numbers to preload (1-indexed)
 * @param options - Optional configuration for progress tracking and behavior
 * @returns Promise resolving to preload results
 *
 * @example
 * ```typescript
 * import { preloadTextLayerCache } from 'vue-pdf-embed'
 *
 * // Preload first 5 pages before component mounts
 * const result = await preloadTextLayerCache('/document.pdf', [1, 2, 3, 4, 5], {
 *   onProgress: (loaded, total) => console.log(`${loaded}/${total} pages cached`)
 * })
 *
 * console.log(`Successfully cached ${result.cached} pages`)
 * ```
 */
export async function preloadTextLayerCache(
  source: Source,
  pages: number[],
  options: PreloadOptions = {}
): Promise<PreloadResult> {
  const { onProgress, timeout = 30000, skipCached = true } = options

  if (!source) {
    throw new Error('Source is required for preloading TextLayer cache')
  }

  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('Pages array must contain at least one page number')
  }

  // Validate page numbers
  const invalidPages = pages.filter(
    (page) => !Number.isInteger(page) || page < 1
  )
  if (invalidPages.length > 0) {
    throw new Error(
      `Invalid page numbers: ${invalidPages.join(', ')}. Page numbers must be positive integers.`
    )
  }

  let cached = 0
  let failed = 0
  const errors: PreloadPageError[] = []

  try {
    // Handle different source types
    let doc: PDFDocumentProxy

    if (source && typeof source === 'object' && 'numPages' in source) {
      // Source is already a PDFDocumentProxy
      doc = source as PDFDocumentProxy
    } else {
      // Load the PDF document with timeout
      const loadingTask = getDocument(source)

      // Add timeout wrapper
      const documentPromise = Promise.race([
        loadingTask.promise,
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error('Document loading timeout')),
            timeout
          )
        }),
      ])

      doc = await documentPromise
    }

    // Validate requested pages against document
    const maxPages = doc.numPages
    const validPages = pages.filter((page) => page <= maxPages)
    const outOfRangePages = pages.filter((page) => page > maxPages)

    if (outOfRangePages.length > 0) {
      console.warn(
        `Pages ${outOfRangePages.join(', ')} are out of range. Document has ${maxPages} pages.`
      )
    }

    // Filter out already cached pages if skipCached is true
    let pagesToLoad = validPages
    if (skipCached) {
      const uncachedPages = []
      for (const pageNum of validPages) {
        const cachedContent = await textLayerCache.get(source, pageNum)
        if (!cachedContent) {
          uncachedPages.push(pageNum)
        } else {
          cached++ // Count as already cached
        }
      }
      pagesToLoad = uncachedPages
    }

    if (pagesToLoad.length === 0) {
      return {
        success: true,
        cached: validPages.length,
        failed: 0,
        totalPages: pages.length,
      }
    }

    // Preload pages with progress tracking
    let completed = 0
    const results = await Promise.allSettled(
      pagesToLoad.map(async (pageNum) => {
        try {
          const page = await doc.getPage(pageNum)
          const textContent = await page.getTextContent()
          await textLayerCache.set(source, pageNum, textContent)

          completed++
          cached++

          if (onProgress) {
            onProgress(completed, pagesToLoad.length)
          }

          return { success: true, page: pageNum }
        } catch (error) {
          completed++
          failed++
          const pageError = { page: pageNum, error: error as Error }
          errors.push(pageError)

          if (onProgress) {
            onProgress(completed, pagesToLoad.length)
          }

          throw pageError
        }
      })
    )

    // Count successful operations
    const successful = results.filter((r) => r.status === 'fulfilled').length
    cached =
      successful + (skipCached ? validPages.length - pagesToLoad.length : 0)
    failed = results.filter((r) => r.status === 'rejected').length

    return {
      success: failed === 0,
      cached,
      failed,
      totalPages: pages.length,
      errors: errors.length > 0 ? errors : undefined,
    }
  } catch (error) {
    // Document loading failed
    throw new Error(
      `Failed to load PDF document: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Preloads TextLayer cache for all pages of a PDF document.
 * This is equivalent to calling preloadTextLayerCache with all page numbers.
 *
 * @param source - PDF source (URL, ArrayBuffer, Uint8Array, or PDFDocumentProxy)
 * @param options - Optional configuration for progress tracking and behavior
 * @returns Promise resolving to preload results
 *
 * @example
 * ```typescript
 * import { preloadTextLayerCacheAll } from 'vue-pdf-embed'
 *
 * // Preload entire document
 * const result = await preloadTextLayerCacheAll('/document.pdf', {
 *   onProgress: (loaded, total) => {
 *     const percent = Math.round((loaded / total) * 100)
 *     console.log(`${percent}% complete`)
 *   }
 * })
 *
 * console.log(`Cached ${result.cached}/${result.totalPages} pages`)
 * ```
 */
export async function preloadTextLayerCacheAll(
  source: Source,
  options: PreloadOptions = {}
): Promise<PreloadResult> {
  if (!source) {
    throw new Error('Source is required for preloading TextLayer cache')
  }

  try {
    // Handle PDFDocumentProxy directly
    let doc: PDFDocumentProxy
    if (source && typeof source === 'object' && 'numPages' in source) {
      doc = source as PDFDocumentProxy
    } else {
      doc = await getDocument(source).promise
    }

    const allPages = Array.from({ length: doc.numPages }, (_, i) => i + 1)

    return await preloadTextLayerCache(source, allPages, options)
  } catch (error) {
    throw new Error(
      `Failed to preload all pages: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
