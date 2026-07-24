import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('R2 对象请求使用查询参数签名', async () => {
  const source = await read('src/js/r2-client.js')

  assert.match(source, /aws:\s*\{\s*signQuery:\s*true\s*\}/)
  assert.doesNotMatch(source, /async\s+listBuckets\s*\(/)
  assert.doesNotMatch(source, /['"]Authorization['"]\s*:/i)
  assert.doesNotMatch(source, /['"]Content-Length['"]\s*:/i)
})

test('Bucket 管理仅保留手动添加', async () => {
  const source = await read('src/js/bucket-manager.js')

  assert.doesNotMatch(source, /同步账户 Bucket|Sync account buckets|#syncBuckets|listBuckets\s*\(/)
  assert.match(source, /bucket-add-btn/)
  assert.match(source, /testConnection\(\)/)
})

test('推荐 CORS 规则与实际请求头保持一致', async () => {
  const source = await read('src/js/bucket-manager.js')

  assert.match(source, /AllowedMethods:\s*\['GET', 'PUT', 'DELETE', 'HEAD'\]/)
  assert.match(source, /AllowedHeaders:\s*\['Content-Type', 'x-amz-copy-source', 'x-amz-metadata-directive'\]/)
  assert.doesNotMatch(source, /AllowedHeaders:\s*\['\*'\]/)
})

test('通用网络错误不再被直接断言为 CORS', async () => {
  const source = await read('src/js/utils.js')

  assert.doesNotMatch(source, /return\s+['"]corsError['"]/)
  assert.match(source, /return\s+['"]networkError['"]/)
})
