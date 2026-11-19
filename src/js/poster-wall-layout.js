import {
  BLOCK_COLS,
  BLOCK_ROWS,
  SLOTS_PER_BLOCK,
  getBlockReflow,
  getBlockTemplate,
} from './poster-wall-blocks.js'

/**
 * Original, deterministic rectilinear mosaic geometry. Each 6 × 4 motif is an
 * exact cover of its cells. Motifs repeat in two dimensions; no masonry,
 * card grids or random packing, so the image wall has a consistent rhythm.
 */
export const WALL_CELL = 164
export const WALL_GAP = 6
export const WALL_MIN_SCALE = 0.35
export const WALL_MAX_SCALE = 2.8
export const LATTICE_CELL = 128
export const LATTICE_GAP = 8
export const MAX_RENDERED_INSTANCES = 400
const FIELD_ASPECT = 2.2

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
  /** @param {{x:number,y:number,w:number,h:number}} rect */
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

/* --------------------------------------------------------------------------
 * Infinite Repeating Lattice Engine (12×8 blocks, 4 variants × 4 reflections,
 * zero-cascade in-block 6×6 expansion, and directional focus navigation).
 * -------------------------------------------------------------------------- */

/**
 * @typedef {{
 *   instanceId: string,
 *   index: number,
 *   cellSlot: number,
 *   repeatX: number,
 *   repeatY: number,
 *   x: number,
 *   y: number,
 *   w: number,
 *   h: number,
 * }} LatticeInstance
 */

/**
 * @typedef {{
 *   blocksPerRow: number,
 *   blockRows: number,
 *   cellSlots: number,
 *   cellWidth: number,
 *   cellHeight: number,
 *   blockWidth: number,
 *   blockHeight: number,
 *   cell: number,
 *   gap: number,
 * }} LatticeGeometry
 */

/**
 * @param {number} totalEntries
 * @param {{cell?:number, gap?:number}} [metrics]
 * @returns {LatticeGeometry}
 */
export function getLatticeGeometry(totalEntries, metrics = {}) {
  const cell = metrics.cell ?? LATTICE_CELL
  const gap = metrics.gap ?? LATTICE_GAP
  const pitch = cell + gap
  const blockWidth = BLOCK_COLS * pitch
  const blockHeight = BLOCK_ROWS * pitch
  const blocks = Math.max(1, Math.ceil(Math.max(0, totalEntries) / SLOTS_PER_BLOCK))
  const blocksPerRow = blocks <= 1
    ? 1
    : Math.max(1, Math.round(Math.sqrt((FIELD_ASPECT * blocks * BLOCK_ROWS) / BLOCK_COLS)))
  const blockRows = Math.ceil(blocks / blocksPerRow)
  return {
    blocksPerRow,
    blockRows,
    cellSlots: blocksPerRow * blockRows * SLOTS_PER_BLOCK,
    cellWidth: blocksPerRow * blockWidth,
    cellHeight: blockRows * blockHeight,
    blockWidth,
    blockHeight,
    cell,
    gap,
  }
}

/**
 * @param {LatticeGeometry} geometry
 * @param {number} totalEntries
 * @param {number} absoluteColumn
 * @param {number} absoluteRow
 * @param {number} slotIndex
 * @returns {LatticeInstance}
 */
function buildInstance(geometry, totalEntries, absoluteColumn, absoluteRow, slotIndex) {
  const repeatX = Math.floor(absoluteColumn / geometry.blocksPerRow)
  const repeatY = Math.floor(absoluteRow / geometry.blockRows)
  const localColumn = absoluteColumn - repeatX * geometry.blocksPerRow
  const localRow = absoluteRow - repeatY * geometry.blockRows
  const cellSlot = (localRow * geometry.blocksPerRow + localColumn) * SLOTS_PER_BLOCK + slotIndex
  const slot = getBlockTemplate(localColumn, localRow)[slotIndex]
  const pitch = geometry.cell + geometry.gap
  return {
    instanceId: `${cellSlot}:${repeatX}:${repeatY}`,
    index: cellSlot % totalEntries,
    cellSlot,
    repeatX,
    repeatY,
    x: repeatX * geometry.cellWidth + localColumn * geometry.blockWidth + slot.x * pitch,
    y: repeatY * geometry.cellHeight + localRow * geometry.blockHeight + slot.y * pitch,
    w: slot.cols * pitch - geometry.gap,
    h: slot.rows * pitch - geometry.gap,
  }
}

/**
 * @param {LatticeGeometry} geometry
 * @param {LatticeInstance} instance
 */
export function getInstanceBlock(geometry, instance) {
  const blockInCell = Math.floor(instance.cellSlot / SLOTS_PER_BLOCK)
  return {
    column: instance.repeatX * geometry.blocksPerRow + (blockInCell % geometry.blocksPerRow),
    row: instance.repeatY * geometry.blockRows + Math.floor(blockInCell / geometry.blocksPerRow),
    slotIndex: instance.cellSlot % SLOTS_PER_BLOCK,
  }
}

/**
 * @param {LatticeGeometry} geometry
 * @param {number} totalEntries
 * @param {{x:number,y:number,w:number,h:number}} bounds
 * @param {number} [overscan]
 * @returns {LatticeInstance[]}
 */
export function layoutLattice(geometry, totalEntries, bounds, overscan = 0) {
  if (totalEntries <= 0 || geometry.blockWidth <= 0 || geometry.blockHeight <= 0) return []
  const view = {
    x: bounds.x - overscan,
    y: bounds.y - overscan,
    w: bounds.w + overscan * 2,
    h: bounds.h + overscan * 2,
  }
  const fromColumn = Math.floor(view.x / geometry.blockWidth)
  const toColumn = Math.floor((view.x + view.w) / geometry.blockWidth)
  const fromRow = Math.floor(view.y / geometry.blockHeight)
  const toRow = Math.floor((view.y + view.h) / geometry.blockHeight)
  /** @type {LatticeInstance[]} */
  const result = []
  for (let row = fromRow; row <= toRow; row++) {
    for (let column = fromColumn; column <= toColumn; column++) {
      for (let slotIndex = 0; slotIndex < SLOTS_PER_BLOCK; slotIndex++) {
        const instance = buildInstance(geometry, totalEntries, column, row, slotIndex)
        if (!intersects(instance, view)) continue
        result.push(instance)
        if (result.length >= MAX_RENDERED_INSTANCES) return result
      }
    }
  }
  return result
}

/**
 * Zero-cascade expansion: only the 12 tiles inside the active tile's block re-gear.
 * @param {LatticeGeometry} geometry
 * @param {number} totalEntries
 * @param {LatticeInstance | null} active
 * @returns {Map<string,{x:number,y:number,w:number,h:number}>}
 */
export function layoutExpandedBlock(geometry, totalEntries, active) {
  /** @type {Map<string,{x:number,y:number,w:number,h:number}>} */
  const result = new Map()
  if (!active || totalEntries <= 0) return result
  const block = getInstanceBlock(geometry, active)
  const localColumn = block.column - active.repeatX * geometry.blocksPerRow
  const localRow = block.row - active.repeatY * geometry.blockRows
  const reflow = getBlockReflow(localColumn, localRow, block.slotIndex)
  if (!reflow) return result
  const pitch = geometry.cell + geometry.gap
  const originX = active.repeatX * geometry.cellWidth + localColumn * geometry.blockWidth
  const originY = active.repeatY * geometry.cellHeight + localRow * geometry.blockHeight
  const blockInCell = localRow * geometry.blocksPerRow + localColumn
  for (let slotIndex = 0; slotIndex < SLOTS_PER_BLOCK; slotIndex++) {
    const slot = reflow[slotIndex]
    const cellSlot = blockInCell * SLOTS_PER_BLOCK + slotIndex
    result.set(`${cellSlot}:${active.repeatX}:${active.repeatY}`, {
      x: originX + slot.x * pitch,
      y: originY + slot.y * pitch,
      w: slot.cols * pitch - geometry.gap,
      h: slot.rows * pitch - geometry.gap,
    })
  }
  return result
}

/**
 * Closest repeat instance of item `index` to a world coordinate.
 * @param {LatticeGeometry} geometry
 * @param {number} totalEntries
 * @param {number} index
 * @param {{x:number,y:number}} point
 * @returns {LatticeInstance | null}
 */
export function locateNearestInstance(geometry, totalEntries, index, point) {
  if (totalEntries <= 0 || index < 0 || index >= totalEntries) return null
  let best = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (let cellSlot = index; cellSlot < geometry.cellSlots; cellSlot += totalEntries) {
    const blockInCell = Math.floor(cellSlot / SLOTS_PER_BLOCK)
    const localColumn = blockInCell % geometry.blocksPerRow
    const localRow = Math.floor(blockInCell / geometry.blocksPerRow)
    const slotIndex = cellSlot % SLOTS_PER_BLOCK
    const base = buildInstance(geometry, totalEntries, localColumn, localRow, slotIndex)
    const repeatX = Math.round((point.x - base.x - base.w / 2) / geometry.cellWidth)
    const repeatY = Math.round((point.y - base.y - base.h / 2) / geometry.cellHeight)
    const candidate = buildInstance(
      geometry,
      totalEntries,
      repeatX * geometry.blocksPerRow + localColumn,
      repeatY * geometry.blockRows + localRow,
      slotIndex,
    )
    const dx = candidate.x + candidate.w / 2 - point.x
    const dy = candidate.y + candidate.h / 2 - point.y
    const distance = dx * dx + dy * dy
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return best
}

/**
 * Candidate instances in the 3x3 blocks around `from` for arrow-key traversal.
 * @param {LatticeGeometry} geometry
 * @param {number} totalEntries
 * @param {LatticeInstance} from
 * @returns {LatticeInstance[]}
 */
export function locateStepCandidates(geometry, totalEntries, from) {
  if (totalEntries <= 0) return []
  const origin = getInstanceBlock(geometry, from)
  /** @type {LatticeInstance[]} */
  const candidates = []
  for (let row = origin.row - 1; row <= origin.row + 1; row++) {
    for (let column = origin.column - 1; column <= origin.column + 1; column++) {
      for (let slotIndex = 0; slotIndex < SLOTS_PER_BLOCK; slotIndex++) {
        candidates.push(buildInstance(geometry, totalEntries, column, row, slotIndex))
      }
    }
  }
  return candidates
}

const AXES = {
  right: { along: 'x', cross: 'y', alongSize: 'w', crossSize: 'h', sign: 1 },
  left: { along: 'x', cross: 'y', alongSize: 'w', crossSize: 'h', sign: -1 },
  down: { along: 'y', cross: 'x', alongSize: 'h', crossSize: 'w', sign: 1 },
  up: { along: 'y', cross: 'x', alongSize: 'h', crossSize: 'w', sign: -1 },
}

/**
 * @param {LatticeInstance} from
 * @param {'up'|'down'|'left'|'right'} direction
 * @param {LatticeInstance[]} candidates
 * @param {Map<string,{x:number,y:number,w:number,h:number}>} [rendered]
 * @param {number} [missPenalty]
 * @returns {LatticeInstance | null}
 */
export function pickAdjacentInstance(from, direction, candidates, rendered, missPenalty = LATTICE_CELL + LATTICE_GAP) {
  const axis = AXES[direction]
  const drawn = (inst) => {
    const override = rendered?.get(inst.instanceId)
    return override ? { ...inst, ...override } : inst
  }
  const source = drawn(from)
  let best = null
  let bestScore = Number.POSITIVE_INFINITY
  let bestCross = Number.POSITIVE_INFINITY

  for (const base of candidates) {
    if (base.instanceId === from.instanceId) continue
    const rect = drawn(base)
    const step = axis.sign === 1
      ? rect[axis.along] - (source[axis.along] + source[axis.alongSize])
      : source[axis.along] - (rect[axis.along] + rect[axis.alongSize])
    if (step < 0) continue

    const aStart = source[axis.cross]
    const bStart = rect[axis.cross]
    const overlap = Math.min(aStart + source[axis.crossSize], bStart + rect[axis.crossSize]) - Math.max(aStart, bStart)
    const score = step + (overlap > 0 ? 0 : -overlap * 2 + missPenalty)
    const crossDelta = Math.abs(
      (rect[axis.cross] + rect[axis.crossSize] / 2) - (source[axis.cross] + source[axis.crossSize] / 2),
    )
    if (score < bestScore || (score === bestScore && crossDelta < bestCross)) {
      bestScore = score
      bestCross = crossDelta
      best = base
    }
  }
  return best
}

/**
 * @template {{x:number,y:number,w:number,h:number}} T
 * @param {readonly T[]} instances
 * @param {{x:number,y:number}} point
 * @returns {T | null}
 */
export function findNearestInstance(instances, point) {
  let best = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const instance of instances) {
    const dx = instance.x + instance.w / 2 - point.x
    const dy = instance.y + instance.h / 2 - point.y
    const distance = dx * dx + dy * dy
    if (distance < bestDistance) {
      bestDistance = distance
      best = instance
    }
  }
  return best
}
