import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (file) => readFileSync(new URL('../' + file, import.meta.url), 'utf8')
const app = read('src/js/app.js')
const explorer = read('src/js/file-explorer.js')
const details = read('src/js/file-details.js')
const html = read('src/index.html')
const css = read('src/css/refinements.css')
const i18n = read('src/js/i18n.js')

test('gallery mode extends native view toggles and refreshes thumbnail dimensions', () => {
  assert.match(html, /id="view-gallery-btn"/)
  assert.match(app, /this\.#setView\('gallery'\)/)
  assert.match(app, /\['grid', 'list', 'gallery'\]\.includes\(view\)/)
  assert.match(app, /if \(previous !== next\) this\.#explorer\?\.refreshThumbnails\(\)/)
  assert.match(explorer, /refreshThumbnails\(\) \{/)
  assert.match(css, /data-view='gallery'/)
  assert.match(css, /@media \(max-width: 640px\)/)
})

test('file inspector has safe metadata-only actions and never downloads a preview automatically', () => {
  for (const id of ['details-panel', 'details-close', 'details-open', 'details-copy', 'details-download', 'details-path']) {
    assert.ok(html.includes('id="' + id + '"'), 'missing ' + id)
  }
  assert.match(explorer, /class="icon-btn sm file-card-details"/)
  assert.match(app, /detailsButton =/)
  assert.match(app, /this\.#details\.open\(card\)/)
  assert.match(details, /card\.dataset\.key/)
  assert.match(details, /card\.dataset\.mod/)
  assert.match(details, /card\.dataset\.size/)
  assert.doesNotMatch(details, /fetch\(|getPresignedUrl|headObject|getObject|\.src\s*=/)
  assert.match(details, /\$\('#details-path'\)\.textContent = item\.key/)
  assert.match(details, /if \(this\.#item && !this\.#item\.isFolder\)/)
})

test('inspector closes on navigation, refresh, filtering and logout', () => {
  assert.match(explorer, /setOnDirectoryChange\(cb\)/)
  assert.match(explorer, /async navigate\(prefix\) \{\s*this\.#onDirectoryChange\?\.\(\)/)
  assert.match(explorer, /async refresh\(\) \{\s*this\.#onDirectoryChange\?\.\(\)/)
  assert.match(app, /setOnDirectoryChange\(\(\) => \{[\s\S]*?this\.#details\.close\(\)[\s\S]*?this\.#wall\.close\(\)/)
  assert.match(app, /filterInput\.addEventListener\('input', \(\) => \{\s*this\.#details\.close\(\)/)
  assert.match(app, /this\.#config\.clear\(\)\s*this\.#details\.close\(\)/)
  assert.match(details, /document\.querySelector\('dialog\[open\]'\)/)
})

test('four locale labels and responsive drawer styles are present', () => {
  assert.equal([...i18n.matchAll(/viewGallery:/g)].length, 4)
  assert.equal([...i18n.matchAll(/detailsAction:/g)].length, 4)
  assert.equal([...i18n.matchAll(/detailsClose:/g)].length, 4)
  assert.match(css, /\.workspace-body > \.file-browser/)
  assert.match(css, /\.details-panel:not\(\[hidden\]\)/)
  assert.match(css, /\.details-backdrop:not\(\[hidden\]\)/)
})

test('loading another R2 page retains existing cards and loaded thumbnails', () => {
  assert.match(explorer, /const existingCards = new Map\(/)
  assert.match(explorer, /existingCards\.get\(item\.key\) \?\? this\.#createFileCard\(item\)/)
  assert.match(explorer, /grid\.replaceChildren\(frag\)/)
  assert.doesNotMatch(
    explorer,
    /const sorted = this\.#sortItems\(this\.#loadedItems\)[\s\S]{0,250}this\.#resetThumbnails\(\)/,
  )
})

test('details panel switches static icons by type and safely escapes file names', () => {
  assert.match(details, /getFileIconSvg\(/)
  assert.match(details, /\$\('#details-filename'\)\.textContent = extractFileName\(item\.key\)/)
  assert.match(details, /art\.dataset\.type = item\.isFolder \? 'folder' : item\.type/)
})
