/**
 * Conservative destination checks for R2 object keys.
 *
 * R2 has key prefixes, not transactional directories. Copying a directory
 * into its own descendant can cause recursive traversal and unbounded work.
 * Reject before issuing any copy or delete requests.
 *
 * @param {string} sourceKey
 * @param {string} destinationKey
 * @param {boolean} isFolder
 * @returns {'same' | 'nested' | null}
 */
export function destinationConflict(sourceKey, destinationKey, isFolder) {
  const source = isFolder && !sourceKey.endsWith('/') ? sourceKey + '/' : sourceKey
  const target = isFolder && !destinationKey.endsWith('/') ? destinationKey + '/' : destinationKey
  if (source === target) return 'same'
  if (isFolder && target.startsWith(source)) return 'nested'
  return null
}
