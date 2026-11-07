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
        blockIndex: block,
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
 * Preserve a tile's on-screen center when responsive geometry changes.
 * Used when switching between desktop and narrow-screen mosaic templates.
 * @param {{x:number,y:number,scale:number}} camera
 * @param {{x:number,y:number,w:number,h:number}} before
 * @param {{x:number,y:number,w:number,h:number}} after
 */
export function preserveTileAnchor(camera, before, after) {
  return {
    x:camera.x + ((before.x + before.w / 2) - (after.x + after.w / 2)) * camera.scale,
    y:camera.y + ((before.y + before.h / 2) - (after.y + after.h / 2)) * camera.scale,
    scale:camera.scale,
  }
}

/**
 * A focus changes only the tile's own 6x4 geometric block, keeping every
 * other block anchored. Within that block we repartition integer cells into
 * exact, non-overlapping rectangles rather than pushing thousands of tiles
 * with a global collision solver.
 *
 * This is an original deterministic block-partition implementation; it does
 * not use Folia's precomputed block-reflow tables.
 */

/** @typedef {{x:number,y:number,w:number,h:number}} CellRect */

/** @param {CellRect} area @param {number} count @returns {CellRect[]} */
function splitRegion(area, count) {
  if (count <= 1) return [area]
  const width = area.w
  const height = area.h
  if (width * height < count) throw new Error('Wall block cannot fit enough tiles')

  const splitX = width >= height ? width > 1 : height <= 1
  // Choose a cut that can hold at least one cell for each resulting tile.
  const side = splitX ? width : height
  const stride = splitX ? height : width
  const leftCount = Math.floor(count / 2)
  const minCut = Math.max(1, Math.ceil(leftCount / stride))
  const maxCut = Math.min(side - 1, Math.floor((side * stride - (count - leftCount)) / stride))
  const cut = Math.max(minCut, Math.min(maxCut, Math.round(side * leftCount / count)))
  const first = splitX
    ? {x:area.x,y:area.y,w:cut,h:height}
    : {x:area.x,y:area.y,w:width,h:cut}
  const second = splitX
    ? {x:area.x+cut,y:area.y,w:width-cut,h:height}
    : {x:area.x,y:area.y+cut,w:width,h:height-cut}
  return [...splitRegion(first,leftCount), ...splitRegion(second,count-leftCount)]
}

/** @param {CellRect[]} zones @param {number} count @returns {CellRect[]} */
function partitionZones(zones, count) {
  if (count < zones.length) throw new Error('Not enough tiles for wall zones')
  const quotas = zones.map(() => 1)
  for (let i = zones.length; i < count; i++) {
    let best = -1
    let ratio = -1
    zones.forEach((zone, index) => {
      const area = zone.w * zone.h
      if (quotas[index] >= area) return
      const score = area / quotas[index]
      if (score > ratio) { ratio = score; best = index }
    })
    if (best < 0) throw new Error('No available wall cells')
    quotas[best]++
  }
  return zones.flatMap((zone, index) => splitRegion(zone, quotas[index]))
}

/** @param {CellRect} a @param {CellRect} b */
function centerDistance(a, b) {
  const dx = (a.x+a.w/2) - (b.x+b.w/2)
  const dy = (a.y+a.h/2) - (b.y+b.h/2)
  return dx*dx+dy*dy
}

/**
 * @param {WallTile[]} layout
 * @param {string|null} activeKey
 * @returns {Map<string,{x:number,y:number,w:number,h:number}>}
 */
export function focusReflow(layout, activeKey) {
  const positions = new Map(layout.map(({key,x,y,w,h}) => [key,{x,y,w,h}]))
  if (!activeKey) return positions

  const selected = layout.find((item) => item.key === activeKey)
  if (!selected) return positions
  const block = selected.blockIndex
  const neighbors = layout.filter((tile) => tile.blockIndex === block && tile.key !== activeKey)

  const stride = WALL_CELL + WALL_GAP
  const originX = Math.floor(selected.x / (6*stride)) * 6*stride
  const originY = Math.floor(selected.y / (4*stride)) * 4*stride
  const xCell = (selected.x-originX) / stride
  const yCell = (selected.y-originY) / stride
  const widthCells = (selected.w+WALL_GAP) / stride
  const heightCells = (selected.h+WALL_GAP) / stride
  const focusW = 4
  const focusH = 3
  const fx = Math.max(0,Math.min(6-focusW,Math.round(xCell + widthCells/2-focusW/2)))
  const fy = Math.max(0,Math.min(4-focusH,Math.round(yCell + heightCells/2-focusH/2)))

  /** @type {CellRect[]} */
  const zones = [
    {x:0,y:0,w:6,h:fy},
    {x:0,y:fy,w:fx,h:focusH},
    {x:fx+focusW,y:fy,w:6-fx-focusW,h:focusH},
    {x:0,y:fy+focusH,w:6,h:4-fy-focusH},
  ].filter((zone)=>zone.w>0 && zone.h>0)

  const absolute = (rect) => ({
    x:originX+rect.x*stride,y:originY+rect.y*stride,
    w:rect.w*stride-WALL_GAP,h:rect.h*stride-WALL_GAP,
  })
  positions.set(selected.key,absolute({x:fx,y:fy,w:focusW,h:focusH}))

  // Assign the remaining tiles to the nearest available rectangular slot.
  // A block holds only seven or eight tiles; no global neighbor search.
  const slots = partitionZones(zones,neighbors.length)
  const remaining = [...slots]
  for(const tile of neighbors) {
    const original = {
      x:(tile.x-originX)/stride,y:(tile.y-originY)/stride,
      w:(tile.w+WALL_GAP)/stride,h:(tile.h+WALL_GAP)/stride,
    }
    let best=0
    for(let index=1;index<remaining.length;index++) {
      if(centerDistance(original,remaining[index])<centerDistance(original,remaining[best])) best=index
    }
    const chosen=remaining.splice(best,1)[0]
    positions.set(tile.key,absolute(chosen))
  }
  return positions
}
