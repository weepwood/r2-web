import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  WALL_CELL,
  WALL_GAP,
  WALL_MOTIFS,
  buildWallLayout,
  cameraBounds,
  focusReflow,
  intersects,
  preserveTileAnchor,
  zoomAt,
} from '../src/js/poster-wall-layout.js'

const fixtures = Array.from({length: 88}, (_, i) => ({key: `photo-${i}.jpg`,size:123}))
const files = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('repeated geometric motifs exactly cover a rectangular 6 × 4 cell footprint', () => {
  for (const motif of WALL_MOTIFS) {
    const cells = new Set()
    for (const [col, row, width, height] of motif) {
      assert.ok(col >= 0 && row >= 0 && col + width <= 6 && row + height <= 4)
      for (let y = row; y < row + height; y++) {
        for (let x = col; x < col + width; x++) {
          const cell = `${x},${y}`
          assert.ok(!cells.has(cell), `overlapping tile cell ${cell}`)
          cells.add(cell)
        }
      }
    }
    assert.equal(cells.size, 24)
  }
})

test('repeat patterns produce a stable, non-overlapping mosaic with six-pixel gaps', () => {
  const layout = buildWallLayout(fixtures, {columns:3})
  assert.equal(layout.length, fixtures.length)
  assert.deepEqual(layout, buildWallLayout(fixtures, {columns:3}))
  assert.equal(layout[0].w, 2 * WALL_CELL + WALL_GAP)
  for (let i = 0; i < layout.length; i++) {
    assert.equal(layout[i].key, fixtures[i].key)
    for (let j = i + 1; j < layout.length; j++) {
      const padded = {
        x: layout[i].x - WALL_GAP / 2,
        y: layout[i].y - WALL_GAP / 2,
        w: layout[i].w + WALL_GAP,
        h: layout[i].h + WALL_GAP,
      }
      assert.equal(intersects(padded, layout[j]), false, `tiles ${i},${j} collide`)
    }
  }
})

test('cursor-anchored zoom keeps the exact world coordinate under the pointer', () => {
  const camera = {x:153,y:-88,scale:.73}
  const pointer = {x:611,y:294}
  const worldX = (pointer.x - camera.x) / camera.scale
  const worldY = (pointer.y - camera.y) / camera.scale
  const next = zoomAt(camera,pointer.x,pointer.y,1.48)
  assert.ok(Math.abs((pointer.x-next.x)/next.scale-worldX) < .000001)
  assert.ok(Math.abs((pointer.y-next.y)/next.scale-worldY) < .000001)
  assert.ok(zoomAt(camera,0,0,900).scale <= 2.8)
  assert.ok(zoomAt(camera,0,0,.01).scale >= .35)
})

test('camera bounds support pan and zoom while culling outside tiles', () => {
  const camera = {x:-200,y:80,scale:.6}
  const bounds = cameraBounds(camera, 900, 580, 300)
  assert.ok(intersects(bounds,{x:800,y:300,w:50,h:50}))
  assert.ok(!intersects(bounds,{x:9000,y:300,w:50,h:50}))
})

test('focused tile expands locally and neighbors are pushed clear of the active region', () => {
  const tiles = buildWallLayout(fixtures.slice(0,22))
  const active = tiles[1]
  const ordinary = focusReflow(tiles,null)
  const changed = focusReflow(tiles,active.key)
  const expanded = changed.get(active.key)
  assert.ok(expanded.w > ordinary.get(active.key).w)
  assert.ok(expanded.h > ordinary.get(active.key).h)
  const moved = tiles.filter(item => {
    const a = changed.get(item.key)
    const b = ordinary.get(item.key)
    return item.key !== active.key && (a.x !== b.x || a.y !== b.y)
  })
  assert.ok(moved.length > 0)
  assert.ok(moved.length < tiles.length - 1)
  assert.deepEqual(focusReflow(tiles,null),ordinary)
})

test('PosterWall uses independent canvas, culling, local image policy and requested original preview', () => {
  const app = files('src/js/app.js')
  const wall = files('src/js/poster-wall.js')
  const explorer = files('src/js/file-explorer.js')
  const html = files('src/index.html')
  const stylesheet = files('src/css/poster-wall.css')
  assert.match(html,/id="view-wall-btn"/)
  assert.match(html,/id="poster-wall-viewport"/)
  assert.match(html,/id="poster-wall-canvas"/)
  assert.match(app,/new PosterWall\(this\.#r2/)
  assert.match(app,/this\.#explorer\.getWallItems\(\)/)
  assert.match(app,/this\.#wall\.open\(/)
  assert.match(explorer,/getWallItems\(\)/)
  assert.match(explorer,/suspendThumbnails\(paused\)/)
  assert.match(wall,/cameraBounds\(this\.#camera/)
  assert.match(wall,/this\.#nodes\.delete\(key\)/)
  assert.ok(wall.includes('this.#images.thumbnailPlan('))
  assert.match(wall,/if \(!policy\.url && !policy\.allowOriginal\)/)
  assert.match(wall,/this\.#onPreview\(item\)/)
  assert.match(wall,/prefers-reduced-motion: reduce/)
  assert.match(wall,/setPointerCapture/)
  assert.match(wall,/this\.#spring\(/)
  assert.match(stylesheet,/#070707/)
  assert.match(stylesheet,/#f7f4ee/)
  assert.match(stylesheet,/border-radius: 0/)
  assert.match(stylesheet,/\.poster-wall-fab/)
  assert.match(stylesheet,/@media \(prefers-reduced-motion: reduce\)/)
})

test('all four supported locales have PosterWall accessibility labels', () => {
  const i18n = files('src/js/i18n.js')
  for (const key of ['viewWall','wallExit','wallZoomIn','wallZoomOut','wallReset','wallCount','wallOpenTile']) {
    assert.equal([...i18n.matchAll(new RegExp('\\b'+key+':','g'))].length,4)
  }
})

test('every expanded mosaic position keeps at least a six-pixel gutter', () => {
  const layout = buildWallLayout(fixtures.slice(0, 74))
  for (const active of layout.slice(0, 36)) {
    const positions = focusReflow(layout, active.key)
    assert.equal(positions.size, layout.length)
    for (let i = 0; i < layout.length; i++) {
      const a = positions.get(layout[i].key)
      for (let j = i + 1; j < layout.length; j++) {
        const b = positions.get(layout[j].key)
        const gap = WALL_GAP - 0.00001
        const separated =
          a.x + a.w + gap <= b.x ||
          b.x + b.w + gap <= a.x ||
          a.y + a.h + gap <= b.y ||
          b.y + b.h + gap <= a.y
        assert.equal(separated, true, `active=${active.key}: ${layout[i].key} and ${layout[j].key} overlap`)
      }
    }
    const repeat = focusReflow(layout, active.key)
    assert.deepEqual(positions, repeat, 'focus reflow must be deterministic')
  }
})

test('responsive mosaic change retains the same image screen anchor', () => {
  const before = buildWallLayout(fixtures.slice(0, 70), { columns: 3 })
  const after = buildWallLayout(fixtures.slice(0, 70), { columns: 2 })
  const camera = { x: -740, y: -165, scale: 0.81 }
  for (const index of [0, 7, 17, 31, 52, 68]) {
    const oldTile = before[index]
    const newTile = after[index]
    const oldX = camera.x + (oldTile.x + oldTile.w / 2) * camera.scale
    const oldY = camera.y + (oldTile.y + oldTile.h / 2) * camera.scale
    const retained = preserveTileAnchor(camera, oldTile, newTile)
    const newX = retained.x + (newTile.x + newTile.w / 2) * retained.scale
    const newY = retained.y + (newTile.y + newTile.h / 2) * retained.scale
    assert.ok(Math.abs(newX - oldX) < 0.000001)
    assert.ok(Math.abs(newY - oldY) < 0.000001)
    assert.equal(retained.scale, camera.scale)
  }
})
