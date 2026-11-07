import { filesize } from 'filesize'
import { t } from './i18n.js'
import { $, extractFileName, formatDate, getFileIconSvg, getMimeType } from './utils.js'

/** @typedef {{key: string, isFolder: boolean, size: number, modified: number, type: string}} DetailsItem */

/**
 * Metadata-only inspector. Opening this panel must never trigger an R2 HEAD,
 * GET, or original-image download. All values come from the current file card.
 */
class FileDetails {
  /** @type {DetailsItem | null} */
  #item = null
  /** @type {(item: {key:string,size:number,lastModified:number}) => void} */
  #onPreview
  /** @type {(key:string) => void} */
  #onNavigate
  /** @type {(key:string) => void} */
  #onDownload
  /** @type {(key:string) => void} */
  #onCopy

  /**
   * @param {{onPreview: (item:{key:string,size:number,lastModified:number})=>void,
   *   onNavigate:(key:string)=>void, onDownload:(key:string)=>void,
   *   onCopy:(key:string)=>void}} callbacks
   */
  constructor(callbacks) {
    this.#onPreview = callbacks.onPreview
    this.#onNavigate = callbacks.onNavigate
    this.#onDownload = callbacks.onDownload
    this.#onCopy = callbacks.onCopy

    $('#details-close').addEventListener('click', () => this.close())
    $('#details-backdrop').addEventListener('click', () => this.close())
    $('#details-open').addEventListener('click', () => {
      const item = this.#item
      if (!item) return
      if (item.isFolder) {
        this.close()
        this.#onNavigate(item.key)
      } else {
        this.#onPreview({ key: item.key, size: item.size, lastModified: item.modified })
      }
    })
    $('#details-copy').addEventListener('click', () => {
      if (this.#item) this.#onCopy(this.#item.key)
    })
    $('#details-download').addEventListener('click', () => {
      if (this.#item && !this.#item.isFolder) this.#onDownload(this.#item.key)
    })
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || this.#item === null) return
      if (document.querySelector('dialog[open]')) return
      this.close()
    })
  }

  /** @param {HTMLElement} card */
  open(card) {
    this.#item = {
      key: card.dataset.key ?? '',
      isFolder: card.dataset.isFolder === 'true',
      size: Number(card.dataset.size ?? 0),
      modified: Number(card.dataset.mod ?? 0),
      type: card.dataset.filetype ?? 'file',
    }
    const panel = $('#details-panel')
    panel.hidden = false
    $('#details-backdrop').hidden = false
    $('#app').classList.add('details-open')
    this.#render()
    $('#details-close').focus()
  }

  close() {
    if (!this.#item) return
    this.#item = null
    $('#details-panel').hidden = true
    $('#details-backdrop').hidden = true
    $('#app').classList.remove('details-open')
  }

  updateLabels() {
    $('#details-eyebrow').textContent = t('detailsEyebrow')
    $('#details-title').textContent = t('detailsTitle')
    $('#details-size-label').textContent = t('size')
    $('#details-modified-label').textContent = t('lastModified')
    $('#details-type-label').textContent = t('contentType')
    $('#details-path-label').textContent = t('detailsPath')
    $('#details-open-text').textContent = this.#item?.isFolder ? t('detailsOpenFolder') : t('preview')
    $('#details-copy-text').textContent = t('copyPath')
    $('#details-download-text').textContent = t('download')
    $('#details-close').setAttribute('aria-label', t('detailsClose'))
    $('#details-backdrop').setAttribute('aria-label', t('detailsClose'))
    this.#render()
  }

  #render() {
    const item = this.#item
    if (!item) return
    $('#details-filename').textContent = extractFileName(item.key)
    $('#details-filetype').textContent = item.isFolder ? t('detailsFolder') : t('detailsFile')
    $('#details-size').textContent = item.isFolder ? '—' : filesize(item.size)
    $('#details-modified').textContent = item.modified ? formatDate(item.modified) : '—'
    $('#details-type').textContent = item.isFolder ? t('detailsFolder') : getMimeType(item.key)
    $('#details-path').textContent = item.key
    const art = $('#details-art')
    art.dataset.type = item.isFolder ? 'folder' : item.type
    // Only static, locally authored icons; the file key is never HTML-interpolated.
    art.innerHTML = item.isFolder
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'
      : item.type === 'image'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m3 18 6-6 4 4 3-3 5 5"/></svg>'
        : getFileIconSvg(/** @type {'video'|'audio'|'text'|'document'|'archive'|'code'|'file'} */ (item.type))
    $('#details-open-text').textContent = item.isFolder ? t('detailsOpenFolder') : t('preview')
    $('#details-download').hidden = item.isFolder
  }
}

export { FileDetails }
