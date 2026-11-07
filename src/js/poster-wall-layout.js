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
 * Do two rects have a visible gutter? The base mosaic already guarantees 6px.
 * @param {{x:number,y:number,w:number,h:number}} a
 * @param {{x:number,y:number,w:number,h:number}} b
 * @param {number} [gap]
 */
function isSeparated(a, b, gap = WALL_GAP) {
  return a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y
}

/**
 * Find the nearest empty spot without moving already placed rectangles.
 * A bounded best-first search projects to exact blocker edges, avoiding
 * infinite incremental physics iterations and accidental overlaps.
 * @param {{x:number,y:number,w:number,h:number}} original
 * @param {{x:number,y:number,w:number,h:number}[]} placed
 */
function nearestFreePosition(original, placed) {
  const pending = [{...original, cost: 0}]
  const visited = new Set([`${original.x.toFixed(2)},${original.y.toFixed(2)}`])
  let attempts = 0
  while (pending.length && attempts++ < 800) {
    pending.sort((a, b) => a.cost - b.cost)
    const current = pending.shift()
    if (!current) break
    const blocker = placed.find((existing) => !isSeparated(current, existing))
    if (!blocker) return {x:current.x,y:current.y,w:original.w,h:original.h}

    const alternatives = [
      [blocker.x - original.w - WALL_GAP, current.y],
      [blocker.x + blocker.w + WALL_GAP, current.y],
      [current.x, blocker.y - original.h - WALL_GAP],
      [current.x, blocker.y + blocker.h + WALL_GAP],
    ]
    for (const [x, y] of alternatives) {
      const id = `${x.toFixed(2)},${y.toFixed(2)}`
      if (visited.has(id)) continue
      visited.add(id)
      pending.push({
        x, y, w:original.w, h:original.h,
        cost:(x - original.x) ** 2 + (y - original.y) ** 2,
      })
    }
  }

  // The field is open-ended: if a dense cluster exhausts the local search,
  // put this tile to the right of the occupied region rather than overlap.
  const right = Math.max(...placed.map((rect) => rect.x + rect.w))
  return {...original, x:right + WALL_GAP}
}

/**
 * Expand the active tile and resolve neighbors without any rectangle overlap.
 *
 * Place distant tiles first so they keep their original coordinates; tiles
 * close to the focus choose the nearest free position. As the wall is dense,
 * there can be a small local chain of displaced neighbors at the boundary.
 * @param {WallTile[]} layout
 * @param {string|null} activeKey
 * @returns {Map<string,{x:number,y:number,w:number,h:number}>}
 */
export function focusReflow(layout, activeKey) {
  const positions = new Map(layout.map(({key,x,y,w,h}) => [key,{x,y,w,h}]))
  if (!activeKey) return positions
  const current = positions.get(activeKey)
  if (!current) return positions

  // Reduced expansion still clearly emphasizes the image, but spares more of
  // the neighboring mosaic from movement.
  const width = Math.max(current.w * 1.44, 430)
  const height = Math.max(current.h * 1.42, 350)
  const expanded = {
    x:current.x - (width - current.w) * .3,
    y:current.y - (height - current.h) * .25,
    w:width, h:height,
  }
  positions.set(activeKey, expanded)

  const centerX = expanded.x + expanded.w / 2
  const centerY = expanded.y + expanded.h / 2
  const distance = (rect) => (rect.x + rect.w / 2 - centerX) ** 2 +
    (rect.y + rect.h / 2 - centerY) ** 2

  const neighbors = layout
    .filter((tile) => tile.key !== activeKey)
    .sort((a, b) => distance(b) - distance(a))
  const placed = [expanded]

  for (const tile of neighbors) {
    const original = positions.get(tile.key)
    if (!original) continue
    const next = nearestFreePosition(original, placed)
    positions.set(tile.key, next)
    placed.push(next)
  }
  return positions
}
