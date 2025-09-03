<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import VuePdfEmbed, {
  preloadTextLayerCache,
  preloadTextLayerCacheAll,
} from '../src/index'
import type { CacheStats } from '../src/services/textLayerCache'
import type { PreloadResult } from '../src/utils/preloadCache'

const pdfRef = ref()
const currentPage = ref(1)
const cacheStats = ref<CacheStats | null>(null)
const isLoading = ref(false)
const preloadPages = ref([1, 2, 3])
const renderTime = ref<number | null>(null)
const standalonePreloadProgress = ref(0)
const lastPreloadResult = ref<PreloadResult | null>(null)

// Use a sample PDF URL for multi-page demonstration
const pdfSource =
  'https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf'

const pages = computed(() => {
  return pdfRef.value?.doc?.numPages || 0
})

const updateCacheStats = () => {
  if (pdfRef.value) {
    cacheStats.value = pdfRef.value.getTextLayerCacheStats()
  }
}

const onDocumentLoaded = async () => {
  console.log('PDF loaded with', pdfRef.value.doc.numPages, 'pages')
  updateCacheStats()
}

const onRendered = () => {
  updateCacheStats()
  renderTime.value = Date.now()
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

const clearCache = () => {
  if (!pdfRef.value) return
  pdfRef.value.clearTextLayerCache()
  updateCacheStats()
  console.log('Cache cleared')
}

const goToPage = (page: number) => {
  currentPage.value = page
  renderTime.value = null
}

const standalonePreloadSelected = async () => {
  isLoading.value = true
  standalonePreloadProgress.value = 0

  try {
    const startTime = Date.now()
    const result = await preloadTextLayerCache(pdfSource, preloadPages.value, {
      onProgress: (loaded, total) => {
        standalonePreloadProgress.value = Math.round((loaded / total) * 100)
      },
    })

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
    const result = await preloadTextLayerCacheAll(pdfSource, {
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
          <span v-if="pages > 10">... ({{ pages }} total)</span>
        </div>
      </div>
    </div>

    <!-- PDF Viewer -->
    <div class="pdf-viewer">
      <VuePdfEmbed
        ref="pdfRef"
        :source="pdfSource"
        :page="currentPage"
        :text-layer="true"
        :enable-text-layer-cache="true"
        :max-text-layer-cache-size="50"
        @loaded="onDocumentLoaded"
        @rendered="onRendered"
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

  .pdf-viewer .vue-pdf-embed {
    max-width: 100%;
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
</style>
