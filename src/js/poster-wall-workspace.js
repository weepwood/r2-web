/**
 * PosterWall workspace helpers, independent from DOM and R2 credentials.
 * Search only inspects the files already loaded into this view. Scene
 * bookmarks persist one camera viewpoint per (account, bucket, directory).
 */

/** @param {{key:string}[]} items @param {string} term */
export function searchWallItems(items, term) {
  const query = term.normalize('NFKC').trim().toLocaleLowerCase()
  if (!query) return []
  return items.filter(item => item.key.normalize('NFKC').toLocaleLowerCase().includes(query))
    .map(item => item.key)
}

/** @param {string} namespace */
export function wallSceneStorageKey(namespace) {
  // Short, stable key. The real names and credentials are never stored in
  // this key or scene data; the fingerprint separates different directories.
  let hash = 2166136261
  for (let i=0;i<namespace.length;i++) {
    hash ^= namespace.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return 'r2-web-wall-scene-v1-' + (hash >>> 0).toString(16).padStart(8,'0')
}

/**
 * Save the world-space center so reopening at a different viewport size
 * restores the same scene, not a stale pixel offset.
 * @param {{x:number,y:number,scale:number}} camera
 * @param {number} width
 * @param {number} height
 */
export function captureWallScene(camera,width,height) {
  return {
    version:1,
    centerX:(width/2-camera.x)/camera.scale,
    centerY:(height/2-camera.y)/camera.scale,
    scale:camera.scale,
  }
}

/** @param {unknown} value */
export function validWallScene(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = /** @type {Record<string,unknown>} */ (value)
  if (data.version !== 1) return null
  const x = data.centerX, y = data.centerY, scale = data.scale
  if (typeof x!=='number'||typeof y!=='number'||typeof scale!=='number'||
      !Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(scale)) return null
  if (Math.abs(x)>1e9 || Math.abs(y)>1e9 || scale < .35 || scale > 2.8) return null
  return /** @type {{version:1,centerX:number,centerY:number,scale:number}} */ ({
    version:1,centerX:x,centerY:y,scale,
  })
}

/** @param {unknown} data @param {number} width @param {number} height */
export function restoreWallScene(data,width,height) {
  const scene = validWallScene(data)
  if (!scene || width <= 0 || height <= 0) return null
  return {
    x:width/2-scene.centerX*scene.scale,
    y:height/2-scene.centerY*scene.scale,
    scale:scene.scale,
  }
}
