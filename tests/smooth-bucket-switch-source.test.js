import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('应用启动前安装平滑 Bucket 切换控制器', async () => {
  const source = await read('src/main.js')

  assert.match(source, /installSmoothBucketSwitch\(\)/)
  assert.ok(source.indexOf('installSmoothBucketSwitch()') < source.indexOf('new App()'))
  assert.ok(source.indexOf('installSmoothBucketSwitch()') < source.indexOf('new BucketManagerUI().init()'))
})

test('Bucket 切换使用事件拦截而不是执行原刷新监听器', async () => {
  const source = await read('src/js/smooth-bucket-switch.js')

  assert.match(source, /document\.addEventListener\('change', handleChange, true\)/)
  assert.match(source, /event\.stopImmediatePropagation\(\)/)
  assert.doesNotMatch(source, /window\.location\.reload\(\)/)
})

test('切换前验证目标 Bucket 并在失败时回滚', async () => {
  const source = await read('src/js/smooth-bucket-switch.js')

  assert.match(source, /config\.setActiveBucket\(profileId, bucketId\)/)
  assert.match(source, /await client\.testConnection\(\)/)
  assert.match(source, /config\.setActiveBucket\(previousProfileId, previousBucketId\)/)
})

test('局部切换会回到根目录并清理文件列表缓存', async () => {
  const source = await read('src/js/smooth-bucket-switch.js')

  assert.match(source, /breadcrumb \.breadcrumb-btn\[data-prefix=/)
  assert.match(source, /refreshButton\?\.click\(\)/)
  assert.match(source, /waitForExplorerIdle\(\)/)
})

test('上传和文件变更任务期间禁止切换 Bucket', async () => {
  const source = await read('src/js/smooth-bucket-switch.js')

  assert.match(source, /trackMethods\(UploadManager\.prototype, \['uploadFiles'\]\)/)
  assert.match(source, /FileOperations\.prototype/)
  assert.match(source, /operationIsBusy\(\)/)
  assert.match(source, /state\.busyCount/)
})

test('平滑切换样式遵循减少动态效果偏好', async () => {
  const source = await read('src/smooth-bucket-switch.css')

  assert.match(source, /data-bucket-switching/)
  assert.match(source, /prefers-reduced-motion: reduce/)
  assert.match(source, /bucket-switch-feedback/)
})
