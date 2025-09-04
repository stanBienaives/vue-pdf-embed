import type { TextLayerCacheInterface } from './textLayerCache'
import { TextLayerCache } from './textLayerCache'
import { IndexedDbCache, type IndexedDbCacheOptions } from './indexedDbCache'

export type CacheStrategy = 'memory' | 'indexeddb' | 'auto'

export interface CacheConfiguration {
  strategy: CacheStrategy
  memoryMaxSize?: number
  indexedDbOptions?: IndexedDbCacheOptions
}

export class CacheManager {
  private cache: TextLayerCacheInterface
  private strategy: CacheStrategy
  private configuration: CacheConfiguration

  constructor(config: CacheConfiguration) {
    this.configuration = config
    this.strategy = config.strategy
    this.cache = this.createCache()
  }

  private createCache(): TextLayerCacheInterface {
    switch (this.strategy) {
      case 'memory':
        return new TextLayerCache(this.configuration.memoryMaxSize)

      case 'indexeddb':
        return new IndexedDbCache(this.configuration.indexedDbOptions)

      case 'auto':
        // Try IndexedDB first, fallback to memory
        return this.createAutoCache()

      default:
        return new TextLayerCache(this.configuration.memoryMaxSize)
    }
  }

  private createAutoCache(): TextLayerCacheInterface {
    try {
      // Check if IndexedDB is available
      if (typeof window !== 'undefined' && 'indexedDB' in window) {
        return new IndexedDbCache(this.configuration.indexedDbOptions)
      }
    } catch (error) {
      console.warn(
        'IndexedDB not available, falling back to memory cache:',
        error
      )
    }

    return new TextLayerCache(this.configuration.memoryMaxSize)
  }

  getCache(): TextLayerCacheInterface {
    return this.cache
  }

  getCurrentStrategy(): CacheStrategy {
    return this.strategy
  }

  getActualCacheType(): 'memory' | 'indexeddb' {
    return this.cache instanceof IndexedDbCache ? 'indexeddb' : 'memory'
  }

  async switchStrategy(newStrategy: CacheStrategy): Promise<void> {
    if (newStrategy === this.strategy) return

    // Don't clear cache when switching strategies
    // Users may want to test different strategies with same cached data
    this.strategy = newStrategy
    this.configuration.strategy = newStrategy
    this.cache = this.createCache()
  }

  async migrateCache(fromCache: TextLayerCacheInterface): Promise<void> {
    // This is a basic migration - for more complex scenarios,
    // you might want to implement cache export/import functionality
    console.warn(
      'Cache migration between different strategies is not fully implemented'
    )

    // For now, we just clear the old cache
    await fromCache.clear()
  }

  isIndexedDbSupported(): boolean {
    return typeof window !== 'undefined' && 'indexedDB' in window
  }

  async getStorageInfo(): Promise<{
    strategy: CacheStrategy
    actualType: 'memory' | 'indexeddb'
    isIndexedDbSupported: boolean
    storageEstimate?: {
      quota?: number
      usage?: number
      usageDetails?: Record<string, number>
    }
  }> {
    const info = {
      strategy: this.strategy,
      actualType: this.getActualCacheType(),
      isIndexedDbSupported: this.isIndexedDbSupported(),
    }

    if (this.cache instanceof IndexedDbCache) {
      try {
        const storageEstimate = await this.cache.getStorageEstimate()
        return { ...info, storageEstimate }
      } catch (error) {
        console.warn('Failed to get storage estimate:', error)
      }
    }

    return info
  }

  async cleanup(): Promise<number> {
    if (this.cache instanceof IndexedDbCache) {
      return await this.cache.cleanup()
    }
    return 0
  }
}

// Factory function for easy cache creation
export function createCacheManager(config: CacheConfiguration): CacheManager {
  return new CacheManager(config)
}

// Singleton instance with default configuration
let defaultCacheManager: CacheManager | null = null

export function getDefaultCacheManager(): CacheManager {
  if (!defaultCacheManager) {
    defaultCacheManager = createCacheManager({
      strategy: 'memory', // Default to memory for backward compatibility
      memoryMaxSize: 100,
      indexedDbOptions: {
        databaseName: 'vue-pdf-embed-cache',
        expirationDays: 7,
        maxEntries: 1000,
      },
    })
  }
  return defaultCacheManager
}

export function setDefaultCacheStrategy(
  strategy: CacheStrategy,
  options?: Partial<CacheConfiguration>
): void {
  const config: CacheConfiguration = {
    strategy,
    memoryMaxSize: options?.memoryMaxSize ?? 100,
    indexedDbOptions: {
      databaseName: 'vue-pdf-embed-cache',
      expirationDays: 7,
      maxEntries: 1000,
      ...options?.indexedDbOptions,
    },
  }

  defaultCacheManager = createCacheManager(config)
}
