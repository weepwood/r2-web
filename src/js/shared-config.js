/**
 * Whitelisted, non-sensitive fields for configuration links.
 *
 * Sharing a URL is not an authentication flow. Base64 only encodes data; it
 * must never carry R2 credentials, Tinify keys, custom S3 endpoints or other
 * future secrets accidentally added to the stored configuration.
 *
 * Use this function for BOTH export and imports, including legacy links.
 */

/** @param {unknown} value */
const textField = (value) => typeof value === 'string' ? value : ''

/** @param {any} bucket */
function safeBucket(bucket) {
  return {
    id: textField(bucket?.id),
    name: textField(bucket?.name),
    alias: textField(bucket?.alias),
    customDomain: textField(bucket?.customDomain),
    bucketAccess: bucket?.bucketAccess === 'private' ? 'private' : 'public',
  }
}

/** @param {any} profile */
function safeProfile(profile) {
  return {
    id: textField(profile?.id),
    name: textField(profile?.name),
    buckets: (Array.isArray(profile?.buckets) ? profile.buckets : [])
      .slice(0, 100)
      .map(safeBucket),
  }
}

/** @param {any} value */
function safePreferences(value) {
  return {
    filenameTpl: textField(value?.filenameTpl),
    filenameTplScope: textField(value?.filenameTplScope),
    compressMode: textField(value?.compressMode),
    compressLevel: textField(value?.compressLevel),
    uploadConcurrency: Number.isInteger(value?.uploadConcurrency) &&
      value.uploadConcurrency >= 1 && value.uploadConcurrency <= 16
      ? value.uploadConcurrency : undefined,
  }
}

/**
 * Strict allowlist. Rejects credentials even when passed in by a malicious or
 * older share URL, and does not trust the payload's claimed shareType.
 * @param {any} input
 * @returns {Record<string, any> | null}
 */
function sanitizeSharedConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null

  if (input.schemaVersion === 2 && Array.isArray(input.profiles)) {
    return {
      schemaVersion: 2,
      profiles: input.profiles.slice(0, 32).map(safeProfile),
      activeProfileId: textField(input.activeProfileId),
      activeBucketId: textField(input.activeBucketId),
      ...safePreferences(input),
    }
  }

  // Old one-bucket links must not restore their embedded credentials, either.
  // Preserve their public bucket metadata so users can re-enter credentials.
  const bucket = textField(input.bucket)
  if (!bucket) return null
  return {
    bucket,
    bucketAlias: textField(input.bucketAlias),
    bucketAccess: input.bucketAccess === 'private' ? 'private' : 'public',
    customDomain: textField(input.customDomain),
    ...safePreferences(input),
  }
}

/**
 * Theme, language and view choices are non-secret but validated to avoid
 * untrusted share URLs injecting arbitrary settings into local storage.
 * @param {any} input
 */
function sanitizeSharedPreferences(input) {
  const allowed = {
    theme: ['auto', 'light', 'dark'],
    lang: ['zh', 'zh_TW', 'en', 'ja'],
    view: ['grid', 'list', 'gallery'],
    density: ['compact', 'normal', 'loose'],
    sortBy: ['name', 'date', 'size'],
    sortOrder: ['asc', 'desc'],
  }
  /** @type {Record<string,string>} */
  const safe = {}
  for (const [key, values] of Object.entries(allowed)) {
    if (values.includes(input?.[key])) safe[key] = input[key]
  }
  return safe
}

export { sanitizeSharedConfig, sanitizeSharedPreferences }
