import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist'

export type Source = Parameters<typeof getDocument>[0] | PDFDocumentProxy | null

export type PasswordRequestParams = {
  callback: Function
  isWrongPassword: boolean
}

export type CacheStrategy = 'memory' | 'indexeddb' | 'auto'

export interface IndexedDbCacheOptions {
  databaseName?: string
  version?: number
  expirationDays?: number
  maxEntries?: number
}

export interface CacheConfiguration {
  strategy: CacheStrategy
  memoryMaxSize?: number
  indexedDbOptions?: IndexedDbCacheOptions
}
