/**
 * A lightweight, interruptible wheel controller. Precise touchpads already
 * produce many small increments and should feel direct. Mechanical wheels
 * produce coarse steps that benefit from a short accumulated damping tail.
 *
 * Independent implementation of common input dynamics; no animation library.
 */

/** @typedef {'precise'|'coarse'} WheelKind */

/**
 * @param {number} lastTimestamp
 * @param {boolean} preciseGesture
 * @param {{deltaX:number,deltaY:number,deltaMode:number,timeStamp:number}} event
 * @returns {{kind:WheelKind,preciseGesture:boolean,lastTimestamp:number}}
 */
export function classifyWallWheel(lastTimestamp, preciseGesture, event) {
  const sameGesture = event.timeStamp - lastTimestamp < 130 && event.timeStamp >= lastTimestamp
  const keepPrecise = sameGesture && preciseGesture
  const bothAxes = Math.abs(event.deltaX) > 0.01 && Math.abs(event.deltaY) > 0.01
  const smallDelta = Math.max(Math.abs(event.deltaX), Math.abs(event.deltaY)) < 47
  const precise = event.deltaMode === 0 && (keepPrecise || bothAxes || smallDelta)
  return {kind: precise ? 'precise' : 'coarse',
    preciseGesture: precise,
    lastTimestamp: event.timeStamp}
}

/**
 * Move an accumulated impulse towards zero while preserving total input
 * displacement. Delta is capped for background-tab and debug-pause recovery.
 * @param {{x:number,y:number}} pending
 * @param {number} dt
 * @returns {{step:{x:number,y:number},pending:{x:number,y:number}}}
 */
export function stepWheelDamping(pending, dt) {
  const elapsed = Math.max(0, Math.min(48, dt))
  const fraction = 1 - Math.exp(-elapsed / 92)
  const step = {x:pending.x*fraction,y:pending.y*fraction}
  const left = {x:pending.x-step.x,y:pending.y-step.y}
  if (Math.hypot(left.x,left.y) < 0.35) {
    return {step:{...pending},pending:{x:0,y:0}}
  }
  return {step,pending:left}
}

/**
 * Frame a focused image with editorial breathing room. Avoid zooming out
 * unnecessarily for wide desktop monitors, but guarantee a whole-poster
 * frame on narrow phones.
 * @param {{x:number,y:number,scale:number}} camera
 * @param {{x:number,y:number,w:number,h:number}} tile
 * @param {number} viewWidth
 * @param {number} viewHeight
 */
export function focusedWallCamera(camera, tile, viewWidth, viewHeight) {
  const horizontalMargin = Math.min(92, viewWidth * .12)
  const verticalMargin = Math.min(132, viewHeight * .17)
  const fit = Math.min(
    (viewWidth - horizontalMargin*2) / tile.w,
    (viewHeight - verticalMargin*2) / tile.h,
  )
  const scale = Math.max(.35,Math.min(1.12,fit,Math.max(.95,camera.scale)))
  return {
    x:viewWidth/2-(tile.x+tile.w/2)*scale,
    y:viewHeight/2-(tile.y+tile.h/2)*scale,
    scale,
  }
}

/**
 * A very short pointer-release coast. Ignore stale or slow release samples;
 * strong swipes receive a bounded distance rather than an infinite glide.
 *
 * @param {number} velocityX screen pixels per second
 * @param {number} velocityY screen pixels per second
 * @param {number} idleMs milliseconds since the last pointer movement
 * @returns {{x:number,y:number}|null}
 */
export function projectWallCoast(velocityX, velocityY, idleMs) {
  if (idleMs > 85 || idleMs < 0) return null
  const speed = Math.hypot(velocityX,velocityY)
  if (speed < 165) return null
  const distance = Math.min(260, speed * .115)
  return {
    x: velocityX / speed * distance,
    y: velocityY / speed * distance,
  }
}
