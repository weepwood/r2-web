/**
 * Thumbnail delivery policies (browser-only settings).
 *
 * "auto": Cloudflare small variants on public custom domains, with original
 *        image fallback if the zone has not enabled Transformations.
 * "strict": Only transformed small images in file cards. Never fall back to
 *          downloading original bytes in a listing (including private buckets).
 * "original": Legacy behavior for unsupported/public/private environments.
 *
 * These preferences are intentionally local to this browser and never exported
 * with shared R2 configuration.
 */
const THUMBNAIL_MODE_KEY = 'r2-web-thumbnail-mode'
const THUMBNAIL_MODES = Object.freeze(['auto', 'strict', 'original'])
const RESIZABLE_IMAGE_RE = /\.(jpe?g|png|webp|avif|gif)$/i
const THUMBNAIL_WIDTHS = Object.freeze([160, 320, 480, 640])

/** @typedef {'auto' | 'strict' | 'original'} ThumbnailMode */

/** @returns {ThumbnailMode} */
function getThumbnailMode() {
  try {
    const value = localStorage.getItem(THUMBNAIL_MODE_KEY)
    return /** @type {ThumbnailMode} */ (THUMBNAIL_MODES.includes(value ?? '') ? value : 'auto')
  } catch {
    return 'auto'
  }
}

/** @param {ThumbnailMode} mode */
function setThumbnailMode(mode) {
  if (!THUMBNAIL_MODES.includes(mode)) throw new Error('Invalid thumbnail mode')
  localStorage.setItem(THUMBNAIL_MODE_KEY, mode)
}

/** @param {number} displayWidth @param {number} [dpr] */
function selectThumbnailWidth(displayWidth, dpr = 1) {
  const requested = Math.max(1, Math.ceil(displayWidth * Math.min(Math.max(dpr || 1, 1), 3)))
  return THUMBNAIL_WIDTHS.find((width) => width >= requested) ?? THUMBNAIL_WIDTHS.at(-1)
}

/**
 * Cloudflare Images Transformations URL for a *public* image on an enabled zone.
 * A signed R2 S3 URL is not eligible. The original source path stays encoded.
 * @param {string | null} publicUrl
 * @param {string} key
 * @param {number} width
 * @returns {string | null}
 */
function buildCloudflareThumbnailUrl(publicUrl, key, width) {
  if (!publicUrl || !RESIZABLE_IMAGE_RE.test(key)) return null

  let original
  try {
    original = new URL(publicUrl)
  } catch {
    return null
  }
  if (original.protocol !== 'https:' && original.protocol !== 'http:') return null
  if (/\.r2\.dev$|\.r2\.cloudflarestorage\.com$/i.test(original.hostname)) return null
  if (original.username || original.password || original.search) return null

  const sized = selectThumbnailWidth(width)
  const options = `width=${sized},quality=72,fit=scale-down,format=auto`
  const result = new URL(original.origin)
  result.pathname = `/cdn-cgi/image/${options}${original.pathname}`
  return result.toString()
}

/**
 * @param {{ publicUrl: string | null, key: string, mode: ThumbnailMode, width: number }} params
 * @returns {{ url: string | null, allowOriginal: boolean }}
 */
function resolveThumbnailPolicy({ publicUrl, key, mode, width }) {
  if (mode === 'original') return { url: null, allowOriginal: true }
  const url = buildCloudflareThumbnailUrl(publicUrl, key, width)
  return { url, allowOriginal: mode !== 'strict' }
}

export {
  THUMBNAIL_MODE_KEY,
  THUMBNAIL_MODES,
  getThumbnailMode,
  setThumbnailMode,
  selectThumbnailWidth,
  buildCloudflareThumbnailUrl,
  resolveThumbnailPolicy,
}
