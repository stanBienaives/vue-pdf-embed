import type { TextContent } from 'pdfjs-dist/types/src/display/api'
import type { Source } from '../types'

export interface CacheStats {
  size: number
  maxSize: number
  hitRate: number
  totalRequests: number
  hitCount: number
  missCount: number
}

export interface TextLayerCacheInterface {
  get(source: Source, pageNumber: number): Promise<TextContent | null>
  set(source: Source, pageNumber: number, content: TextContent): Promise<void>
  preloadPages(source: Source, pages: number[]): Promise<void>
  preloadDocument(source: Source): Promise<void>
  clear(): void
  getStats(): CacheStats
}

interface CacheEntry {
  content: TextContent
  lastAccessed: number
  accessCount: number
}

export class TextLayerCache implements TextLayerCacheInterface {
  private cache = new Map<string, CacheEntry>()
  private maxSize: number
  private hitCount = 0
  private missCount = 0

  constructor(maxSize = 100) {
    this.maxSize = maxSize
  }

  async get(source: Source, pageNumber: number): Promise<TextContent | null> {
    const key = await this.generateCacheKey(source, pageNumber)
    const entry = this.cache.get(key)

    if (entry) {
      entry.lastAccessed = Date.now()
      entry.accessCount++
      this.hitCount++
      return entry.content
    }

    this.missCount++
    return null
  }

  async set(
    source: Source,
    pageNumber: number,
    content: TextContent
  ): Promise<void> {
    const key = await this.generateCacheKey(source, pageNumber)

    // If at max capacity, evict least recently used entry
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU()
    }

    this.cache.set(key, {
      content,
      lastAccessed: Date.now(),
      accessCount: 1,
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async preloadPages(_source: Source, _pages: number[]): Promise<void> {
    // This will be implemented when we integrate with the PDF document
    // For now, this is a placeholder that will be called from the component
    console.warn('preloadPages: Implementation requires PDF document access')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async preloadDocument(_source: Source): Promise<void> {
    // This will be implemented when we integrate with the PDF document
    // For now, this is a placeholder that will be called from the component
    console.warn('preloadDocument: Implementation requires PDF document access')
  }

  clear(): void {
    this.cache.clear()
    this.hitCount = 0
    this.missCount = 0
  }

  getStats(): CacheStats {
    const totalRequests = this.hitCount + this.missCount
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: totalRequests > 0 ? this.hitCount / totalRequests : 0,
      totalRequests,
      hitCount: this.hitCount,
      missCount: this.missCount,
    }
  }

  private evictLRU(): void {
    let oldestKey = ''
    let oldestTime = Infinity

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)
    }
  }

  private async generateCacheKey(
    source: Source,
    pageNumber: number
  ): Promise<string> {
    let sourceKey: string

    if (source === null) {
      sourceKey = 'null'
    } else if (typeof source === 'string') {
      // URL string
      sourceKey = source
    } else if (source instanceof ArrayBuffer) {
      // ArrayBuffer - use content hash
      sourceKey = await this.hashArrayBuffer(source)
    } else if (source instanceof Uint8Array) {
      // Uint8Array - use content hash
      sourceKey = await this.hashUint8Array(source)
    } else if (
      source &&
      'numPages' in source &&
      typeof source.numPages === 'number'
    ) {
      // PDFDocumentProxy - use fingerprint if available
      const fingerprint =
        'fingerprints' in source && Array.isArray(source.fingerprints)
          ? source.fingerprints[0] || 'unknown'
          : 'unknown'
      sourceKey = `doc:${fingerprint}`
    } else {
      // Generic object - stringify and hash
      const serialized = JSON.stringify(source, null, 0)
      sourceKey = await this.hashString(serialized)
    }

    return `${sourceKey}:${pageNumber}`
  }

  private async hashString(str: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(str)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  private async hashArrayBuffer(buffer: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  private async hashUint8Array(array: Uint8Array): Promise<string> {
    const buffer =
      array.buffer instanceof ArrayBuffer
        ? array.buffer
        : (array.buffer.slice(0) as unknown as ArrayBuffer)
    return this.hashArrayBuffer(buffer)
  }
}

// Export singleton instance
export const textLayerCache = new TextLayerCache()
