import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8')
const entry = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/css/refinements.css', import.meta.url), 'utf8')

test('workspace refinement is included after legacy component sheets', () => {
  const previous = entry.indexOf("@import './smooth-bucket-switch.css';")
  const current = entry.indexOf("@import './css/refinements.css';")
  assert.ok(previous >= 0 && current > previous)
})

test('brand refresh preserves JS binding targets and bucket switcher anchor', () => {
  assert.match(html, /class="flex items-center topbar-brand"/)
  assert.match(html, /class="topbar-title"/)
  assert.match(html, /class="flex items-center toolbar-location"/)
  assert.match(html, /class="flex items-center toolbar-controls"/)
  for (const id of ['settings-btn', 'refresh-btn', 'batch-toggle-btn', 'file-browser', 'file-grid', 'upload-btn']) {
    assert.match(html, new RegExp('id="' + id + '"'))
  }
})

test('responsive, density, themes and motion preference are preserved', () => {
  assert.match(styles, /--accent:\s*light-dark\(/)
  assert.match(styles, /\[data-view='list'\]/)
  assert.match(styles, /\[data-density='compact'\]/)
  assert.match(styles, /\[data-density='loose'\]/)
  assert.match(styles, /@media \(max-width: 640px\)/)
  assert.match(styles, /prefers-reduced-motion: reduce/)
  assert.match(styles, /pointer: coarse/)
})
