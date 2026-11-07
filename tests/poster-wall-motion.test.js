import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyWallWheel, stepWheelDamping, focusedWallCamera,
} from '../src/js/poster-wall-motion.js'
import {
  buildWallLayout, focusBlockReflow, focusReflow, WALL_GAP,
} from '../src/js/poster-wall-layout.js'

test('high resolution trackpads are direct and coarse wheel steps remain accumulable', () => {
  const sample = (x,y,mode,time) => ({deltaX:x,deltaY:y,deltaMode:mode,timeStamp:time})
  assert.equal(classifyWallWheel(0,false,sample(0,12,0,20)).kind,'precise')
  assert.equal(classifyWallWheel(0,false,sample(0,100,0,20)).kind,'coarse')
  assert.equal(classifyWallWheel(0,false,sample(0,3,1,20)).kind,'coarse')
  assert.equal(classifyWallWheel(0,false,sample(17,140,0,20)).kind,'precise')
  const prior = classifyWallWheel(0,false,sample(0,5,0,20))
  assert.equal(classifyWallWheel(prior.lastTimestamp,prior.preciseGesture,
    sample(0,104,0,42)).kind,'precise')
  assert.equal(classifyWallWheel(prior.lastTimestamp,prior.preciseGesture,
    sample(0,104,0,220)).kind,'coarse')
})

test('damped wheel conserves displacement across any number of interrupted frames', () => {
  let pending = {x:-140,y:340}
  let moved = {x:0,y:0}
  for(let i=0;i<140;i++){
    const {step,pending:next}=stepWheelDamping(pending,16)
    moved.x+=step.x
    moved.y+=step.y
    pending=next
    if(!pending.x&&!pending.y)break
  }
  assert.deepEqual(pending,{x:0,y:0})
  assert.ok(Math.abs(moved.x+140)<1e-6)
  assert.ok(Math.abs(moved.y-340)<1e-6)
})

test('damping remains bounded after a tab resumes from a long pause',()=>{
  const result=stepWheelDamping({x:240,y:-160},30_000)
  assert.ok(Math.abs(result.step.x)<240)
  assert.ok(Math.abs(result.step.y)<160)
  assert.ok(result.pending.x>0)
  assert.ok(result.pending.y<0)
})

test('focus camera centers a complete expanded poster on desktop and narrow screens',()=>{
  const tile={x:2300,y:1500,w:674,h:504}
  const from={x:-30,y:40,scale:.62}
  for(const [w,h] of [[1440,900],[390,780],[768,1000]]) {
    const camera=focusedWallCamera(from,tile,w,h)
    assert.ok(camera.scale>=.35&&camera.scale<=1.12)
    assert.ok(Math.abs(camera.x+(tile.x+tile.w/2)*camera.scale-w/2)<1e-6)
    assert.ok(Math.abs(camera.y+(tile.y+tile.h/2)*camera.scale-h/2)<1e-6)
    assert.ok(tile.w*camera.scale<=w || camera.scale===.35)
    assert.ok(tile.h*camera.scale<=h || camera.scale===.35)
  }
})

test('block-only focus equals the global focus result, without scanning distant blocks',()=>{
  const layout=buildWallLayout(Array.from({length:5000},(_,i)=>({key:'image'+i})))
  const base=focusReflow(layout,null)
  for(const key of [layout[0].key,layout[7].key,layout[345].key,layout[3500].key]){
    const active=layout.find(tile=>tile.key===key)
    const local=layout.filter(tile=>tile.blockIndex===active.blockIndex)
    const changed=focusBlockReflow(local,key)
    assert.ok(changed.size<=8)
    const comparison=focusReflow(layout,key)
    for(const [id,rect] of changed)assert.deepEqual(rect,comparison.get(id))
    for(const tile of local){
      assert.ok(changed.has(tile.key))
      for(const sibling of local){
        if(tile===sibling)continue
        const a=changed.get(tile.key),b=changed.get(sibling.key)
        assert.ok(a.x+a.w+WALL_GAP<=b.x+0.001 ||
          b.x+b.w+WALL_GAP<=a.x+0.001 ||
          a.y+a.h+WALL_GAP<=b.y+0.001 ||
          b.y+b.h+WALL_GAP<=a.y+0.001)
      }
    }
    for(const tile of layout.slice(0,100))if(tile.blockIndex!==active.blockIndex){
      assert.deepEqual(comparison.get(tile.key),base.get(tile.key))
    }
  }
})
