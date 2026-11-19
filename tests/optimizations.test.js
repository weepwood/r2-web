import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('applyFilenameTemplate avoids reading/hashing large files unless [hash] is used', async () => {
  const utils = read('src/js/utils.js')
  assert.ok(utils.includes('if (/\\[hash(?::\\d+)?\\]/.test(result))'))
  const fnMatch = utils.match(/async function applyFilenameTemplate\(template, file\) \{[\s\S]*?\n\}/)
  assert.ok(fnMatch)
  const runTemplate = new Function(
    'getExtension',
    'getBaseName',
    'computeFileHash',
    'dayjs',
    `return (${fnMatch[0]})`,
  )(
    (name) => {
      const i = name.lastIndexOf('.')
      return i > 0 ? name.slice(i + 1) : ''
    },
    (name) => {
      const i = name.lastIndexOf('.')
      return i > 0 ? name.slice(0, i) : name
    },
    async (file) => {
      const buf = await file.arrayBuffer()
      const digest = await crypto.subtle.digest('SHA-256', buf)
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    },
    () => ({ format: () => '2026-11-19' }),
  )

  const fakeFile = {
    name: 'vacation-video.mp4',
    arrayBuffer: async () => {
      throw new Error('Should not hash file when [hash] is absent')
    },
  }
  const out = await runTemplate('videos/[name]-[date:YYYY-MM-DD]-[timestamp].[ext]', fakeFile)
  assert.match(out, /^videos\/vacation-video-2026-11-19-\d+\.mp4$/)

  const hashableFile = {
    name: 'photo.png',
    arrayBuffer: async () => new TextEncoder().encode('hello-r2').buffer,
  }
  const hashed = await runTemplate('[hash:8]-[name].[ext]', hashableFile)
  assert.match(hashed, /^[0-9a-f]{8}-photo\.png$/)
})

test('R2Client validates XML responses and formats UTF-8 download Content-Disposition', () => {
  const client = read('src/js/r2-client.js')
  assert.match(client, /#parseXml\(text\)/)
  assert.match(client, /doc\.querySelector\('parsererror'\)/)
  assert.match(client, /doc\.querySelector\('Error > Code'\)/)
  assert.match(client, /filename\*=UTF-8''\$\{utf8Name\}/)
})

test('FileExplorer preserves cards on sort changes and bounds directory cache', () => {
  const explorer = read('src/js/file-explorer.js')
  assert.match(explorer, /setSortBy\(sortBy\)[\s\S]*?#resortAndRender\(false\)/)
  assert.match(explorer, /setSortOrder\(order\)[\s\S]*?#resortAndRender\(false\)/)
  assert.match(explorer, /refreshThumbnails\(\)[\s\S]*?#resortAndRender\(true\)/)
  assert.match(explorer, /if \(this\.#cache\.size >= 100\)/)
})

test('UploadManager revokes compression Object URLs safely and tracks real XHR upload progress', () => {
  const upload = read('src/js/upload-manager.js')
  assert.match(upload, /const objectUrl = URL\.createObjectURL\(file\)[\s\S]*?finally\s*\{\s*URL\.revokeObjectURL\(objectUrl\)/)
  assert.match(upload, /new XMLHttpRequest\(\)/)
  assert.match(upload, /xhr\.upload\.onprogress/)
  assert.match(upload, /bar\.style\.width = `\$\{percent\}%`/)
})

test('FileOperations normalizes clipboard images to PNG and batches multi-item operations', () => {
  const ops = read('src/js/file-operations.js')
  const utils = read('src/js/utils.js')
  assert.match(utils, /async function blobToPng\(blob\)/)
  assert.match(ops, /const pngBlob = await blobToPng\(/)
  assert.match(ops, /deleteMany\(items\)[\s\S]*?for \(let i = 0; i < items\.length; i \+= 5\)/)
  assert.match(ops, /moveMany\(items\)[\s\S]*?for \(let i = 0; i < tasks\.length; i \+= 5\)/)
  assert.match(ops, /copyMany\(items\)[\s\S]*?for \(let i = 0; i < tasks\.length; i \+= 5\)/)
})

test('FilePreview streams text safely with size cap and releases media streams on close or switch', () => {
  const preview = read('src/js/file-preview.js')
  assert.match(preview, /MAX_TEXT_PREVIEW_BYTES = 1024 \* 1024/)
  assert.match(preview, /#readLimitedText\(res\)/)
  assert.match(preview, /reader\.cancel\(\)/)
  assert.match(preview, /#releaseMedia\(/)
  assert.match(preview, /media\.removeAttribute\('src'\)/)
  assert.match(preview, /media\.load\(\)/)
})

test('App and UIManager provide full tooltip aria-label syncing and keyboard focus tooltips', () => {
  const app = read('src/js/app.js')
  const ui = read('src/js/ui-manager.js')
  assert.match(app, /document\.querySelectorAll\('button\[data-tooltip\]'\)/)
  assert.match(ui, /document\.addEventListener\('focusin'/)
  assert.match(ui, /:focus-visible/)
  assert.match(ui, /document\.addEventListener\('focusout'/)
})

test('formatDate guards empty/invalid dates and ConfigManager skips redundant v2 writes & blank share buckets', () => {
  const utils = read('src/js/utils.js')
  const config = read('src/js/config-manager.js')
  assert.match(utils, /if \(!dateStr\) return '—'/)
  assert.match(utils, /if \(Number\.isNaN\(d\.getTime\(\)\)\) return '—'/)
  assert.match(config, /raw\?\.schemaVersion === SCHEMA_VERSION && Array\.isArray\(raw\.profiles\)\) return/)
  assert.match(config, /if \(bucket\.name && !currentProfile\.buckets\.some/)
})

test('App clears stale settings inputs, validates folder names, cleans logout state, and PosterWall resets zIndex', () => {
  const app = read('src/js/app.js')
  const wall = read('src/js/poster-wall.js')
  const bucket = read('src/js/bucket-manager.js')
  assert.match(app, /domainInput\.value = cfg\.customDomain \|\| ''/)
  assert.match(app, /tplInput\.value = cfg\.filenameTpl \|\| ''/)
  assert.match(app, /#new-folder-btn'\)[\s\S]*?renameInvalidChars/)
  assert.match(app, /#logout-btn'\)[\s\S]*?#exitBatchMode\(\)[\s\S]*?invalidateCache\(\)/)
  assert.match(wall, /const nextZ = active \? '5' : focused \? '3' : '1'/)
  assert.match(bucket, /if \(!allValid\) return/)
})

test('CSP permits WASM local compression and compressFile has canvas fallback', () => {
  const html = read('src/index.html')
  const upload = read('src/js/upload-manager.js')
  assert.match(html, /script-src[^;]*'wasm-unsafe-eval'/)
  assert.match(html, /worker-src[^;]*https:\/\/esm\.sh/)
  assert.match(upload, /await import\('@jsquash\/jpeg'\)/)
  assert.match(upload, /await import\('@jsquash\/oxipng'\)/)
  assert.match(upload, /await import\('@jsquash\/webp'\)/)
  assert.match(upload, /await import\('@jsquash\/avif'\)/)
  assert.match(upload, /encodeWithCanvas\(canvas, outputType, fallbackQuality\)/)
})

test('drag-and-drop traverses folders recursively and preserves relative folder placement', () => {
  const upload = read('src/js/upload-manager.js')
  assert.match(upload, /webkitGetAsEntry/)
  assert.match(upload, /#readDirectoryEntries\(dirEntry\)/)
  assert.match(upload, /#collectDroppedEntries\(entries\)/)
  assert.match(upload, /const relDir = rawRelativePath\.includes\('\/'\)/)
  assert.match(upload, /key = currentPrefix \+ relDir \+ processedName/)
  assert.match(upload, /if \(uploads\.some\(\(u\) => u\.key\.slice\(currentPrefix\.length\)\.includes\('\/'\)\)\)/)
})
