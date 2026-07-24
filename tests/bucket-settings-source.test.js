import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('顶部仅保留 Bucket 快速切换器', async () => {
  const source = await read('src/js/bucket-manager.js')

  assert.match(source, /bucket-switcher-select/)
  assert.doesNotMatch(source, /bucket-manage-btn|showModal\(|bucket-manager-dialog/)
})

test('Bucket 管理注入 R2 设置页并复用原 UI 组件', async () => {
  const source = await read('src/js/bucket-manager.js')

  assert.match(source, /\[data-panel="r2"\]\s+\.config-section/)
  assert.match(source, /class="field bucket-current-field"/)
  assert.match(source, /class="btn secondary sm bucket-test-btn"/)
  assert.match(source, /class="btn primary bucket-add-confirm"/)
})

test('设置保存时会同步当前 Bucket 显示名称', async () => {
  const source = await read('src/js/bucket-manager.js')

  assert.match(source, /#config-submit/)
  assert.match(source, /updateBucket\(active\.id,\s*\{\s*alias:/)
})
