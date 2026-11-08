import { selectThumbnailWidth } from './thumbnail-utils.js'
import { ImageAssetService } from './image-asset-service.js'
import { extractFileName } from './utils.js'
import { t } from './i18n.js'
import { buildWallLayout, cameraBounds, focusBlockReflow, focusReflow, intersects, preserveTileAnchor, zoomAt } from './poster-wall-layout.js'
import { indexWallTiles, queryWallTiles } from './poster-wall-visibility.js'
import { classifyWallWheel, focusedWallCamera, projectWallCoast, stepWheelDamping } from './poster-wall-motion.js'
import { captureWallScene, restoreWallScene, searchWallItems, validWallScene, wallSceneStorageKey } from './poster-wall-workspace.js'

/** @typedef {{key:string,size?:number,lastModified?:number|string}} ImageItem */
/** @typedef {{key:string,node:HTMLButtonElement,img:HTMLImageElement,cancel:()=>void,active:boolean,stopped:boolean,requestedWidth:number}} ImageTask */

class PosterWall {
  /** @type {import('./r2-client.js').R2Client} */
  #r2
  /** @type {ImageAssetService} */
  #images
  /** @type {(item:ImageItem)=>void} */
  #onPreview
  /** @type {()=>Promise<void>|void} */
  #onMore
  /** @type {()=>void} */
  #onClose
  /** @type {()=>string} */
  #getScope
  /** @type {HTMLElement} */
  #root
  /** @type {HTMLElement} */
  #viewport
  /** @type {HTMLElement} */
  #canvas
  /** @type {HTMLElement} */
  #focusActions
  /** @type {HTMLElement} */
  #countNode
  /** @type {HTMLElement} */
  #zoomNode
  #lastCountValue = -1
  /** @type {HTMLElement} */
  #searchPanel
  /** @type {HTMLInputElement} */
  #searchInput
  /** @type {HTMLElement} */
  #searchStatus
  /** @type {HTMLButtonElement} */
  #sceneRestoreButton
  /** @type {HTMLElement} */
  #noticeNode
  #noticeTimer = 0
  /** @type {string[]} */
  #searchResults = []
  #searchIndex = -1
  /** @type {ImageItem[]} */
  #items = []
  /** @type {ReturnType<typeof buildWallLayout>} */
  #layout = []
  /** @type {Map<string,import('./poster-wall-layout.js').WallTile>} */
  #tileByKey = new Map()
  /** @type {Map<number,import('./poster-wall-layout.js').WallTile[]>} */
  #blockTiles = new Map()
  /** @type {ReturnType<typeof focusReflow>} */
  #positions = new Map()
  /** @type {ReturnType<typeof indexWallTiles>} */
  #blocks = new Map()
  /** @type {{x:number,y:number,w:number,h:number}|null} */
  #committedBounds = null
  #entranceWave = false
  /** @type {Map<string,HTMLButtonElement>} */
  #nodes = new Map()
  /** @type {Map<string,ImageTask>} */
  #imageTasks = new Map()
  /** @type {ImageTask[]} */
  #imageQueue = []
  #activeImageLoads = 0
  #maxImageLoads = 4
  #qualityTimer = 0
  #lastQualityScale = 0
  #camera = { x: 40, y: 80, scale: 0.76 }
  /** @type {{x:number,y:number,scale:number}|null} */
  #focusReturnCamera = null
  /** @type {string|null} */
  #activeKey = null
  #hasMore = false
  #renderFrame = 0
  #cameraFrame = 0
  #wheelFrame = 0
  #wheelTime = 0
  #wheelPending = { x: 0, y: 0 }
  #wheelLastEvent = 0
  #wheelPrecise = false
  #reducedMotion = false
  #pinchDistance = 0
  #lastPinchCenter = { x: 0, y: 0 }
  /** @type {Map<number,{x:number,y:number,originX:number,originY:number,lastTime:number,vx:number,vy:number}>} */
  #pointers = new Map()
  /** @type {string|null} */
  #pointerTile = null
  #dragged = false
  #gestureUsedPinch = false
  #columnCount = 3
  #viewportSize = { width: 0, height: 0 }
  /** @type {Map<HTMLElement,boolean>} */
  #backgroundInert = new Map()

  /**
   * @param {import('./r2-client.js').R2Client} r2
   * @param {{onPreview:(item:ImageItem)=>void,onLoadMore:()=>Promise<void>|void,onClose:()=>void,getScope?:()=>string}} options
   */
  constructor(r2, { onPreview, onLoadMore, onClose, getScope = () => '' }) {
    this.#r2 = r2
    this.#images = new ImageAssetService(r2)
    this.#onPreview = onPreview
    this.#onMore = onLoadMore
    this.#onClose = onClose
    this.#getScope = getScope
    this.#root = /** @type {HTMLElement} */ (document.querySelector('#poster-wall'))
    this.#viewport = /** @type {HTMLElement} */ (document.querySelector('#poster-wall-viewport'))
    this.#canvas = /** @type {HTMLElement} */ (document.querySelector('#poster-wall-canvas'))
    this.#focusActions = /** @type {HTMLElement} */ (document.querySelector('#wall-focus-actions'))
    this.#countNode = /** @type {HTMLElement} */ (document.querySelector('#wall-count'))
    this.#zoomNode = /** @type {HTMLElement} */ (document.querySelector('#wall-zoom-value'))
    this.#searchPanel = /** @type {HTMLElement} */ (document.querySelector('#wall-search-panel'))
    this.#searchInput = /** @type {HTMLInputElement} */ (document.querySelector('#wall-search-input'))
    this.#searchStatus = /** @type {HTMLElement} */ (document.querySelector('#wall-search-status'))
    this.#sceneRestoreButton = /** @type {HTMLButtonElement} */ (document.querySelector('#wall-restore-view'))
    this.#noticeNode = /** @type {HTMLElement} */ (document.querySelector('#wall-notice'))
    this.#reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => {
      this.#reducedMotion = event.matches
      if (event.matches) {
        this.#cancelCameraMotion()
        this.#cancelWheelMotion()
        for (const tile of this.#nodes.values()) tile.getAnimations().forEach((animation) => animation.cancel())
      }
    })
    this.#bindEvents()
    new ResizeObserver(() => this.#handleResize()).observe(this.#viewport)
  }

  get isOpen() {
    return !this.#root.hidden
  }

  #handleResize() {
    if (!this.isOpen) return
    const width = this.#viewport.clientWidth
    const height = this.#viewport.clientHeight
    if (!width || !height) return
    const previousSize = this.#viewportSize
    if (previousSize.width === width && previousSize.height === height) return
    this.#viewportSize = { width, height }
    this.#cancelCameraMotion()
    this.#cancelWheelMotion()
    // Keep both the active camera and the pre-focus return location anchored
    // around the viewport midpoint on ordinary resizes.
    const shiftX = (width - previousSize.width) / 2
    const shiftY = (height - previousSize.height) / 2
    this.#camera.x += shiftX
    this.#camera.y += shiftY
    if (this.#focusReturnCamera) {
      this.#focusReturnCamera.x += shiftX
      this.#focusReturnCamera.y += shiftY
    }

    const nextColumns = width < 760 ? 2 : 3
    if (nextColumns === this.#columnCount) {
      this.#scheduleRender()
      return
    }

    // Template geometry changes at the breakpoint, so the old unexpanded
    // camera is no longer a valid target for an animated return.
    this.#focusReturnCamera = null
    const previousRects = this.#getVisualRects()
    const centerX = (width / 2 - this.#camera.x) / this.#camera.scale
    const centerY = (height / 2 - this.#camera.y) / this.#camera.scale
    /** @param {{x:number,y:number,w:number,h:number}} rect */
    const distance = (rect) => (rect.x + rect.w / 2 - centerX) ** 2 +
      (rect.y + rect.h / 2 - centerY) ** 2
    const anchor = this.#activeKey ?? this.#layout.reduce((best, tile) => {
      const rect = this.#positions.get(tile.key)
      const closest = best ? this.#positions.get(best) : null
      if (!rect) return best
      if (!closest) return tile.key
      return distance(rect) < distance(closest) ? tile.key : best
    }, /** @type {string | null} */ (null))
    const before = anchor ? this.#positions.get(anchor) : null
    this.#columnCount = nextColumns
    this.#recalculate()
    const after = anchor ? this.#positions.get(anchor) : null
    if (before && after) this.#camera = preserveTileAnchor(this.#camera, before, after)
    this.#render(previousRects)
  }

  /** @param {ImageItem[]} items @param {boolean} hasMore */
  open(items, hasMore) {
    if (this.isOpen) {
      this.update(items, hasMore)
      return
    }
    this.#root.hidden = false
    this.#viewportSize = { width: this.#viewport.clientWidth, height: this.#viewport.clientHeight }
    // Keep Tab inside the presentation, without blocking native top-layer dialogs.
    for (const sibling of this.#root.parentElement?.children ?? []) {
      if (!(sibling instanceof HTMLElement) || sibling === this.#root) continue
      this.#backgroundInert.set(sibling, sibling.inert)
      sibling.inert = true
    }
    this.#columnCount = this.#viewport.clientWidth < 760 ? 2 : 3
    this.#committedBounds = null
    this.#entranceWave = !this.#reducedMotion
    this.#items = items
    this.#hasMore = hasMore
    this.#activeKey = null
    this.#focusReturnCamera = null
    this.#searchInput.value = ''
    this.#searchResults = []
    this.#searchIndex = -1
    this.#setSearchOpen(false)
    this.#refreshSavedView()
    this.#recalculate()
    this.resetCamera()
    this.#render()
    this.#entranceWave = false
    this.#viewport.focus({ preventScroll: true })
  }

  /** @param {ImageItem[]} items @param {boolean} hasMore */
  update(items, hasMore) {
    this.#items = items
    this.#hasMore = hasMore
    if (!this.isOpen) return
    this.#updateSearchResults()
    const previous = this.#getVisualRects()
    this.#recalculate()
    if (this.#activeKey && !this.#positions.has(this.#activeKey)) {
      this.#activeKey = null
      this.#focusReturnCamera = null
    }
    this.#positions = focusReflow(this.#layout, this.#activeKey)
    this.#render(previous)
  }

  close() {
    if (!this.isOpen) return
    this.#root.hidden = true
    for (const [sibling, wasInert] of this.#backgroundInert) sibling.inert = wasInert
    this.#backgroundInert.clear()
    if (this.#renderFrame) cancelAnimationFrame(this.#renderFrame)
    this.#renderFrame = 0
    this.#committedBounds = null
    this.#entranceWave = false
    window.clearTimeout(this.#qualityTimer)
    this.#qualityTimer = 0
    this.#lastQualityScale = 0
    this.#cancelCameraMotion()
    this.#cancelWheelMotion()
    this.#pointers.clear()
    this.#gestureUsedPinch = false
    this.#pointerTile = null
    this.#dragged = false
    this.#viewport.classList.remove('is-dragging')
    this.#activeKey = null
    this.#focusReturnCamera = null
    this.#pinchDistance = 0
    this.#cancelAllImages()
    this.#setSearchOpen(false)
    this.#searchResults = []
    this.#searchIndex = -1
    window.clearTimeout(this.#noticeTimer)
    this.#noticeNode.hidden = true
    this.#nodes.clear()
    this.#canvas.replaceChildren()
    this.#root.classList.remove('has-active')
    this.#onClose()
  }

  refreshLabels() {
    this.#lastCountValue = -1
    this.#root.setAttribute('aria-label', t('viewWall'))
    this.#viewport.setAttribute('aria-label', t('wallHelp'))
    document.querySelector('#wall-eyebrow').textContent = t('wallEyebrow')
    document.querySelector('#wall-title').textContent = t('wallTitle')
    document.querySelector('#wall-help').textContent = t('wallHelp')
    document.querySelector('#wall-empty-title').textContent = t('wallEmptyTitle')
    document.querySelector('#wall-empty-hint').textContent = t('wallEmptyHint')
    document.querySelector('#wall-preview').textContent = t('wallOriginalPreview')
    document.querySelector('#wall-collapse').textContent = t('wallCollapse')
    document.querySelector('#wall-load-more').textContent = t('wallLoadMore')
    document.querySelector('#wall-search-label').textContent = t('wallSearch')
    this.#searchInput.placeholder = t('wallSearchPlaceholder')
    for (const [id, key] of [
      ['wall-search-toggle', 'wallSearch'],
      ['wall-search-prev', 'wallSearchPrevious'],
      ['wall-search-next', 'wallSearchNext'],
      ['wall-save-view', 'wallSaveView'],
      ['wall-restore-view', 'wallRestoreView'],
      ['wall-close', 'wallExit'],
      ['wall-zoom-in', 'wallZoomIn'],
      ['wall-zoom-out', 'wallZoomOut'],
      ['wall-reset', 'wallReset'],
    ]) {
      const button = /** @type {HTMLElement} */ (document.querySelector('#' + id))
      button.setAttribute('aria-label', t(/** @type {any} */ (key)))
      button.setAttribute('title', t(/** @type {any} */ (key)))
    }
    this.#updateSearchResults()
    this.#updateHud()
  }

  #recalculate() {
    this.#layout = buildWallLayout(this.#items, { columns: this.#columnCount })
    this.#tileByKey = new Map(this.#layout.map((tile) => [tile.key, tile]))
    this.#blockTiles.clear()
    for (const tile of this.#layout) {
      const list = this.#blockTiles.get(tile.blockIndex) || []
      list.push(tile)
      this.#blockTiles.set(tile.blockIndex, list)
    }
    this.#blocks = indexWallTiles(this.#layout)
    this.#positions = focusReflow(this.#layout, this.#activeKey)
  }

  /** @param {boolean} [animated] */
  resetCamera(animated = false) {
    this.#cancelWheelMotion()
    const width = this.#viewport.clientWidth || window.innerWidth
    const height = this.#viewport.clientHeight || window.innerHeight
    const defaultScale = width < 640 ? 0.54 : width < 1100 ? 0.66 : 0.76
    // Fit the first motif rather than assuming there are always many images.
    // A one-image folder now opens centered instead of against empty canvas.
    const opening = this.#layout.slice(0, Math.min(this.#layout.length, 7))
    const left = opening.length ? Math.min(...opening.map((tile) => tile.x)) : 0
    const top = opening.length ? Math.min(...opening.map((tile) => tile.y)) : 0
    const right = opening.length ? Math.max(...opening.map((tile) => tile.x + tile.w)) : 0
    const bottom = opening.length ? Math.max(...opening.map((tile) => tile.y + tile.h)) : 0
    const contentWidth = Math.max(1, right - left)
    const contentHeight = Math.max(1, bottom - top)
    const maximum = opening.length <= 2 ? 1.25 : defaultScale
    const scale = Math.max(0.35, Math.min(maximum,
      (width - 64) / contentWidth,
      (height - 130) / contentHeight))
    const target = {
      x: (width - contentWidth * scale) / 2 - left * scale,
      y: (height - contentHeight * scale) / 2 - top * scale,
      scale,
    }
    if (animated) this.#animateCamera(target, 320)
    else {
      this.#cancelCameraMotion()
      this.#camera = target
      this.#scheduleRender()
    }
  }

  /** @param {number} factor @param {number} [x] @param {number} [y] @param {boolean} [animated] */
  zoom(factor, x = this.#viewport.clientWidth / 2, y = this.#viewport.clientHeight / 2, animated = false) {
    this.#cancelWheelMotion()
    const target = zoomAt(this.#camera, x, y, this.#camera.scale * factor)
    if (animated) this.#animateCamera(target, 235)
    else {
      this.#cancelCameraMotion()
      this.#camera = target
      this.#scheduleRender()
    }
  }

  #cancelCameraMotion() {
    if (this.#cameraFrame) cancelAnimationFrame(this.#cameraFrame)
    this.#cameraFrame = 0
  }

  #cancelWheelMotion() {
    if (this.#wheelFrame) cancelAnimationFrame(this.#wheelFrame)
    this.#wheelFrame = 0
    this.#wheelTime = 0
    this.#wheelPending = {x:0,y:0}
  }

  /** @param {number} dx @param {number} dy */
  #moveWheel(dx,dy) {
    this.#cancelCameraMotion()
    this.#wheelPending.x -= dx
    this.#wheelPending.y -= dy
    if (this.#wheelFrame) return
    /** @param {number} now */
    const tick = (now) => {
      this.#wheelFrame = 0
      if (!this.isOpen) { this.#cancelWheelMotion(); return }
      const dt = this.#wheelTime ? now-this.#wheelTime : 16
      this.#wheelTime = now
      const motion = stepWheelDamping(this.#wheelPending,dt)
      this.#wheelPending = motion.pending
      this.#camera.x += motion.step.x
      this.#camera.y += motion.step.y
      this.#scheduleRender()
      if (this.#wheelPending.x || this.#wheelPending.y) {
        this.#wheelFrame = requestAnimationFrame(tick)
      } else this.#wheelTime = 0
    }
    this.#wheelFrame = requestAnimationFrame(tick)
  }

  /**
   * Short interruptible UI-camera motion. Real pointer movements cancel it.
   * @param {{x:number,y:number,scale:number}} target
   * @param {number} duration
   */
  #animateCamera(target, duration) {
    this.#cancelWheelMotion()
    this.#cancelCameraMotion()
    if (this.#reducedMotion) {
      this.#camera = target
      this.#scheduleRender()
      return
    }
    const from = { ...this.#camera }
    const started = performance.now()
    /** @param {number} now */
    const tick = (now) => {
      const t = Math.min(1, (now - started) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      this.#camera = {
        x: from.x + (target.x - from.x) * eased,
        y: from.y + (target.y - from.y) * eased,
        scale: from.scale + (target.scale - from.scale) * eased,
      }
      this.#scheduleRender()
      this.#cameraFrame = t < 1 ? requestAnimationFrame(tick) : 0
    }
    this.#cameraFrame = requestAnimationFrame(tick)
  }

  /**
   * Camera frames only touch the GPU transform and a tiny HUD. They do not
   * scan, sort or allocate the tile DOM on every mouse move / touch frame.
   * The cached cull box reserves 380px around the visible viewport; refresh
   * it only when the visible rectangle approaches the edge of that reserve.
   */
  #scheduleRender() {
    if (!this.isOpen || this.#renderFrame) return
    this.#renderFrame = requestAnimationFrame(() => {
      this.#renderFrame = 0
      this.#paintCamera()
      const bounds = this.#committedBounds
      const visible = cameraBounds(this.#camera,
        this.#viewport.clientWidth, this.#viewport.clientHeight, 0)
      const margin = 110 / this.#camera.scale
      if (!bounds ||
        visible.x < bounds.x + margin ||
        visible.y < bounds.y + margin ||
        visible.x + visible.w > bounds.x + bounds.w - margin ||
        visible.y + visible.h > bounds.y + bounds.h - margin) {
        this.#render()
      }
    })
  }

  #paintCamera() {
    const { x, y, scale } = this.#camera
    this.#canvas.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`
    const zoomLevel = scale < 0.58 ? 'overview' : scale > 1.45 ? 'detail' : 'normal'
    if (this.#root.dataset.zoomLevel !== zoomLevel) this.#root.dataset.zoomLevel = zoomLevel
    if (Math.abs(this.#lastQualityScale - scale) >= 0.025) {
      this.#lastQualityScale = scale
      this.#scheduleQualityCheck()
    }
    this.#updateHud()
    if (this.#activeKey) {
      const visible = this.#positionFocusActions(this.#focusActions)
      if (this.#focusActions.hidden === visible) this.#focusActions.hidden = !visible
    }
  }

  /** @param {Set<number>|null} [blocks] */
  #getVisualRects(blocks = null) {
    return new Map([...this.#nodes]
      .filter(([key]) => !blocks || blocks.has(this.#tileByKey.get(key)?.blockIndex ?? -1))
      .map(([key, node]) => [key, node.getBoundingClientRect()]))
  }

  /** @param {Map<string,DOMRect>} [previous] */
  #render(previous) {
    if (!this.isOpen) return
    this.#root.dataset.wallRenderPasses = String(
      Number(this.#root.dataset.wallRenderPasses || 0) + 1)
    this.#paintCamera()
    const { scale } = this.#camera
    const bounds = cameraBounds(this.#camera, this.#viewport.clientWidth,
      this.#viewport.clientHeight, 380)
    this.#committedBounds = bounds
    const candidates = queryWallTiles(this.#blocks, this.#positions, bounds)
    const visible = new Set(candidates.map((tile) => tile.key))
    for (const tile of candidates) {
      const rect = this.#positions.get(tile.key)
      if (!rect) continue
      let node = this.#nodes.get(tile.key)
      if (!node) {
        node = this.#createTile(tile)
        this.#nodes.set(tile.key, node)
        this.#canvas.append(node)
        this.#enqueueImage(tile, node)
        // Limit first-paint animation work on low-end GPUs. Newly culled-in
        // cards mount at their destination without replaying the opening wave.
        if (this.#entranceWave && this.#nodes.size <= 48) {
          const screenX = tile.x * scale + this.#camera.x
          const screenY = tile.y * scale + this.#camera.y
          const delay = Math.min(290, Math.max(0, (screenX + screenY) * 0.11))
          node.style.setProperty('--wall-entrance-delay', delay + 'ms')
          node.classList.add('is-entering')
          node.addEventListener('animationend', () => node.classList.remove('is-entering'), { once:true })
        }
      }
      const layoutId = `${rect.x},${rect.y},${rect.w},${rect.h}`
      // Only the actually reconfigured block needs to interrupt FLIP.
      if (node.dataset.layoutRect !== layoutId && previous?.has(tile.key)) {
        node.getAnimations().forEach((animation) => animation.cancel())
      }
      if (node.dataset.layoutRect !== layoutId) {
        node.dataset.layoutRect = layoutId
        node.style.left = `${rect.x}px`
        node.style.top = `${rect.y}px`
        node.style.width = `${rect.w}px`
        node.style.height = `${rect.h}px`
      }
      const active = tile.key === this.#activeKey
      if (node.classList.contains('is-active') !== active) {
        node.classList.toggle('is-active', active)
        node.setAttribute('aria-pressed', String(active))
        node.style.zIndex = active ? '5' : '1'
      }
    }

    // Virtualization: preserve only visible, overscanned, focused or expanded tiles.
    for (const [key, node] of this.#nodes) {
      if (visible.has(key) || key === this.#activeKey || node === document.activeElement) continue
      this.#discardImage(key)
      node.remove()
      this.#nodes.delete(key)
    }

    if (previous && !this.#reducedMotion) {
      for (const [key, node] of this.#nodes) {
        const from = previous.get(key)
        if (!from || !visible.has(key)) continue
        const to = node.getBoundingClientRect()
        const dx = (from.left - to.left) / scale
        const dy = (from.top - to.top) / scale
        const sx = to.width ? from.width / to.width : 1
        const sy = to.height ? from.height / to.height : 1
        if (Math.abs(dx) + Math.abs(dy) < 0.5 && Math.abs(sx - 1) + Math.abs(sy - 1) < .01) continue
        this.#spring(node, dx, dy, sx, sy)
      }
    }

    // Visible images are favored over overscan; start requests only after
    // the whole visible set has been reconciled.
    this.#imageQueue = this.#imageQueue.filter((task) => !task.stopped)
    this.#imageQueue.sort((a, b) => this.#imagePriority(a.key) - this.#imagePriority(b.key))
    this.#pumpImages()
    this.#root.classList.toggle('has-active', Boolean(this.#activeKey))
    const focusActions = this.#focusActions
    const emptyState = /** @type {HTMLElement} */ (document.querySelector('#wall-empty'))
    const moreControl = /** @type {HTMLElement} */ (document.querySelector('#wall-more'))
    const actionsVisible = this.#activeKey ? this.#positionFocusActions(focusActions) : false
    focusActions.hidden = !actionsVisible
    emptyState.hidden = this.#layout.length > 0
    moreControl.hidden = !this.#hasMore
    this.#root.dataset.wallMountedTiles = String(this.#nodes.size)
    this.#updateHud()
  }

  /**
   * Keep contextual actions near the selected image, clamped to the viewport.
   * Their location is computed from world coordinates, not layout reads.
   * @param {HTMLElement} actions
   * @returns {boolean} Whether the selected tile is still onscreen.
   */
  #positionFocusActions(actions) {
    const rect = this.#activeKey ? this.#positions.get(this.#activeKey) : null
    if (!rect) return false
    const { x, y, scale } = this.#camera
    const viewportWidth = this.#viewport.clientWidth
    const viewportHeight = this.#viewport.clientHeight
    const projectedLeft = x + rect.x * scale
    const projectedTop = y + rect.y * scale
    const projectedRight = x + (rect.x + rect.w) * scale
    const projectedBottom = y + (rect.y + rect.h) * scale
    if (projectedRight < 0 || projectedBottom < 0 || projectedLeft > viewportWidth || projectedTop > viewportHeight) {
      return false
    }
    // Avoid a synchronous layout read on every camera animation frame.
    const width = 220
    const left = Math.max(14, Math.min(projectedRight - width, viewportWidth - width - 14))
    const top = Math.max(79, Math.min(projectedBottom + 10, viewportHeight - 76))
    const position = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
    if (actions.style.transform !== position) actions.style.transform = position
    return true
  }

  /**
   * FLIP animation with a restrained underdamped spring curve. New interactions sample
   * the live bounding box, cancel the old animation, and start from that point.
   * @param {HTMLElement} node
   * @param {number} dx
   * @param {number} dy
   * @param {number} sx
   * @param {number} sy
   */
  #spring(node, dx, dy, sx, sy) {
    const frames = []
    for (let step = 0; step <= 20; step++) {
      const t = step / 20
      const progress = step === 20 ? 1 : 1 - Math.exp(-9 * t) * (Math.cos(6.2 * t) + 0.32 * Math.sin(6.2 * t))
      const left = 1 - progress
      frames.push({
        offset: t,
        transform: `translate3d(${dx * left}px, ${dy * left}px, 0) scale(${1 + (sx - 1) * left}, ${1 + (sy - 1) * left})`,
      })
    }
    node.animate(frames, { duration: 480, easing: 'linear', fill: 'none' })
  }

  /** @param {import('./poster-wall-layout.js').WallTile} tile */
  #createTile(tile) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'poster-tile'
    button.classList.toggle('is-compact', tile.w < 330 || tile.h < 330)
    button.dataset.key = tile.key
    button.setAttribute('aria-pressed', 'false')
    button.setAttribute('aria-label', t('wallOpenTile') + ': ' + extractFileName(tile.key))

    const media = document.createElement('span')
    media.className = 'poster-tile-media'
    const img = document.createElement('img')
    img.alt = ''
    img.loading = 'eager' // culling controls the exact set of network requests
    img.decoding = 'async'
    img.draggable = false
    media.append(img)

    const shade = document.createElement('span')
    shade.className = 'poster-tile-shade'
    const copy = document.createElement('span')
    copy.className = 'poster-tile-copy'
    const kicker = document.createElement('span')
    kicker.className = 'poster-tile-kicker'
    kicker.textContent = tile.key.split('/').slice(0, -1).filter(Boolean).at(-1) || 'R2 / IMAGE'
    const title = document.createElement('span')
    title.className = 'poster-tile-title'
    title.textContent = extractFileName(tile.key).replace(/\.[^.]+$/, '')
    copy.append(kicker, title)
    button.append(media, shade, copy)
    // Pointer activation is handled on pointerup after differentiating a drag.
    // Keyboard-synthesized clicks have detail=0 and remain fully operable.
    button.addEventListener('click', (event) => {
      if (event.detail === 0) this.#toggle(tile.key)
    })
    return button
  }

  /** @param {string} key */
  #toggle(key) {
    if (!this.isOpen) return
    this.#cancelCameraMotion()
    this.#cancelWheelMotion()
    const oldBlock = this.#activeKey ? this.#tileByKey.get(this.#activeKey)?.blockIndex : null
    const newBlock = this.#tileByKey.get(key)?.blockIndex
    const blocks = new Set([oldBlock,newBlock].filter((value) => value !== null && value !== undefined))
    // FLIP samples only the 7-8 cards in the affected geometric block(s),
    // not every image on the wall.
    const previous = this.#getVisualRects(blocks)
    const collapsing = this.#activeKey === key
    if (!this.#activeKey) this.#focusReturnCamera = {...this.#camera}
    this.#activeKey = collapsing ? null : key
    // Restore the previously expanded block and update only the new one.
    // The layout map is reused; a large Bucket never needs a full clone here.
    for (const block of blocks) {
      const tiles = this.#blockTiles.get(block) || []
      for (const tile of tiles) {
        this.#positions.set(tile.key, { x:tile.x, y:tile.y, w:tile.w, h:tile.h })
      }
    }
    if (this.#activeKey && newBlock !== undefined) {
      const tiles = this.#blockTiles.get(newBlock) || []
      for (const [itemKey, rect] of focusBlockReflow(tiles, this.#activeKey)) {
        this.#positions.set(itemKey, rect)
      }
    }
    this.#render(previous)

    // Folia-like focus: the expanded picture settles towards the center
    // while surrounding posters re-gear within their own block.
    if (this.#activeKey) {
      const rect = this.#positions.get(this.#activeKey)
      if (rect) {
        this.#animateCamera(
          focusedWallCamera(this.#camera,rect,
            this.#viewport.clientWidth,this.#viewport.clientHeight),
          420)
      }
    } else if (this.#focusReturnCamera) {
      // Closing the poster completes the spatial gesture by returning to the
      // exact viewpoint from which it was opened, instead of stranding the
      // visitor at an unexpectedly zoomed-in camera location.
      const target = this.#focusReturnCamera
      this.#focusReturnCamera = null
      this.#animateCamera(target, 360)
    }
  }

  #updateHud() {
    // Count translation is recomputed only when the file count or locale
    // changes; camera frames only check the small numeric zoom value.
    if (this.#lastCountValue !== this.#items.length) {
      this.#lastCountValue = this.#items.length
      this.#countNode.textContent = t('wallCount', { count: this.#items.length })
    }
    const zoomLabel = Math.round(this.#camera.scale * 100) + '%'
    if (this.#zoomNode.textContent !== zoomLabel) this.#zoomNode.textContent = zoomLabel
  }

  /** @param {string} key */
  #imagePriority(key) {
    const tile = this.#positions.get(key)
    if (!tile) return Number.POSITIVE_INFINITY
    const { x, y, scale } = this.#camera
    const centerX = (this.#viewport.clientWidth / 2 - x) / scale
    const centerY = (this.#viewport.clientHeight / 2 - y) / scale
    const distance = Math.hypot(tile.x + tile.w / 2 - centerX, tile.y + tile.h / 2 - centerY)
    const onscreen = intersects(tile, cameraBounds(this.#camera, this.#viewport.clientWidth,
      this.#viewport.clientHeight, 0))
    return distance + (onscreen ? 0 : 100000)
  }

  /** @param {import('./poster-wall-layout.js').WallTile} tile @param {HTMLButtonElement} node */
  #enqueueImage(tile, node) {
    const currentWidth = Number(node.dataset.wallImageWidth || 0)
    const requestedWidth = selectThumbnailWidth(Math.min(640, tile.w * this.#camera.scale),
      window.devicePixelRatio || 1)
    if (currentWidth >= requestedWidth || this.#imageTasks.has(tile.key)) return
    if (Number(node.dataset.wallFailedWidth || 0) === requestedWidth) return
    const task = /** @type {ImageTask} */ ({
      key: tile.key,
      node,
      img: /** @type {HTMLImageElement} */ (node.querySelector('.poster-tile-media img:not(.poster-tile-upgrade)')),
      cancel: () => {},
      active: false,
      stopped: false,
      requestedWidth,
    })
    this.#imageTasks.set(tile.key, task)
    this.#imageQueue.push(task)
  }

  #scheduleQualityCheck() {
    window.clearTimeout(this.#qualityTimer)
    if (!this.isOpen) return
    // Waiting until a zoom gesture settles prevents request storms while
    // crossing the 160/320/480/640px resolution boundaries.
    this.#qualityTimer = window.setTimeout(() => {
      this.#qualityTimer = 0
      this.#upgradeVisibleImages()
    }, 230)
  }

  #upgradeVisibleImages() {
    if (!this.isOpen) return
    const visibleBounds = cameraBounds(this.#camera,
      this.#viewport.clientWidth, this.#viewport.clientHeight, 0)
    for (const [key, node] of this.#nodes) {
      const tile = this.#tileByKey.get(key)
      const rect = this.#positions.get(key)
      if (!tile || !rect || !intersects(rect, visibleBounds)) continue
      // Do not upgrade a failed/placeholder tile and never prefetch an original
      // just because a user is zooming the canvas.
      if (!node.classList.contains('is-loaded')) continue
      this.#enqueueImage(tile, node)
    }
    this.#imageQueue.sort((a, b) => this.#imagePriority(a.key) - this.#imagePriority(b.key))
    this.#pumpImages()
  }

  #pumpImages() {
    while (this.#activeImageLoads < this.#maxImageLoads && this.#imageQueue.length > 0) {
      const task = this.#imageQueue.shift()
      if (!task || task.stopped || this.#imageTasks.get(task.key) !== task) continue
      this.#activeImageLoads++
      task.active = true
      void this.#loadImage(task).finally(() => {
        this.#activeImageLoads--
        if (this.#imageTasks.get(task.key) === task) this.#imageTasks.delete(task.key)
        if (!task.stopped && task.node.classList.contains('is-loaded')) {
          const tile = this.#tileByKey.get(task.key)
          const desired = tile ? selectThumbnailWidth(Math.min(640, tile.w * this.#camera.scale),
            window.devicePixelRatio || 1) : 0
          if (desired > Number(task.node.dataset.wallImageWidth || 0)) this.#scheduleQualityCheck()
        }
        this.#pumpImages()
      })
    }
  }

  /** @param {ImageTask} task */
  async #loadImage(task) {
    const live = () => !task.stopped && this.isOpen && this.#nodes.get(task.key) === task.node
    if (!live()) return
    const tile = this.#tileByKey.get(task.key)
    if (!tile) return
    const desired = task.requestedWidth
    const upgrading = task.node.classList.contains('is-loaded')
    const policy = this.#images.thumbnailPlan(task.key, desired)
    if (!policy.url && !policy.allowOriginal) {
      if (!upgrading && live()) task.node.classList.add('is-unavailable')
      return
    }
    try {
      let success = policy.url ? await this.#attemptImage(task, policy.url, upgrading) : false
      let fromOriginal = false
      // If a CDN upgrade fails, keep the existing low-res image. Never
      // trigger an automatic full-size fallback during an upscale.
      if (!success && !upgrading && live() && policy.allowOriginal) {
        const source = await this.#images.originalUrl(task.key)
        if (!live()) return
        success = await this.#attemptImage(task, source, false)
        fromOriginal = success
      }
      if (!live()) return
      if (success) {
        task.node.dataset.wallImageWidth = String(fromOriginal ? 99999 : desired)
        delete task.node.dataset.wallFailedWidth
        task.node.classList.add('is-loaded')
        task.node.classList.remove('is-unavailable')
      } else if (!upgrading) {
        task.node.classList.add('is-unavailable')
      } else {
        task.node.dataset.wallFailedWidth = String(desired)
      }
    } catch {
      if (live()) {
        if (upgrading) task.node.dataset.wallFailedWidth = String(desired)
        else task.node.classList.add('is-unavailable')
      }
    }
  }

  /**
   * Preload a higher-resolution image behind the existing tile. Only swap
   * DOM nodes once the new variant is decoded by the browser. This avoids
   * flicker, broken placeholders and a second GET for non-cacheable URLs.
   * @param {ImageTask} task
   * @param {string} url
   * @param {boolean} upgrade
   * @returns {Promise<boolean>}
   */
  #attemptImage(task, url, upgrade) {
    return new Promise((resolve) => {
      if (task.stopped) { resolve(false); return }
      const img = upgrade ? document.createElement('img') : task.img
      if (upgrade) {
        img.className = 'poster-tile-upgrade'
        img.alt = ''
        img.decoding = 'async'
        img.draggable = false
        img.loading = 'eager'
        task.node.querySelector('.poster-tile-media')?.append(img)
      }
      let finished = false
      /** @param {boolean} success */
      const settle = (success) => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        img.onload = null
        img.onerror = null
        task.cancel = () => {}
        if (upgrade) {
          if (success && !task.stopped) {
            task.img.remove()
            img.classList.remove('poster-tile-upgrade')
            task.img = img
          } else {
            img.remove()
          }
        }
        resolve(success)
      }
      const timeout = setTimeout(() => {
        if (!upgrade) img.removeAttribute('src')
        settle(false)
      }, 15000)
      task.cancel = () => {
        if (!upgrade) img.removeAttribute('src')
        settle(false)
      }
      img.onload = () => {
        if (!upgrade || typeof img.decode !== 'function') {
          settle(true)
          return
        }
        // onload only confirms bytes arrived; the image may still need a
        // costly decode. Keep the old thumbnail painted until the new bitmap
        // is ready, so a large variant never flashes or stalls focus motion.
        void img.decode().then(() => settle(true), () => settle(false))
      }
      img.onerror = () => settle(false)
      img.src = url
    })
  }

  /** @param {string} key */
  #discardImage(key) {
    const task = this.#imageTasks.get(key)
    if (!task) return
    task.stopped = true
    task.cancel()
    this.#imageTasks.delete(key)
  }

  #cancelAllImages() {
    for (const key of this.#imageTasks.keys()) this.#discardImage(key)
    this.#imageQueue = []
  }

  #bindEvents() {
    this.#viewport.addEventListener('pointerdown', (event) => this.#pointerDown(event))
    this.#viewport.addEventListener('pointermove', (event) => this.#pointerMove(event))
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.#viewport.addEventListener(type, (event) => this.#pointerUp(/** @type {PointerEvent} */ (event)))
    }
    this.#viewport.addEventListener('wheel', (event) => {
      event.preventDefault()
      const rect = this.#viewport.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      // Wheel notches accumulate into one damping tail. Precise trackpads
      // go straight to the camera because the OS already supplies inertia.
      if (event.ctrlKey || event.altKey) {
        this.zoom(Math.exp(-event.deltaY * 0.0022), x, y)
        return
      }
      const step = event.deltaMode === 1 ? 16
        : event.deltaMode === 2 ? this.#viewport.clientHeight : 1
      const dx = (event.shiftKey ? event.deltaY : event.deltaX) * step
      const dy = (event.shiftKey ? 0 : event.deltaY) * step
      const classification = classifyWallWheel(
        this.#wheelLastEvent,this.#wheelPrecise,event)
      this.#wheelLastEvent = classification.lastTimestamp
      this.#wheelPrecise = classification.preciseGesture
      if (classification.kind === 'precise' || this.#reducedMotion) {
        const carry = this.#wheelPending
        this.#cancelWheelMotion()
        this.#cancelCameraMotion()
        this.#camera.x += carry.x - dx
        this.#camera.y += carry.y - dy
        this.#scheduleRender()
      } else {
        this.#moveWheel(dx,dy)
      }
    }, { passive: false })
    // Controls live outside the viewport, so keyboard shortcuts must be scoped
    // to the entire presentation (including focused action buttons).
    this.#root.addEventListener('keydown', (event) => this.#keyDown(event))
    const onClick = (id, cb) => document.querySelector('#' + id).addEventListener('click', cb)
    onClick('wall-close', () => this.close())
    onClick('wall-zoom-in', () => this.zoom(1.23, undefined, undefined, true))
    onClick('wall-zoom-out', () => this.zoom(1 / 1.23, undefined, undefined, true))
    onClick('wall-reset', () => this.resetCamera(true))
    onClick('wall-collapse', () => {
      if (this.#activeKey) this.#toggle(this.#activeKey)
      this.#viewport.focus({ preventScroll: true })
    })
    onClick('wall-preview', () => {
      const item = this.#items.find((entry) => entry.key === this.#activeKey)
      if (item) this.#onPreview(item)
    })
    onClick('wall-load-more', async () => {
      const button = /** @type {HTMLButtonElement} */ (document.querySelector('#wall-load-more'))
      if (button.disabled) return
      button.disabled = true
      try {
        await this.#onMore()
      } finally {
        button.disabled = false
      }
    })
  }

  /** @param {PointerEvent} event */
  #pointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    this.#cancelCameraMotion()
    this.#cancelWheelMotion()
    this.#viewport.setPointerCapture(event.pointerId)
    this.#pointers.set(event.pointerId, {
      x: event.clientX, y: event.clientY,
      originX: event.clientX, originY: event.clientY,
      lastTime: event.timeStamp, vx: 0, vy: 0,
    })
    // A second finger is a new gesture; do not allow either contact to
    // synthesize a tile click when it leaves the screen.
    if (this.#pointers.size === 1) {
      this.#dragged = false
      this.#gestureUsedPinch = false
    }
    this.#pointerTile = this.#pointers.size === 1
      ? /** @type {HTMLElement|null} */ (event.target instanceof Element ? event.target.closest('.poster-tile') : null)?.dataset.key ?? null
      : null
    if (this.#pointers.size >= 2) {
      this.#gestureUsedPinch = true
      this.#dragged = true
      this.#pointerTile = null
      this.#recordPinch()
    }
  }

  #recordPinch() {
    const points = [...this.#pointers.values()]
    if (points.length < 2) return
    this.#pinchDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
    const rect = this.#viewport.getBoundingClientRect()
    this.#lastPinchCenter = {
      x: (points[0].x + points[1].x) / 2 - rect.left,
      y: (points[0].y + points[1].y) / 2 - rect.top,
    }
  }

  /** @param {PointerEvent} event */
  #pointerMove(event) {
    const pointer = this.#pointers.get(event.pointerId)
    if (!pointer) return
    const dx = event.clientX - pointer.x
    const dy = event.clientY - pointer.y
    const elapsed = event.timeStamp - pointer.lastTime
    if (elapsed > 0 && elapsed < 130) {
      pointer.vx = pointer.vx * .25 + dx / elapsed * 1000 * .75
      pointer.vy = pointer.vy * .25 + dy / elapsed * 1000 * .75
    } else { pointer.vx = 0; pointer.vy = 0 }
    pointer.lastTime = event.timeStamp
    pointer.x = event.clientX
    pointer.y = event.clientY
    const totalX = pointer.x - pointer.originX
    const totalY = pointer.y - pointer.originY
    if (this.#pointers.size === 1 && !this.#dragged) {
      // Keep small finger jitter a click. Only start panning after 7px.
      if (Math.hypot(totalX, totalY) < 7) return
      this.#dragged = true
      this.#pointerTile = null
      this.#camera.x += totalX
      this.#camera.y += totalY
      this.#viewport.classList.add('is-dragging')
      this.#scheduleRender()
      return
    }
    if (this.#pointers.size >= 2) {
      this.#dragged = true
      const points = [...this.#pointers.values()]
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
      const rect = this.#viewport.getBoundingClientRect()
      const center = { x: (points[0].x + points[1].x) / 2 - rect.left, y: (points[0].y + points[1].y) / 2 - rect.top }
      if (this.#pinchDistance > 0) {
        this.#camera = zoomAt(this.#camera, this.#lastPinchCenter.x, this.#lastPinchCenter.y,
          this.#camera.scale * distance / this.#pinchDistance)
        this.#camera.x += center.x - this.#lastPinchCenter.x
        this.#camera.y += center.y - this.#lastPinchCenter.y
      }
      this.#pinchDistance = distance
      this.#lastPinchCenter = center
    } else {
      this.#camera.x += dx
      this.#camera.y += dy
    }
    this.#viewport.classList.toggle('is-dragging', this.#dragged)
    this.#scheduleRender()
  }

  /** @param {PointerEvent} event */
  #pointerUp(event) {
    const pointer = this.#pointers.get(event.pointerId)
    if (!pointer) return
    const pick = !this.#dragged && !this.#gestureUsedPinch &&
      this.#pointers.size === 1 ? this.#pointerTile : null
    const coast = this.#dragged && !this.#gestureUsedPinch && !this.#reducedMotion &&
      this.#pointers.size === 1 && event.type === 'pointerup'
      ? projectWallCoast(pointer.vx, pointer.vy, event.timeStamp - pointer.lastTime)
      : null
    this.#pointers.delete(event.pointerId)
    if (this.#pointers.size < 2) {
      this.#pinchDistance = 0
      for (const remaining of this.#pointers.values()) {
        // Do not apply the old finger's entire movement as a pan offset
        // when one finger stays down after pinching.
        remaining.originX = remaining.x
        remaining.originY = remaining.y
      }
    }
    if (this.#pointers.size === 0) {
      this.#viewport.classList.remove('is-dragging')
      this.#pointerTile = null
      this.#dragged = false
      this.#gestureUsedPinch = false
    }
    if (pick && event.type === 'pointerup') this.#toggle(pick)
    else if (coast && this.isOpen) {
      this.#animateCamera({
        x: this.#camera.x + coast.x,
        y: this.#camera.y + coast.y,
        scale: this.#camera.scale,
      }, 330)
    }
  }

  /** @param {KeyboardEvent} event */
  #keyDown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Escape','+','=','-','0','Home'].includes(event.key)) {
      this.#cancelCameraMotion()
      this.#cancelWheelMotion()
    }
    const step = event.shiftKey ? 170 : 86
    let used = true
    if (event.key === 'Escape') {
      if (this.#activeKey) this.#toggle(this.#activeKey)
      else this.close()
    } else if (event.key === 'ArrowLeft') this.#camera.x += step
    else if (event.key === 'ArrowRight') this.#camera.x -= step
    else if (event.key === 'ArrowUp') this.#camera.y += step
    else if (event.key === 'ArrowDown') this.#camera.y -= step
    else if (event.key === '+' || event.key === '=') this.zoom(1.23)
    else if (event.key === '-') this.zoom(1 / 1.23)
    else if (event.key === '0' || event.key === 'Home') this.resetCamera()
    else used = false
    if (used) {
      event.preventDefault()
      this.#scheduleRender()
    }
  }
}

export { PosterWall }
