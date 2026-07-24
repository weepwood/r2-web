import { AwsClient } from 'aws4fetch'
import { PAGE_SIZE } from './constants.js'
import { encodeS3Key } from './utils.js'
import { ConfigManager } from './config-manager.js'

/** @typedef {{ key: string; isFolder: boolean; size?: number; lastModified?: string }} FileItem */

class R2Client {
  /** @type {AwsClient | null} */
  #client = null
  /** @type {ConfigManager | null} */
  #config = null

  /** @param {ConfigManager} configManager */
  init(configManager) {
    this.#config = configManager
    const cfg = configManager.get()
    this.#client = new AwsClient({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      service: 's3',
      region: 'auto',
    })
  }

  /**
   * 使用查询参数签名，而不是 Authorization 请求头。
   * 这样普通 GET 不再触发 CORS 预检，PUT/DELETE 等操作的预检头也更少。
   * @param {string} url
   * @param {RequestInit} [init]
   */
  async #signedFetch(url, init = {}) {
    const client = /** @type {AwsClient} */ (this.#client)
    const method = init.method || 'GET'
    const headers = new Headers(init.headers || {})
    const signed = await client.sign(url, {
      method,
      headers,
      body: init.body,
      aws: { signQuery: true },
    })

    return fetch(signed.url, {
      method,
      headers,
      body: init.body,
    })
  }

  /** @param {Response} res */
  #assertOk(res) {
    if (res.ok) return
    if (res.status === 401) throw new Error('HTTP_401')
    if (res.status === 403) throw new Error('HTTP_403')
    if (res.status === 404) throw new Error('HTTP_404')
    throw new Error(`HTTP ${res.status}`)
  }

  /** @param {string} [prefix] @param {string} [continuationToken] @param {number} [maxKeys] */
  async listObjects(prefix = '', continuationToken = '', maxKeys = PAGE_SIZE) {
    const url = new URL(/** @type {ConfigManager} */ (this.#config).getBucketUrl())
    url.searchParams.set('list-type', '2')
    url.searchParams.set('delimiter', '/')
    url.searchParams.set('max-keys', String(maxKeys))
    if (prefix) url.searchParams.set('prefix', prefix)
    if (continuationToken) url.searchParams.set('continuation-token', continuationToken)

    const res = await this.#signedFetch(url.toString())
    this.#assertOk(res)

    const text = await res.text()
    const doc = new DOMParser().parseFromString(text, 'application/xml')

    /** @type {FileItem[]} */
    const folders = [...doc.querySelectorAll('CommonPrefixes > Prefix')].map((el) => ({
      key: el.textContent ?? '',
      isFolder: true,
    }))

    /** @type {FileItem[]} */
    const files = [...doc.querySelectorAll('Contents')]
      .map((el) => ({
        key: el.querySelector('Key')?.textContent ?? '',
        size: parseInt(el.querySelector('Size')?.textContent ?? '0', 10),
        lastModified: el.querySelector('LastModified')?.textContent ?? '',
        isFolder: false,
      }))
      .filter((f) => f.key !== prefix)

    const isTruncated = doc.querySelector('IsTruncated')?.textContent === 'true'
    const nextToken = doc.querySelector('NextContinuationToken')?.textContent || ''

    return { folders, files, isTruncated, nextToken }
  }

  /**
   * 检查对象是否存在。认证、权限或跨域失败时必须抛出错误，不能误判为“不存在”。
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async fileExists(key) {
    const url = new URL(/** @type {ConfigManager} */ (this.#config).getBucketUrl())
    url.searchParams.set('list-type', '2')
    url.searchParams.set('max-keys', '1')
    url.searchParams.set('prefix', key)
    const res = await this.#signedFetch(url.toString())
    this.#assertOk(res)
    const text = await res.text()
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    return [...doc.querySelectorAll('Contents > Key')].some((el) => el.textContent === key)
  }

  /** 测试当前 Bucket 的最小读取权限。 */
  async testConnection() {
    await this.listObjects('', '', 1)
  }

  /** @param {string} key @param {string} contentType */
  async putObjectSigned(key, contentType) {
    const url = `${/** @type {ConfigManager} */ (this.#config).getBucketUrl()}/${encodeS3Key(key)}`
    const headers = new Headers()
    if (contentType) headers.set('Content-Type', contentType)
    const req = await /** @type {AwsClient} */ (this.#client).sign(url, {
      method: 'PUT',
      headers,
      aws: { signQuery: true },
    })
    return { url: req.url, headers: Object.fromEntries(headers.entries()) }
  }

  /** @param {string} key */
  async getObject(key) {
    const url = `${/** @type {ConfigManager} */ (this.#config).getBucketUrl()}/${encodeS3Key(key)}`
    const res = await this.#signedFetch(url)
    this.#assertOk(res)
    return res
  }

  /** @param {string} key */
  async getPresignedUrl(key) {
    const url = `${/** @type {ConfigManager} */ (this.#config).getBucketUrl()}/${encodeS3Key(key)}`
    const signed = await /** @type {AwsClient} */ (this.#client).sign(url, {
      method: 'GET',
      aws: { signQuery: true },
    })
    return signed.url
  }

  /** @param {string} key @param {string} filename */
  async getDownloadUrl(key, filename) {
    const base = `${/** @type {ConfigManager} */ (this.#config).getBucketUrl()}/${encodeS3Key(key)}`
    const url = new URL(base)
    url.searchParams.set('response-content-disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
    const signed = await /** @type {AwsClient} */ (this.#client).sign(url.toString(), {
      method: 'GET',
      aws: { signQuery: true },
    })
    return signed.url
  }

  /** @param {string} key */
  getPublicUrl(key) {
    const cfg = /** @type {ConfigManager} */ (this.#config).get()
    if (cfg.customDomain && cfg.bucketAccess !== 'private') {
      return `${cfg.customDomain}/${encodeS3Key(key)}`
    }
    return null
  }

  /** @param {string} key */
  async headObject(key) {
    const url = `${/** @type {ConfigManager} */ (this.#config).getBucketUrl()}/${encodeS3Key(key)}`
    const res = await this.#signedFetch(url, { method: 'HEAD' })
    this.#assertOk(res)
    return {
      contentType: res.headers.get('content-type'),
      contentLength: parseInt(res.headers.get('content-length') || '0', 10),
      lastModified: res.headers.get('last-modified'),
      etag: res.headers.get('etag'),
    }
  }

  /** @param {string} key */
  async deleteObject(key) {
    const url = `${/** @type {ConfigManager} */ (this.#config).getBucketUrl()}/${encodeS3Key(key)}`
    const res = await this.#signedFetch(url, { method: 'DELETE' })
    this.#assertOk(res)
  }

  /** @param {string} src @param {string} dest */
  async copyObject(src, dest) {
    const cfg = /** @type {ConfigManager} */ (this.#config).get()
    const url = `${/** @type {ConfigManager} */ (this.#config).getBucketUrl()}/${encodeS3Key(dest)}`
    const res = await this.#signedFetch(url, {
      method: 'PUT',
      headers: {
        'x-amz-copy-source': `/${cfg.bucket}/${encodeS3Key(src)}`,
      },
    })
    this.#assertOk(res)
  }

  /** @param {string} key @param {string} contentType */
  async updateContentType(key, contentType) {
    const cfg = /** @type {ConfigManager} */ (this.#config).get()
    const url = `${/** @type {ConfigManager} */ (this.#config).getBucketUrl()}/${encodeS3Key(key)}`
    const res = await this.#signedFetch(url, {
      method: 'PUT',
      headers: {
        'x-amz-copy-source': `/${cfg.bucket}/${encodeS3Key(key)}`,
        'x-amz-metadata-directive': 'REPLACE',
        'Content-Type': contentType,
      },
    })
    this.#assertOk(res)
  }

  /** @param {string} prefix */
  async createFolder(prefix) {
    const key = prefix.endsWith('/') ? prefix : prefix + '/'
    const url = `${/** @type {ConfigManager} */ (this.#config).getBucketUrl()}/${encodeS3Key(key)}`
    const res = await this.#signedFetch(url, {
      method: 'PUT',
      body: new Uint8Array(0),
    })
    this.#assertOk(res)
  }
}

export { R2Client }
