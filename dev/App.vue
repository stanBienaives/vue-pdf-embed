<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import VuePdfEmbed, {
  preloadTextLayerCache,
  preloadTextLayerCacheAll,
} from '../src/index'
import type { CacheStats } from '../src/services/textLayerCache'
import type { PreloadResult } from '../src/utils/preloadCache'
import type { CacheStrategy, TextLayerProgressParams } from '../src/types'

const pdfRef = ref()
const currentPage = ref(1)
const displayAllPages = ref(false)
const cacheStats = ref<CacheStats | null>(null)
const isLoading = ref(false)
const preloadPages = ref([1, 2, 3])
const renderTime = ref<number | null>(null)
const standalonePreloadProgress = ref(0)
const lastPreloadResult = ref<PreloadResult | null>(null)
const isDragOver = ref(false)
const isFileLoading = ref(false)
const uploadedFileName = ref('')
const showTextLayer = ref(false)
const cacheStrategy = ref<CacheStrategy>('memory')
const indexedDbName = ref('vue-pdf-embed-demo')
const cacheExpirationDays = ref(7)
const storageInfo = ref<{
  strategy: CacheStrategy
  actualType: 'memory' | 'indexeddb'
  isIndexedDbSupported: boolean
  storageEstimate?: {
    quota?: number
    usage?: number
    usageDetails?: Record<string, number>
  }
} | null>(null)

// Text layer rendering progress
const textLayerProgress = ref({
  currentPage: 0,
  totalPages: 0,
  percentage: 0,
  renderTime: 0,
  cacheHit: false,
  pageNumber: 0,
})
const isRenderingTextLayers = ref(false)

// Default PDF URL for multi-page demonstration
const defaultPdfUrl =
  'https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf'
const pdfSource = ref<string | ArrayBuffer>(defaultPdfUrl)

const pages = computed(() => {
  return pdfRef.value?.doc?.numPages || 0
})

const updateCacheStats = async () => {
  if (pdfRef.value) {
    cacheStats.value = pdfRef.value.getTextLayerCacheStats()

    // Get additional cache information
    try {
      const info = await pdfRef.value.getCacheInfo()
      storageInfo.value = info
    } catch (error) {
      console.warn('Failed to get cache info:', error)
    }
  }
}

const onDocumentLoaded = async () => {
  console.log('PDF loaded with', pdfRef.value.doc.numPages, 'pages')
  updateCacheStats()
}

const onRendered = () => {
  console.log('Rendered')
  updateCacheStats()
  renderTime.value = Date.now()
  isRenderingTextLayers.value = false

  // Apply TextLayer visualization if enabled
  if (showTextLayer.value) {
    applyTextLayerVisualization()
  }
}

// Throttle progress updates to prevent recursive updates with many pages
let latestProgressParams: TextLayerProgressParams | null = null
let updateScheduled = false

const onTextLayerProgress = (params: TextLayerProgressParams) => {
  latestProgressParams = params

  if (!updateScheduled) {
    updateScheduled = true
    requestAnimationFrame(() => {
      if (latestProgressParams) {
        textLayerProgress.value = latestProgressParams
        isRenderingTextLayers.value = latestProgressParams.percentage < 100
        console.log(
          `TextLayer Progress: ${latestProgressParams.currentPage}/${latestProgressParams.totalPages} (${latestProgressParams.percentage.toFixed(1)}%) - ${latestProgressParams.cacheHit ? 'Cache HIT' : 'Cache MISS'} - ${latestProgressParams.renderTime.toFixed(1)}ms`
        )
      }
      updateScheduled = false
    })
  }
}

const preloadSelectedPages = async () => {
  if (!pdfRef.value) return

  isLoading.value = true
  const startTime = Date.now()

  try {
    await pdfRef.value.preloadTextLayer(preloadPages.value)
    const duration = Date.now() - startTime
    console.log(`Preloaded ${preloadPages.value.length} pages in ${duration}ms`)
    updateCacheStats()
  } catch (error) {
    console.error('Preload failed:', error)
  } finally {
    isLoading.value = false
  }
}

const preloadAllPages = async () => {
  if (!pdfRef.value) return

  isLoading.value = true
  const startTime = Date.now()

  try {
    await pdfRef.value.preloadAllTextLayers()
    const duration = Date.now() - startTime
    console.log(`Preloaded all pages in ${duration}ms`)
    updateCacheStats()
  } catch (error) {
    console.error('Preload all failed:', error)
  } finally {
    isLoading.value = false
  }
}

const clearCache = async () => {
  if (!pdfRef.value) return
  await pdfRef.value.clearTextLayerCache()
  await updateCacheStats()
  console.log('Cache cleared')
}

const switchCacheStrategy = async (newStrategy: CacheStrategy) => {
  cacheStrategy.value = newStrategy

  if (pdfRef.value) {
    try {
      await pdfRef.value.switchCacheStrategy(newStrategy)
      await updateCacheStats()
      console.log(`Cache strategy switched to: ${newStrategy}`)
    } catch (error) {
      console.error('Failed to switch cache strategy:', error)
    }
  }
}

const goToPage = (page: number) => {
  currentPage.value = page
  renderTime.value = null
}

const applyTextLayerVisualization = () => {
  // Apply visualization class to all textLayer elements
  const textLayers = document.querySelectorAll('.textLayer')
  textLayers.forEach((layer) => {
    layer.classList.add('show-text-layer')
  })
}

const removeTextLayerVisualization = () => {
  // Remove visualization class from all textLayer elements
  const textLayers = document.querySelectorAll('.textLayer')
  textLayers.forEach((layer) => {
    layer.classList.remove('show-text-layer')
  })
}

const toggleTextLayerVisualization = () => {
  showTextLayer.value = !showTextLayer.value

  if (showTextLayer.value) {
    applyTextLayerVisualization()
  } else {
    removeTextLayerVisualization()
  }

  console.log(
    `TextLayer visualization ${showTextLayer.value ? 'enabled' : 'disabled'}`
  )
}

const handleFileUpload = async (file: File) => {
  if (!file || file.type !== 'application/pdf') {
    alert('Please select a valid PDF file')
    return
  }

  isFileLoading.value = true
  try {
    const arrayBuffer = await file.arrayBuffer()
    pdfSource.value = arrayBuffer
    uploadedFileName.value = file.name
    currentPage.value = 1

    // // Clear cache when switching documents
    // if (pdfRef.value) {
    //   // pdfRef.value.clearTextLayerCache()
    //   updateCacheStats()
    // }

    console.log(
      `Loaded PDF: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`
    )
  } catch (error) {
    console.error('Failed to load PDF file:', error)
    alert('Failed to load PDF file. Please try another file.')
  } finally {
    isFileLoading.value = false
  }
}

const handleFileInputChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) {
    handleFileUpload(file)
  }
}

const handleDragOver = (event: DragEvent) => {
  event.preventDefault()
  isDragOver.value = true
}

const handleDragLeave = (event: DragEvent) => {
  event.preventDefault()
  isDragOver.value = false
}

const handleDrop = (event: DragEvent) => {
  event.preventDefault()
  isDragOver.value = false

  const file = event.dataTransfer?.files?.[0]
  if (file) {
    handleFileUpload(file)
  }
}

const resetToDefault = () => {
  pdfSource.value = defaultPdfUrl
  uploadedFileName.value = ''
  currentPage.value = 1

  // Clear cache when switching back to default
  if (pdfRef.value) {
    pdfRef.value.clearTextLayerCache()
    updateCacheStats()
  }

  console.log('Reset to default PDF document')
}

const standalonePreloadSelected = async () => {
  isLoading.value = true
  standalonePreloadProgress.value = 0

  try {
    const startTime = Date.now()
    const result = await preloadTextLayerCache(
      pdfSource.value,
      preloadPages.value,
      {
        cacheStrategy: cacheStrategy.value,
        cacheIndexedDbName: indexedDbName.value,
        cacheExpirationDays: cacheExpirationDays.value,
        onProgress: (loaded, total) => {
          standalonePreloadProgress.value = Math.round((loaded / total) * 100)
        },
      }
    )

    const duration = Date.now() - startTime
    lastPreloadResult.value = result

    console.log(`Standalone preload completed in ${duration}ms:`, result)
    updateCacheStats()
  } catch (error) {
    console.error('Standalone preload failed:', error)
    lastPreloadResult.value = {
      success: false,
      cached: 0,
      failed: 0,
      totalPages: 0,
    }
  } finally {
    isLoading.value = false
    standalonePreloadProgress.value = 0
  }
}

const standalonePreloadAll = async () => {
  isLoading.value = true
  standalonePreloadProgress.value = 0

  try {
    const startTime = Date.now()
    const result = await preloadTextLayerCacheAll(pdfSource.value, {
      cacheStrategy: cacheStrategy.value,
      cacheIndexedDbName: indexedDbName.value,
      cacheExpirationDays: cacheExpirationDays.value,
      onProgress: (loaded, total) => {
        standalonePreloadProgress.value = Math.round((loaded / total) * 100)
      },
    })

    const duration = Date.now() - startTime
    lastPreloadResult.value = result

    console.log(`Standalone preload all completed in ${duration}ms:`, result)
    updateCacheStats()
  } catch (error) {
    console.error('Standalone preload all failed:', error)
    lastPreloadResult.value = {
      success: false,
      cached: 0,
      failed: 0,
      totalPages: 0,
    }
  } finally {
    isLoading.value = false
    standalonePreloadProgress.value = 0
  }
}

onMounted(() => {
  // Update stats every 2 seconds for demo purposes
  setInterval(updateCacheStats, 2000)
})
</script>

<template>
  <div class="demo-container">
    <h1>Vue PDF Embed - TextLayer Caching Demo</h1>

    <!-- File Upload Panel -->
    <div class="controls-panel">
      <h3>📄 PDF Document</h3>

      <div class="control-group">
        <div class="current-document">
          <label>Current Document:</label>
          <span class="document-info">
            {{ uploadedFileName || 'Default Sample PDF' }}
            <span v-if="!uploadedFileName" class="document-url"
              >(Mozilla TracemonKey)</span
            >
          </span>
        </div>

        <div
          class="file-upload-area"
          :class="{ 'drag-over': isDragOver, loading: isFileLoading }"
          @dragover="handleDragOver"
          @dragleave="handleDragLeave"
          @drop="handleDrop"
        >
          <div v-if="isFileLoading" class="upload-loading">
            <div class="spinner"></div>
            <span>Loading PDF...</span>
          </div>
          <div v-else class="upload-content">
            <div class="upload-icon">📁</div>
            <p><strong>Drag & drop</strong> your PDF file here</p>
            <p>or</p>
            <label class="upload-button">
              <input
                type="file"
                accept=".pdf,application/pdf"
                style="display: none"
                @change="handleFileInputChange"
              />
              Choose PDF File
            </label>
          </div>
        </div>

        <div class="document-actions">
          <button
            v-if="uploadedFileName"
            class="reset-button"
            @click="resetToDefault"
          >
            🔄 Use Default PDF
          </button>
        </div>
      </div>
    </div>

    <!-- Cache Configuration Panel -->
    <div class="controls-panel">
      <h3>💾 Cache Configuration</h3>

      <div class="control-group">
        <label>Cache Strategy:</label>
        <div class="strategy-controls">
          <button
            v-for="strategy in ['memory', 'indexeddb', 'auto']"
            :key="strategy"
            :class="{ active: cacheStrategy === strategy }"
            @click="switchCacheStrategy(strategy as CacheStrategy)"
          >
            {{ strategy }}
          </button>
        </div>
        <div class="strategy-info">
          <p v-if="cacheStrategy === 'memory'">
            <strong>Memory:</strong> Fast, session-only caching. Data lost on
            refresh.
          </p>
          <p v-else-if="cacheStrategy === 'indexeddb'">
            <strong>IndexedDB:</strong> Persistent caching across sessions.
            Larger capacity.
          </p>
          <p v-else>
            <strong>Auto:</strong> IndexedDB if available, fallback to memory.
          </p>
        </div>
      </div>

      <div
        v-if="cacheStrategy === 'indexeddb' || cacheStrategy === 'auto'"
        class="control-group"
      >
        <label>IndexedDB Database Name:</label>
        <input
          v-model="indexedDbName"
          type="text"
          placeholder="vue-pdf-embed-demo"
        />

        <label>Cache Expiration (days):</label>
        <input
          v-model.number="cacheExpirationDays"
          type="number"
          min="1"
          max="365"
        />
      </div>

      <div v-if="storageInfo" class="control-group">
        <div class="storage-info">
          <h4>Storage Information</h4>
          <p><strong>Current Strategy:</strong> {{ storageInfo.strategy }}</p>
          <p>
            <strong>Actual Cache Type:</strong> {{ storageInfo.actualType }}
          </p>
          <p>
            <strong>IndexedDB Supported:</strong>
            {{ storageInfo.isIndexedDbSupported ? 'Yes' : 'No' }}
          </p>
          <div v-if="storageInfo.storageEstimate">
            <p>
              <strong>Storage Usage:</strong>
              {{
                Math.round(
                  (storageInfo.storageEstimate.usage || 0) / 1024 / 1024
                )
              }}
              MB
            </p>
            <p>
              <strong>Storage Quota:</strong>
              {{
                Math.round(
                  (storageInfo.storageEstimate.quota || 0) / 1024 / 1024
                )
              }}
              MB
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Cache Statistics Panel -->
    <div class="stats-panel">
      <h3>🚀 Cache Statistics</h3>
      <div v-if="cacheStats" class="stats-grid">
        <div class="stat">
          <span class="label">Hit Rate:</span>
          <span class="value"
            >{{ (cacheStats.hitRate * 100).toFixed(1) }}%</span
          >
        </div>
        <div class="stat">
          <span class="label">Cached Pages:</span>
          <span class="value"
            >{{ cacheStats.size }}/{{ cacheStats.maxSize }}</span
          >
        </div>
        <div class="stat">
          <span class="label">Total Requests:</span>
          <span class="value">{{ cacheStats.totalRequests }}</span>
        </div>
        <div class="stat">
          <span class="label">Cache Hits:</span>
          <span class="value success">{{ cacheStats.hitCount }}</span>
        </div>
        <div class="stat">
          <span class="label">Cache Misses:</span>
          <span class="value warning">{{ cacheStats.missCount }}</span>
        </div>
      </div>
      <div v-else class="loading">Loading cache statistics...</div>
    </div>

    <!-- Standalone Preloading Panel -->
    <div class="controls-panel">
      <h3>🚀 Standalone Preloading (Library Functions)</h3>

      <div class="control-group">
        <label
          >These functions work <strong>before</strong> component mounts!</label
        >
        <div class="standalone-controls">
          <button :disabled="isLoading" @click="standalonePreloadSelected">
            {{ isLoading ? 'Preloading...' : 'preloadTextLayerCache()' }}
          </button>
          <button :disabled="isLoading" @click="standalonePreloadAll">
            {{ isLoading ? 'Preloading...' : 'preloadTextLayerCacheAll()' }}
          </button>
        </div>

        <div v-if="standalonePreloadProgress > 0" class="progress-bar">
          <div
            class="progress-fill"
            :style="{ width: `${standalonePreloadProgress}%` }"
          ></div>
          <span class="progress-text">{{ standalonePreloadProgress }}%</span>
        </div>

        <div v-if="lastPreloadResult" class="preload-result">
          <div
            class="result-summary"
            :class="{
              success: lastPreloadResult.success,
              warning: !lastPreloadResult.success,
            }"
          >
            {{ lastPreloadResult.success ? '✅' : '⚠️' }}
            Cached {{ lastPreloadResult.cached }}/{{
              lastPreloadResult.totalPages
            }}
            pages
            <span v-if="lastPreloadResult.failed > 0"
              >({{ lastPreloadResult.failed }} failed)</span
            >
          </div>
        </div>
      </div>
    </div>

    <!-- Component Controls Panel -->
    <div class="controls-panel">
      <h3>⚙️ Component Cache Controls</h3>

      <div class="control-group">
        <label>Preload Pages (comma-separated):</label>
        <input
          v-model="preloadPages"
          type="text"
          placeholder="1,2,3,4,5"
          @input="
            preloadPages = ($event.target as HTMLInputElement).value
              .split(',')
              .map((n: string) => parseInt(n.trim()))
              .filter((n: number) => !isNaN(n))
          "
        />
        <button :disabled="isLoading" @click="preloadSelectedPages">
          {{ isLoading ? 'Preloading...' : 'Preload Selected' }}
        </button>
      </div>

      <div class="control-group">
        <button :disabled="isLoading" @click="preloadAllPages">
          {{ isLoading ? 'Preloading...' : 'Preload All Pages' }}
        </button>
        <button class="danger" @click="clearCache">Clear Cache</button>
      </div>

      <div v-if="pages > 0" class="control-group">
        <label>Navigate to Page:</label>
        <div class="page-buttons">
          <button
            v-for="page in Math.min(pages, 10)"
            :key="page"
            :class="{ active: currentPage === page }"
            @click="goToPage(page)"
          >
            {{ page }}
          </button>
          <button v-if="currentPage > 1" @click="goToPage(currentPage - 1)">
            ‹ Prev
          </button>
          <button v-if="currentPage < pages" @click="goToPage(currentPage + 1)">
            Next ›
          </button>
          <button
            v-if="pages > 10"
            :class="{ active: currentPage === pages }"
            @click="goToPage(pages)"
          >
            Last Page
          </button>
          <span v-if="pages > 10">... ({{ pages }} total)</span>
          <button @click="displayAllPages = !displayAllPages">
            {{ displayAllPages ? 'Show Single Page' : 'Show All Pages' }}
          </button>
        </div>
      </div>
    </div>

    <!-- PDF Viewer -->
    <div class="pdf-viewer">
      <div class="viewer-controls">
        <button
          class="text-layer-toggle"
          :class="{ active: showTextLayer }"
          title="Toggle TextLayer visualization to see the invisible text elements used for selection"
          @click="toggleTextLayerVisualization"
        >
          {{ showTextLayer ? '👁️ Hide TextLayer' : '👁️‍🗨️ Show TextLayer' }}
        </button>
        <span class="viewer-info">
          {{
            showTextLayer
              ? 'TextLayer elements are now visible with yellow background'
              : 'Click to visualize invisible text selection layer'
          }}
        </span>
      </div>

      <!-- Text Layer Rendering Progress Bar -->
      <div v-if="isRenderingTextLayers" class="text-layer-progress">
        <div class="progress-header">
          <span>📄 Rendering Text Layers</span>
          <span class="progress-details">
            {{ textLayerProgress.currentPage }} of
            {{ textLayerProgress.totalPages }} pages completed
            <span v-if="textLayerProgress.pageNumber"
              >(Page #{{ textLayerProgress.pageNumber }}
              {{
                textLayerProgress.cacheHit ? 'from cache' : 'rendered'
              }})</span
            >
          </span>
        </div>
        <div class="progress-bar">
          <div
            class="progress-fill"
            :class="{ cached: textLayerProgress.cacheHit }"
            :style="{ width: `${textLayerProgress.percentage}%` }"
          ></div>
        </div>
        <div class="progress-footer">
          <span>{{ textLayerProgress.percentage.toFixed(0) }}% Complete</span>
          <span>Last: {{ textLayerProgress.renderTime.toFixed(0) }}ms</span>
        </div>
      </div>

      <VuePdfEmbed
        ref="pdfRef"
        :source="pdfSource"
        :page="displayAllPages ? undefined : currentPage"
        :text-layer="true"
        :enable-text-layer-cache="true"
        :cache-strategy="cacheStrategy"
        :cache-indexed-db-name="indexedDbName"
        :cache-expiration-days="cacheExpirationDays"
        :max-text-layer-cache-size="500"
        @loaded="onDocumentLoaded"
        @rendered="onRendered"
        @text-layer-progress="onTextLayerProgress"
      />

      <!-- Test headless mode for preloading -->
      <VuePdfEmbed
        :source="pdfSource"
        :headless="true"
        :text-layer="true"
        :preload-text-layer-pages="[10, 11, 12, 13, 14]"
        :enable-text-layer-cache="true"
        :cache-strategy="cacheStrategy"
        :cache-indexed-db-name="indexedDbName"
        @loaded="() => console.log('Headless component loaded')"
        @text-layer-progress="
          (params) => console.log('Headless preload progress:', params)
        "
      />
    </div>

    <!-- Performance Info -->
    <div class="performance-info">
      <h3>📊 Performance Tips</h3>
      <ul>
        <li>
          <strong>First visit:</strong> Page renders normally (cache miss)
        </li>
        <li>
          <strong>Return visits:</strong> 80-95% faster rendering (cache hit)
        </li>
        <li>
          <strong>Preloading:</strong> Load text content in advance for instant
          rendering
        </li>
        <li><strong>Memory usage:</strong> ~1-5KB per cached page</li>
      </ul>

      <div class="instructions">
        <h4>Try this:</h4>
        <ol>
          <li>Navigate between pages 1-3 (notice initial load times)</li>
          <li>Click "Preload Selected" to cache pages 1-3</li>
          <li>Navigate between the same pages again (much faster!)</li>
          <li>Watch the hit rate increase in the statistics</li>
        </ol>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
@import 'pdfjs-dist/web/pdf_viewer.css';

body {
  margin: 0;
  padding: 20px;
  background-color: #f5f5f5;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial,
    sans-serif;
  line-height: 1.6;
}

.demo-container {
  max-width: 1200px;
  margin: 0 auto;

  h1 {
    text-align: center;
    color: #333;
    margin-bottom: 2rem;
  }
}

.stats-panel {
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);

  h3 {
    margin-top: 0;
    color: #333;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;

    .stat {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem;
      background: #f8f9fa;
      border-radius: 6px;
      border-left: 4px solid #007bff;

      .label {
        font-weight: 600;
        color: #555;
      }

      .value {
        font-weight: 700;
        font-size: 1.1em;

        &.success {
          color: #28a745;
        }

        &.warning {
          color: #fd7e14;
        }
      }
    }
  }

  .loading {
    text-align: center;
    color: #666;
    font-style: italic;
  }
}

.controls-panel {
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);

  h3 {
    margin-top: 0;
    color: #333;
  }

  .control-group {
    margin-bottom: 1.5rem;

    &:last-child {
      margin-bottom: 0;
    }

    label {
      display: block;
      font-weight: 600;
      margin-bottom: 0.5rem;
      color: #555;
    }

    input {
      padding: 0.5rem;
      border: 1px solid #ddd;
      border-radius: 4px;
      margin-right: 0.5rem;
      font-size: 14px;
      width: 200px;
    }

    button {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 4px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 0.2s;
      margin-right: 0.5rem;
      margin-bottom: 0.5rem;

      &:not(.danger) {
        background: #007bff;
        color: white;

        &:hover:not(:disabled) {
          background: #0056b3;
        }

        &:disabled {
          background: #6c757d;
          cursor: not-allowed;
        }
      }

      &.danger {
        background: #dc3545;
        color: white;

        &:hover {
          background: #c82333;
        }
      }
    }

    .page-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      align-items: center;

      button {
        margin: 0;
        padding: 0.375rem 0.75rem;
        background: #f8f9fa;
        color: #495057;
        border: 1px solid #dee2e6;

        &:hover {
          background: #e9ecef;
        }

        &.active {
          background: #007bff;
          color: white;
          border-color: #007bff;
        }
      }

      span {
        margin-left: 0.5rem;
        color: #666;
        font-style: italic;
      }
    }
  }
}

.pdf-viewer {
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);

  .viewer-controls {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding: 1rem;
    background: #f8f9fa;
    border-radius: 6px;
    border-left: 4px solid #6f42c1;

    .text-layer-toggle {
      padding: 0.5rem 1rem;
      background: #6f42c1;
      color: white;
      border: none;
      border-radius: 4px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      font-size: 0.875em;

      &:hover {
        background: #5a2d91;
        transform: translateY(-1px);
      }

      &.active {
        background: #fd7e14;
        box-shadow: 0 0 0 2px rgba(253, 126, 20, 0.3);

        &:hover {
          background: #e8690b;
        }
      }
    }

    .viewer-info {
      font-size: 0.875em;
      color: #6c757d;
      font-style: italic;
      flex: 1;
    }
  }

  .vue-pdf-embed {
    margin: auto;
    max-width: 600px;

    & > div {
      margin-bottom: 1rem;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
      border-radius: 4px;
      overflow: hidden;
    }
  }
}

.performance-info {
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);

  h3,
  h4 {
    color: #333;
  }

  h3 {
    margin-top: 0;
  }

  ul,
  ol {
    padding-left: 1.5rem;

    li {
      margin-bottom: 0.5rem;
      color: #555;
    }
  }

  .instructions {
    margin-top: 1.5rem;
    padding: 1rem;
    background: #e7f3ff;
    border-radius: 6px;
    border-left: 4px solid #007bff;

    h4 {
      margin-top: 0;
      margin-bottom: 0.75rem;
    }

    ol {
      margin-bottom: 0;
    }
  }
}

@media (max-width: 768px) {
  body {
    padding: 10px;
  }

  .stats-panel .stats-grid {
    grid-template-columns: 1fr;
  }

  .controls-panel {
    .control-group {
      input {
        width: 100%;
        margin-bottom: 0.5rem;
      }

      .page-buttons {
        justify-content: center;
      }
    }
  }

  .pdf-viewer {
    .viewer-controls {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;

      .viewer-info {
        font-size: 0.8em;
      }
    }

    .vue-pdf-embed {
      max-width: 100%;
    }
  }
}

/* Standalone preloading styles */
.standalone-controls {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;

  button {
    padding: 0.75rem 1rem;
    background: #28a745;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 0.875em;

    &:hover:not(:disabled) {
      background: #218838;
    }

    &:disabled {
      background: #6c757d;
    }
  }
}

.text-layer-progress {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
  color: white;
  animation: slideDown 0.3s ease-out;

  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
    font-weight: 600;

    .progress-details {
      font-size: 0.9rem;
      opacity: 0.95;
    }
  }

  .progress-bar {
    position: relative;
    width: 100%;
    height: 24px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #4ade80 0%, #22c55e 100%);
      border-radius: 12px;
      transition: width 0.3s ease-out;
      box-shadow: 0 2px 8px rgba(34, 197, 94, 0.4);
      position: relative;
      overflow: hidden;

      &.cached {
        background: linear-gradient(90deg, #fbbf24 0%, #f59e0b 100%);
        box-shadow: 0 2px 8px rgba(245, 158, 11, 0.4);
      }

      &::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(
          90deg,
          rgba(255, 255, 255, 0) 0%,
          rgba(255, 255, 255, 0.3) 50%,
          rgba(255, 255, 255, 0) 100%
        );
        animation: shimmer 2s infinite;
      }
    }
  }

  .progress-footer {
    display: flex;
    justify-content: space-between;
    margin-top: 0.5rem;
    font-size: 0.85rem;
    opacity: 0.9;
  }
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

.progress-bar {
  position: relative;
  width: 100%;
  height: 24px;
  background: #e9ecef;
  border-radius: 12px;
  overflow: hidden;
  margin: 1rem 0;

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #28a745, #20c997);
    border-radius: 12px;
    transition: width 0.3s ease;
  }

  .progress-text {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-weight: 600;
    font-size: 0.875em;
    color: #333;
    text-shadow: 0 0 3px white;
  }
}

.preload-result {
  .result-summary {
    padding: 0.75rem;
    border-radius: 6px;
    font-weight: 600;

    &.success {
      background: #d4edda;
      color: #155724;
      border: 1px solid #c3e6cb;
    }

    &.warning {
      background: #fff3cd;
      color: #856404;
      border: 1px solid #ffeaa7;
    }

    span {
      font-weight: normal;
      opacity: 0.8;
    }
  }
}

/* File Upload Styles */
.current-document {
  margin-bottom: 1rem;
  padding: 0.75rem;
  background: #f8f9fa;
  border-radius: 6px;
  border-left: 4px solid #6c757d;

  label {
    font-weight: 600;
    color: #495057;
    margin-right: 0.5rem;
  }

  .document-info {
    font-weight: 600;
    color: #212529;

    .document-url {
      font-weight: normal;
      color: #6c757d;
      font-size: 0.875em;
    }
  }
}

.file-upload-area {
  border: 2px dashed #dee2e6;
  border-radius: 8px;
  padding: 2rem;
  text-align: center;
  transition: all 0.3s ease;
  background: #fafafa;
  margin: 1rem 0;
  cursor: pointer;

  &:hover {
    border-color: #007bff;
    background: #f0f8ff;
  }

  &.drag-over {
    border-color: #28a745;
    background: #f0fff4;
    transform: scale(1.02);
  }

  &.loading {
    border-color: #007bff;
    background: #f0f8ff;
    cursor: not-allowed;
  }

  .upload-content {
    .upload-icon {
      font-size: 3rem;
      margin-bottom: 1rem;
      opacity: 0.7;
    }

    p {
      margin: 0.5rem 0;
      color: #495057;

      strong {
        color: #007bff;
      }
    }
  }

  .upload-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    color: #007bff;
    font-weight: 600;

    .spinner {
      width: 24px;
      height: 24px;
      border: 3px solid #e3f2fd;
      border-top: 3px solid #007bff;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
  }
}

.upload-button {
  display: inline-block;
  padding: 0.75rem 1.5rem;
  background: #007bff;
  color: white;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover {
    background: #0056b3;
  }
}

.document-actions {
  text-align: center;
  margin-top: 1rem;

  .reset-button {
    padding: 0.5rem 1rem;
    background: #6c757d;
    color: white;
    border: none;
    border-radius: 4px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.2s;

    &:hover {
      background: #545b62;
    }
  }
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

@media (max-width: 768px) {
  .file-upload-area {
    padding: 1.5rem;

    .upload-content .upload-icon {
      font-size: 2rem;
    }
  }

  .current-document {
    .document-info {
      display: block;

      .document-url {
        display: block;
        margin-top: 0.25rem;
      }
    }
  }
}

/* Cache Strategy Controls */
.strategy-controls {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;

  button {
    padding: 0.5rem 1rem;
    background: #f8f9fa;
    color: #495057;
    border: 2px solid #dee2e6;
    border-radius: 6px;
    font-weight: 600;
    text-transform: capitalize;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      background: #e9ecef;
      border-color: #adb5bd;
    }

    &.active {
      background: #007bff;
      color: white;
      border-color: #007bff;
    }
  }
}

.strategy-info {
  padding: 0.75rem;
  background: #f8f9fa;
  border-radius: 6px;
  border-left: 4px solid #17a2b8;
  margin-bottom: 1rem;

  p {
    margin: 0;
    color: #495057;
    font-size: 0.9em;
  }

  strong {
    color: #17a2b8;
  }
}

.storage-info {
  padding: 1rem;
  background: #e7f3ff;
  border-radius: 6px;
  border-left: 4px solid #007bff;

  h4 {
    margin-top: 0;
    margin-bottom: 0.75rem;
    color: #0056b3;
  }

  p {
    margin: 0.25rem 0;
    color: #495057;
    font-size: 0.9em;
  }

  strong {
    color: #0056b3;
  }
}

/* TextLayer Visualization */
.textLayer.show-text-layer {
  background-color: rgba(255, 255, 0, 0.2) !important;
  border: 1px solid rgba(255, 255, 0, 0.5) !important;
}

.textLayer.show-text-layer :is(span, br) {
  color: rgba(255, 0, 0, 0.7) !important;
  background-color: rgba(255, 255, 0, 0.3) !important;
  border: 1px solid rgba(255, 0, 0, 0.4) !important;
  border-radius: 2px !important;
}
</style>
