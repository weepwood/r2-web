import { STORAGE_KEY, THEME_KEY, LANG_KEY, VIEW_KEY, DENSITY_KEY, SORT_BY_KEY, SORT_ORDER_KEY } from './constants.js'

/** @typedef {'public'|'private'} BucketAccess */
/** @typedef {{ id: string; name: string; alias?: string; customDomain?: string; bucketAccess?: BucketAccess }} BucketConfig */
/** @typedef {{ id: string; name?: string; accountId?: string; accessKeyId?: string; secretAccessKey?: string; endpoint?: string; buckets: BucketConfig[] }} ProfileConfig */
/** @typedef {{ schemaVersion: 2; profiles: ProfileConfig[]; activeProfileId?: string; activeBucketId?: string; filenameTpl?: string; filenameTplScope?: string; compressMode?: string; compressLevel?: string; tinifyKey?: string; uploadConcurrency?: number }} StoredConfig */
/** @typedef {{ accountId?: string; accessKeyId?: string; secretAccessKey?: string; endpoint?: string; bucket?: string; bucketId?: string; bucketAlias?: string; filenameTpl?: string; filenameTplScope?: string; customDomain?: string; bucketAccess?: BucketAccess; compressMode?: string; compressLevel?: string; tinifyKey?: string; uploadConcurrency?: number }} AppConfig */

const SCHEMA_VERSION = 2
const BUCKET_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/

const randomId = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
const cleanDomain = (value = '') => value.trim().replace(/\/+$/, '')

/** @param {string} value */
function validateBucketName(value) {
  const name = value.trim()
  if (!name) throw new Error('BUCKET_NAME_REQUIRED')
  if (!BUCKET_NAME_RE.test(name)) throw new Error('BUCKET_NAME_INVALID')
  return name
}

class ConfigManager {
  constructor() {
    this.#ensureMigrated()
  }

  /** @returns {StoredConfig} */
  loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') || {}
      if (raw.schemaVersion === SCHEMA_VERSION && Array.isArray(raw.profiles)) return this.#normalizeState(raw)
      return this.#migrateLegacy(raw)
    } catch {
      return this.#emptyState()
    }
  }

  /** @returns {AppConfig} */
  load() {
    const state = this.loadState()
    const profile = this.#findActiveProfile(state)
    const bucket = this.#findActiveBucket(state, profile)
    return {
      accountId: profile?.accountId,
      accessKeyId: profile?.accessKeyId,
      secretAccessKey: profile?.secretAccessKey,
      endpoint: profile?.endpoint,
      bucket: bucket?.name,
      bucketId: bucket?.id,
      bucketAlias: bucket?.alias,
      customDomain: bucket?.customDomain,
      bucketAccess: bucket?.bucketAccess || 'public',
      filenameTpl: state.filenameTpl,
      filenameTplScope: state.filenameTplScope,
      compressMode: state.compressMode,
      compressLevel: state.compressLevel,
      tinifyKey: state.tinifyKey,
      uploadConcurrency: state.uploadConcurrency,
    }
  }

  /**
   * 保存现有设置表单。账户字段更新当前 Profile，Bucket 字段只更新当前 Bucket，
   * 上传和压缩字段保持为全局偏好。
   * @param {AppConfig} cfg
   */
  save(cfg) {
    const state = this.loadState()
    let profile = this.#findActiveProfile(state)
    if (!profile) {
      profile = { id: randomId('profile'), name: 'Cloudflare R2', buckets: [] }
      state.profiles.push(profile)
      state.activeProfileId = profile.id
    }

    profile.accountId = cfg.accountId ?? profile.accountId
    profile.accessKeyId = cfg.accessKeyId ?? profile.accessKeyId
    profile.secretAccessKey = cfg.secretAccessKey ?? profile.secretAccessKey
    profile.endpoint = cfg.endpoint ?? profile.endpoint

    let bucket = this.#findActiveBucket(state, profile)
    if (!bucket) {
      bucket = { id: randomId('bucket'), name: cfg.bucket?.trim() || '', bucketAccess: 'public' }
      profile.buckets.push(bucket)
      state.activeBucketId = bucket.id
    }

    if (cfg.bucket !== undefined) bucket.name = cfg.bucket.trim()
    if (cfg.bucketAlias !== undefined) bucket.alias = cfg.bucketAlias.trim()
    if (cfg.customDomain !== undefined) bucket.customDomain = cleanDomain(cfg.customDomain)
    if (cfg.bucketAccess !== undefined) bucket.bucketAccess = cfg.bucketAccess

    if (cfg.filenameTpl !== undefined) state.filenameTpl = cfg.filenameTpl
    if (cfg.filenameTplScope !== undefined) state.filenameTplScope = cfg.filenameTplScope
    if (cfg.compressMode !== undefined) state.compressMode = cfg.compressMode
    if (cfg.compressLevel !== undefined) state.compressLevel = cfg.compressLevel
    if (cfg.tinifyKey !== undefined) state.tinifyKey = cfg.tinifyKey
    if (cfg.uploadConcurrency !== undefined) state.uploadConcurrency = cfg.uploadConcurrency

    this.#saveState(state)
  }

  /** @returns {AppConfig} */
  get() {
    return this.load()
  }

  clear() {
    localStorage.removeItem(STORAGE_KEY)
    this.#emitChange()
  }

  isValid() {
    const c = this.load()
    return !!(c.accountId && c.accessKeyId && c.secretAccessKey && c.bucket)
  }

  getEndpoint() {
    const c = this.load()
    return (c.endpoint || `https://${c.accountId}.r2.cloudflarestorage.com`).replace(/\/+$/, '')
  }

  getBucketUrl() {
    const c = this.load()
    return `${this.getEndpoint()}/${c.bucket}`
  }

  /** @returns {ProfileConfig[]} */
  getProfiles() {
    return structuredClone(this.loadState().profiles)
  }

  /** @returns {ProfileConfig | null} */
  getActiveProfile() {
    const state = this.loadState()
    return structuredClone(this.#findActiveProfile(state) || null)
  }

  /** @returns {BucketConfig | null} */
  getActiveBucket() {
    const state = this.loadState()
    const profile = this.#findActiveProfile(state)
    return structuredClone(this.#findActiveBucket(state, profile) || null)
  }

  /** @returns {BucketConfig[]} */
  getBuckets() {
    return this.getActiveProfile()?.buckets || []
  }

  /** @param {{ name: string; alias?: string; customDomain?: string; bucketAccess?: BucketAccess }} input */
  addBucket(input) {
    const name = validateBucketName(input.name)
    const state = this.loadState()
    const profile = this.#findActiveProfile(state)
    if (!profile) throw new Error('PROFILE_REQUIRED')
    if (profile.buckets.some((bucket) => bucket.name === name)) throw new Error('BUCKET_EXISTS')

    const bucket = {
      id: randomId('bucket'),
      name,
      alias: input.alias?.trim() || '',
      customDomain: cleanDomain(input.customDomain),
      bucketAccess: input.bucketAccess || 'private',
    }
    profile.buckets.push(bucket)
    this.#saveState(state)
    return structuredClone(bucket)
  }

  /** @param {string} bucketId @param {Partial<BucketConfig>} patch */
  updateBucket(bucketId, patch) {
    const state = this.loadState()
    const profile = this.#findActiveProfile(state)
    const bucket = profile?.buckets.find((item) => item.id === bucketId)
    if (!bucket || !profile) throw new Error('BUCKET_NOT_FOUND')

    if (patch.name !== undefined) {
      const name = validateBucketName(patch.name)
      if (profile.buckets.some((item) => item.id !== bucketId && item.name === name)) throw new Error('BUCKET_EXISTS')
      bucket.name = name
    }
    if (patch.alias !== undefined) bucket.alias = patch.alias.trim()
    if (patch.customDomain !== undefined) bucket.customDomain = cleanDomain(patch.customDomain)
    if (patch.bucketAccess !== undefined) bucket.bucketAccess = patch.bucketAccess
    this.#saveState(state)
  }

  /** @param {string} bucketId */
  removeBucket(bucketId) {
    const state = this.loadState()
    const profile = this.#findActiveProfile(state)
    if (!profile) throw new Error('PROFILE_REQUIRED')
    if (profile.buckets.length <= 1) throw new Error('LAST_BUCKET')
    const index = profile.buckets.findIndex((bucket) => bucket.id === bucketId)
    if (index < 0) throw new Error('BUCKET_NOT_FOUND')
    profile.buckets.splice(index, 1)
    if (state.activeBucketId === bucketId) state.activeBucketId = profile.buckets[0]?.id
    this.#saveState(state)
  }

  /** @param {string} profileId @param {string} bucketId */
  setActiveBucket(profileId, bucketId) {
    const state = this.loadState()
    const profile = state.profiles.find((item) => item.id === profileId)
    if (!profile?.buckets.some((bucket) => bucket.id === bucketId)) throw new Error('BUCKET_NOT_FOUND')
    state.activeProfileId = profileId
    state.activeBucketId = bucketId
    this.#saveState(state)
  }

  toBase64() {
    const state = this.loadState()
    const safeState = {
      ...state,
      profiles: state.profiles.map(({ secretAccessKey: _secret, accessKeyId: _access, accountId: _account, ...profile }) => profile),
      theme: localStorage.getItem(THEME_KEY) || undefined,
      lang: localStorage.getItem(LANG_KEY) || undefined,
      view: localStorage.getItem(VIEW_KEY) || undefined,
      density: localStorage.getItem(DENSITY_KEY) || undefined,
      sortBy: localStorage.getItem(SORT_BY_KEY) || undefined,
      sortOrder: localStorage.getItem(SORT_ORDER_KEY) || undefined,
      shareType: 'safe',
    }
    return btoa(unescape(encodeURIComponent(JSON.stringify(safeState))))
  }

  /** @param {string} b64 @returns {boolean} */
  loadFromBase64(b64) {
    try {
      const json = decodeURIComponent(escape(atob(b64)))
      const payload = JSON.parse(json)
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false

      const { theme, lang, view, density, sortBy, sortOrder, shareType: _shareType, ...config } = payload
      if (theme) localStorage.setItem(THEME_KEY, theme)
      if (lang) localStorage.setItem(LANG_KEY, lang)
      if (view) localStorage.setItem(VIEW_KEY, view)
      if (density) localStorage.setItem(DENSITY_KEY, density)
      if (sortBy) localStorage.setItem(SORT_BY_KEY, sortBy)
      if (sortOrder) localStorage.setItem(SORT_ORDER_KEY, sortOrder)

      if (config.schemaVersion === SCHEMA_VERSION && Array.isArray(config.profiles)) {
        const current = this.loadState()
        const incoming = this.#normalizeState(config)
        const currentProfile = this.#findActiveProfile(current)
        const incomingProfile = this.#findActiveProfile(incoming)
        if (currentProfile && incomingProfile) {
          for (const bucket of incomingProfile.buckets) {
            if (!currentProfile.buckets.some((item) => item.name === bucket.name)) currentProfile.buckets.push(bucket)
          }
          this.#saveState(current)
        } else {
          this.#saveState(incoming)
        }
      } else if (Object.values(config).some(Boolean)) {
        const migrated = this.#migrateLegacy(config)
        this.#saveState(migrated)
      }
      return true
    } catch {
      return false
    }
  }

  getShareUrl() {
    const b64 = this.toBase64()
    const url = new URL(window.location.href)
    url.searchParams.set('config', b64)
    url.hash = ''
    return url.toString()
  }

  #ensureMigrated() {
    const state = this.loadState()
    if (state.profiles.length > 0 || localStorage.getItem(STORAGE_KEY)) this.#saveState(state, false)
  }

  /** @returns {StoredConfig} */
  #emptyState() {
    return { schemaVersion: SCHEMA_VERSION, profiles: [] }
  }

  /** @param {any} raw @returns {StoredConfig} */
  #migrateLegacy(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.values(raw).some(Boolean)) return this.#emptyState()
    const profileId = randomId('profile')
    const bucketId = randomId('bucket')
    return this.#normalizeState({
      schemaVersion: SCHEMA_VERSION,
      profiles: [
        {
          id: profileId,
          name: 'Cloudflare R2',
          accountId: raw.accountId || '',
          accessKeyId: raw.accessKeyId || '',
          secretAccessKey: raw.secretAccessKey || '',
          endpoint: raw.endpoint || '',
          buckets: [
            {
              id: bucketId,
              name: raw.bucket || '',
              alias: raw.bucketAlias || '',
              customDomain: raw.customDomain || '',
              bucketAccess: raw.bucketAccess || 'public',
            },
          ],
        },
      ],
      activeProfileId: profileId,
      activeBucketId: bucketId,
      filenameTpl: raw.filenameTpl,
      filenameTplScope: raw.filenameTplScope,
      compressMode: raw.compressMode,
      compressLevel: raw.compressLevel,
      tinifyKey: raw.tinifyKey,
      uploadConcurrency: raw.uploadConcurrency,
    })
  }

  /** @param {any} raw @returns {StoredConfig} */
  #normalizeState(raw) {
    const profiles = (Array.isArray(raw.profiles) ? raw.profiles : []).map((profile) => ({
      id: profile.id || randomId('profile'),
      name: profile.name || 'Cloudflare R2',
      accountId: profile.accountId || '',
      accessKeyId: profile.accessKeyId || '',
      secretAccessKey: profile.secretAccessKey || '',
      endpoint: profile.endpoint || '',
      buckets: (Array.isArray(profile.buckets) ? profile.buckets : []).map((bucket) => ({
        id: bucket.id || randomId('bucket'),
        name: bucket.name || '',
        alias: bucket.alias || '',
        customDomain: cleanDomain(bucket.customDomain || ''),
        bucketAccess: bucket.bucketAccess === 'private' ? 'private' : 'public',
      })),
    }))
    const activeProfile = profiles.find((profile) => profile.id === raw.activeProfileId) || profiles[0]
    const activeBucket = activeProfile?.buckets.find((bucket) => bucket.id === raw.activeBucketId) || activeProfile?.buckets[0]
    return {
      schemaVersion: SCHEMA_VERSION,
      profiles,
      activeProfileId: activeProfile?.id,
      activeBucketId: activeBucket?.id,
      filenameTpl: raw.filenameTpl,
      filenameTplScope: raw.filenameTplScope,
      compressMode: raw.compressMode,
      compressLevel: raw.compressLevel,
      tinifyKey: raw.tinifyKey,
      uploadConcurrency: raw.uploadConcurrency,
    }
  }

  /** @param {StoredConfig} state @returns {ProfileConfig | undefined} */
  #findActiveProfile(state) {
    return state.profiles.find((profile) => profile.id === state.activeProfileId) || state.profiles[0]
  }

  /** @param {StoredConfig} state @param {ProfileConfig | undefined} profile @returns {BucketConfig | undefined} */
  #findActiveBucket(state, profile) {
    return profile?.buckets.find((bucket) => bucket.id === state.activeBucketId) || profile?.buckets[0]
  }

  /** @param {StoredConfig} state @param {boolean} [emit=true] */
  #saveState(state, emit = true) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#normalizeState(state)))
    if (emit) this.#emitChange()
  }

  #emitChange() {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('r2-config-changed'))
    }
  }
}

export { ConfigManager }
