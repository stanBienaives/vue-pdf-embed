import type { TextContent } from 'pdfjs-dist/types/src/display/api'
import type { Source } from '../types'
import type { CacheStats, TextLayerCacheInterface } from './textLayerCache'

interface IndexedDbCacheEntry {
  key: string
  content: TextContent
  lastAccessed: number
  accessCount: number
  createdAt: number
  expiresAt: number
}

export interface IndexedDbCacheOptions {
  databaseName?: string
  version?: number
  expirationDays?: number
  maxEntries?: number
}

export class IndexedDbCache implements TextLayerCacheInterface {
  private db: IDBDatabase | null = null
  private dbName: string
  private dbVersion: number
  private expirationMs: number
  private maxEntries: number
  private hitCount = 0
  private missCount = 0
  private cachedCount = 0 // Track cache size in memory for sync access
  private initPromise: Promise<void> | null = null

  // Performance optimization: defer non-critical operations
  private deferredOperations = new Set<string>()
  private processingDeferred = false

  constructor(options: IndexedDbCacheOptions = {}) {
    this.dbName = options.databaseName ?? 'vue-pdf-embed-cache'
    this.dbVersion = options.version ?? 1
    this.expirationMs = (options.expirationDays ?? 7) * 24 * 60 * 60 * 1000
    this.maxEntries = options.maxEntries ?? 1000
  }

  async get(source: Source, pageNumber: number): Promise<TextContent | null> {
    try {
      await this.ensureInitialized()
      if (!this.db) return null

      const key = this.generateCacheKeySync(source, pageNumber)
      const transaction = this.db.transaction(['textLayerCache'], 'readonly')
      const store = transaction.objectStore('textLayerCache')
      const request = store.get(key)

      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          const entry = request.result as IndexedDbCacheEntry | undefined
          if (entry && entry.expiresAt > Date.now()) {
            // Just update in-memory stats, no database write
            this.hitCount++
            // Defer access stats update to avoid blocking reads
            this.deferredUpdateAccessStats(entry.key)
            resolve(entry.content)
          } else {
            // Just increment miss count, defer expired entry cleanup
            this.missCount++
            if (entry && entry.expiresAt <= Date.now()) {
              this.deferredRemoveExpiredEntry(entry.key)
            }
            resolve(null)
          }
        }
        request.onerror = () => {
          this.missCount++
          reject(request.error)
        }
      })
    } catch (error) {
      this.missCount++
      console.warn('IndexedDB cache get error:', error)
      return null
    }
  }

  async set(
    source: Source,
    pageNumber: number,
    content: TextContent
  ): Promise<void> {
    try {
      await this.ensureInitialized()
      if (!this.db) return

      const key = this.generateCacheKeySync(source, pageNumber)
      const now = Date.now()
      const entry: IndexedDbCacheEntry = {
        key,
        content,
        lastAccessed: now,
        accessCount: 1,
        createdAt: now,
        expiresAt: now + this.expirationMs,
      }

      // Check if we need to evict entries
      await this.evictIfNeeded()

      const transaction = this.db.transaction(['textLayerCache'], 'readwrite')
      const store = transaction.objectStore('textLayerCache')

      // Check if this is a new entry or update
      const existingRequest = store.get(key)

      return new Promise((resolve, reject) => {
        existingRequest.onsuccess = () => {
          const isNewEntry = !existingRequest.result

          const putRequest = store.put(entry)
          putRequest.onsuccess = () => {
            if (isNewEntry) {
              this.cachedCount++
            }
            resolve()
          }
          putRequest.onerror = () => reject(putRequest.error)
        }
        existingRequest.onerror = () => reject(existingRequest.error)
      })
    } catch (error) {
      console.warn('IndexedDB cache set error:', error)
    }
  }

  async preloadPages(): Promise<void> {
    console.warn('preloadPages: Implementation requires PDF document access')
  }

  async preloadDocument(): Promise<void> {
    console.warn('preloadDocument: Implementation requires PDF document access')
  }

  async clear(): Promise<void> {
    try {
      await this.ensureInitialized()
      if (!this.db) return

      const transaction = this.db.transaction(['textLayerCache'], 'readwrite')
      const store = transaction.objectStore('textLayerCache')
      const request = store.clear()

      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          this.hitCount = 0
          this.missCount = 0
          this.cachedCount = 0
          resolve()
        }
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.warn('IndexedDB cache clear error:', error)
    }
  }

  getStats(): CacheStats {
    const totalRequests = this.hitCount + this.missCount
    return {
      size: this.cachedCount, // Use in-memory counter for immediate response
      maxSize: this.maxEntries,
      hitRate: totalRequests > 0 ? this.hitCount / totalRequests : 0,
      totalRequests,
      hitCount: this.hitCount,
      missCount: this.missCount,
    }
  }

  async getStatsAsync(): Promise<CacheStats> {
    try {
      await this.ensureInitialized()
      if (!this.db) {
        return this.getStats()
      }

      const transaction = this.db.transaction(['textLayerCache'], 'readonly')
      const store = transaction.objectStore('textLayerCache')
      const countRequest = store.count()

      return new Promise((resolve, reject) => {
        countRequest.onsuccess = () => {
          const size = countRequest.result
          const totalRequests = this.hitCount + this.missCount
          resolve({
            size,
            maxSize: this.maxEntries,
            hitRate: totalRequests > 0 ? this.hitCount / totalRequests : 0,
            totalRequests,
            hitCount: this.hitCount,
            missCount: this.missCount,
          })
        }
        countRequest.onerror = () => reject(countRequest.error)
      })
    } catch (error) {
      console.warn('IndexedDB cache getStatsAsync error:', error)
      return this.getStats()
    }
  }

  async getStorageEstimate(): Promise<{
    quota?: number
    usage?: number
    usageDetails?: Record<string, number>
  }> {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      return await navigator.storage.estimate()
    }
    return {}
  }

  async cleanup(): Promise<number> {
    try {
      await this.ensureInitialized()
      if (!this.db) return 0

      const now = Date.now()
      const transaction = this.db.transaction(['textLayerCache'], 'readwrite')
      const store = transaction.objectStore('textLayerCache')
      const request = store.openCursor()
      let deletedCount = 0

      return new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result
          if (cursor) {
            const entry = cursor.value as IndexedDbCacheEntry
            if (entry.expiresAt < now) {
              cursor.delete()
              deletedCount++
            }
            cursor.continue()
          } else {
            // Update the cached count after cleanup
            this.cachedCount = Math.max(0, this.cachedCount - deletedCount)
            resolve(deletedCount)
          }
        }
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.warn('IndexedDB cache cleanup error:', error)
      return 0
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.db) return
    if (this.initPromise) return this.initPromise

    this.initPromise = this.initialize()
    return this.initPromise
  }

  private async initialize(): Promise<void> {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      throw new Error('IndexedDB not supported')
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        // Initialize the cache count
        this.initializeCacheCount()
          .then(() => resolve())
          .catch(reject)
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains('textLayerCache')) {
          const store = db.createObjectStore('textLayerCache', {
            keyPath: 'key',
          })
          store.createIndex('expiresAt', 'expiresAt')
          store.createIndex('lastAccessed', 'lastAccessed')
        }
      }
    })
  }

  private async updateAccessStats(entry: IndexedDbCacheEntry): Promise<void> {
    if (!this.db) return

    try {
      entry.lastAccessed = Date.now()
      entry.accessCount++

      const transaction = this.db.transaction(['textLayerCache'], 'readwrite')
      const store = transaction.objectStore('textLayerCache')
      store.put(entry)
    } catch (error) {
      console.warn('Failed to update access stats:', error)
    }
  }

  private async evictIfNeeded(): Promise<void> {
    if (!this.db) return

    try {
      const transaction = this.db.transaction(['textLayerCache'], 'readonly')
      const store = transaction.objectStore('textLayerCache')
      const countRequest = store.count()

      countRequest.onsuccess = async () => {
        if (countRequest.result >= this.maxEntries) {
          await this.evictOldest(Math.floor(this.maxEntries * 0.1)) // Remove 10%
        }
      }
    } catch (error) {
      console.warn('Eviction check failed:', error)
    }
  }

  private async evictOldest(count: number): Promise<void> {
    if (!this.db) return

    try {
      const transaction = this.db.transaction(['textLayerCache'], 'readwrite')
      const store = transaction.objectStore('textLayerCache')
      const index = store.index('lastAccessed')
      const request = index.openCursor()
      let deletedCount = 0

      return new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result
          if (cursor && deletedCount < count) {
            cursor.delete()
            deletedCount++
            cursor.continue()
          } else {
            // Update the cached count after eviction
            this.cachedCount = Math.max(0, this.cachedCount - deletedCount)
            resolve()
          }
        }
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.warn('Eviction failed:', error)
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
      sourceKey = source
    } else if (source instanceof ArrayBuffer) {
      sourceKey = await this.hashArrayBuffer(source)
    } else if (source instanceof Uint8Array) {
      sourceKey = await this.hashUint8Array(source)
    } else if (
      source &&
      'numPages' in source &&
      typeof source.numPages === 'number'
    ) {
      // Handle PDFDocumentProxy - check both fingerprints and fingerprint properties
      let fingerprint = 'unknown'
      if ('fingerprints' in source && Array.isArray(source.fingerprints)) {
        fingerprint = source.fingerprints[0] || 'unknown'
      } else if (
        'fingerprint' in source &&
        typeof source.fingerprint === 'string'
      ) {
        fingerprint = source.fingerprint
      } else if (
        '_pdfInfo' in source &&
        source._pdfInfo &&
        'fingerprints' in source._pdfInfo
      ) {
        fingerprint = source._pdfInfo.fingerprints?.[0] || 'unknown'
      }
      sourceKey = `doc:${fingerprint}`
    } else {
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

  private async initializeCacheCount(): Promise<void> {
    if (!this.db) return

    try {
      const transaction = this.db.transaction(['textLayerCache'], 'readonly')
      const store = transaction.objectStore('textLayerCache')
      const countRequest = store.count()

      return new Promise((resolve, reject) => {
        countRequest.onsuccess = () => {
          this.cachedCount = countRequest.result
          resolve()
        }
        countRequest.onerror = () => reject(countRequest.error)
      })
    } catch (error) {
      console.warn('Failed to initialize cache count:', error)
      this.cachedCount = 0
    }
  }

  private async removeExpiredEntry(key: string): Promise<void> {
    if (!this.db) return

    try {
      const transaction = this.db.transaction(['textLayerCache'], 'readwrite')
      const store = transaction.objectStore('textLayerCache')
      const request = store.delete(key)

      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          this.cachedCount = Math.max(0, this.cachedCount - 1)
          resolve()
        }
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.warn('Failed to remove expired entry:', error)
    }
  }

  // PERFORMANCE OPTIMIZATIONS

  private generateCacheKeySync(source: Source, pageNumber: number): string {
    let sourceKey: string

    if (source === null) {
      sourceKey = 'null'
    } else if (typeof source === 'string') {
      sourceKey = source
    } else if (source instanceof ArrayBuffer) {
      // Use a simple hash instead of crypto.subtle for performance
      sourceKey = this.fastHashArrayBuffer(source)
    } else if (source instanceof Uint8Array) {
      sourceKey = this.fastHashUint8Array(source)
    } else if (
      source &&
      'numPages' in source &&
      typeof source.numPages === 'number'
    ) {
      // Handle PDFDocumentProxy - check both fingerprints and fingerprint properties
      let fingerprint = 'unknown'
      if ('fingerprints' in source && Array.isArray(source.fingerprints)) {
        fingerprint = source.fingerprints[0] || 'unknown'
      } else if (
        'fingerprint' in source &&
        typeof source.fingerprint === 'string'
      ) {
        fingerprint = source.fingerprint
      } else if (
        '_pdfInfo' in source &&
        source._pdfInfo &&
        'fingerprints' in source._pdfInfo
      ) {
        fingerprint = source._pdfInfo.fingerprints?.[0] || 'unknown'
      }
      sourceKey = `doc:${fingerprint}`
    } else {
      // Simple stringify for objects
      sourceKey = this.fastHashString(JSON.stringify(source, null, 0))
    }

    return `${sourceKey}:${pageNumber}`
  }

  private fastHashString(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32bit integer
    }
    return hash.toString(36)
  }

  private fastHashArrayBuffer(buffer: ArrayBuffer): string {
    const view = new Uint32Array(buffer)
    let hash = 0
    const sampleSize = Math.min(view.length, 100) // Sample first 400 bytes

    for (let i = 0; i < sampleSize; i++) {
      hash = (hash << 5) - hash + view[i]
      hash = hash & hash
    }
    return hash.toString(36) + '_' + buffer.byteLength
  }

  private fastHashUint8Array(array: Uint8Array): string {
    let hash = 0
    const sampleSize = Math.min(array.length, 400) // Sample first 400 bytes

    for (let i = 0; i < sampleSize; i++) {
      hash = (hash << 5) - hash + array[i]
      hash = hash & hash
    }
    return hash.toString(36) + '_' + array.length
  }

  private deferredUpdateAccessStats(key: string): void {
    // Add to deferred operations instead of immediate execution
    this.deferredOperations.add(`access:${key}`)
    this.scheduleDeferredProcessing()
  }

  private deferredRemoveExpiredEntry(key: string): void {
    // Add to deferred operations instead of immediate execution
    this.deferredOperations.add(`remove:${key}`)
    this.scheduleDeferredProcessing()
  }

  private scheduleDeferredProcessing(): void {
    if (this.processingDeferred) return

    // Process deferred operations after a short delay
    setTimeout(() => {
      this.processDeferredOperations()
    }, 100)
  }

  private async processDeferredOperations(): Promise<void> {
    if (this.processingDeferred || this.deferredOperations.size === 0) return

    this.processingDeferred = true
    const operations = Array.from(this.deferredOperations)
    this.deferredOperations.clear()

    try {
      if (!this.db) return

      // Group operations by type
      const accessOps = operations.filter((op) => op.startsWith('access:'))
      const removeOps = operations.filter((op) => op.startsWith('remove:'))

      // Process access stat updates in batches
      if (accessOps.length > 0) {
        await this.batchUpdateAccessStats(
          accessOps.map((op) => op.substring(7))
        )
      }

      // Process removals in batches
      if (removeOps.length > 0) {
        await this.batchRemoveEntries(removeOps.map((op) => op.substring(7)))
      }
    } catch (error) {
      console.warn('Failed to process deferred operations:', error)
    } finally {
      this.processingDeferred = false
    }
  }

  private async batchUpdateAccessStats(keys: string[]): Promise<void> {
    if (!this.db) return

    try {
      const transaction = this.db.transaction(['textLayerCache'], 'readwrite')
      const store = transaction.objectStore('textLayerCache')
      const now = Date.now()

      for (const key of keys) {
        const getRequest = store.get(key)
        getRequest.onsuccess = () => {
          const entry = getRequest.result as IndexedDbCacheEntry | undefined
          if (entry) {
            entry.lastAccessed = now
            entry.accessCount++
            store.put(entry)
          }
        }
      }
    } catch (error) {
      console.warn('Batch access stats update failed:', error)
    }
  }

  private async batchRemoveEntries(keys: string[]): Promise<void> {
    if (!this.db) return

    try {
      const transaction = this.db.transaction(['textLayerCache'], 'readwrite')
      const store = transaction.objectStore('textLayerCache')

      for (const key of keys) {
        store.delete(key)
      }

      this.cachedCount = Math.max(0, this.cachedCount - keys.length)
    } catch (error) {
      console.warn('Batch remove failed:', error)
    }
  }
}
