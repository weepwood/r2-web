import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { destinationConflict } from '../src/js/file-operation-guards.js'

test('拒绝将文件夹复制或移动到自身以及后代目录', () => {
  assert.equal(destinationConflict('photos/', 'photos/', true), 'same')
  assert.equal(destinationConflict('photos/', 'photos/edited/', true), 'nested')
  assert.equal(destinationConflict('photos/', 'photos/edited/photos/', true), 'nested')
  assert.equal(destinationConflict('album/2026/', 'album/2026/trips/', true), 'nested')
  assert.equal(destinationConflict('photos/', 'photos/sibling/', true), 'nested')
})

test('允许不重叠的目标，且前缀相似但不同的文件夹不互相冲突', () => {
  assert.equal(destinationConflict('photos/', 'photos-archive/', true), null)
  assert.equal(destinationConflict('photos/', 'archive/photos/', true), null)
  assert.equal(destinationConflict('photos/', 'photo/', true), null)
  assert.equal(destinationConflict('photos/a.jpg', 'photos/b.jpg', false), null)
  assert.equal(destinationConflict('photos/a.jpg', 'photos/a.jpg', false), 'same')
  assert.equal(destinationConflict('照片/', '照片备份/', true), null)
})

test('递归 R2 处理不会将无实体的 CommonPrefixes 当作可复制对象', () => {
  const operations = readFileSync(new URL('../src/js/file-operations.js', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../src/js/r2-client.js', import.meta.url), 'utf8')

  assert.match(operations, /if \(result\.hasFolderMarker && !allKeys\.includes\(prefix\)\) allKeys\.push\(prefix\)/)
  assert.doesNotMatch(operations, /allKeys\.push\(folder\.key\)/)
  assert.match(operations, /const subKeys = await this\.#collectAllKeys\(folder\.key\)/)
  assert.match(client, /const hasFolderMarker = Boolean\(prefix\)/)
  assert.match(client, /return \{ folders, files, isTruncated, nextToken, hasFolderMarker \}/)
})

test('移动和批量复制移动都对目标目录执行冲突检测', () => {
  const operations = readFileSync(new URL('../src/js/file-operations.js', import.meta.url), 'utf8')
  assert.match(operations, /destinationConflict\(key, resolveDest\(v\), isFolder\)/)
  assert.match(operations, /destinationConflict\(key, isFolder \? FileOperations\.#toFolderPrefix\(v\) : v, isFolder\)/)
  assert.equal([...operations.matchAll(/if \(problems\.includes\('nested'\)\)/g)].length, 2)
  assert.equal([...operations.matchAll(/if \(destinationConflict\(item\.key, dest, item\.isFolder\)\) continue/g)].length, 2)
})

test('CopyObject 检测 HTTP 200 内嵌错误码，复制成功前不删除源数据', () => {
  const client = readFileSync(new URL('../src/js/r2-client.js', import.meta.url), 'utf8')
  const operations = readFileSync(new URL('../src/js/file-operations.js', import.meta.url), 'utf8')
  assert.match(client, /document\.querySelector\('Error > Code'\)\?\.textContent/)
  assert.match(client, /if \(code\) throw new Error\('R2_COPY_' \+ code\)/)
  assert.match(operations, /await this\.#r2\.copyObject\(key, dest\)\s*await this\.#r2\.deleteObject\(key\)/)
})
