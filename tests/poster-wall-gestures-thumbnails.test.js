import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { resolveThumbnailPolicy, selectThumbnailWidth } from '../src/js/thumbnail-utils.js'

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const wall = read('src/js/poster-wall.js')
const css = read('src/css/poster-wall.css')

test('pointer jitter stays a click, while dragging and pinch always prevent tile activation', () => {
  assert.match(wall, /if \(Math\.hypot\(totalX, totalY\) < 7\) return/)
  assert.match(wall, /this\.#pointerTile = null\s*this\.#camera\.x \+= totalX/)
  assert.match(wall, /this\.#gestureUsedPinch = true/)
  assert.match(wall, /const pick = !this\.#dragged && !this\.#gestureUsedPinch/)
  assert.match(wall, /remaining\.originX = remaining\.x/)
  assert.match(wall, /remaining\.originY = remaining\.y/)
  assert.match(wall, /if \(pick && event\.type === 'pointerup'\) this\.#toggle\(pick\)/)
})

test('small folders open fitted and centered on real image bounds, not hardcoded empty canvas', () => {
  assert.match(wall, /const opening = this\.#layout\.slice\(0, Math\.min\(this\.#layout\.length, 7\)\)/)
  assert.match(wall, /const contentWidth = Math\.max\(1, right - left\)/)
  assert.match(wall, /x: \(width - contentWidth \* scale\) \/ 2 - left \* scale/)
  assert.match(wall, /y: \(height - contentHeight \* scale\) \/ 2 - top \* scale/)
  assert.doesNotMatch(wall, /1080 \* scale/)
})

test('thumbnail requests prioritize actual viewport and only upgrade after zoom settles', () => {
  assert.match(wall, /#imagePriority\(key\)/)
  assert.match(wall, /return distance \+ \(onscreen \? 0 : 100000\)/)
  assert.match(wall, /this\.#imageQueue\.sort\(\(a, b\) => this\.#imagePriority/)
  assert.match(wall, /#scheduleQualityCheck\(\)/)
  assert.match(wall, /window\.setTimeout\(\(\) => \{[\s\S]*?this\.#upgradeVisibleImages\(\)[\s\S]*?\}, 230\)/)
  assert.match(wall, /if \(!node\.classList\.contains\('is-loaded'\)\) continue/)
  assert.match(wall, /if \(currentWidth >= requestedWidth \|\| this\.#imageTasks\.has\(tile\.key\)\) return/)
})

test('progressive CDN variants keep the old image until a new one is loaded', () => {
  assert.match(wall, /const img = upgrade \? document\.createElement\('img'\) : task\.img/)
  assert.match(wall, /img\.className = 'poster-tile-upgrade'/)
  assert.match(wall, /task\.img\.remove\(\)[\s\S]*?img\.classList\.remove\('poster-tile-upgrade'\)/)
  assert.match(wall, /if \(!success && !upgrading && live\(\) && policy\.allowOriginal\)/)
  assert.match(wall, /task\.node\.dataset\.wallImageWidth = String\(fromOriginal \? 99999 : desired\)/)
  assert.match(css, /\.poster-tile-media img\.poster-tile-upgrade/)
  assert.match(css, /opacity: 0/)
})

test('strict mode never loads an original image during zoom upgrades', () => {
  const publicUrl = 'https://images.example.com/folder/abc.jpg'
  for (const width of [160, 320, 480, 640]) {
    const policy = resolveThumbnailPolicy({publicUrl,key:'folder/abc.jpg',mode:'strict',width})
    assert.equal(policy.allowOriginal,false)
    assert.match(policy.url || '', /\/cdn-cgi\/image\//)
  }
  assert.deepEqual(resolveThumbnailPolicy({
    publicUrl:null,key:'private.jpg',mode:'strict',width:640,
  }), {url:null,allowOriginal:false})
  assert.equal(selectThumbnailWidth(320,2),640)
})

test('zooming out hides captions, but hover, keyboard focus and selection reveal them', () => {
  assert.match(wall, /const zoomLevel = scale < 0\.58 \? 'overview'/)
  assert.match(wall, /this\.#root\.dataset\.zoomLevel = zoomLevel/)
  assert.match(css, /\[data-zoom-level='overview'\]/)
  assert.match(css, /:not\(:focus-visible\)/)
  assert.match(css, /\.poster-tile:is\(:hover, :focus-visible, \.is-active\)/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
})
