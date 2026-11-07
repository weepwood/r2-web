import { getThumbnailMode, resolveThumbnailPolicy, selectThumbnailWidth } from './thumbnail-utils.js'
import { extractFileName } from './utils.js'
import { t } from './i18n.js'
import { buildWallLayout, cameraBounds, focusReflow, intersects, zoomAt } from './poster-wall-layout.js'

/** @typedef {{key:string,size?:number,lastModified?:number|string}} ImageItem */
/** @typedef {{key:string,node:HTMLButtonElement,img:HTMLImageElement,cancel:()=>void,active:boolean,stopped:boolean}} ImageTask */

class PosterWall {
  /** @type {import('./r2-client.js').R2Client} */
  #r2
  /** @type {(item:ImageItem)=>void} */
  #onPreview
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
  /** @type {ReturnType<typeof buildWallLayout>} */
  #layout = []
  /** @type {ReturnType<typeof focusReflow>} */
  #positions = new Map()
  /** @type {Map<string,HTMLButtonElement>} */
  #nodes = new Map()
  /** @type {Map<string,ImageTask>} */
  #imageTasks = new Map()
  /** @type {ImageTask[]} */
  #imageQueue = []
  #activeImageLoads = 0
  #maxImageLoads = 4
  #camera = { x: 40, y: 80, scale: 0.76 }
  /** @type {string|null} */
  #activeKey = null
  #hasMore = false
  #renderFrame = 0
  #reducedMotion = false
  #pinchDistance = 0
  #lastPinchCenter = { x: 0, y: 0 }
  /** @type {Map<number,{x:number,y:number,originX:number,originY:number}>} */
  #pointers = new Map()
  /** @type {string|null} */
  #pointerTile = null
  #dragged = false
  #columnCount = 3

  /**
   * @param {import('./r2-client.js').R2Client} r2
   * @param {{onPreview:(item:ImageItem)=>void,onLoadMore:()=>Promise<void>|void,onClose:()=>void}} options
   */
  constructor(r2, { onPreview, onLoadMore, onClose }) {
    this.#r2 = r2
    this.#onPreview = onPreview
    this.#onMore = onLoadMore
    this.#onClose = onClose
    this.#root = /** @type {HTMLElement} */ (document.querySelector('#poster-wall'))
    this.#viewport = /** @type {HTMLElement} */ (document.querySelector('#poster-wall-viewport'))
    this.#canvas = /** @type {HTMLElement} */ (document.querySelector('#poster-wall-canvas'))
    this.#reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => {
      this.#reducedMotion = event.matches
    })
    this.#bindEvents()
    new ResizeObserver(() => {
      if (!this.isOpen) return
      const nextColumns = this.#viewport.clientWidth < 760 ? 2 : 3
      if (nextColumns !== this.#columnCount) {
        this.#columnCount = nextColumns
        this.#recalculate()
      }
      this.#scheduleRender()
    }).observe(this.#viewport)
  }

  get isOpen() {
    return !this.#root.hidden
  }

  /** @param {ImageItem[]} items @param {boolean} hasMore */
  open(items, hasMore) {
    if (this.isOpen) {
      this.update(items, hasMore)
      return
    }
    this.#root.hidden = false
    this.#columnCount = this.#viewport.clientWidth < 760 ? 2 : 3
    this.#items = items
    this.#hasMore = hasMore
    this.#activeKey = null
    this.#recalculate()
    this.resetCamera()
    this.#render()
    this.#viewport.focus({ preventScroll: true })
  }

  /** @param {ImageItem[]} items @param {boolean} hasMore */
  update(items, hasMore) {
    this.#items = items
    this.#hasMore = hasMore
    if (!this.isOpen) return
    const previous = this.#getVisualRects()
    this.#recalculate()
    if (this.#activeKey && !this.#positions.has(this.#activeKey)) this.#activeKey = null
    this.#positions = focusReflow(this.#layout, this.#activeKey)
    this.#render(previous)
  }

  close() {
    if (!this.isOpen) return
    this.#root.hidden = true
    if (this.#renderFrame) cancelAnimationFrame(this.#renderFrame)
    this.#renderFrame = 0
    this.#pointers.clear()
    this.#activeKey = null
    this.#pinchDistance = 0
    this.#cancelAllImages()
    this.#nodes.clear()
    this.#canvas.replaceChildren()
    this.#root.classList.remove('has-active')
    this.#onClose()
  }

  refreshLabels() {
    document.querySelector('#wall-eyebrow').textContent = t('wallEyebrow')
    document.querySelector('#wall-title').textContent = t('wallTitle')
    document.querySelector('#wall-help').textContent = t('wallHelp')
    document.querySelector('#wall-empty-title').textContent = t('wallEmptyTitle')
    document.querySelector('#wall-empty-hint').textContent = t('wallEmptyHint')
    document.querySelector('#wall-preview').textContent = t('wallOriginalPreview')
    document.querySelector('#wall-collapse').textContent = t('wallCollapse')
    document.querySelector('#wall-load-more').textContent = t('wallLoadMore')
    for (const [id, key] of [
      ['wall-close', 'wallExit'],
      ['wall-zoom-in', 'wallZoomIn'],
      ['wall-zoom-out', 'wallZoomOut'],
      ['wall-reset', 'wallReset'],
    ]) {
      const button = /** @type {HTMLElement} */ (document.querySelector('#' + id))
      button.setAttribute('aria-label', t(/** @type {any} */ (key)))
      button.setAttribute('title', t(/** @type {any} */ (key)))
    }
    this.#updateHud()
  }

  #recalculate() {
    this.#layout = buildWallLayout(this.#items, { columns: this.#columnCount })
    this.#positions = focusReflow(this.#layout, this.#activeKey)
  }

  resetCamera() {
    const width = this.#viewport.clientWidth || window.innerWidth
    const height = this.#viewport.clientHeight || window.innerHeight
    const scale = width < 640 ? 0.54 : width < 1100 ? 0.66 : 0.76
    this.#camera = {
      x: width * 0.51 - 1080 * scale,
      y: height * 0.50 - 345 * scale,
      scale,
    }
    this.#scheduleRender()
  }

  /** @param {number} factor @param {number} [x] @param {number} [y] */
  zoom(factor, x = this.#viewport.clientWidth / 2, y = this.#viewport.clientHeight / 2) {
    this.#camera = zoomAt(this.#camera, x, y, this.#camera.scale * factor)
    this.#scheduleRender()
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

  /** @param {Map<string,DOMRect>} [previous] */
  #render(previous) {
    if (!this.isOpen) return
    const { x, y, scale } = this.#camera
    this.#canvas.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`
    const bounds = cameraBounds(this.#camera, this.#viewport.clientWidth, this.#viewport.clientHeight)
    const visible = new Set()
    for (const tile of this.#layout) {
      const rect = this.#positions.get(tile.key)
      if (!rect || !intersects(rect, bounds)) continue
      visible.add(tile.key)
      let node = this.#nodes.get(tile.key)
      if (!node) {
        node = this.#createTile(tile)
        this.#nodes.set(tile.key, node)
        this.#canvas.append(node)
        this.#enqueueImage(tile, node)
      }
      // An interrupted spring starts at the tile's current visual location.
      if (previous?.has(tile.key)) node.getAnimations().forEach((a) => a.cancel())
      node.style.left = `${rect.x}px`
      node.style.top = `${rect.y}px`
      node.style.width = `${rect.w}px`
      node.style.height = `${rect.h}px`
      const active = tile.key === this.#activeKey
      node.classList.toggle('is-active', active)
      node.setAttribute('aria-pressed', String(active))
      node.style.zIndex = active ? '5' : '1'
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

    this.#root.classList.toggle('has-active', Boolean(this.#activeKey))
    document.querySelector('#wall-focus-actions').hidden = !this.#activeKey
    document.querySelector('#wall-empty').hidden = this.#layout.length > 0
    document.querySelector('#wall-more').hidden = !this.#hasMore
    this.#updateHud()
  }

  /**
   * FLIP animation with an underdamped spring curve. New interactions sample
   * the live bounding box, cancel the old animation, and start from that point.
   * @param {HTMLElement} node
   * @param {number} dx
   * @param {number} dy
   * @param {number} sx
   * @param {number} sy
   */
  #spring(node, dx, dy, sx, sy) {
    const frames = []
    for (let step = 0; step <= 24; step++) {
      const t = step / 24
      const progress = step === 24 ? 1 : 1 - Math.exp(-7.8 * t) * (Math.cos(10.8 * t) + 0.18 * Math.sin(10.8 * t))
      const left = 1 - progress
      frames.push({
        offset: t,
        transform: `translate3d(${dx * left}px, ${dy * left}px, 0) scale(${1 + (sx - 1) * left}, ${1 + (sy - 1) * left})`,
      })
    }
    node.animate(frames, { duration: 630, easing: 'linear', fill: 'none' })
  }

  /** @param {import('./poster-wall-layout.js').WallTile} tile */
  #createTile(tile) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'poster-tile'
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
    const previous = this.#getVisualRects()
    this.#activeKey = this.#activeKey === key ? null : key
    this.#positions = focusReflow(this.#layout, this.#activeKey)
    this.#render(previous)
  }

  #updateHud() {
    const count = document.querySelector('#wall-count')
    const zoom = document.querySelector('#wall-zoom-value')
    if (count) count.textContent = t('wallCount', { count: this.#items.length })
    if (zoom) zoom.textContent = Math.round(this.#camera.scale * 100) + '%'
  }

  /** @param {import('./poster-wall-layout.js').WallTile} tile @param {HTMLButtonElement} node */
  #enqueueImage(tile, node) {
    const task = /** @type {ImageTask} */ ({
      key: tile.key,
      node,
      img: /** @type {HTMLImageElement} */ (node.querySelector('img')),
      cancel: () => {},
      active: false,
      stopped: false,
    })
    this.#imageTasks.set(tile.key, task)
    this.#imageQueue.push(task)
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
        this.#pumpImages()
      })
    }
  }

  /** @param {ImageTask} task */
  async #loadImage(task) {
    const live = () => !task.stopped && this.isOpen && this.#nodes.get(task.key) === task.node
    if (!live()) return
    const tile = this.#layout.find((item) => item.key === task.key)
    if (!tile) return
    const publicUrl = this.#r2.getPublicUrl(task.key)
    const desired = selectThumbnailWidth(Math.min(640, tile.w * this.#camera.scale), window.devicePixelRatio || 1)
    const policy = resolveThumbnailPolicy({
      publicUrl, key: task.key, mode: getThumbnailMode(), width: desired,
    })
    if (!policy.url && !policy.allowOriginal) {
      if (live()) task.node.classList.add('is-unavailable')
      return
    }
    try {
      let success = policy.url ? await this.#attemptImage(task, policy.url) : false
      if (!success && live() && policy.allowOriginal) {
        const source = publicUrl ?? (await this.#r2.getPresignedUrl(task.key))
        if (!live()) return
        success = await this.#attemptImage(task, source)
      }
      if (!live()) return
      task.node.classList.toggle('is-loaded', success)
      task.node.classList.toggle('is-unavailable', !success)
    } catch {
      if (live()) task.node.classList.add('is-unavailable')
    }
  }

  /**
   * @param {ImageTask} task
   * @param {string} url
   * @returns {Promise<boolean>}
   */
  #attemptImage(task, url) {
    return new Promise((resolve) => {
      if (task.stopped) { resolve(false); return }
      let finished = false
      /** @param {boolean} success */
      const settle = (success) => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        task.img.onload = null
        task.img.onerror = null
        task.cancel = () => {}
        resolve(success)
      }
      const timeout = setTimeout(() => {
        task.img.removeAttribute('src')
        settle(false)
      }, 15000)
      task.cancel = () => {
        task.img.removeAttribute('src')
        settle(false)
      }
      task.img.onload = () => settle(true)
      task.img.onerror = () => settle(false)
      task.img.src = url
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
      this.#viewport.addEventListener(type, (event) => this.#pointerUp(event))
    }
    this.#viewport.addEventListener('wheel', (event) => {
      event.preventDefault()
      const rect = this.#viewport.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      if (event.shiftKey && !event.ctrlKey) {
        this.#camera.x -= event.deltaY
        this.#camera.y -= event.deltaX
        this.#scheduleRender()
      } else {
        const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.008 : 0.0019))
        this.zoom(factor, x, y)
      }
    }, { passive: false })
    this.#viewport.addEventListener('keydown', (event) => this.#keyDown(event))
    const onClick = (id, cb) => document.querySelector('#' + id).addEventListener('click', cb)
    onClick('wall-close', () => this.close())
    onClick('wall-zoom-in', () => this.zoom(1.23))
    onClick('wall-zoom-out', () => this.zoom(1 / 1.23))
    onClick('wall-reset', () => this.resetCamera())
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
    this.#viewport.setPointerCapture(event.pointerId)
    this.#pointers.set(event.pointerId, {
      x: event.clientX, y: event.clientY,
      originX: event.clientX, originY: event.clientY,
    })
    this.#dragged = false
    this.#pointerTile = this.#pointers.size === 1
      ? /** @type {HTMLElement|null} */ (event.target instanceof Element ? event.target.closest('.poster-tile') : null)?.dataset.key ?? null
      : null
    if (this.#pointers.size >= 2) {
      this.#dragged = true
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
    pointer.x = event.clientX
    pointer.y = event.clientY
    if (Math.hypot(pointer.x - pointer.originX, pointer.y - pointer.originY) > 5) this.#dragged = true
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
    const pick = !this.#dragged && this.#pointers.size === 1 ? this.#pointerTile : null
    this.#pointers.delete(event.pointerId)
    if (this.#pointers.size < 2) this.#pinchDistance = 0
    if (this.#pointers.size === 0) {
      this.#viewport.classList.remove('is-dragging')
      this.#pointerTile = null
      this.#dragged = false
    }
    if (pick && event.type === 'pointerup') this.#toggle(pick)
  }

  /** @param {KeyboardEvent} event */
  #keyDown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return
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
