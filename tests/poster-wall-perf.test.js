import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import {
  buildWallLayout, focusReflow, WALL_GAP, cameraBounds,
} from '../src/js/poster-wall-layout.js'
import {
  indexWallTiles, queryWallTiles, WALL_RENDER_LIMIT,
} from '../src/js/poster-wall-visibility.js'

const items = (count) => Array.from({length:count},(_,i)=>({key:'asset-'+i+'.jpg',size:i}))

test('focus exact reflow changes only the selected geometric block', () => {
  const layout=buildWallLayout(items(365))
  for(const selected of [layout[0],layout[5],layout[7],layout[38],layout[88],layout[171],layout.at(-1)]){
    const result=focusReflow(layout,selected.key)
    const before=layout.filter(t=>t.blockIndex!==selected.blockIndex)
    for(const tile of before)assert.deepEqual(result.get(tile.key),
      {x:tile.x,y:tile.y,w:tile.w,h:tile.h})
    const affected=layout.filter(t=>t.blockIndex===selected.blockIndex)
    const focused=result.get(selected.key)
    assert.ok(focused.w>=selected.w && focused.h>=selected.h)
    for(let i=0;i<affected.length;i++)for(let j=i+1;j<affected.length;j++){
      const a=result.get(affected[i].key),b=result.get(affected[j].key)
      const separated=a.x+a.w+WALL_GAP<=b.x+1e-6 ||
        b.x+b.w+WALL_GAP<=a.x+1e-6 ||
        a.y+a.h+WALL_GAP<=b.y+1e-6 ||
        b.y+b.h+WALL_GAP<=a.y+1e-6
      assert.equal(separated,true,selected.key+' overlaps '+affected[i].key+' '+affected[j].key)
    }
  }
})

test('large library focus does not cascade distant layouts', () => {
  const layout=buildWallLayout(items(12000))
  const before=performance.now()
  for(const selected of [layout[0],layout[3500],layout[8000],layout[11999]]) {
    const positions=focusReflow(layout,selected.key)
    assert.equal(positions.size,12000)
  }
  const elapsed=performance.now()-before
  console.log('12k asset x4 block reflows: '+elapsed.toFixed(1)+' ms (informational only)')
})

test('spatial culling caps visible DOM nodes regardless of bucket size', () => {
  const layout=buildWallLayout(items(12000))
  const index=indexWallTiles(layout)
  const positions=focusReflow(layout,null)
  for(const camera of [
    {x:40,y:80,scale:.76},
    {x:-6500,y:-3000,scale:.35},
    {x:-90000,y:-36000,scale:.5},
    {x:19000,y:6000,scale:2.2},
  ]) {
    const bounds=cameraBounds(camera,1920,1080)
    const visible=queryWallTiles(index,positions,bounds)
    assert.ok(visible.length<=WALL_RENDER_LIMIT)
    const unique=new Set(visible.map(t=>t.key))
    assert.equal(unique.size,visible.length)
    for(const tile of visible)assert.ok(positions.has(tile.key))
    assert.deepEqual(queryWallTiles(index,positions,bounds).map(t=>t.key),
      visible.map(t=>t.key))
  }
})

test('culling checks nearby geometry blocks, not all objects',()=>{
  const layout=buildWallLayout(items(14000))
  const index=indexWallTiles(layout)
  const backing=focusReflow(layout,null)
  let hits=0
  const positions=new Proxy(backing,{
    get(target,property,receiver){
      if(property==='get')return (key)=>{hits++;return target.get(key)}
      return Reflect.get(target,property,receiver)
    },
  })
  const visible=queryWallTiles(index,positions,cameraBounds({x:-2200,y:-700,scale:.75},1280,720))
  assert.ok(visible.length>0)
  assert.ok(hits<500,'culling must not inspect all 14k image rectangles; looked at '+hits)
})
