import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildCloudflareThumbnailUrl,
  resolveThumbnailPolicy,
  selectThumbnailWidth,
} from '../src/js/thumbnail-utils.js'

test('Cloudflare CDN gets an actual resized image URL for a public bucket', () => {
  assert.equal(
    buildCloudflareThumbnailUrl(
      'https://images.example.com/photos/my%20pic.jpg',
      'photos/my pic.jpg',
      480,
    ),
    'https://images.example.com/cdn-cgi/image/width=480,quality=72,fit=scale-down,format=auto/photos/my%20pic.jpg',
  )
})

test('different layouts choose bounded, reusable thumbnail variants', () => {
  assert.equal(selectThumbnailWidth(42, 2), 160)
  assert.equal(selectThumbnailWidth(180, 2), 480)
  assert.equal(selectThumbnailWidth(400, 3), 640)
  assert.equal(selectThumbnailWidth(0, 0), 160)
})

test('never send private or signed URLs to public Cloudflare transformations', () => {
  assert.equal(buildCloudflareThumbnailUrl(null, 'photo.jpg', 320), null)
  assert.equal(
    buildCloudflareThumbnailUrl('https://account.r2.cloudflarestorage.com/bucket/photo.jpg', 'photo.jpg', 320),
    null,
  )
  assert.equal(buildCloudflareThumbnailUrl('https://demo.r2.dev/photo.jpg', 'photo.jpg', 320), null)
  assert.equal(buildCloudflareThumbnailUrl('https://public.example.com/photo.jpg?signature=secret', 'photo.jpg', 320), null)
  assert.equal(buildCloudflareThumbnailUrl('https://user:pass@public.example.com/photo.jpg', 'photo.jpg', 320), null)
})

test('unsupported formats use originals in auto mode and placeholders in strict mode', () => {
  const original = 'https://cdn.example.com/vector.svg'
  assert.deepEqual(resolveThumbnailPolicy({ publicUrl: original, key: 'vector.svg', mode: 'auto', width: 320 }), {
    url: null,
    allowOriginal: true,
  })
  assert.deepEqual(resolveThumbnailPolicy({ publicUrl: original, key: 'vector.svg', mode: 'strict', width: 320 }), {
    url: null,
    allowOriginal: false,
  })
})

test('strict thumbnails never fall back to fetching original-size bytes', () => {
  const strict = resolveThumbnailPolicy({
    publicUrl: 'https://photos.example.com/album/夏%20天.png',
    key: 'album/夏 天.png',
    mode: 'strict',
    width: 320,
  })
  assert.equal(strict.allowOriginal, false)
  assert.match(strict.url ?? '', /\/cdn-cgi\/image\/width=320/)
  assert.deepEqual(resolveThumbnailPolicy({ publicUrl: null, key: 'private.jpg', mode: 'strict', width: 160 }), {
    url: null,
    allowOriginal: false,
  })
})

test('listing thumbnail loader uses a concurrency bound and preview still resolves original URL', () => {
  const explorer = readFileSync(new URL('../src/js/file-explorer.js', import.meta.url), 'utf8')
  const preview = readFileSync(new URL('../src/js/file-preview.js', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/js/app.js', import.meta.url), 'utf8')
  const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../src/js/r2-client.js', import.meta.url), 'utf8')

  assert.match(explorer, /#maxThumbnailLoads = 4/)
  assert.match(explorer, /this\.#thumbnailQueue\.push/)
  assert.match(explorer, /if \(!policy\.url && !policy\.allowOriginal\)/)
  assert.match(explorer, /if \(!loaded && policy\.allowOriginal && isCurrent\(\)\)/)
  assert.match(preview, /const url = this\.#r2\.getPublicUrl\(key\) \?\? \(await this\.#r2\.getPresignedUrl\(key\)\)/)
  assert.match(html, /id="cfg-thumbnail-mode"/)
  assert.match(html, /id="thumbnail-mode-indicator"/)
  assert.match(app, /setThumbnailMode\(newThumbnailMode\)/)
  assert.match(client, /#presignedGetCache = new Map\(\)/)
  assert.match(client, /3 \* 60_000/)
})

test('filter and navigation cancel outdated requests so new thumbnails do not stall', () => {
  const explorer = readFileSync(new URL('../src/js/file-explorer.js', import.meta.url), 'utf8')
  assert.match(explorer, /#thumbnailCancels = new Set\(\)/)
  assert.match(explorer, /for \(const cancel of this\.#thumbnailCancels\) cancel\(\)/)
  assert.match(explorer, /this\.#thumbnailCancels\.add\(cancel\)/)
  assert.match(explorer, /this\.#thumbnailCancels\.delete\(cancel\)/)
  assert.match(explorer, /#resetThumbnails\(\) \{[\s\S]*?this\.#thumbnailObserver\.disconnect\(\)/)
  assert.match(explorer, /this\.#resetThumbnails\(\)\s*this\.#applyFilter\(\)/)
})
