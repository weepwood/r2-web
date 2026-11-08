import assert from 'node:assert/strict'
import test from 'node:test'
import {
  captureWallScene, restoreWallScene, searchWallItems,
  validWallScene, wallSceneStorageKey,
} from '../src/js/poster-wall-workspace.js'

test('search matches loaded filenames and path components without network access',()=>{
  const items=[
    {key:'2026/北京风光/封面-01.JPG'},
    {key:'2026/北京风光/内页-02.jpg'},
    {key:'2026/Travel/Poster.PNG'},
    {key:'assets/other.webp'},
  ]
  assert.deepEqual(searchWallItems(items, ' 北京风光 '),
    ['2026/北京风光/封面-01.JPG','2026/北京风光/内页-02.jpg'])
  assert.deepEqual(searchWallItems(items, 'poster'),['2026/Travel/Poster.PNG'])
  assert.deepEqual(searchWallItems(items, '  '),[])
  assert.deepEqual(searchWallItems(items, 'not-loaded'),[])
  assert.deepEqual(searchWallItems(items, 'ＰＯＳＴＥＲ'),['2026/Travel/Poster.PNG'])
})

test('bookmarks are isolated by account, bucket and folder without storing raw paths in keys',()=>{
  const a=wallSceneStorageKey(JSON.stringify(['a','photos','one/']))
  const b=wallSceneStorageKey(JSON.stringify(['a','photos','two/']))
  const c=wallSceneStorageKey(JSON.stringify(['b','photos','one/']))
  assert.notEqual(a,b)
  assert.notEqual(a,c)
  assert.ok(a.startsWith('r2-web-wall-scene-v1-'))
  assert.ok(!a.includes('photos'))
  assert.ok(!a.includes('one/'))
  assert.equal(a,wallSceneStorageKey(JSON.stringify(['a','photos','one/'])))
})

test('scene saves a world-space center that survives different viewport sizes',()=>{
  const original={x:-3750,y:180,scale:.64}
  const scene=captureWallScene(original,1440,900)
  assert.deepEqual(restoreWallScene(scene,1440,900),original)
  const restored=restoreWallScene(scene,390,780)
  assert.ok(restored)
  assert.equal(restored.scale,.64)
  assert.ok(Math.abs((390/2-restored.x)/restored.scale-scene.centerX)<1e-6)
  assert.ok(Math.abs((780/2-restored.y)/restored.scale-scene.centerY)<1e-6)
})

test('invalid, malicious or obsolete scene data cannot corrupt the camera',()=>{
  for(const bad of [
    null,{},[],{version:0,centerX:1,centerY:1,scale:1},
    {version:1,centerX:Infinity,centerY:0,scale:.9},
    {version:1,centerX:0,centerY:NaN,scale:.9},
    {version:1,centerX:0,centerY:0,scale:5},
    {version:1,centerX:2e9,centerY:0,scale:.9},
    {version:1,centerX:0,centerY:0,scale:'0.8'},
  ]) {
    assert.equal(validWallScene(bad),null)
    assert.equal(restoreWallScene(bad,1280,720),null)
  }
  const scene=captureWallScene({x:0,y:0,scale:1},1280,720)
  assert.equal(restoreWallScene(scene,0,0),null)
})
