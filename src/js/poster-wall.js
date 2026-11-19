import { selectThumbnailWidth } from './thumbnail-utils.js'
import { ImageAssetService } from './image-asset-service.js'
import { extractFileName, formatBytes } from './utils.js'
import { t } from './i18n.js'
import {
  LATTICE_CELL,
  LATTICE_GAP,
  WALL_MAX_SCALE,
  WALL_MIN_SCALE,
  cameraBounds,
  findNearestInstance,
  getLatticeGeometry,
  intersects,
  layoutExpandedBlock,
  layoutLattice,
  locateNearestInstance,
  locateStepCandidates,
  pickAdjacentInstance,
  zoomAt,
} from './poster-wall-layout.js'

/** @typedef {{key:string,size?:number,lastModified?:number|string}} ImageItem */
/** @typedef {import('./poster-wall-layout.js').LatticeInstance} LatticeInstance */
/** @typedef {{key:string,instanceId:string,node:HTMLButtonElement,img:HTMLImageElement,cancel:()=>void,active:boolean,stopped:boolean,requestedWidth:number}} ImageTask */

const ENTRANCE_STAGGER_S = 0.03
const ENTRANCE_MAX_DELAY_S = 0.34
const INERTIA = {
  minSpeed: 40,
  maxSpeed: 4000,
  power: 0.3,
  timeConstant: 280,
  restDelta: 0.5,
  staleReleaseMs: 80,
}

class PosterWall {
  /** @type {import('./r2-client.js').R2Client} */
  #r2
  /** @type {ImageAssetService} */
  #images
  /** @type {(item:ImageItem)=>void} */
  #onPreview
  /** @type {((item:ImageItem)=>void)|undefined} */
  #onCopyUrl
  /** @type {((item:ImageItem)=>void)|undefined} */
  #onDownload
  /** @type {()=>Promise<void>|void} */
  #onMore
  /** @type {()=>void} */
  #onClose
  /** @type {HTMLElement} */
  #root
  /** @type {HTMLElement} */
  #viewport
  /** @type {HTMLElement} */
  #canvas
  /** @type {ImageItem[]} */
  #items = []
  #geometry = getLatticeGeometry(0)
  /** @type {LatticeInstance[]} */
  #layout = []
  /** @type {Map<string,LatticeInstance>} */
  #visibleInstances = new Map()
  /** @type {Map<string,{x:number,y:number,w:number,h:number}>} */
  #expandedRects = new Map()
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
  /** @type {LatticeInstance|null} */
  #activeInstance = null
  /** @type {LatticeInstance|null} */
  #focusedInstance = null
  /** @type {string|null} */
  #firstPressInstanceId = null
  #hasMore = false
  #renderFrame = 0
  #cameraFrame = 0
  #wheelFrame = 0
  /** @type {{targetScale:number,x:number,y:number,lastTime:number|null}|null} */
  #wheelZoom = null
  #reducedMotion = false
  #entranceActive = false
  #pinchDistance = 0
  #lastPinchCenter = { x: 0, y: 0 }
  /** @type {Map<number,{x:number,y:number,originX:number,originY:number,lastX:number,lastY:number,lastTime:number,vx:number,vy:number}>} */
  #pointers = new Map()
  /** @type {string|null} */
  #pointerTile = null
  #dragged = false
  #gestureUsedPinch = false
  #viewportSize = { width: 0, height: 0 }
  /** @type {Map<HTMLElement,boolean>} */
  #backgroundInert = new Map()
  /** @type {number[]} */
  #searchMatches = []
  #searchMatchCursor = 0

  /**
   * @param {import('./r2-client.js').R2Client} r2
   * @param {{
   *   onPreview:(item:ImageItem)=>void,
   *   onCopyUrl?:(item:ImageItem)=>void,
   *   onDownload?:(item:ImageItem)=>void,
   *   onLoadMore:()=>Promise<void>|void,
   *   onClose:()=>void
   * }} options
   */
  constructor(r2, { onPreview, onCopyUrl, onDownload, onLoadMore, onClose }) {
    this.#r2 = r2
    this.#images = new ImageAssetService(r2)
    this.#onPreview = onPreview
    this.#onCopyUrl = onCopyUrl
    this.#onDownload = onDownload
    this.#onMore = onLoadMore
    this.#onClose = onClose
    this.#root = /** @type {HTMLElement} */ (document.querySelector('#poster-wall'))
    this.#viewport = /** @type {HTMLElement} */ (document.querySelector('#poster-wall-viewport'))
    this.#canvas = /** @type {HTMLElement} */ (document.querySelector('#poster-wall-canvas'))
    this.#reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => {
      this.#reducedMotion = event.matches
      if (event.matches) {
        this.#cancelCameraMotion()
        this.#stopWheelZoom()
        this.#entranceActive = false
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
    this.#stopWheelZoom()
    this.#camera.x += (width - previousSize.width) / 2
    this.#camera.y += (height - previousSize.height) / 2
    this.#scheduleRender()
  }

  /** @param {ImageItem[]} items @param {boolean} hasMore */
  open(items, hasMore) {
    if (this.isOpen) {
      this.update(items, hasMore)
      return
    }
    this.#root.hidden = false
    this.#viewportSize = { width: this.#viewport.clientWidth, height: this.#viewport.clientHeight }
    for (const sibling of this.#root.parentElement?.children ?? []) {
      if (!(sibling instanceof HTMLElement) || sibling === this.#root) continue
      this.#backgroundInert.set(sibling, sibling.inert)
      sibling.inert = true
    }
    this.#items = items
    this.#hasMore = hasMore
    this.#activeInstance = null
    this.#focusedInstance = null
    this.#firstPressInstanceId = null
    this.#entranceActive = !this.#reducedMotion
    this.#closeFinder(false)
    this.#recalculate()
    this.resetCamera()
    this.#render()
    this.#entranceActive = false
    this.#viewport.focus({ preventScroll: true })
  }

  /** @param {ImageItem[]} items @param {boolean} hasMore */
  update(items, hasMore) {
    const activeKey = this.#activeInstance ? this.#items[this.#activeInstance.index]?.key : null
    const focusedKey = this.#focusedInstance ? this.#items[this.#focusedInstance.index]?.key : null
    this.#items = items
    this.#hasMore = hasMore
    if (!this.isOpen) return
    const previous = this.#getVisualRects()
    this.#recalculate()
    if (activeKey) {
      const idx = this.#items.findIndex((entry) => entry.key === activeKey)
      const prevRect = this.#activeInstance
      this.#activeInstance = idx >= 0 && prevRect
        ? locateNearestInstance(this.#geometry, this.#items.length, idx, {
            x: prevRect.x + prevRect.w / 2,
            y: prevRect.y + prevRect.h / 2,
          })
        : null
    } else {
      this.#activeInstance = null
    }
    if (focusedKey) {
      const idx = this.#items.findIndex((entry) => entry.key === focusedKey)
      const prevRect = this.#focusedInstance
      this.#focusedInstance = idx >= 0 && prevRect
        ? locateNearestInstance(this.#geometry, this.#items.length, idx, {
            x: prevRect.x + prevRect.w / 2,
            y: prevRect.y + prevRect.h / 2,
          })
        : null
    } else {
      this.#focusedInstance = null
    }
    this.#expandedRects = layoutExpandedBlock(this.#geometry, this.#items.length, this.#activeInstance)
    this.#refreshFinderMatches(false)
    this.#render(previous)
  }

  close() {
    if (!this.isOpen) return
    this.#root.hidden = true
    for (const [sibling, wasInert] of this.#backgroundInert) sibling.inert = wasInert
    this.#backgroundInert.clear()
    if (this.#renderFrame) cancelAnimationFrame(this.#renderFrame)
    this.#renderFrame = 0
    window.clearTimeout(this.#qualityTimer)
    this.#qualityTimer = 0
    this.#lastQualityScale = 0
    this.#cancelCameraMotion()
    this.#stopWheelZoom()
    this.#pointers.clear()
    this.#gestureUsedPinch = false
    this.#pointerTile = null
    this.#firstPressInstanceId = null
    this.#dragged = false
    this.#viewport.classList.remove('is-dragging')
    this.#activeInstance = null
    this.#focusedInstance = null
    this.#expandedRects.clear()
    this.#visibleInstances.clear()
    this.#pinchDistance = 0
    this.#entranceActive = false
    this.#closeFinder(false)
    this.#cancelAllImages()
    this.#nodes.clear()
    this.#canvas.replaceChildren()
    this.#root.classList.remove('has-active')
    this.#onClose()
  }

  refreshLabels() {
    this.#root.setAttribute('aria-label', t('viewWall'))
    this.#viewport.setAttribute('aria-label', t('wallHelp'))
    document.querySelector('#wall-eyebrow').textContent = t('wallEyebrow')
    document.querySelector('#wall-title').textContent = t('wallTitle')
    document.querySelector('#wall-help').textContent = t('wallHelp')
    document.querySelector('#wall-empty-title').textContent = t('wallEmptyTitle')
    document.querySelector('#wall-empty-hint').textContent = t('wallEmptyHint')
    document.querySelector('#wall-preview').textContent = t('wallOriginalPreview')
    document.querySelector('#wall-copy-url').textContent = t('wallCopyUrl')
    document.querySelector('#wall-download').textContent = t('wallDownload')
    document.querySelector('#wall-collapse').textContent = t('wallCollapse')
    document.querySelector('#wall-load-more').textContent = t('wallLoadMore')
    const searchInput = /** @type {HTMLInputElement|null} */ (document.querySelector('#wall-search-input'))
    if (searchInput) {
      searchInput.placeholder = t('wallSearchPlaceholder')
      searchInput.setAttribute('aria-label', t('wallSearch'))
    }
    for (const [id, key] of [
      ['wall-close', 'wallExit'],
      ['wall-search-toggle', 'wallSearch'],
      ['wall-search-prev', 'wallPrev'],
      ['wall-search-next', 'wallNext'],
      ['wall-prev', 'wallPrev'],
      ['wall-next', 'wallNext'],
      ['wall-zoom-in', 'wallZoomIn'],
      ['wall-zoom-out', 'wallZoomOut'],
      ['wall-reset', 'wallReset'],
    ]) {
      const button = /** @type {HTMLElement|null} */ (document.querySelector('#' + id))
      if (!button) continue
      button.setAttribute('aria-label', t(/** @type {any} */ (key)))
      button.setAttribute('title', t(/** @type {any} */ (key)))
    }
    this.#updateHud()
  }

  #recalculate() {
    this.#geometry = getLatticeGeometry(this.#items.length, { cell: LATTICE_CELL, gap: LATTICE_GAP })
    this.#layout = this.#items.length
      ? Array.from({ length: Math.min(this.#items.length, 12) }, (_, index) =>
          locateNearestInstance(this.#geometry, this.#items.length, index, { x: 0, y: 0 }),
        ).filter(Boolean)
      : []
    this.#expandedRects = layoutExpandedBlock(this.#geometry, this.#items.length, this.#activeInstance)
  }

  /** @param {boolean} [animated] */
  resetCamera(animated = false) {
    const width = this.#viewport.clientWidth || window.innerWidth
    const height = this.#viewport.clientHeight || window.innerHeight
    const defaultScale = width < 640 ? 0.54 : width < 1100 ? 0.66 : 0.76
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

  #stopWheelZoom() {
    if (this.#wheelFrame) cancelAnimationFrame(this.#wheelFrame)
    this.#wheelFrame = 0
    this.#wheelZoom = null
  }

  /**
   * Short interruptible UI-camera motion. Real pointer movements cancel it.
   * @param {{x:number,y:number,scale:number}} target
   * @param {number} duration
   */
  #animateCamera(target, duration) {
    this.#cancelCameraMotion()
    this.#stopWheelZoom()
    if (this.#reducedMotion) {
      this.#camera = target
      this.#scheduleRender()
      return
    }
    const from = { ...this.#camera }
    const started = performance.now()
    /** @param {number} now */
    const tick = (now) => {
      const progress = Math.min(1, (now - started) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      this.#camera = {
        x: from.x + (target.x - from.x) * eased,
        y: from.y + (target.y - from.y) * eased,
        scale: from.scale + (target.scale - from.scale) * eased,
      }
      this.#scheduleRender()
      this.#cameraFrame = progress < 1 ? requestAnimationFrame(tick) : 0
    }
    this.#cameraFrame = requestAnimationFrame(tick)
  }

  /**
   * Smooth exponential coasting after pointer release, matching folia-major inertia.
   * @param {number} vx
   * @param {number} vy
   */
  #animateInertia(vx, vy) {
    this.#cancelCameraMotion()
    this.#stopWheelZoom()
    if (this.#reducedMotion) return
    const rawSpeed = Math.hypot(vx, vy)
    if (rawSpeed < INERTIA.minSpeed) return
    const speed = Math.min(rawSpeed, INERTIA.maxSpeed)
    const ux = vx / rawSpeed
    const uy = vy / rawSpeed
    const totalDistance = speed * INERTIA.power
    const fromX = this.#camera.x
    const fromY = this.#camera.y
    const started = performance.now()
    /** @param {number} now */
    const tick = (now) => {
      const elapsed = now - started
      const decay = Math.exp(-elapsed / INERTIA.timeConstant)
      const moved = totalDistance * (1 - decay)
      this.#camera.x = fromX + ux * moved
      this.#camera.y = fromY + uy * moved
      this.#scheduleRender()
      if (totalDistance * decay > INERTIA.restDelta) {
        this.#cameraFrame = requestAnimationFrame(tick)
      } else {
        this.#camera.x = fromX + ux * totalDistance
        this.#camera.y = fromY + uy * totalDistance
        this.#cameraFrame = 0
        this.#scheduleRender()
      }
    }
    this.#cameraFrame = requestAnimationFrame(tick)
  }

  /** @param {{x:number,y:number,w:number,h:number}} rect @param {boolean} [center] */
  #panRectIntoView(rect, center = false) {
    const vw = this.#viewport.clientWidth
    const vh = this.#viewport.clientHeight
    if (!vw || !vh) return
    const { x, y, scale } = this.#camera
    if (center) {
      this.#animateCamera({
        x: vw / 2 - (rect.x + rect.w / 2) * scale,
        y: vh / 2 - (rect.y + rect.h / 2) * scale,
        scale,
      }, 320)
      return
    }
    const padX = Math.min(56, vw * 0.08)
    const padTop = 76
    const padBottom = 88
    const left = x + rect.x * scale
    const right = x + (rect.x + rect.w) * scale
    const top = y + rect.y * scale
    const bottom = y + (rect.y + rect.h) * scale
    let dx = 0
    let dy = 0
    if (right - left > vw - padX * 2) {
      dx = vw / 2 - (left + right) / 2
    } else if (left < padX) {
      dx = padX - left
    } else if (right > vw - padX) {
      dx = (vw - padX) - right
    }
    if (bottom - top > vh - padTop - padBottom) {
      dy = (vh - padTop - padBottom) / 2 + padTop - (top + bottom) / 2
    } else if (top < padTop) {
      dy = padTop - top
    } else if (bottom > vh - padBottom) {
      dy = (vh - padBottom) - bottom
    }
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      this.#animateCamera({ x: x + dx, y: y + dy, scale }, 320)
    }
  }

  #scheduleRender() {
    if (!this.isOpen || this.#renderFrame) return
    this.#renderFrame = requestAnimationFrame(() => {
      this.#renderFrame = 0
      this.#render()
    })
  }

  #getVisualRects() {
    return new Map([...this.#nodes].map(([key, node]) => [key, node.getBoundingClientRect()]))
  }

  /** @param {Map<string,DOMRect>} [previous] @param {boolean} [revealActions] */
  #render(previous, revealActions = false) {
    if (!this.isOpen) return
    const { x, y, scale } = this.#camera
    this.#canvas.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`
    const zoomLevel = scale < 0.58 ? 'overview' : scale > 1.45 ? 'detail' : 'normal'
    if (this.#root.dataset.zoomLevel !== zoomLevel) this.#root.dataset.zoomLevel = zoomLevel
    const bounds = cameraBounds(this.#camera, this.#viewport.clientWidth, this.#viewport.clientHeight)
    const instances = layoutLattice(this.#geometry, this.#items.length, bounds, 0)
    this.#visibleInstances = new Map(instances.map((inst) => [inst.instanceId, inst]))
    if (this.#activeInstance && !this.#visibleInstances.has(this.#activeInstance.instanceId)) {
      this.#visibleInstances.set(this.#activeInstance.instanceId, this.#activeInstance)
    }

    const visible = new Set()
    const baseCol = Math.floor(bounds.x / (LATTICE_CELL + LATTICE_GAP))
    const baseRow = Math.floor(bounds.y / (LATTICE_CELL + LATTICE_GAP))

    for (const instance of this.#visibleInstances.values()) {
      const rect = this.#expandedRects.get(instance.instanceId) ?? instance
      if (!intersects(rect, bounds) && instance.instanceId !== this.#activeInstance?.instanceId) continue
      visible.add(instance.instanceId)
      let node = this.#nodes.get(instance.instanceId)
      if (!node) {
        node = this.#createTile(instance)
        if (this.#entranceActive) {
          const col = Math.floor(instance.x / (LATTICE_CELL + LATTICE_GAP)) - baseCol
          const row = Math.floor(instance.y / (LATTICE_CELL + LATTICE_GAP)) - baseRow
          const delay = Math.min(ENTRANCE_MAX_DELAY_S, Math.max(0, (col + row) * 0.5 * ENTRANCE_STAGGER_S))
          node.classList.add('is-entering')
          node.style.setProperty('--wall-enter-delay', `${Math.round(delay * 1000)}ms`)
        }
        this.#nodes.set(instance.instanceId, node)
        this.#canvas.append(node)
        this.#enqueueImage({ ...rect, key: instance.instanceId, index: instance.index }, node)
      }
      if (previous?.has(instance.instanceId)) node.getAnimations().forEach((animation) => animation.cancel())
      const layoutId = `${rect.x},${rect.y},${rect.w},${rect.h}`
      if (node.dataset.layoutRect !== layoutId) {
        node.dataset.layoutRect = layoutId
        node.style.left = `${rect.x}px`
        node.style.top = `${rect.y}px`
        node.style.width = `${rect.w}px`
        node.style.height = `${rect.h}px`
      }
      const active = instance.instanceId === this.#activeInstance?.instanceId
      const focused = instance.instanceId === this.#focusedInstance?.instanceId
      if (node.classList.contains('is-active') !== active) {
        node.classList.toggle('is-active', active)
        node.setAttribute('aria-pressed', String(active))
        node.style.zIndex = active ? '5' : focused ? '3' : '1'
      } else if (focused && node.style.zIndex !== '3' && !active) {
        node.style.zIndex = '3'
      }
      node.classList.toggle('is-focused', focused)
    }

    // Virtualization: preserve only visible, overscanned, focused or expanded tiles.
    for (const [key, node] of this.#nodes) {
      if (
        visible.has(key) ||
        key === this.#activeInstance?.instanceId ||
        key === this.#focusedInstance?.instanceId ||
        node === document.activeElement
      ) continue
      this.#discardImage(key)
      node.remove()
      this.#nodes.delete(key)
    }

    if (previous && !this.#reducedMotion) {
      for (const [instanceId, node] of this.#nodes) {
        const from = previous.get(instanceId)
        if (!from || !visible.has(instanceId)) continue
        const to = node.getBoundingClientRect()
        const dx = (from.left - to.left) / scale
        const dy = (from.top - to.top) / scale
        const sx = to.width ? from.width / to.width : 1
        const sy = to.height ? from.height / to.height : 1
        if (Math.abs(dx) + Math.abs(dy) < 0.5 && Math.abs(sx - 1) + Math.abs(sy - 1) < 0.01) continue
        this.#spring(node, dx, dy, sx, sy)
      }
    }

    this.#imageQueue = this.#imageQueue.filter((task) => !task.stopped)
    this.#imageQueue.sort((a, b) => this.#imagePriority(a.instanceId) - this.#imagePriority(b.instanceId))
    this.#pumpImages()
    if (Math.abs(this.#lastQualityScale - scale) >= 0.025) {
      this.#lastQualityScale = scale
      this.#scheduleQualityCheck()
    }

    this.#root.classList.toggle('has-active', Boolean(this.#activeInstance))
    const focusActions = /** @type {HTMLElement} */ (document.querySelector('#wall-focus-actions'))
    const emptyState = /** @type {HTMLElement} */ (document.querySelector('#wall-empty'))
    const moreControl = /** @type {HTMLElement} */ (document.querySelector('#wall-more'))
    if (this.#activeInstance) {
      focusActions.hidden = false
      if (revealActions && !this.#reducedMotion) {
        focusActions.classList.remove('is-revealing')
        void focusActions.offsetWidth
        focusActions.classList.add('is-revealing')
      }
      if (!this.#positionFocusActions(focusActions)) focusActions.hidden = true
    } else {
      focusActions.hidden = true
      focusActions.classList.remove('is-revealing')
    }
    emptyState.hidden = this.#items.length > 0
    moreControl.hidden = !this.#hasMore
    this.#updateHud()
  }

  /**
   * Keep contextual actions near the selected image, clamped to the viewport.
   * Their location is computed from world coordinates, not layout reads.
   * @param {HTMLElement} actions
   * @returns {boolean} Whether the selected tile is still onscreen.
   */
  #positionFocusActions(actions) {
    const active = this.#activeInstance
    const rect = active ? (this.#expandedRects.get(active.instanceId) ?? active) : null
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
    const width = actions.offsetWidth || 320
    const left = Math.max(14, Math.min(projectedRight - width, viewportWidth - width - 14))
    const top = Math.max(79, Math.min(projectedBottom + 10, viewportHeight - 76))
    actions.style.left = `${left}px`
    actions.style.top = `${top}px`
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
      const progressNorm = step / 20
      const progress = step === 20
        ? 1
        : 1 - Math.exp(-9 * progressNorm) * (Math.cos(6.2 * progressNorm) + 0.32 * Math.sin(6.2 * progressNorm))
      const left = 1 - progress
      frames.push({
        offset: progressNorm,
        transform: `translate3d(${dx * left}px, ${dy * left}px, 0) scale(${1 + (sx - 1) * left}, ${1 + (sy - 1) * left})`,
      })
    }
    node.animate(frames, { duration: 480, easing: 'linear', fill: 'none' })
  }

  /** @param {LatticeInstance} instance */
  #createTile(instance) {
    const item = this.#items[instance.index]
    const fileName = extractFileName(item.key)
    const ext = fileName.includes('.') ? fileName.split('.').pop().toUpperCase() : 'IMAGE'
    const folder = item.key.split('/').slice(0, -1).filter(Boolean).at(-1)
    const metaParts = [folder || 'R2', item.size ? formatBytes(item.size) : null, ext].filter(Boolean)

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'poster-tile'
    button.classList.toggle('is-compact', instance.w < 330 || instance.h < 330)
    button.dataset.key = item.key
    button.dataset.instanceId = instance.instanceId
    button.dataset.index = String(instance.index)
    button.setAttribute('aria-pressed', 'false')
    button.setAttribute('aria-label', t('wallOpenTile') + ': ' + fileName)

    const media = document.createElement('span')
    media.className = 'poster-tile-media'
    const img = document.createElement('img')
    img.alt = ''
    img.loading = 'eager'
    img.decoding = 'async'
    img.draggable = false
    media.append(img)

    const badge = document.createElement('span')
    badge.className = 'poster-tile-badge'
    badge.textContent = String(instance.index + 1).padStart(2, '0')

    const shade = document.createElement('span')
    shade.className = 'poster-tile-shade'
    const copy = document.createElement('span')
    copy.className = 'poster-tile-copy'
    const kicker = document.createElement('span')
    kicker.className = 'poster-tile-kicker'
    kicker.textContent = metaParts.join(' · ')
    const title = document.createElement('span')
    title.className = 'poster-tile-title'
    title.textContent = fileName.replace(/\.[^.]+$/, '')
    copy.append(kicker, title)
    button.append(media, badge, shade, copy)

    button.addEventListener('click', (event) => {
      if (event.detail === 0) this.#toggle(instance.instanceId)
    })
    button.addEventListener('dblclick', () => {
      if (this.#firstPressInstanceId !== instance.instanceId) return
      const target = this.#items[instance.index]
      if (target) this.#onPreview(target)
    })
    return button
  }

  /** @param {string} instanceId */
  #toggle(instanceId) {
    if (!this.isOpen) return
    const instance = this.#visibleInstances.get(instanceId) ??
      (this.#activeInstance?.instanceId === instanceId ? this.#activeInstance : null)
    if (!instance) return
    const previous = this.#getVisualRects()
    const opening = this.#activeInstance?.instanceId !== instanceId
    this.#activeInstance = opening ? instance : null
    this.#focusedInstance = instance
    this.#expandedRects = layoutExpandedBlock(this.#geometry, this.#items.length, this.#activeInstance)
    this.#render(previous, opening)
    if (opening) {
      const targetRect = this.#expandedRects.get(instanceId) ?? instance
      this.#panRectIntoView(targetRect)
      this.#upgradeVisibleImages()
    }
  }

  /** @param {number} delta */
  #stepByIndex(delta) {
    if (!this.#items.length) return
    const baseIdx = this.#activeInstance?.index ?? this.#focusedInstance?.index ?? 0
    const nextIdx = (baseIdx + delta + this.#items.length) % this.#items.length
    const center = {
      x: (this.#viewport.clientWidth / 2 - this.#camera.x) / this.#camera.scale,
      y: (this.#viewport.clientHeight / 2 - this.#camera.y) / this.#camera.scale,
    }
    const nextInstance = locateNearestInstance(this.#geometry, this.#items.length, nextIdx, center)
    if (!nextInstance) return
    this.#focusAndExpand(nextInstance, true)
  }

  /** @param {LatticeInstance} instance @param {boolean} [center] */
  #focusAndExpand(instance, center = true) {
    const previous = this.#getVisualRects()
    this.#activeInstance = instance
    this.#focusedInstance = instance
    this.#expandedRects = layoutExpandedBlock(this.#geometry, this.#items.length, instance)
    const targetRect = this.#expandedRects.get(instance.instanceId) ?? instance
    this.#render(previous, true)
    this.#panRectIntoView(targetRect, center)
    const node = this.#nodes.get(instance.instanceId)
    node?.focus({ preventScroll: true })
    this.#upgradeVisibleImages()
  }

  #updateHud() {
    const count = document.querySelector('#wall-count')
    const zoom = document.querySelector('#wall-zoom-value')
    if (count) {
      const base = t('wallCount', { count: this.#items.length })
      count.textContent = this.#activeInstance
        ? `${this.#activeInstance.index + 1} / ${this.#items.length} · ${base}`
        : base
    }
    if (zoom) zoom.textContent = Math.round(this.#camera.scale * 100) + '%'
  }

  /** @param {string} key */
  #imagePriority(key) {
    const tile = this.#expandedRects.get(key) ?? this.#visibleInstances.get(key)
    if (!tile) return Number.POSITIVE_INFINITY
    const { x, y, scale } = this.#camera
    const centerX = (this.#viewport.clientWidth / 2 - x) / scale
    const centerY = (this.#viewport.clientHeight / 2 - y) / scale
    const distance = Math.hypot(tile.x + tile.w / 2 - centerX, tile.y + tile.h / 2 - centerY)
    const onscreen = intersects(tile, cameraBounds(this.#camera, this.#viewport.clientWidth,
      this.#viewport.clientHeight, 0))
    return distance + (onscreen ? 0 : 100000)
  }

  /** @param {{key:string,index:number,w:number}} tile @param {HTMLButtonElement} node */
  #enqueueImage(tile, node) {
    const item = this.#items[tile.index]
    if (!item) return
    const currentWidth = Number(node.dataset.wallImageWidth || 0)
    const requestedWidth = selectThumbnailWidth(Math.min(640, tile.w * this.#camera.scale),
      window.devicePixelRatio || 1)
    if (currentWidth >= requestedWidth || this.#imageTasks.has(tile.key)) return
    if (Number(node.dataset.wallFailedWidth || 0) === requestedWidth) return
    const task = /** @type {ImageTask} */ ({
      key: item.key,
      instanceId: tile.key,
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
    this.#qualityTimer = window.setTimeout(() => {
      this.#qualityTimer = 0
      this.#upgradeVisibleImages()
    }, 230)
  }

  #upgradeVisibleImages() {
    if (!this.isOpen) return
    const visibleBounds = cameraBounds(this.#camera,
      this.#viewport.clientWidth, this.#viewport.clientHeight, 0)
    for (const [instanceId, node] of this.#nodes) {
      const instance = this.#visibleInstances.get(instanceId)
      const rect = this.#expandedRects.get(instanceId) ?? instance
      if (!instance || !rect || !intersects(rect, visibleBounds)) continue
      if (!node.classList.contains('is-loaded')) continue
      this.#enqueueImage({ ...rect, key: instanceId, index: instance.index }, node)
    }
    this.#imageQueue.sort((a, b) => this.#imagePriority(a.instanceId) - this.#imagePriority(b.instanceId))
    this.#pumpImages()
  }

  #pumpImages() {
    while (this.#activeImageLoads < this.#maxImageLoads && this.#imageQueue.length > 0) {
      const task = this.#imageQueue.shift()
      if (!task || task.stopped || this.#imageTasks.get(task.instanceId) !== task) continue
      this.#activeImageLoads++
      task.active = true
      void this.#loadImage(task).finally(() => {
        this.#activeImageLoads--
        if (this.#imageTasks.get(task.instanceId) === task) this.#imageTasks.delete(task.instanceId)
        if (!task.stopped && task.node.classList.contains('is-loaded')) {
          const instance = this.#visibleInstances.get(task.instanceId)
          const rect = (instance && (this.#expandedRects.get(task.instanceId) ?? instance))
          const desired = rect ? selectThumbnailWidth(Math.min(640, rect.w * this.#camera.scale),
            window.devicePixelRatio || 1) : 0
          if (desired > Number(task.node.dataset.wallImageWidth || 0)) this.#scheduleQualityCheck()
        }
        this.#pumpImages()
      })
    }
  }

  /** @param {ImageTask} task */
  async #loadImage(task) {
    const live = () => !task.stopped && this.isOpen && this.#nodes.get(task.instanceId) === task.node
    if (!live()) return
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
      img.onload = () => settle(true)
      img.onerror = () => settle(false)
      img.src = url
    })
  }

  /** @param {string} instanceId */
  #discardImage(instanceId) {
    const task = this.#imageTasks.get(instanceId)
    if (!task) return
    task.stopped = true
    task.cancel()
    this.#imageTasks.delete(instanceId)
  }

  #cancelAllImages() {
    for (const instanceId of this.#imageTasks.keys()) this.#discardImage(instanceId)
    this.#imageQueue = []
  }

  /** @param {boolean} [open] */
  #toggleFinder(open) {
    const finder = /** @type {HTMLElement|null} */ (document.querySelector('#wall-finder'))
    const toggle = /** @type {HTMLButtonElement|null} */ (document.querySelector('#wall-search-toggle'))
    const input = /** @type {HTMLInputElement|null} */ (document.querySelector('#wall-search-input'))
    if (!finder || !toggle || !input) return
    const next = open ?? finder.hidden
    finder.hidden = !next
    toggle.setAttribute('aria-expanded', String(next))
    if (next) {
      input.focus({ preventScroll: true })
      input.select()
      this.#refreshFinderMatches(false)
    }
  }

  /** @param {boolean} [restoreFocus] */
  #closeFinder(restoreFocus = true) {
    const finder = /** @type {HTMLElement|null} */ (document.querySelector('#wall-finder'))
    const toggle = /** @type {HTMLButtonElement|null} */ (document.querySelector('#wall-search-toggle'))
    const input = /** @type {HTMLInputElement|null} */ (document.querySelector('#wall-search-input'))
    const count = document.querySelector('#wall-search-count')
    if (finder) finder.hidden = true
    if (toggle) toggle.setAttribute('aria-expanded', 'false')
    if (input) input.value = ''
    if (count) count.textContent = ''
    this.#searchMatches = []
    this.#searchMatchCursor = 0
    if (restoreFocus && this.isOpen) this.#viewport.focus({ preventScroll: true })
  }

  /** @param {boolean} [jump] */
  #refreshFinderMatches(jump = true) {
    const input = /** @type {HTMLInputElement|null} */ (document.querySelector('#wall-search-input'))
    const count = document.querySelector('#wall-search-count')
    if (!input || !count) return
    const query = input.value.trim().toLowerCase()
    if (!query) {
      this.#searchMatches = []
      this.#searchMatchCursor = 0
      count.textContent = ''
      return
    }
    this.#searchMatches = []
    this.#items.forEach((item, index) => {
      if (item.key.toLowerCase().includes(query)) this.#searchMatches.push(index)
    })
    this.#searchMatchCursor = 0
    if (!this.#searchMatches.length) {
      count.textContent = t('wallSearchEmpty')
      return
    }
    count.textContent = `1 / ${this.#searchMatches.length}`
    if (jump) this.#jumpToFinderMatch(0)
  }

  /** @param {number} step */
  #jumpToFinderMatch(step) {
    if (!this.#searchMatches.length) return
    this.#searchMatchCursor = (this.#searchMatchCursor + step + this.#searchMatches.length) % this.#searchMatches.length
    const count = document.querySelector('#wall-search-count')
    if (count) count.textContent = `${this.#searchMatchCursor + 1} / ${this.#searchMatches.length}`
    const targetIdx = this.#searchMatches[this.#searchMatchCursor]
    const center = {
      x: (this.#viewport.clientWidth / 2 - this.#camera.x) / this.#camera.scale,
      y: (this.#viewport.clientHeight / 2 - this.#camera.y) / this.#camera.scale,
    }
    const inst = locateNearestInstance(this.#geometry, this.#items.length, targetIdx, center)
    if (inst) this.#focusAndExpand(inst, true)
  }

  #bindEvents() {
    this.#viewport.addEventListener('pointerdown', (event) => this.#pointerDown(event))
    this.#viewport.addEventListener('pointermove', (event) => this.#pointerMove(event))
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.#viewport.addEventListener(type, (event) => this.#pointerUp(/** @type {PointerEvent} */ (event)))
    }
    this.#viewport.addEventListener('wheel', (event) => {
      event.preventDefault()
      this.#cancelCameraMotion()
      const rect = this.#viewport.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      if (event.shiftKey && !event.ctrlKey) {
        this.#stopWheelZoom()
        this.#camera.x -= event.deltaY
        this.#camera.y -= event.deltaX
        this.#scheduleRender()
        return
      }
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.35 && !event.ctrlKey) {
        this.#stopWheelZoom()
        this.#camera.x -= event.deltaX
        this.#camera.y -= event.deltaY
        this.#scheduleRender()
        return
      }
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.0024 : 0.00135))
      if (this.#reducedMotion) {
        this.zoom(factor, x, y)
        return
      }
      const currentTarget = this.#wheelZoom?.targetScale ?? this.#camera.scale
      this.#wheelZoom = {
        targetScale: Math.min(WALL_MAX_SCALE, Math.max(WALL_MIN_SCALE, currentTarget * factor)),
        x,
        y,
        lastTime: this.#wheelZoom?.lastTime ?? null,
      }
      if (!this.#wheelFrame) {
        const tick = (now) => {
          const wz = this.#wheelZoom
          if (!wz || !this.isOpen) { this.#wheelFrame = 0; return }
          const dt = wz.lastTime === null ? 16 : Math.min(50, Math.max(0, now - wz.lastTime))
          wz.lastTime = now
          const alpha = 1 - Math.exp(-dt / 75)
          const nextScale = this.#camera.scale + (wz.targetScale - this.#camera.scale) * alpha
          if (Math.abs(wz.targetScale - nextScale) < 0.0015) {
            this.#camera = zoomAt(this.#camera, wz.x, wz.y, wz.targetScale)
            this.#wheelFrame = 0
            this.#wheelZoom = null
            this.#scheduleRender()
            return
          }
          this.#camera = zoomAt(this.#camera, wz.x, wz.y, nextScale)
          this.#scheduleRender()
          this.#wheelFrame = requestAnimationFrame(tick)
        }
        this.#wheelFrame = requestAnimationFrame(tick)
      }
    }, { passive: false })

    this.#root.addEventListener('keydown', (event) => this.#keyDown(event))
    const onClick = (id, cb) => document.querySelector('#' + id)?.addEventListener('click', cb)
    onClick('wall-close', () => this.close())
    onClick('wall-zoom-in', () => this.zoom(1.23, undefined, undefined, true))
    onClick('wall-zoom-out', () => this.zoom(1 / 1.23, undefined, undefined, true))
    onClick('wall-reset', () => this.resetCamera(true))
    onClick('wall-prev', () => this.#stepByIndex(-1))
    onClick('wall-next', () => this.#stepByIndex(1))
    onClick('wall-collapse', () => {
      if (this.#activeInstance) this.#toggle(this.#activeInstance.instanceId)
      this.#viewport.focus({ preventScroll: true })
    })
    onClick('wall-preview', () => {
      const item = this.#activeInstance ? this.#items[this.#activeInstance.index] : null
      if (item) this.#onPreview(item)
    })
    onClick('wall-copy-url', () => {
      const item = this.#activeInstance ? this.#items[this.#activeInstance.index] : null
      if (item && this.#onCopyUrl) this.#onCopyUrl(item)
    })
    onClick('wall-download', () => {
      const item = this.#activeInstance ? this.#items[this.#activeInstance.index] : null
      if (item && this.#onDownload) this.#onDownload(item)
    })
    onClick('wall-search-toggle', () => this.#toggleFinder())
    onClick('wall-search-prev', () => this.#jumpToFinderMatch(-1))
    onClick('wall-search-next', () => this.#jumpToFinderMatch(1))
    const searchInput = /** @type {HTMLInputElement|null} */ (document.querySelector('#wall-search-input'))
    searchInput?.addEventListener('input', () => this.#refreshFinderMatches(true))
    searchInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        this.#jumpToFinderMatch(event.shiftKey ? -1 : 1)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        this.#closeFinder(true)
      }
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
    this.#stopWheelZoom()
    this.#viewport.setPointerCapture(event.pointerId)
    this.#pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      originX: event.clientX,
      originY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      vx: 0,
      vy: 0,
    })
    if (this.#pointers.size === 1) {
      this.#dragged = false
      this.#gestureUsedPinch = false
    }
    const tile = event.target instanceof Element ? event.target.closest('.poster-tile') : null
    const instanceId = tile instanceof HTMLElement ? (tile.dataset.instanceId ?? null) : null
    this.#pointerTile = this.#pointers.size === 1 ? instanceId : null
    if (this.#pointers.size === 1 && event.detail === 1) {
      this.#firstPressInstanceId = instanceId
    }
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
    const dt = event.timeStamp - pointer.lastTime
    if (dt > 0) {
      pointer.vx = ((event.clientX - pointer.lastX) / dt) * 1000
      pointer.vy = ((event.clientY - pointer.lastY) / dt) * 1000
    }
    pointer.lastX = event.clientX
    pointer.lastY = event.clientY
    pointer.lastTime = event.timeStamp
    pointer.x = event.clientX
    pointer.y = event.clientY
    const totalX = pointer.x - pointer.originX
    const totalY = pointer.y - pointer.originY
    if (this.#pointers.size === 1 && !this.#dragged) {
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
    const shouldCoast = event.type === 'pointerup' &&
      this.#dragged &&
      !this.#gestureUsedPinch &&
      this.#pointers.size === 1 &&
      (event.timeStamp - pointer.lastTime) <= INERTIA.staleReleaseMs
    const vx = pointer.vx
    const vy = pointer.vy
    this.#pointers.delete(event.pointerId)
    if (this.#pointers.size < 2) {
      this.#pinchDistance = 0
      for (const remaining of this.#pointers.values()) {
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
    else if (shouldCoast) {
      this.#animateInertia(vx, vy)
    }
  }

  /** @param {KeyboardEvent} event */
  #keyDown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      this.#toggleFinder(true)
      return
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.target instanceof Element ? event.target : null
    const inInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'
    if (inInput) return

    const arrows = /** @type {Record<string, 'left'|'right'|'up'|'down'>} */ ({
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
    })
    let used = true
    if (event.key === 'Escape') {
      const finder = document.querySelector('#wall-finder')
      if (finder && !finder.hidden) this.#closeFinder(true)
      else if (this.#activeInstance) this.#toggle(this.#activeInstance.instanceId)
      else if (this.#focusedInstance) {
        this.#focusedInstance = null
        this.#scheduleRender()
      } else this.close()
    } else if (event.key === '/') {
      this.#toggleFinder(true)
    } else if (arrows[event.key]) {
      if (event.shiftKey) {
        const step = 170
        if (event.key === 'ArrowLeft') this.#camera.x += step
        else if (event.key === 'ArrowRight') this.#camera.x -= step
        else if (event.key === 'ArrowUp') this.#camera.y += step
        else if (event.key === 'ArrowDown') this.#camera.y -= step
        this.#scheduleRender()
      } else {
        this.#moveFocus(arrows[event.key])
      }
    } else if (event.key === ' ' && this.#focusedInstance && target?.tagName !== 'BUTTON') {
      this.#toggle(this.#focusedInstance.instanceId)
    } else if (event.key === 'Enter' && target?.tagName !== 'BUTTON') {
      if (this.#activeInstance) {
        const item = this.#items[this.#activeInstance.index]
        if (item) this.#onPreview(item)
      } else if (this.#focusedInstance) {
        this.#toggle(this.#focusedInstance.instanceId)
      }
    } else if (event.key === '[' || event.key === 'PageUp') {
      this.#stepByIndex(-1)
    } else if (event.key === ']' || event.key === 'PageDown') {
      this.#stepByIndex(1)
    } else if (event.key === '+' || event.key === '=') {
      this.zoom(1.23, undefined, undefined, true)
    } else if (event.key === '-') {
      this.zoom(1 / 1.23, undefined, undefined, true)
    } else if (event.key === '0' || event.key === 'Home') {
      this.resetCamera(true)
    } else {
      used = false
    }
    if (used) event.preventDefault()
  }

  /** @param {'up'|'down'|'left'|'right'} direction */
  #moveFocus(direction) {
    if (!this.#items.length) return
    const current = this.#focusedInstance ?? this.#activeInstance
    const center = {
      x: (this.#viewport.clientWidth / 2 - this.#camera.x) / this.#camera.scale,
      y: (this.#viewport.clientHeight / 2 - this.#camera.y) / this.#camera.scale,
    }
    const seed = current ?? findNearestInstance([...this.#visibleInstances.values()], center)
    if (!seed) return
    const next = current
      ? pickAdjacentInstance(
          seed,
          direction,
          locateStepCandidates(this.#geometry, this.#items.length, seed),
          this.#expandedRects,
        )
      : seed
    if (!next) return
    this.#focusedInstance = next
    const rect = this.#expandedRects.get(next.instanceId) ?? next
    this.#render()
    this.#panRectIntoView(rect)
    this.#nodes.get(next.instanceId)?.focus({ preventScroll: true })
  }
}

export { PosterWall }
