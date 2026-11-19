import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

const html = read('src/index.html')
const appJs = read('src/js/app.js')
const explorerJs = read('src/js/file-explorer.js')
const uiJs = read('src/js/ui-manager.js')
const detailsJs = read('src/js/file-details.js')
const previewJs = read('src/js/file-preview.js')
const opsJs = read('src/js/file-operations.js')
const uploadJs = read('src/js/upload-manager.js')
const bucketJs = read('src/js/bucket-manager.js')
const switchJs = read('src/js/smooth-bucket-switch.js')
const componentsCss = read('src/css/components.css')
const refinementsCss = read('src/css/refinements.css')
const switchCss = read('src/smooth-bucket-switch.css')
const wallCss = read('src/css/poster-wall.css')

test('i18n dictionaries stay synchronized across zh, zh_TW, en and ja', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {} }
  const { I18N } = await import('../src/js/i18n.js')
  const baseKeys = Object.keys(I18N.zh).sort()
  for (const locale of ['zh_TW', 'en', 'ja']) {
    assert.deepEqual(Object.keys(I18N[locale]).sort(), baseKeys, `${locale} keys differ from zh`)
  }
  for (const key of ['moreActions', 'uploadFailed', 'showPassword', 'hidePassword', 'configRequiredFields']) {
    for (const locale of ['zh', 'zh_TW', 'en', 'ja']) {
      assert.ok(I18N[locale][key], `missing ${locale}.${key}`)
    }
  }
})

test('file cards support keyboard activation, arrow navigation, range selection and inspect highlight', () => {
  assert.match(explorerJs, /card\.tabIndex = 0/)
  assert.match(explorerJs, /selectRange\(fromKey, toKey\)/)
  assert.match(explorerJs, /file-card-thumb-wrap/)
  assert.match(explorerJs, /draggable="false"/)
  assert.match(explorerJs, /t\('moreActions'\)/)
  assert.match(explorerJs, /aria-current', 'page'/)
  assert.match(explorerJs, /ol\.scrollLeft = ol\.scrollWidth/)
  assert.match(appJs, /explorer\.selectRange\(this\.#lastSelectedKey, key\)/)
  assert.match(appJs, /\$\('#file-grid'\)\.addEventListener\('keydown'/)
  assert.match(appJs, /this\.#updateBatchActionButtons\(count\)/)
  assert.match(appJs, /this\.#wall\.isOpen \|\| document\.querySelector\('dialog\[open\]'\)/)
  assert.match(detailsJs, /classList\.add\('is-inspecting'\)/)
  assert.match(detailsJs, /opener\.focus\(\{ preventScroll: true \}\)/)
})

test('settings dialog supports secret visibility toggle, required validation and Enter submit', () => {
  assert.match(html, /id="toggle-secret-key"/)
  assert.match(html, /id="toggle-tinify-key"/)
  assert.match(appJs, /setupSecretToggle\('#toggle-secret-key', secretInput\)/)
  assert.match(appJs, /setupSecretToggle\('#toggle-tinify-key', tinifyKeyInput\)/)
  assert.match(appJs, /input\.setAttribute\('aria-invalid', 'true'\)/)
  assert.match(appJs, /t\('configRequiredFields'\)/)
  assert.match(appJs, /\$\('#config-submit'\)\.click\(\)/)
  assert.match(componentsCss, /\.secret-input-wrap/)
})

test('context menu, toasts, theme transitions and bucket dialogs are accessible and clamped', () => {
  assert.match(html, /id="context-menu"[^>]*role="menu"/)
  assert.match(html, /id="ctx-copy-link"[^>]*role="menuitem"[^>]*aria-haspopup="menu"/)
  assert.match(uiJs, /#applyThemeChange\(apply\)/)
  assert.match(uiJs, /prefers-reduced-motion: reduce/)
  assert.match(uiJs, /container\.children\.length >= 4/)
  assert.match(uiJs, /el\.addEventListener\('click', dismiss\)/)
  assert.match(uiJs, /submenu-inline/)
  assert.match(uiJs, /Math\.max\(8, Math\.min\(/)
  assert.match(appJs, /\$\('#context-menu'\)\.addEventListener\('keydown'/)
  assert.doesNotMatch(bucketJs, /window\.confirm\(/)
  assert.doesNotMatch(switchJs, /window\.confirm\(/)
  assert.match(bucketJs, /aria-expanded/)
})

test('preview, upload drag-drop, paste hint and mobile styles avoid layout glitches', () => {
  assert.match(previewJs, /img\.classList\.add\('is-loading'\)/)
  assert.match(previewJs, /img\.naturalWidth.*img\.naturalHeight/)
  assert.match(previewJs, /img\.classList\.add\('is-zoomable'\)/)
  assert.match(previewJs, /if \(!res\.ok\) throw new Error/)
  assert.match(previewJs, /URL\.revokeObjectURL\(objectUrl\)/)
  assert.match(opsJs, /if \(!res\.ok\) throw new Error/)
  assert.match(uploadJs, /e\.dataTransfer\?\.types\?\.includes\('Files'\)/)
  assert.match(uploadJs, /t\('uploadPreparing'\)/)
  assert.match(uploadJs, /classList\.add\('is-error'\)/)
  assert.match(refinementsCss, /\.file-card-thumb-wrap::after/)
  assert.doesNotMatch(refinementsCss, /top: 26%/)
  assert.doesNotMatch(switchCss, /calc\(50% - 132px\)/)
  assert.match(wallCss, /max-width: calc\(100vw - 125px\)/)
})

test('dropdown selects, secret toggle icons, folder card bounds and detail fixes stay aligned', () => {
  assert.match(appJs, /querySelector\('\.icon-eye'\)/)
  assert.match(appJs, /querySelector\('\.icon-eye-off'\)/)
  assert.doesNotMatch(appJs, /querySelector\('\.eye(?:-off)?-icon'\)/)
  assert.match(html, /class="icon icon-eye-off"[^>]*\bhidden\b/)
  assert.match(refinementsCss, /dialog \.field \.secret-input-wrap input\s*\{[^}]*padding-right:\s*40px/)
  assert.match(refinementsCss, /dialog \.field select,\s*#app \.bucket-switcher-select\s*\{[^}]*appearance:\s*none/)
  assert.match(refinementsCss, /dialog \.field select option,\s*#app \.bucket-switcher-select option/)
  assert.match(refinementsCss, /\[data-view='grid'\] \.file-card\[data-is-folder='true'\]/)
  assert.match(refinementsCss, /\[data-view='gallery'\] \.file-card\[data-is-folder='true'\]/)
  assert.match(refinementsCss, /#preview-dialog #preview-body img[\s\S]*width:\s*auto;\s*height:\s*auto;/)
  assert.doesNotMatch(html, /id="view-(?:gallery|wall)-btn"[^>]*\btitle=/)
})

test('all ESM named imports across src/ resolve to real exports or importmap entries', () => {
  const importMapMatch = html.match(/<script type="importmap">\s*([\s\S]*?)<\/script>/)
  assert.ok(importMapMatch, 'importmap script block must exist')
  const importMap = JSON.parse(importMapMatch[1]).imports
  const jsFiles = readdirSync(new URL('../src/js', import.meta.url)).filter((f) => f.endsWith('.js'))
  const exportsMap = new Map()

  for (const file of jsFiles) {
    const code = read(`src/js/${file}`)
    const exported = new Set()
    for (const m of code.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) {
      exported.add(m[1])
    }
    for (const m of code.matchAll(/export\s*\{([^}]+)\}/g)) {
      for (const part of m[1].split(',')) {
        const cleaned = part.trim()
        if (!cleaned) continue
        const asMatch = cleaned.match(/\bas\s+([A-Za-z_$][\w$]*)$/)
        exported.add(asMatch ? asMatch[1] : cleaned)
      }
    }
    exportsMap.set(`./${file}`, exported)
  }

  for (const rel of ['src/main.js', ...jsFiles.map((f) => `src/js/${f}`)]) {
    const code = read(rel)
    for (const m of code.matchAll(/import\s*(?:\{([^}]+)\}|([A-Za-z_$][\w$]*))\s*from\s*["']([^"']+)["']/g)) {
      const spec = m[3]
      if (!spec.startsWith('.')) {
        assert.ok(importMap[spec], `${rel} imports unmapped package "${spec}"`)
        continue
      }
      const key = rel === 'src/main.js' ? spec.replace('./js/', './') : spec
      const avail = exportsMap.get(key)
      assert.ok(avail, `${rel} imports missing module "${spec}"`)
      if (m[1]) {
        for (const part of m[1].split(',')) {
          const cleaned = part.trim().replace(/\s+as\s+.*$/, '')
          if (!cleaned) continue
          assert.ok(avail.has(cleaned), `${rel} imports missing export "${cleaned}" from "${spec}"`)
        }
      }
    }
  }
})
