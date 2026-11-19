import dayjs from 'dayjs'
import { filesize } from 'filesize'
import { COMPRESSIBLE_IMAGE_RE, IMAGE_RE, MAX_UPLOAD_SIZE } from './constants.js'
import { t } from './i18n.js'
import { ConfigManager } from './config-manager.js'
import { FileExplorer } from './file-explorer.js'
import { R2Client } from './r2-client.js'
import { UIManager } from './ui-manager.js'
import { $, applyFilenameTemplate, computeFileHash, extractFileName, getMimeType } from './utils.js'

/** @typedef {{ accountId?: string; accessKeyId?: string; secretAccessKey?: string; bucket?: string; filenameTpl?: string; filenameTplScope?: string; customDomain?: string; compressMode?: string; compressLevel?: string; tinifyKey?: string }} AppConfig */

/**
 * Decode an image File into an offscreen Canvas element.
 * @param {File} file
 * @returns {Promise<HTMLCanvasElement | null>}
 */
async function decodeImageToCanvas(file) {
  const img = new Image()
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const objectUrl = URL.createObjectURL(file)
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = objectUrl
    })
    const width = img.naturalWidth || img.width
    const height = img.naturalHeight || img.height
    if (!width || !height) return null
    canvas.width = width
    canvas.height = height
    ctx.drawImage(img, 0, 0)
    return canvas
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/**
 * Native browser canvas fallback encoder when WASM codecs fail or cannot load.
 * @param {HTMLCanvasElement} canvas
 * @param {string} mimeType
 * @param {number} [quality]
 * @returns {Promise<Blob | null>}
 */
function encodeWithCanvas(canvas, mimeType, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality)
  })
}

/**
 * Compress image file based on configuration
 * @param {File} file - Original file
 * @param {AppConfig} config - AppConfig object
 * @param {function(string):void} onStatus - Callback to update status text
 * @returns {Promise<File>}
 */
async function compressFile(file, config, onStatus) {
  const allowCompress = COMPRESSIBLE_IMAGE_RE.test(file.name)

  if (!allowCompress || !config.compressMode || config.compressMode === 'none') {
    return file
  }

  try {
    const originalSize = file.size

    if (config.compressMode === 'local') {
      onStatus && onStatus('压缩中...')

      const level = config.compressLevel || 'balanced'

      const jpegQuality = level === 'extreme' ? 75 : 90
      const avifQuality = level === 'extreme' ? 50 : 60

      const ext = file.name.toLowerCase().match(/\.(jpe?g|png|webp|avif)$/i)?.[1]
      /** @type {Blob | null} */
      let compressedBlob = null
      let outputType = file.type

      if (ext === 'png') {
        outputType = 'image/png'
        try {
          const { optimise: optimisePng } = await import('@jsquash/oxipng')
          const oxipngLevel = level === 'extreme' ? 4 : 2
          const compressedBuffer = await optimisePng(await file.arrayBuffer(), {
            level: oxipngLevel,
            interlace: false,
            optimiseAlpha: true,
          })
          if (compressedBuffer && compressedBuffer.byteLength > 0) {
            compressedBlob = new Blob([compressedBuffer], { type: outputType })
          }
        } catch {
          const canvas = await decodeImageToCanvas(file)
          if (canvas) compressedBlob = await encodeWithCanvas(canvas, outputType)
        }
      } else {
        const canvas = await decodeImageToCanvas(file)
        if (!canvas) return file
        const ctx = canvas.getContext('2d')
        if (!ctx) return file
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

        /** @type {BufferSource | null} */
        let compressedBuffer = null
        let fallbackQuality = jpegQuality / 100

        if (ext === 'jpg' || ext === 'jpeg') {
          outputType = 'image/jpeg'
          try {
            const { encode: encodeJpeg } = await import('@jsquash/jpeg')
            compressedBuffer = await encodeJpeg(imageData, { quality: jpegQuality })
          } catch {
            compressedBuffer = null
          }
        } else if (ext === 'webp') {
          outputType = 'image/webp'
          try {
            const { encode: encodeWebp } = await import('@jsquash/webp')
            compressedBuffer = await encodeWebp(imageData, { quality: jpegQuality })
          } catch {
            compressedBuffer = null
          }
        } else if (ext === 'avif') {
          outputType = 'image/avif'
          fallbackQuality = avifQuality / 100
          try {
            const { encode: encodeAvif } = await import('@jsquash/avif')
            const avifSpeed = level === 'extreme' ? 4 : 6
            compressedBuffer = await encodeAvif(imageData, {
              quality: avifQuality,
              speed: avifSpeed,
            })
          } catch {
            compressedBuffer = null
          }
        } else {
          return file
        }

        if (compressedBuffer && compressedBuffer.byteLength > 0) {
          compressedBlob = new Blob([compressedBuffer], { type: outputType })
        } else {
          const canvasBlob = await encodeWithCanvas(canvas, outputType, fallbackQuality)
          if (canvasBlob && canvasBlob.type === outputType && canvasBlob.size > 0) {
            compressedBlob = canvasBlob
          }
        }
      }

      if (!compressedBlob || compressedBlob.size === 0) {
        onStatus && onStatus('压缩失败，使用原图')
        return file
      }

      const savings = Math.round((1 - compressedBlob.size / originalSize) * 100)

      if (savings > 0) {
        const msg = `本地压缩: ${filesize(originalSize)} → ${filesize(compressedBlob.size)} (省 ${savings}%)`
        onStatus && onStatus(msg)
        return new File([compressedBlob], file.name, { type: outputType })
      } else {
        const msg = `本地压缩: 原图更优 (${filesize(originalSize)})`
        onStatus && onStatus(msg)
        return file
      }
    }

    if (config.compressMode === 'tinify') {
      if (!config.tinifyKey) return file

      onStatus && onStatus('云端压缩中...')

      const apiUrl = new URL('https://api.tinify.com/shrink')
      apiUrl.searchParams.set('proxy-host', 'api.tinify.com')
      apiUrl.host = 'proxy.nioi.in'

      const response = await fetch(apiUrl.toString(), {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + btoa('api:' + config.tinifyKey),
        },
        body: file,
      })

      if (!response.ok) throw new Error('Tinify API Error')

      const data = await response.json()
      const url = new URL(data.output.url)
      url.searchParams.set('proxy-host', 'api.tinify.com')
      url.host = 'proxy.nioi.in'

      const compressedRes = await fetch(url.toString())
      const compressedBlob = await compressedRes.blob()

      const savings = Math.round((1 - compressedBlob.size / originalSize) * 100)
      if (savings > 0) {
        onStatus && onStatus(`Tinify: ${filesize(originalSize)} → ${filesize(compressedBlob.size)} (省 ${savings}%)`)
      } else {
        onStatus && onStatus(`Tinify: 已优化 (${filesize(compressedBlob.size)})`)
      }

      return new File([compressedBlob], file.name, { type: file.type })
    }
  } catch {
    onStatus && onStatus('压缩失败，使用原图')
  }

  return file
}

/**
 * 并发限制执行异步任务，返回 PromiseSettledResult 数组
 * @template T
 * @param {Array<() => Promise<T>>} tasks
 * @param {number} limit
 * @returns {Promise<PromiseSettledResult<T>[]>}
 */
async function runWithConcurrency(tasks, limit) {
  const results = /** @type {PromiseSettledResult<T>[]} */ (new Array(tasks.length))
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < tasks.length) {
      const i = nextIndex++
      try {
        results[i] = { status: 'fulfilled', value: await tasks[i]() }
      } catch (e) {
        results[i] = { status: 'rejected', reason: e }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

class UploadManager {
  /** @type {R2Client} */
  #r2
  /** @type {UIManager} */
  #ui
  /** @type {FileExplorer} */
  #explorer
  /** @type {ConfigManager} */
  #config
  #dragCounter = 0
  #panelBatchGeneration = 0
  /** @type {WeakMap<File, string>} */
  #droppedRelativePaths = new WeakMap()

  /** @param {R2Client} r2 @param {UIManager} ui @param {FileExplorer} explorer @param {ConfigManager} config */
  constructor(r2, ui, explorer, config) {
    this.#r2 = r2
    this.#ui = ui
    this.#explorer = explorer
    this.#config = config
  }

  /**
   * Read all entries from a FileSystemDirectoryEntry (Chromium batches at 100 entries per call).
   * @param {any} dirEntry
   * @returns {Promise<any[]>}
   */
  #readDirectoryEntries(dirEntry) {
    return new Promise((resolve, reject) => {
      const reader = dirEntry.createReader()
      /** @type {any[]} */
      const all = []
      const readNext = () => {
        reader.readEntries(
          (/** @type {any[]} */ batch) => {
            if (batch.length === 0) {
              resolve(all)
              return
            }
            all.push(...batch)
            readNext()
          },
          reject,
        )
      }
      readNext()
    })
  }

  /**
   * Recursively collect files (preserving relative folder paths) and empty directories.
   * @param {any[]} entries
   * @returns {Promise<{ files: File[]; emptyDirs: string[] }>}
   */
  async #collectDroppedEntries(entries) {
    /** @type {File[]} */
    const files = []
    /** @type {string[]} */
    const emptyDirs = []

    /** @param {any} entry */
    const walk = async (entry) => {
      if (!entry) return
      if (entry.isFile) {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject))
        const relPath = String(entry.fullPath || file.webkitRelativePath || file.name).replace(/^\/+/, '')
        this.#droppedRelativePaths.set(file, relPath)
        files.push(file)
      } else if (entry.isDirectory) {
        const children = await this.#readDirectoryEntries(entry)
        if (children.length === 0) {
          const dirPath = String(entry.fullPath || entry.name).replace(/^\/+/, '').replace(/\/+$/, '')
          if (dirPath) emptyDirs.push(dirPath + '/')
          return
        }
        for (const child of children) {
          await walk(child)
        }
      }
    }

    for (const entry of entries) {
      await walk(entry)
    }
    return { files, emptyDirs }
  }

  initDragDrop() {
    const app = $('#app')
    const dropzone = $('#dropzone')

    /** @param {DragEvent} e */
    const hasFiles = (e) => Boolean(e.dataTransfer?.types?.includes('Files'))

    const showDropzone = () => {
      this.#dragCounter++
      dropzone.hidden = false
    }

    const hideDropzone = () => {
      this.#dragCounter--
      if (this.#dragCounter <= 0) {
        this.#dragCounter = 0
        dropzone.hidden = true
      }
    }

    const handleDrop = async (/** @type {DragEvent} */ e) => {
      if (!hasFiles(e)) {
        this.#dragCounter = 0
        dropzone.hidden = true
        return
      }
      e.preventDefault()
      e.stopPropagation()
      this.#dragCounter = 0
      dropzone.hidden = true

      // Snapshot DataTransfer items/entries synchronously before any await clears them.
      const items = [...(e.dataTransfer?.items ?? [])]
      const entries = items
        .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
        .filter(Boolean)
      const fallbackFiles = [...(e.dataTransfer?.files ?? [])]

      if (entries.length > 0) {
        try {
          const { files, emptyDirs } = await this.#collectDroppedEntries(entries)
          const basePrefix = this.#explorer.currentPrefix
          for (const dir of emptyDirs) {
            await this.#r2.createFolder(basePrefix + dir)
          }
          if (files.length > 0) {
            await this.uploadFiles(files)
          } else if (emptyDirs.length > 0) {
            this.#explorer.invalidateCache()
            await this.#explorer.refresh()
          } else {
            this.#ui.toast(t('dropInvalidHint'), 'info')
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          this.#ui.toast(t('networkError', { msg }), 'error')
        }
        return
      }

      if (fallbackFiles.length > 0) {
        await this.uploadFiles(fallbackFiles)
      } else {
        this.#ui.toast(t('dropInvalidHint'), 'info')
      }
    }

    app.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      showDropzone()
    })

    app.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      hideDropzone()
    })

    app.addEventListener('dragover', (/** @type {DragEvent} */ e) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    })

    app.addEventListener('drop', handleDrop)

    dropzone.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      showDropzone()
    })

    dropzone.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      hideDropzone()
    })

    dropzone.addEventListener('dragover', (/** @type {DragEvent} */ e) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    })

    dropzone.addEventListener('drop', handleDrop)

    document.addEventListener('paste', async (e) => {
      const target = /** @type {HTMLElement} */ (e.target)
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return

      const items = [...(e.clipboardData?.items || [])]
      const htmlText = e.clipboardData?.getData('text/html') || ''
      const plainText = e.clipboardData?.getData('text/plain') || ''
      // 去除 HTML 标签后的纯文字内容，用于判断是否有实质文字（避免把图片的 HTML 包装误判为文字）
      const htmlTextContent = htmlText.replace(/<[^>]+>/g, '').trim()
      const hasText = Boolean(plainText.trim() || htmlTextContent)
      const hasImageItem = items.some((item) => item.kind === 'file' && item.type.startsWith('image/'))
      const hasHtmlImage = Boolean(htmlText.trim()) && /<img[\s>]/i.test(htmlText)

      /** @type {File[]} */
      const files = items
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter(/** @returns {f is File} */ (f) => f !== null)

      if ((hasImageItem || hasHtmlImage) && hasText) {
        this.#ui.toast(t('pasteMixedNotSupported'), 'info')
        return
      }

      if (files.length > 0) {
        e.preventDefault()
        const allImages = files.every((f) => f.type.startsWith('image/'))
        if (allImages) {
          this.#ui.toast(t('pasteToUpload', { count: files.length }), 'success')
          this.uploadFiles(files)
          return
        }

        if (files.length === 1) {
          const file = files[0]
          const ok = await this.#ui.confirm(t('pasteFileConfirmTitle'), t('pasteFileConfirmMsg', { name: file.name }))
          if (!ok) return
          const suggestedPath = this.#explorer.currentPrefix + file.name
          const targetPath = await this.#ui.prompt(t('pasteFilePathTitle'), t('pasteFilePathLabel'), suggestedPath)
          if (!targetPath) return
          await this.uploadFiles([file], targetPath)
          return
        }

        const ok = await this.#ui.confirm(
          t('pasteFilesConfirmTitle'),
          t('pasteFilesConfirmMsg', { count: files.length }),
        )
        if (!ok) return
        this.uploadFiles(files)
        return
      }

      if (hasText) {
        e.preventDefault()
        let content = plainText
        if (!content.trim() && htmlTextContent) {
          const doc = new DOMParser().parseFromString(htmlTextContent, 'text/html')
          content = doc.body?.textContent || ''
        }
        content = content.trim()
        if (!content) return

        const ok = await this.#ui.confirm(t('pasteTextConfirmTitle'), t('pasteTextConfirmMsg'))
        if (!ok) return

        const cfg = this.#config.get()
        let filename = `pasted-${dayjs().format('YYYYMMDD-HHmmss')}.txt`
        if ((cfg.filenameTplScope || 'images') === 'images') {
          const tempFile = new File([content], 'pasted.txt', { type: 'text/plain' })
          const hash = await computeFileHash(tempFile)
          filename = `${hash.slice(0, 6)}.txt`
        }

        const suggestedPath = this.#explorer.currentPrefix + filename
        const targetPath = await this.#ui.prompt(t('pasteTextPathTitle'), t('pasteTextPathLabel'), suggestedPath)
        if (!targetPath) return

        const file = new File([content], filename, { type: 'text/plain' })
        await this.uploadFiles([file], targetPath)
      }
    })
  }

  /** @param {File[]} files @param {string} [overrideKey] */
  async uploadFiles(files, overrideKey) {
    const generation = ++this.#panelBatchGeneration
    const ownsPanel = () => generation === this.#panelBatchGeneration
    const panel = $('#upload-panel')
    const body = $('#upload-panel-body')
    const title = $('#upload-panel-title')

    // A new batch takes over the task panel; previous uploads keep running
    // but must not overwrite the new batch's progress or completion status.
    body.innerHTML = ''
    panel.hidden = false
    panel.classList.remove('is-collapsed')
    panel.dataset.state = 'preparing'
    $('#upload-panel-toggle').setAttribute('aria-expanded', 'true')
    $('#upload-panel-toggle').setAttribute('aria-label', t('uploadCollapse'))
    title.textContent = t('uploadPreparing')

    const updateOverallProgress = (completed, total) => {
      if (!ownsPanel()) return
      const percent = total > 0 ? Math.round((completed / total) * 100) : 0
      $('#upload-panel-summary').textContent = `${completed} / ${total}`
      $('#upload-panel-percent').textContent = `${percent}%`
      $('#upload-panel-progress-fill').style.width = `${percent}%`
      $('#upload-panel-progress').setAttribute('aria-valuenow', String(percent))
    }
    updateOverallProgress(0, 0)
    if (ownsPanel()) {
      $('#upload-panel-summary').textContent = t('uploadPreparing')
    }

    const cfg = this.#config.get()
    const filenameTpl = cfg.filenameTpl || ''
    const filenameTplScope = cfg.filenameTplScope || 'images'
    const currentPrefix = this.#explorer.currentPrefix
    /** @type {'template'|'prefix-template'|'prefix-basename'} */
    let pathStrategy = 'prefix-template'
    let pathStrategyChosen = false
    const useOverrideKey = Boolean(overrideKey && files.length === 1)

    const uploads = []
    /** @type {null | 'overwrite-all' | 'skip-all'} */
    let conflictDecision = null
    let skippedCount = 0

    for (let i = 0; i < files.length; i++) {
      let file = files[i]

      if (file.size > MAX_UPLOAD_SIZE) {
        this.#ui.toast(t('fileTooLarge', { name: file.name }), 'error')
        continue
      }

      const shouldApplyTpl = filenameTplScope === 'all' ? true : IMAGE_RE.test(file.name)
      const processedName = (shouldApplyTpl ? await applyFilenameTemplate(filenameTpl, file) : file.name).replace(/^\/+/, '')
      const rawRelativePath = (this.#droppedRelativePaths.get(file) || file.webkitRelativePath || '').replace(/^\/+/, '')
      const relDir = rawRelativePath.includes('/')
        ? rawRelativePath.slice(0, rawRelativePath.lastIndexOf('/') + 1)
        : ''

      if (
        !pathStrategyChosen &&
        currentPrefix &&
        shouldApplyTpl &&
        (processedName.includes('/') || filenameTpl.includes('/'))
      ) {
        const choice = await this.#ui.chooseFilenameTemplatePath(currentPrefix, processedName, filenameTpl)
        if (!choice) {
          if (ownsPanel()) panel.hidden = true
          return
        }
        pathStrategy = choice
        pathStrategyChosen = true
      }

      let key
      if (useOverrideKey) {
        key = /** @type {string} */ (overrideKey).replace(/^\/+/, '')
      } else if (pathStrategy === 'template') {
        key = processedName
      } else if (pathStrategy === 'prefix-basename') {
        key = currentPrefix + relDir + extractFileName(processedName)
      } else {
        key = currentPrefix + relDir + processedName
      }

      // Check for existing file conflict
      if (conflictDecision !== 'overwrite-all') {
        const exists = await this.#r2.fileExists(key)
        if (exists) {
          if (conflictDecision === 'skip-all') {
            skippedCount++
            continue
          }
          const choice = await this.#ui.confirmOverwrite(extractFileName(key), files.length > 1)
          if (choice === 'skip') {
            skippedCount++
            continue
          }
          if (choice === 'skip-all') {
            conflictDecision = 'skip-all'
            skippedCount++
            continue
          }
          if (choice === 'overwrite-all') conflictDecision = 'overwrite-all'
          // 'overwrite': fall through to upload
        }
      }

      const contentType = file.type || getMimeType(file.name)

      const id = `upload-${generation}-${i}-${Date.now()}`
      const displayName = key.length > 40 ? '...' + key.slice(-37) : key

      const item = document.createElement('div')
      item.className = 'upload-item'
      item.id = id
      item.innerHTML = `
        <div class="upload-item-header">
          <div class="upload-item-name"></div>
          <div class="upload-item-status" id="${id}-status"></div>
        </div>
        <div class="upload-progress">
          <div class="upload-progress-bar" id="${id}-bar"></div>
        </div>
      `
      const nameEl = /** @type {HTMLElement} */ (item.querySelector('.upload-item-name'))
      nameEl.textContent = displayName
      nameEl.setAttribute('title', displayName)
      body.appendChild(item)

      const updateStatus = /** @param {string} msg */ (msg) => {
        const statusEl = item.querySelector('.upload-item-status')
        if (statusEl) statusEl.textContent = msg
      }
      updateStatus(t('uploadWaiting'))

      uploads.push({ id, key, file, contentType, updateStatus })
    }

    // All files were skipped
    if (uploads.length === 0) {
      if (ownsPanel()) panel.hidden = true
      if (skippedCount > 0) {
        this.#ui.toast(t('uploadSkipped', { count: skippedCount }), 'info')
      }
      return
    }

    if (ownsPanel()) {
      panel.hidden = false
      panel.dataset.state = 'uploading'
      title.textContent = `${t('uploadProgress')} 0/${uploads.length}`
      updateOverallProgress(0, uploads.length)
    }

    let completed = 0
    const results = await runWithConcurrency(
      uploads.map((u) => async () => {
        let compressionStatus = ''
        const compressed = await compressFile(u.file, cfg, (msg) => {
          compressionStatus = msg
          u.updateStatus(msg)
        })
        u.updateStatus(t('uploading'))
        try {
          const result = await this.#uploadSingleFile(u.id, u.key, compressed, compressed.type || u.contentType)
          u.updateStatus(compressionStatus || filesize(compressed.size))
          return result
        } catch (e) {
          document.getElementById(u.id)?.classList.add('is-error')
          const detail = e instanceof Error && /^HTTP \d+$/.test(e.message) ? `${t('uploadFailed')} (${e.message})` : t('uploadFailed')
          u.updateStatus(detail)
          throw e
        } finally {
          completed++
          if (ownsPanel()) {
            title.textContent = `${t('uploadProgress')} ${completed}/${uploads.length}`
            updateOverallProgress(completed, uploads.length)
          }
        }
      }),
      cfg.uploadConcurrency ?? 3,
    )

    const success = results.filter((r) => r.status === 'fulfilled').length
    const fail = results.filter((r) => r.status === 'rejected').length
    if (ownsPanel()) {
      panel.dataset.state = fail === 0 ? 'done' : 'error'
      $('#upload-panel-summary').textContent = fail === 0
        ? t('uploadSuccess', { count: success })
        : t('uploadPartialFail', { success, fail })
    }

    if (fail === 0) {
      this.#ui.toast(t('uploadSuccess', { count: success }), 'success')
    } else {
      this.#ui.toast(t('uploadPartialFail', { success, fail }), 'error')
    }
    if (skippedCount > 0) {
      this.#ui.toast(t('uploadSkipped', { count: skippedCount }), 'info')
    }

    if (uploads.some((u) => u.key.slice(currentPrefix.length).includes('/'))) {
      this.#explorer.invalidateCache()
    }
    await this.#explorer.refresh()
  }

  /** @param {string} id @param {string} key @param {File} file @param {string} contentType */
  async #uploadSingleFile(id, key, file, contentType) {
    const bar = $(`#${id}-bar`)

    try {
      const signed = await this.#r2.putObjectSigned(key, contentType)
      if (bar) bar.classList.add('indeterminate')

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', signed.url)
        for (const [k, v] of Object.entries(signed.headers)) {
          if (k.toLowerCase() !== 'host') xhr.setRequestHeader(k, v)
        }
        xhr.upload.onprogress = (event) => {
          if (!bar || !event.lengthComputable || event.total <= 0) return
          bar.classList.remove('indeterminate')
          const percent = Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100)))
          bar.style.width = `${percent}%`
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve(undefined)
          else reject(new Error(`HTTP ${xhr.status}`))
        }
        xhr.onerror = () => reject(new TypeError('Failed to fetch'))
        xhr.onabort = () => reject(new Error('Upload aborted'))
        xhr.send(file)
      })
    } catch (error) {
      // Signing failures and network failures must both leave a visible error state.
      if (bar) bar.classList.add('error')
      throw error
    } finally {
      if (bar) bar.classList.remove('indeterminate')
    }

    if (bar) {
      bar.classList.add('done')
      bar.style.width = '100%'
    }
  }
}

export { UploadManager }
