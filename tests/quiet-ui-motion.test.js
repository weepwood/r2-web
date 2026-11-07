import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const wall = source('src/js/poster-wall.js')
const wallCss = source('src/css/poster-wall.css')
const workspaceCss = source('src/css/quiet-ui.css')
const stylesheet = source('src/style.css')

test('poster wall chrome is quiet, captions prioritize big images and typography stays readable', () => {
  assert.match(wallCss, /#070707/)
  assert.match(wallCss, /#f7f4ee/)
  assert.match(wallCss, /\.poster-wall-header h2 \{[\s\S]*?font-size: 16px/)
  assert.match(wallCss, /\.poster-tile\.is-compact \.poster-tile-copy \{[\s\S]*?opacity: 0/)
  assert.match(wallCss, /\.poster-tile\.is-active \.poster-tile-copy/)
  assert.match(wallCss, /\.poster-tile-title \{[\s\S]*?text-shadow:/)
  assert.match(wallCss, /\.poster-wall-fab \{[\s\S]*?opacity: \.65/)
  assert.doesNotMatch(wallCss, /animation:\s*poster-skeleton/)
  assert.match(wallCss, /@media \(hover:none\), \(pointer:coarse\)/)
})

test('camera, spring and focus actions are brief, local and interruptible', () => {
  assert.match(wall, /#cameraFrame = 0/)
  assert.match(wall, /#cancelCameraMotion\(\)/)
  assert.match(wall, /this\.#animateCamera\(target, 235\)/)
  assert.match(wall, /this\.#animateCamera\(target, 320\)/)
  assert.match(wall, /this\.#cancelCameraMotion\(\)\s*this\.#camera = target/)
  assert.match(wall, /this\.#pointerDown\(event\)/)
  assert.match(wall, /this\.#root\.addEventListener\('keydown'/)
  assert.match(wall, /node\.dataset\.layoutRect !== layoutId/)
  assert.match(wall, /duration: 480, easing: 'linear'/)
  assert.match(wall, /#positionFocusActions\(actions\)/)
  assert.match(wall, /return false[\s\S]*?actions\.style\.left/)
})

test('full-window presentation isolates keyboard focus, while native dialog remains usable', () => {
  assert.match(wall, /#backgroundInert = new Map\(\)/)
  assert.match(wall, /sibling\.inert = true/)
  assert.match(wall, /sibling\.inert = wasInert/)
  assert.match(wall, /this\.#viewport\.focus\(\{ preventScroll: true \}\)/)
  assert.match(wall, /this\.#root\.setAttribute\('aria-label', t\('viewWall'\)\)/)
  assert.match(wall, /this\.#viewport\.setAttribute\('aria-label', t\('wallHelp'\)\)/)
  assert.match(wall, /this\.#reducedMotion = event\.matches/)
  assert.match(wallCss, /@media \(prefers-reduced-motion: reduce\)/)
})

test('workbench gallery is image-first and inspector no longer uses a dominant illustration', () => {
  assert.match(stylesheet, /@import '\.\/css\/quiet-ui\.css'/)
  assert.match(workspaceCss, /\.file-browser\[data-view='gallery'\] \.file-card \{[\s\S]*?box-shadow: none/)
  assert.match(workspaceCss, /\.file-browser\[data-view='gallery'\] \.file-card:hover \{[\s\S]*?transform: none/)
  assert.match(workspaceCss, /\.details-art \{\s*height: 115px/)
  assert.match(workspaceCss, /@media \(prefers-reduced-motion: reduce\)/)
})
