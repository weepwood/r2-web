/**
 * Dependency-free Chromium CDP smoke test for the real HTML/JS app.
 *
 * It starts a local static server, seeds a TEST-ONLY R2 profile, mocks the
 * S3 ListObjects/HEAD API before app boot, then exercises the UI in Chrome.
 * No real credentials or R2 objects are accessed.
 *
 * Run: CHROME_PATH=/path/to/chrome node tests/browser-smoke.mjs
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { setTimeout as pause } from 'node:timers/promises'

const root = path.resolve(fileURLToPath(new URL('../src/', import.meta.url)))
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9UV5qwkAAAAASUVORK5CYII=', 'base64')
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult><IsTruncated>false</IsTruncated>
<Contents><Key>poster-01.jpg</Key><Size>20480</Size><LastModified>2026-11-01T10:00:00Z</LastModified></Contents>
<Contents><Key>poster-02.jpg</Key><Size>30720</Size><LastModified>2026-11-01T11:00:00Z</LastModified></Contents>
<Contents><Key>poster-03.jpg</Key><Size>40960</Size><LastModified>2026-11-01T12:00:00Z</LastModified></Contents>
</ListBucketResult>`

const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
  if (pathname.endsWith('.jpg') || pathname.startsWith('/cdn-cgi/image/')) {
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=300' })
    res.end(pixel)
    return
  }
  const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
  if (target !== root && !target.startsWith(root + path.sep)) {
    res.writeHead(403).end()
    return
  }
  try {
    const bytes = await readFile(target)
    res.writeHead(200, { 'content-type': mime[path.extname(target)] || 'application/octet-stream' })
    res.end(bytes)
  } catch {
    res.writeHead(404).end()
  }
})

class DevTools {
  #id = 0
  #pending = new Map()
  /** @param {WebSocket} socket */
  constructor(socket) {
    this.socket = socket
    socket.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (!msg.id || !this.#pending.has(msg.id)) return
      const { resolve, reject } = this.#pending.get(msg.id)
      this.#pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    })
  }
  /** @param {string} method @param {Record<string,unknown>} [params] */
  send(method, params = {}) {
    const id = ++this.#id
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({id, method, params}))
    })
  }
  /** @param {string} expression */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression, returnByValue:true, awaitPromise:true,
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text +
      ' ' + (result.exceptionDetails.exception?.description || ''))
    return result.result.value
  }
}

async function eventually(check, label, timeout = 25000) {
  const started = Date.now()
  let last = null
  while (Date.now() - started < timeout) {
    try {
      const value = await check()
      if (value) return value
    } catch (error) { last = error }
    await pause(150)
  }
  throw new Error('Timeout: ' + label + (last ? ' / ' + last.message : ''))
}

const dir = await mkdtemp(path.join(tmpdir(), 'r2-web-browser-'))
/** @type {import('node:child_process').ChildProcess | null} */
let chrome = null
/** @type {WebSocket | null} */
let socket = null

try {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port
  const origin = 'http://127.0.0.1:' + port
  const chromePath = process.env.CHROME_PATH || '/usr/bin/chromium'
  chrome = spawn(chromePath, [
    '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
    '--no-first-run','--no-default-browser-check','--remote-debugging-port=0',
    '--user-data-dir=' + dir,'about:blank',
  ], { stdio:'ignore' })
  chrome.on('error', (error) => console.error('Chrome failed to start:', error.message))
  const activePortFile = path.join(dir, 'DevToolsActivePort')
  const chromePort = await eventually(async () => {
    const content = await readFile(activePortFile, 'utf8')
    return Number(content.split('\n')[0]) || null
  }, 'Chrome DevTools startup', 15000)

  const target = await eventually(async () => {
    const response = await fetch('http://127.0.0.1:' + chromePort + '/json/list')
    const tabs = await response.json()
    return tabs.find((tab) => tab.type === 'page' && tab.webSocketDebuggerUrl)
  }, 'Chrome page target')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, {once:true})
    socket.addEventListener('error', reject, {once:true})
  })
  const cdp = new DevTools(socket)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  const config = {
    schemaVersion:2,
    profiles:[{
      id:'local-profile',name:'Browser test only',
      accountId:'example-account',accessKeyId:'TEST_ACCESS',
      secretAccessKey:'TEST_SECRET',
      buckets:[{
        id:'test-bucket',name:'test-bucket',bucketAccess:'public',
        customDomain:origin,
      }],
    }],
    activeProfileId:'local-profile',activeBucketId:'test-bucket',
  }
  const preload = `(() => {
    if (location.origin !== ${JSON.stringify(origin)}) return;
    localStorage.setItem('r2-manager-config', ${JSON.stringify(JSON.stringify(config))});
    const raw = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = init?.method || 'GET';
      if (url.includes('list-type=2')) {
        return Promise.resolve(new Response(${JSON.stringify(xml)}, {
          status:200,headers:{'content-type':'application/xml'},
        }));
      }
      if (method === 'HEAD' && url.includes('.r2.cloudflarestorage.com')) {
        return Promise.resolve(new Response(null, {
          status:200,headers:{'content-type':'image/jpeg','content-length':'20480'},
        }));
      }
      return raw(input, init);
    };
  })()`
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {source:preload})
  await cdp.send('Page.navigate', {url:origin + '/'})

  await eventually(() => cdp.evaluate(
    `Boolean(document.querySelector('#app') && !document.querySelector('#app').hidden &&
      document.querySelectorAll('#file-grid .file-card').length === 3)`
  ), 'connected R2 file list')

  await cdp.evaluate(`document.querySelector('#view-wall-btn').click()`)
  await eventually(() => cdp.evaluate(
    `Boolean(!document.querySelector('#poster-wall').hidden &&
      document.querySelectorAll('.poster-tile').length > 0)`
  ), 'PosterWall opening')

  const before = await cdp.evaluate(`document.querySelector('#poster-wall-canvas').style.transform`)
  await cdp.evaluate(`document.querySelector('#wall-zoom-in').click()`)
  await eventually(async () => {
    const next = await cdp.evaluate(`document.querySelector('#poster-wall-canvas').style.transform`)
    return next !== before
  }, 'zoom-in camera transform')
  await cdp.evaluate(`document.querySelector('.poster-tile').click()`)
  await eventually(() => cdp.evaluate(
    `Boolean(document.querySelector('.poster-tile.is-active') &&
      !document.querySelector('#wall-focus-actions').hidden)`
  ), 'expanded poster tile')

  await cdp.evaluate(`document.querySelector('#wall-preview').click()`)
  await eventually(() => cdp.evaluate(
    `Boolean(document.querySelector('#preview-dialog')?.open &&
      document.querySelector('#preview-body img')?.src)`
  ), 'original preview dialog')
  await cdp.evaluate(`document.querySelector('#preview-dialog').close()`)
  await cdp.evaluate(`document.querySelector('#wall-close').click()`)
  assert.equal(await cdp.evaluate(`document.querySelector('#poster-wall').hidden`), true)

  console.log('Chromium browser smoke passed: connect, list, wall, zoom, expand, preview and exit')
} finally {
  socket?.close()
  chrome?.kill('SIGTERM')
  server.close()
  await rm(dir, {recursive:true,force:true,maxRetries:3,retryDelay:100})
}
