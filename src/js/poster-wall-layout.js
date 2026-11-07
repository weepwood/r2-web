/**
 * Original, deterministic rectilinear mosaic geometry. Each 6 × 4 motif is an
 * exact cover of its cells. Motifs repeat in two dimensions; no masonry,
 * card grids or random packing, so the image wall has a consistent rhythm.
 */
export const WALL_CELL = 164
export const WALL_GAP = 6
export const WALL_MIN_SCALE = 0.35
export const WALL_MAX_SCALE = 2.8

// Tuples: [column, row, columns-wide, rows-high]. Total area = 24 per motif.
export const WALL_MOTIFS = Object.freeze([
  [[0,0,2,2],[2,0,2,1],[4,0,2,2],[2,1,2,1],[0,2,1,2],[1,2,3,2],[4,2,2,2]],
  [[0,0,3,2],[3,0,1,1],[4,0,2,1],[3,1,3,1],[0,2,2,2],[2,2,2,1],[4,2,2,2],[2,3,2,1]],
  [[0,0,1,2],[1,0,3,2],[4,0,2,1],[4,1,2,1],[0,2,2,2],[2,2,4,1],[2,3,2,1],[4,3,2,1]],
])

/** @typedef {{key:string, size?:number, lastModified?:number|string}} WallItem */
/** @typedef {WallItem & {x:number,y:number,w:number,h:number}} WallTile */

/**
 * @param {WallItem[]} items
 * @param {{columns?:number, cell?:number, gap?:number}} [opts]
 * @returns {WallTile[]}
 */
export function buildWallLayout(items, opts = {}) {
  const columns = Math.max(1, Math.floor(opts.columns ?? 3))
  const cell = opts.cell ?? WALL_CELL
  const gap = opts.gap ?? WALL_GAP
  const stride = cell + gap
  const motifW = 6 * stride
  const motifH = 4 * stride
  const tiles = []
  let next = 0
  let block = 0
  while (next < items.length) {
    const col = block % columns
    const row = Math.floor(block / columns)
    const pattern = WALL_MOTIFS[block % WALL_MOTIFS.length]
    for (const [x, y, w, h] of pattern) {
      if (next >= items.length) break
      tiles.push({
        ...items[next++],
        x: col * motifW + x * stride,
        y: row * motifH + y * stride,
        w: w * stride - gap,
        h: h * stride - gap,
      })
    }
    block++
  }
  return tiles
}

/** @param {{x:number,y:number,w:number,h:number}} a @param {{x:number,y:number,w:number,h:number}} b */
export function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/**
 * World bounds for viewport culling. Overscan is measured in screen pixels.
 * @param {{x:number,y:number,scale:number}} camera
 * @param {number} width
 * @param {number} height
 * @param {number} [overscan]
 */
export function cameraBounds(camera, width, height, overscan = 420) {
  const scale = camera.scale
  return {
    x: (-camera.x - overscan) / scale,
    y: (-camera.y - overscan) / scale,
    w: (width + overscan * 2) / scale,
    h: (height + overscan * 2) / scale,
  }
}

/**
 * Maintain the world point under the cursor when zooming.
 * Cursor coordinates are relative to the viewport.
 * @param {{x:number,y:number,scale:number}} camera
 * @param {number} px
 * @param {number} py
 * @param {number} desired
 */
export function zoomAt(camera, px, py, desired) {
  const scale = Math.min(WALL_MAX_SCALE, Math.max(WALL_MIN_SCALE, desired))
  return {
    x: px - ((px - camera.x) / camera.scale) * scale,
    y: py - ((py - camera.y) / camera.scale) * scale,
    scale,
  }
}

/**
 * Local expansion in the original position, with near neighbors repelled
 * outside the expanded bounds. No movement of far-away motifs.
 * @param {WallTile[]} layout
 * @param {string|null} activeKey
 * @returns {Map<string,{x:number,y:number,w:number,h:number}>}
 */
export function focusReflow(layout, activeKey) {
  const positions = new Map(layout.map(({ key, x, y, w, h }) => [key, { x, y, w, h }]))
  if (!activeKey) return positions
  const current = positions.get(activeKey)
  if (!current) return positions

  const w = Math.max(current.w * 1.58, 470)
  const h = Math.max(current.h * 1.5, 370)
  const expanded = {
    x: current.x - (w - current.w) * 0.3,
    y: current.y - (h - current.h) * 0.24,
    w, h,
  }
  positions.set(activeKey, expanded)

  const padding = 14
  const inflated = {
    x: expanded.x - padding,
    y: expanded.y - padding,
    w: expanded.w + padding * 2,
    h: expanded.h + padding * 2,
  }
  for (const tile of layout) {
    if (tile.key === activeKey) continue
    const rect = positions.get(tile.key)
    if (!rect || !intersects(rect, inflated)) continue
    const left = rect.x + rect.w - inflated.x
    const right = inflated.x + inflated.w - rect.x
    const up = rect.y + rect.h - inflated.y
    const down = inflated.y + inflated.h - rect.y
    const offsets = [
      {x:-left, y:0, distance:left},
      {x:right, y:0, distance:right},
      {x:0, y:-up, distance:up},
      {x:0, y:down, distance:down},
    ]
    const nearest = offsets.reduce((best, candidate) => candidate.distance < best.distance ? candidate : best)
    positions.set(tile.key, {...rect, x: rect.x + nearest.x, y: rect.y + nearest.y})
  }
  return positions
}
