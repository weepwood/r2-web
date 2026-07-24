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
