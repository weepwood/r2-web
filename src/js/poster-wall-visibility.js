import { WALL_CELL, WALL_GAP, intersects } from './poster-wall-layout.js'

export const WALL_RENDER_LIMIT = 180
const BLOCK_WIDTH = 6 * (WALL_CELL + WALL_GAP)
const BLOCK_HEIGHT = 4 * (WALL_CELL + WALL_GAP)

/** @typedef {import('./poster-wall-layout.js').WallTile} WallTile */
/** @typedef {{x:number,y:number,w:number,h:number}} Rect */

/**
 * Spatial index: only motifs intersecting the viewport are considered.
 * Camera motion never scans all objects in a large bucket.
 * @param {WallTile[]} tiles
 */
export function indexWallTiles(tiles) {
  /** @type {Map<string, WallTile[]>} */
  const blocks = new Map()
  for (const tile of tiles) {
    const col = Math.floor(tile.x / BLOCK_WIDTH)
    const row = Math.floor(tile.y / BLOCK_HEIGHT)
    const id = col + ':' + row
    const list = blocks.get(id) || []
    list.push(tile)
    blocks.set(id,list)
  }
  return blocks
}

/**
 * @param {Map<string,WallTile[]>} blocks
 * @param {Map<string,Rect>} positions
 * @param {Rect} bounds
 * @param {number} [limit]
 * @returns {WallTile[]}
 */
export function queryWallTiles(blocks, positions, bounds, limit = WALL_RENDER_LIMIT) {
  const startCol = Math.floor(bounds.x / BLOCK_WIDTH)
  const endCol = Math.floor((bounds.x + bounds.w) / BLOCK_WIDTH)
  const startRow = Math.floor(bounds.y / BLOCK_HEIGHT)
  const endRow = Math.floor((bounds.y + bounds.h) / BLOCK_HEIGHT)
  /** @type {WallTile[]} */
  const candidates = []
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      for (const tile of blocks.get(col + ':' + row) || []) {
        const rect = positions.get(tile.key)
        if (rect && intersects(rect, bounds)) candidates.push(tile)
      }
    }
  }
  if (candidates.length <= limit) return candidates
  const centerX = bounds.x + bounds.w / 2
  const centerY = bounds.y + bounds.h / 2
  candidates.sort((a,b)=>{
    const pa=positions.get(a.key) || a
    const pb=positions.get(b.key) || b
    const da=(pa.x+pa.w/2-centerX)**2+(pa.y+pa.h/2-centerY)**2
    const db=(pb.x+pb.w/2-centerX)**2+(pb.y+pb.h/2-centerY)**2
    return da-db
  })
  return candidates.slice(0,limit)
}
