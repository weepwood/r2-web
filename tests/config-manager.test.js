import test from 'node:test'
import assert from 'node:assert/strict'
import { ConfigManager } from '../src/js/config-manager.js'

class MemoryStorage {
  #data = new Map()

  getItem(key) {
    return this.#data.has(key) ? this.#data.get(key) : null
  }

  setItem(key, value) {
    this.#data.set(key, String(value))
  }

  removeItem(key) {
    this.#data.delete(key)
  }

  clear() {
    this.#data.clear()
  }
}

globalThis.localStorage = new MemoryStorage()
globalThis.CustomEvent = class CustomEvent {
  constructor(type) {
    this.type = type
  }
}
globalThis.window = { dispatchEvent() {}, location: { href: 'https://example.com/' } }

test.beforeEach(() => localStorage.clear())

test('迁移旧版单 Bucket 配置', () => {
  localStorage.setItem(
    'r2-manager-config',
    JSON.stringify({
      accountId: 'account',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      bucket: 'images',
      customDomain: 'https://img.example.com/',
    }),
  )

  const manager = new ConfigManager()
  assert.equal(manager.get().bucket, 'images')
  assert.equal(manager.get().customDomain, 'https://img.example.com')
  assert.equal(manager.loadState().schemaVersion, 2)
  assert.equal(manager.getBuckets().length, 1)
})

test('添加并切换 Bucket 时保持账户凭据', () => {
  const manager = new ConfigManager()
  manager.save({ accountId: 'account', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'images' })
  const bucket = manager.addBucket({ name: 'backup', bucketAccess: 'private' })
  const profile = manager.getActiveProfile()

  manager.setActiveBucket(profile.id, bucket.id)

  assert.equal(manager.get().bucket, 'backup')
  assert.equal(manager.get().accountId, 'account')
  assert.equal(manager.get().bucketAccess, 'private')
})

test('设置表单只更新当前 Bucket', () => {
  const manager = new ConfigManager()
  manager.save({ accountId: 'account', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'images' })
  const backup = manager.addBucket({ name: 'backup' })
  const profile = manager.getActiveProfile()

  manager.setActiveBucket(profile.id, backup.id)
  manager.save({ bucket: 'archive', customDomain: 'https://archive.example.com/' })

  assert.deepEqual(
    manager
      .getBuckets()
      .map((bucket) => bucket.name)
      .sort(),
    ['archive', 'images'],
  )
  assert.equal(manager.get().customDomain, 'https://archive.example.com')
})

test('手动添加时校验 R2 Bucket 名称', () => {
  const manager = new ConfigManager()
  manager.save({ accountId: 'account', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'images' })

  assert.throws(() => manager.addBucket({ name: 'UPPERCASE' }), /BUCKET_NAME_INVALID/)
  assert.throws(() => manager.addBucket({ name: 'ab' }), /BUCKET_NAME_INVALID/)
  assert.throws(() => manager.addBucket({ name: '-invalid' }), /BUCKET_NAME_INVALID/)
  assert.equal(manager.addBucket({ name: 'valid-backup-01' }).name, 'valid-backup-01')
})

test('不允许添加重名 Bucket', () => {
  const manager = new ConfigManager()
  manager.save({ accountId: 'account', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'images' })

  assert.throws(() => manager.addBucket({ name: 'images' }), /BUCKET_EXISTS/)
})

test('不允许删除最后一个 Bucket', () => {
  const manager = new ConfigManager()
  manager.save({ accountId: 'account', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'images' })

  assert.throws(() => manager.removeBucket(manager.getActiveBucket().id), /LAST_BUCKET/)
})

test('安全分享配置不包含账户凭据', () => {
  const manager = new ConfigManager()
  manager.save({ accountId: 'account', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'images' })

  const decoded = JSON.parse(decodeURIComponent(escape(atob(manager.toBase64()))))

  assert.equal(decoded.profiles[0].accountId, undefined)
  assert.equal(decoded.profiles[0].accessKeyId, undefined)
  assert.equal(decoded.profiles[0].secretAccessKey, undefined)
})

test('分享链接导出严格白名单，拒绝 Tinify Key、R2 凭据和自定义签名端点', () => {
  const manager = new ConfigManager()
  manager.save({
    accountId: 'secret-account',
    accessKeyId: 'secret-access',
    secretAccessKey: 'secret-password',
    tinifyKey: 'secret-tinify',
    endpoint: 'https://secret-endpoint.example.invalid',
    bucket: 'images-safe',
    customDomain: 'https://img.example.com',
    uploadConcurrency: 4,
  })

  const state = manager.loadState()
  state.profiles[0].unknownSecret = 'secret-future-profile'
  state.profiles[0].buckets[0].unknownToken = 'secret-future-bucket'
  state.unknownApiToken = 'secret-future-global'
  localStorage.setItem('r2-manager-config', JSON.stringify(state))

  const encoded = manager.toBase64()
  const decoded = JSON.parse(decodeURIComponent(escape(atob(encoded))))
  const serialized = JSON.stringify(decoded)
  assert.equal(decoded.schemaVersion, 2)
  assert.equal(decoded.shareType, 'safe')
  assert.equal(decoded.profiles[0].buckets[0].name, 'images-safe')
  assert.equal(decoded.profiles[0].buckets[0].customDomain, 'https://img.example.com')
  assert.equal(decoded.uploadConcurrency, 4)

  for (const marker of ['secret-account', 'secret-access', 'secret-password',
    'secret-tinify', 'secret-endpoint', 'secret-future-profile',
    'secret-future-bucket', 'secret-future-global']) {
    assert.equal(serialized.includes(marker), false, `share payload leaked ${marker}`)
    assert.equal(encoded.includes(marker), false)
  }
  const url = new URL(manager.getShareUrl())
  assert.equal(url.searchParams.get('config'), encoded)
})

test('导入伪造的新版本分享链接时，不写入任何第三方密钥或 R2 凭据', () => {
  const manager = new ConfigManager()
  const malicious = {
    schemaVersion: 2,
    shareType: 'safe',
    profiles: [{
      id: 'profile-attacker',
      name: 'Imported',
      accountId: 'INJECTED_ACCOUNT',
      accessKeyId: 'INJECTED_ACCESS',
      secretAccessKey: 'INJECTED_SECRET',
      endpoint: 'https://attacker.example.invalid',
      buckets: [{id:'bucket-1',name:'images-safe',bucketAccess:'private',unknownSecret:'NEVER'}],
    }],
    activeProfileId: 'profile-attacker',
    activeBucketId: 'bucket-1',
    tinifyKey: 'INJECTED_TINIFY',
    compressMode: 'none',
    theme: 'dark',
  }
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(malicious))))
  assert.equal(manager.loadFromBase64(b64), true)
  assert.equal(manager.get().bucket, 'images-safe')
  assert.equal(manager.get().bucketAccess, 'private')
  assert.equal(manager.get().secretAccessKey, '')
  assert.equal(manager.get().accessKeyId, '')
  assert.equal(manager.get().accountId, '')
  assert.equal(manager.get().endpoint, '')
  assert.equal(manager.get().tinifyKey, undefined)
  assert.equal(manager.get().compressMode, 'none')
  assert.equal(localStorage.getItem('r2-manager-theme'), 'dark')
  assert.equal(JSON.stringify(manager.loadState()).includes('INJECTED'), false)
})

test('旧版单 Bucket 分享链接导入也不恢复嵌入的密钥', () => {
  const manager = new ConfigManager()
  const oldPayload = {
    bucket: 'legacy-images',
    customDomain: 'https://legacy.example.org',
    accountId: 'OLD_ACCOUNT',
    accessKeyId: 'OLD_ACCESS',
    secretAccessKey: 'OLD_SECRET',
    tinifyKey: 'OLD_TINIFY',
    endpoint: 'https://malicious.example.org',
  }
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(oldPayload))))
  assert.equal(manager.loadFromBase64(b64), true)
  assert.equal(manager.get().bucket, 'legacy-images')
  assert.equal(manager.get().customDomain, 'https://legacy.example.org')
  assert.equal(manager.get().secretAccessKey, '')
  assert.equal(manager.get().tinifyKey, undefined)
  assert.equal(manager.get().endpoint, '')
})

test('分享链接仅添加新 Bucket，不覆盖现有 R2 密钥与 Tinify Key', () => {
  const manager = new ConfigManager()
  manager.save({accountId:'my-account',accessKeyId:'my-access',secretAccessKey:'my-secret',
    tinifyKey:'my-tinify',bucket:'original-bucket'})
  const incoming = {
    schemaVersion: 2,
    profiles: [{id:'other',name:'Other',accessKeyId:'bad',secretAccessKey:'bad',
      buckets:[{id:'added',name:'imported-bucket',bucketAccess:'private'}]}],
    tinifyKey:'bad',
  }
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(incoming))))
  assert.equal(manager.loadFromBase64(b64), true)
  assert.equal(manager.get().secretAccessKey, 'my-secret')
  assert.equal(manager.get().tinifyKey, 'my-tinify')
  assert.ok(manager.getBuckets().some((bucket) => bucket.name === 'imported-bucket'))
})

test('拒绝格式错误或超大的分享链接，不改变本地已保存凭据', () => {
  const manager = new ConfigManager()
  manager.save({accountId:'local',accessKeyId:'local-key',secretAccessKey:'local-secret',bucket:'valid-bucket'})
  const huge = btoa(JSON.stringify({schemaVersion:2,profiles:[],padding:'x'.repeat(100_001)}))
  assert.equal(manager.loadFromBase64('%%%'), false)
  assert.equal(manager.loadFromBase64(huge), false)
  assert.equal(manager.get().secretAccessKey, 'local-secret')
})
