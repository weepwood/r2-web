import assert from 'node:assert/strict'
import test from 'node:test'
import { ImageAssetService } from '../src/js/image-asset-service.js'

const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
}

test.beforeEach(() => storage.clear())

function fakeR2(publicDomain = 'https://img.example.com') {
  let presignedCalls = 0
  return {
    getPublicUrl: (key) => publicDomain ? publicDomain + '/' + encodeURIComponent(key) : null,
    getPresignedUrl: async (key) => {
      presignedCalls++
      return 'https://private.example.com/' + encodeURIComponent(key) + '?signature=private'
    },
    get presignedCalls() { return presignedCalls },
  }
}

test('public thumbnails use reusable Cloudflare variants without signing originals', () => {
  const r2 = fakeR2()
  const images = new ImageAssetService(r2)
  const plan = images.thumbnailPlan('image.jpg', 190, 2)
  assert.equal(plan.width, 480)
  assert.equal(plan.allowOriginal, true)
  assert.match(plan.url, /\/cdn-cgi\/image\/width=480,quality=72,fit=scale-down,format=auto\/image\.jpg/)
  assert.equal(r2.presignedCalls, 0)
})

test('strict private mode never makes a presigned GET when only a thumbnail was requested', () => {
  storage.set('r2-web-thumbnail-mode', 'strict')
  const r2 = fakeR2(null)
  const images = new ImageAssetService(r2)
  const plan = images.thumbnailPlan('private.jpg', 240, 2)
  assert.equal(plan.url, null)
  assert.equal(plan.allowOriginal, false)
  assert.equal(r2.presignedCalls, 0)
})

test('compatibility mode still explicitly allows full-size thumbnails', () => {
  storage.set('r2-web-thumbnail-mode', 'original')
  const r2 = fakeR2()
  const images = new ImageAssetService(r2)
  assert.deepEqual(images.thumbnailPlan('photo.png', 150, 1), {
    url: null,
    allowOriginal: true,
    publicUrl: 'https://img.example.com/photo.png',
    width: 160,
  })
})

test('original images require calling a separate method', async () => {
  storage.set('r2-web-thumbnail-mode', 'strict')
  const r2 = fakeR2(null)
  const images = new ImageAssetService(r2)
  images.thumbnailPlan('private.jpg', 400)
  assert.equal(r2.presignedCalls, 0)
  assert.match(await images.originalUrl('private.jpg'), /signature=private/)
  assert.equal(r2.presignedCalls, 1)
})
