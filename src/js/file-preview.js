import { filesize } from 'filesize'
import { AUDIO_RE, IMAGE_RE, TEXT_RE, VIDEO_RE } from './constants.js'
import { t } from './i18n.js'
import { R2Client } from './r2-client.js'
import { ImageAssetService } from './image-asset-service.js'
import { UIManager } from './ui-manager.js'
import { $, formatDate, getErrorMessage, extractFileName, getMimeType } from './utils.js'

const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024

/** @typedef {{key: string, size?: number, lastModified?: number}} PreviewItem */

class FilePreview {
  /** @type {R2Client} */
  #r2
  /** @type {ImageAssetService} */
  #images
  /** @type {UIManager} */
  #ui
  #currentKey = ''
  #currentText = ''
  #currentUrl = ''
  /** @type {PreviewItem[]} */
  #navigationItems = []
  #loadGeneration = 0

  /** @param {R2Client} r2 @param {UIManager} ui */
  constructor(r2, ui) {
    this.#r2 = r2
    this.#images = new ImageAssetService(r2)
    this.#ui = ui
    const dialog = /** @type {HTMLDialogElement} */ ($('#preview-dialog'))
    dialog.addEventListener('close', () => {
      // The close event can run after a rapid reopen; never invalidate the new preview.
      if (dialog.open) return
      // Ignore any pending HEAD, signed URL or text fetch response after closing.
      this.#loadGeneration++
      this.#currentKey = ''
      this.#currentText = ''
      this.#currentUrl = ''
      this.#releaseMedia(dialog)
    })
  }

  /** @param {ParentNode} root */
  #releaseMedia(root) {
    root.querySelectorAll('video, audio').forEach((el) => {
      const media = /** @type {HTMLMediaElement} */ (el)
      media.pause()
      media.removeAttribute('src')
      media.load()
    })
  }

  /** @param {Response} res @returns {Promise<{ text: string; truncated: boolean }>} */
  async #readLimitedText(res) {
    const reader = res.body?.getReader()
    if (!reader) {
      const text = await res.text()
      return { text, truncated: false }
    }
    const decoder = new TextDecoder()
    let text = ''
    let total = 0
    let truncated = false
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const remaining = MAX_TEXT_PREVIEW_BYTES - total
        if (value.byteLength > remaining) {
          text += decoder.decode(value.subarray(0, remaining), { stream: false })
          truncated = true
          await reader.cancel().catch(() => {})
          break
        }
        total += value.byteLength
        text += decoder.decode(value, { stream: true })
      }
      if (!truncated) text += decoder.decode()
    } finally {
      reader.releaseLock()
    }
    return { text, truncated }
  }

  get currentKey() {
    return this.#currentKey
  }

  /**
   * Populate navigation from the currently displayed, previewable files.
   * Never reaches into R2 or an unloaded directory.
   * @param {PreviewItem[]} items
   */
  setNavigationItems(items) {
    this.#navigationItems = items.map((item) => ({ ...item }))
    this.#updateNavigation()
  }

  /** @param {-1 | 1} direction */
  navigate(direction) {
    const dialog = /** @type {HTMLDialogElement} */ ($('#preview-dialog'))
    if (!dialog.open) return
    const index = this.#navigationItems.findIndex((item) => item.key === this.#currentKey)
    const next = this.#navigationItems[index + direction]
    if (!next || index < 0) return
    void this.preview(next)
  }

  #updateNavigation() {
    const previous = /** @type {HTMLButtonElement} */ ($('#preview-prev'))
    const next = /** @type {HTMLButtonElement} */ ($('#preview-next'))
    const position = $('#preview-position')
    const index = this.#navigationItems.findIndex((item) => item.key === this.#currentKey)
    const hasList = this.#navigationItems.length > 1 && index >= 0

    const activeElement = document.activeElement
    previous.hidden = !hasList
    next.hidden = !hasList
    position.hidden = !hasList
    previous.disabled = !hasList || index === 0
    next.disabled = !hasList || index === this.#navigationItems.length - 1
    if (hasList) position.textContent = `${index + 1} / ${this.#navigationItems.length}`
    if (activeElement === previous && previous.disabled) {
      if (!next.disabled) next.focus({ preventScroll: true })
      else $('#preview-dialog .dialog-panel').focus({ preventScroll: true })
    } else if (activeElement === next && next.disabled) {
      if (!previous.disabled) previous.focus({ preventScroll: true })
      else $('#preview-dialog .dialog-panel').focus({ preventScroll: true })
    }
  }

  /** @param {string} message @param {'loading'|'error'|'empty'} kind */
  #showMessage(message, kind) {
    const p = document.createElement('p')
    p.className = `preview-message preview-message-${kind}`
    if (kind === 'loading') p.setAttribute('role', 'status')
    if (kind === 'error') p.setAttribute('role', 'alert')
    p.textContent = message
    $('#preview-body').replaceChildren(p)
  }

  /** @param {{contentLength: number, contentType: string, lastModified?: Date}} meta */
  #renderMetadata(meta) {
    const footer = $('#preview-footer')
    const fields = [
      `${t('size')}: ${filesize(meta.contentLength)}`,
      `${t('contentType')}: ${meta.contentType || 'unknown'}`,
    ]
    if (meta.lastModified) fields.push(`${t('lastModified')}: ${formatDate(meta.lastModified)}`)
    const nodes = fields.map((value) => {
      const span = document.createElement('span')
      span.textContent = value
      return span
    })
    footer.replaceChildren(...nodes)
    footer.classList.add('bordered')
  }

  /** @param {PreviewItem} item */
  async preview(item) {
    const generation = ++this.#loadGeneration
    const key = item.key
    this.#currentKey = key
    this.#currentText = ''
    this.#currentUrl = ''

    const dialog = /** @type {HTMLDialogElement} */ ($('#preview-dialog'))
    const body = $('#preview-body')
    this.#releaseMedia(body)
    const footer = $('#preview-footer')
    const copyBtn = /** @type {HTMLElement} */ ($('#preview-copy'))
    const copyTextBtn = /** @type {HTMLElement} */ ($('#preview-copy-text'))
    const copyImageBtn = /** @type {HTMLElement} */ ($('#preview-copy-image'))

    $('#preview-filename').textContent = extractFileName(key)
    footer.replaceChildren()
    footer.classList.remove('bordered')
    copyBtn.hidden = true
    copyTextBtn.hidden = true
    copyImageBtn.hidden = true
    this.#showMessage(t('previewLoading'), 'loading')
    this.#updateNavigation()
    if (!dialog.open) dialog.showModal()

    // Resolve URLs and metadata without letting stale requests repaint another file.
    const isCurrent = () => generation === this.#loadGeneration && dialog.open

    try {
      let realContentType = getMimeType(key)
      try {
        const head = await this.#r2.headObject(key)
        if (!isCurrent()) return
        if (head.contentType) realContentType = head.contentType
      } catch {
        if (!isCurrent()) return
      }

      this.#renderMetadata({
        contentLength: item.size ?? 0,
        contentType: realContentType,
        lastModified: item.lastModified ? new Date(item.lastModified) : undefined,
      })

      if (IMAGE_RE.test(key) || VIDEO_RE.test(key) || AUDIO_RE.test(key) || TEXT_RE.test(key)) {
        const url = await this.#images.originalUrl(key)
        if (!isCurrent()) return
        this.#currentUrl = url

        if (IMAGE_RE.test(key)) {
          const img = document.createElement('img')
          img.alt = extractFileName(key)
          img.classList.add('is-loading')
          const spinner = document.createElement('p')
          spinner.className = 'preview-message preview-message-loading preview-image-spinner'
          spinner.setAttribute('role', 'status')
          spinner.textContent = t('previewLoading')
          img.onload = () => {
            if (!isCurrent()) return
            img.classList.remove('is-loading')
            spinner.remove()
            if (img.naturalWidth && img.naturalHeight) {
              const dim = document.createElement('span')
              dim.textContent = `${img.naturalWidth} × ${img.naturalHeight}`
              footer.appendChild(dim)
              if (img.naturalWidth > body.clientWidth || img.naturalHeight > body.clientHeight) {
                img.classList.add('is-zoomable')
                const zoomPill = document.createElement('button')
                zoomPill.type = 'button'
                zoomPill.className = 'preview-zoom-pill'
                const syncZoom = () => {
                  const zoomed = img.classList.contains('is-zoomed')
                  zoomPill.textContent = zoomed ? '100%' : 'Fit'
                  zoomPill.setAttribute('aria-pressed', String(zoomed))
                }
                const toggleZoom = () => {
                  img.classList.toggle('is-zoomed')
                  syncZoom()
                }
                syncZoom()
                img.addEventListener('click', toggleZoom)
                zoomPill.addEventListener('click', toggleZoom)
                footer.appendChild(zoomPill)
              }
            }
          }
          img.onerror = () => {
            if (!isCurrent()) return
            copyImageBtn.hidden = true
            this.#showMessage(t('previewLoadFailed'), 'error')
          }
          img.src = url
          body.replaceChildren(spinner, img)
          copyImageBtn.hidden = false
        } else if (VIDEO_RE.test(key)) {
          const video = document.createElement('video')
          video.src = url
          video.controls = true
          video.preload = 'metadata'
          body.replaceChildren(video)
        } else if (AUDIO_RE.test(key)) {
          const audio = document.createElement('audio')
          audio.src = url
          audio.controls = true
          audio.preload = 'metadata'
          body.replaceChildren(audio)
        } else {
          const res = await this.#r2.getObject(key)
          if (!isCurrent()) return
          const { text, truncated } = await this.#readLimitedText(res)
          if (!isCurrent()) return
          this.#currentText = text
          const pre = document.createElement('pre')
          pre.textContent = text
          if (truncated) {
            const notice = document.createElement('p')
            notice.className = 'preview-message preview-message-empty'
            notice.textContent = t('previewTextTruncated')
            body.replaceChildren(notice, pre)
          } else {
            body.replaceChildren(pre)
          }
          copyTextBtn.hidden = false
        }
        copyBtn.hidden = false
      } else {
        this.#showMessage(t('previewNotAvailable'), 'empty')
      }
    } catch {
      if (!isCurrent()) return
      this.#showMessage(t('previewLoadFailed'), 'error')
    }
  }

  async downloadCurrent() {
    if (!this.#currentKey) return
    try {
      const filename = extractFileName(this.#currentKey)
      const url = await this.#r2.getDownloadUrl(this.#currentKey, filename)
      const a = document.createElement('a')
      a.href = url
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (/** @type {any} */ err) {
      const errorKey = getErrorMessage(err)
      if (errorKey === 'networkError') {
        this.#ui.toast(t('networkError', { msg: err.message }), 'error')
      } else {
        this.#ui.toast(t(/** @type {any} */ (errorKey)), 'error')
      }
    }
  }

  async copyCurrentLink() {
    if (!this.#currentUrl) return
    try {
      await navigator.clipboard.writeText(this.#currentUrl)
      this.#ui.toast(t('linkCopied'), 'success')
    } catch {
      await this.#ui.prompt(t('copyLink'), t('copyUrl'), this.#currentUrl)
    }
  }

  async copyCurrentImage() {
    if (!this.#currentUrl) return
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      this.#ui.toast(t('copyImageNotSupported'), 'error')
      return
    }
    let objectUrl = ''
    try {
      const res = await fetch(this.#currentUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      objectUrl = URL.createObjectURL(blob)
      const pngBlob = await new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            reject(new Error('Canvas context unavailable'))
            return
          }
          ctx.drawImage(img, 0, 0)
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error())), 'image/png')
        }
        img.onerror = () => reject(new Error('Image decode failed'))
        img.src = objectUrl
      })
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
      this.#ui.toast(t('copyImageSuccess'), 'success')
    } catch {
      this.#ui.toast(t('copyImageFailed'), 'error')
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }

  async copyCurrentText() {
    if (!this.#currentText) return
    try {
      await navigator.clipboard.writeText(this.#currentText)
      this.#ui.toast(t('copyTextSuccess'), 'success')
    } catch {
      await this.#ui.prompt(t('copyTextTitle'), t('copyTextLabel'), this.#currentText)
    }
  }
}

export { FilePreview }
