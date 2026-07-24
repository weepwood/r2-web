import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('Bucket 设置样式使用项目设计变量', async () => {
  const styles = await read('src/bucket-manager.css')

  assert.match(styles, /var\(--border\)/)
  assert.match(styles, /var\(--radius-md\)/)
  assert.match(styles, /var\(--bg-primary\)/)
  assert.match(styles, /var\(--text-secondary\)/)
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}/i)
})
