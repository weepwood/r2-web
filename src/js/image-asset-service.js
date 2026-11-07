import { getThumbnailMode, resolveThumbnailPolicy, selectThumbnailWidth } from './thumbnail-utils.js'
/** @typedef {import('./r2-client.js').R2Client} R2Client */

/**
 * Single point for deciding which image resource can be requested.
 *
 * The main gallery and PosterWall share exactly the same public/private,
 * strict-bandwidth and Cloudflare-resize rules. Opening an original preview is
 * deliberately a separate method: neither a viewport change nor a zoom
 * gesture is allowed to trigger it implicitly.
 */
class ImageAssetService {
  /** @type {R2Client} */
  #r2

  /** @param {R2Client} r2 */
  constructor(r2) {
    this.#r2 = r2
  }

  /**
   * @param {string} key
   * @param {number} displayWidth
   * @param {number} [dpr]
   * @returns {{url: string|null, allowOriginal: boolean, publicUrl: string|null, width: number}}
   */
  thumbnailPlan(key, displayWidth, dpr = 1) {
    const publicUrl = this.#r2.getPublicUrl(key)
    const width = selectThumbnailWidth(displayWidth, dpr)
    const policy = resolveThumbnailPolicy({
      publicUrl,
      key,
      mode: getThumbnailMode(),
      width,
    })
    return { ...policy, publicUrl, width }
  }

  /**
   * Only call this after an explicit user preview or download action, or when
   * the selected compatibility mode permits full-size thumbnail fallback.
   * @param {string} key
   * @returns {Promise<string>}
   */
  async originalUrl(key) {
    return this.#r2.getPublicUrl(key) ?? (await this.#r2.getPresignedUrl(key))
  }
}

export { ImageAssetService }
