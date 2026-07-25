import { ConfigManager } from './config-manager.js'
import { FileOperations } from './file-operations.js'
import { UploadManager } from './upload-manager.js'
import { R2Client } from './r2-client.js'
import { getCurrentLang } from './i18n.js'

const PATCHED = Symbol('smooth-bucket-switch-patched')
const state = {
  installed: false,
  switching: false,
  busyCount: 0,
}

const messages = {
  zh: {
    intro: 'Bucket 使用同一组账户凭据，可在当前页面平滑切换；文件列表会局部刷新。',
    switching: '正在切换到 {name}…',
    switched: '已切换到 {name}',
    busy: '当前有上传、复制、移动或删除任务，请在任务完成后切换 Bucket。',
    failed: 'Bucket 切换失败：{message}',
    removed: 'Bucket 配置已删除',
    confirmDelete: '只删除浏览器中的本地配置，不会删除 Cloudflare R2 中的真实 Bucket。确认继续？',
    lastBucket: '至少需要保留一个 Bucket',
    duplicate: '该 Bucket 已存在',
    required: '请输入 Bucket 名称',
    invalid: 'Bucket 名称格式不正确',
    tokenDenied: 'API Token 没有访问该 Bucket 的权限',
    bucketMissing: 'Bucket 不存在或名称填写错误',
    network: '浏览器无法访问该 Bucket，请检查 CORS、网络和 Token 权限',
  },
  zh_TW: {
    intro: 'Bucket 共用同一組帳戶憑證，可在目前頁面平滑切換；檔案清單會局部重新整理。',
    switching: '正在切換到 {name}…',
    switched: '已切換到 {name}',
    busy: '目前有上傳、複製、移動或刪除工作，請在工作完成後切換 Bucket。',
    failed: 'Bucket 切換失敗：{message}',
    removed: 'Bucket 設定已刪除',
    confirmDelete: '只刪除瀏覽器中的本機設定，不會刪除 Cloudflare R2 中的真實 Bucket。確定繼續？',
    lastBucket: '至少需要保留一個 Bucket',
    duplicate: '此 Bucket 已存在',
    required: '請輸入 Bucket 名稱',
    invalid: 'Bucket 名稱格式不正確',
    tokenDenied: 'API Token 沒有存取此 Bucket 的權限',
    bucketMissing: 'Bucket 不存在或名稱錯誤',
    network: '瀏覽器無法存取此 Bucket，請檢查 CORS、網路與 Token 權限',
  },
  en: {
    intro: 'Buckets share one credential set and switch in place. Only the file list is refreshed.',
    switching: 'Switching to {name}…',
    switched: 'Switched to {name}',
    busy: 'An upload, copy, move, or delete task is still running. Switch buckets after it finishes.',
    failed: 'Bucket switch failed: {message}',
    removed: 'Bucket configuration removed',
    confirmDelete: 'This only removes the local browser configuration. It will not delete the real R2 bucket. Continue?',
    lastBucket: 'Keep at least one bucket',
    duplicate: 'This bucket already exists',
    required: 'Enter a bucket name',
    invalid: 'Invalid bucket name',
    tokenDenied: 'The API token is not authorized for this bucket',
    bucketMissing: 'The bucket does not exist or its name is incorrect',
    network: 'The browser cannot reach this bucket. Check CORS, network access, and token scope',
  },
  ja: {
    intro: 'Bucket は同じ認証情報を共有し、ページを再読み込みせずに切り替えます。ファイル一覧のみ更新します。',
    switching: '{name} に切り替えています…',
    switched: '{name} に切り替えました',
    busy: 'アップロード、コピー、移動、削除の処理中です。完了後に Bucket を切り替えてください。',
    failed: 'Bucket の切り替えに失敗しました：{message}',
    removed: 'Bucket 設定を削除しました',
    confirmDelete: 'ブラウザ内の設定のみ削除し、Cloudflare R2 の実 Bucket は削除しません。続行しますか？',
    lastBucket: '少なくとも 1 つの Bucket を残してください',
    duplicate: 'この Bucket は既に存在します',
    required: 'Bucket 名を入力してください',
    invalid: 'Bucket 名の形式が正しくありません',
    tokenDenied: 'API Token にこの Bucket へのアクセス権がありません',
    bucketMissing: 'Bucket が存在しないか、名前が正しくありません',
    network: 'Bucket に接続できません。CORS、ネットワーク、Token 権限を確認してください',
  },
}

/** @param {string} key @param {Record<string, string | number>} [params] */
function message(key, params = {}) {
  const lang = getCurrentLang()
  let value = (messages[lang] || messages.zh)[key] || messages.zh[key] || key
  for (const [name, replacement] of Object.entries(params)) value = value.replace(`{${name}}`, String(replacement))
  return value
}

/** @param {object} prototype @param {string[]} names */
function trackMethods(prototype, names) {
  const target = /** @type {any} */ (prototype)
  for (const name of names) {
    const original = target[name]
    if (typeof original !== 'function' || original[PATCHED]) continue
    const wrapped = async function (/** @type {any[]} */ ...args) {
      state.busyCount++
      try {
        return await original.apply(this, args)
      } finally {
        state.busyCount = Math.max(0, state.busyCount - 1)
      }
    }
    wrapped[PATCHED] = true
    target[name] = wrapped
  }
}

function patchBusyOperations() {
  trackMethods(UploadManager.prototype, ['uploadFiles'])
  trackMethods(FileOperations.prototype, ['rename', 'copy', 'move', 'delete', 'deleteMany', 'moveMany', 'copyMany', 'editContentType'])
  trackMethods(R2Client.prototype, ['createFolder'])
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

/** @param {number} [timeout] */
function waitForExplorerIdle(timeout = 30000) {
  const skeleton = /** @type {HTMLElement | null} */ (document.querySelector('#skeleton-grid'))
  if (!skeleton) return Promise.resolve()
  if (skeleton.hidden) return Promise.resolve()

  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      observer.disconnect()
      clearTimeout(timer)
      resolve()
    }
    const observer = new MutationObserver(() => {
      if (skeleton.hidden) finish()
    })
    const timer = window.setTimeout(finish, timeout)
    observer.observe(skeleton, { attributes: true, attributeFilter: ['hidden'] })
  })
}

/** @param {string} text @param {boolean} [isError] */
function showFeedback(text, isError = false) {
  const status = document.querySelector('.bucket-settings-status')
  if (status) {
    status.textContent = text
    status.setAttribute('data-error', String(isError))
  }

  document.querySelector('.bucket-switch-feedback')?.remove()
  const feedback = document.createElement('div')
  feedback.className = 'bucket-switch-feedback'
  feedback.dataset.error = String(isError)
  feedback.setAttribute('role', 'status')
  feedback.textContent = text
  document.body.append(feedback)
  requestAnimationFrame(() => feedback.classList.add('visible'))
  window.setTimeout(() => {
    feedback.classList.remove('visible')
    feedback.addEventListener('transitionend', () => feedback.remove(), { once: true })
  }, isError ? 4800 : 2200)
}

function syncActiveBucketFields() {
  const config = new ConfigManager()
  const cfg = config.get()
  const active = config.getActiveBucket()
  const values = [
    ['#cfg-bucket', cfg.bucket || ''],
    ['#cfg-bucket-alias', active?.alias || ''],
    ['#cfg-custom-domain', cfg.customDomain || ''],
    ['#cfg-bucket-access', cfg.bucketAccess || 'public'],
  ]
  for (const [selector, value] of values) {
    const field = /** @type {HTMLInputElement | HTMLSelectElement | null} */ (document.querySelector(selector))
    if (field) field.value = value
  }

  const activeId = active?.id || ''
  document.querySelectorAll('.bucket-switcher-select, #bucket-settings-select').forEach((element) => {
    const select = /** @type {HTMLSelectElement} */ (element)
    if ([...select.options].some((option) => option.value === activeId)) select.value = activeId
  })

  const intro = document.querySelector('.bucket-settings-intro')
  if (intro) intro.textContent = message('intro')
}

/** @param {boolean} switching @param {string} [label] */
function setSwitchingState(switching, label = '') {
  state.switching = switching
  document.body.toggleAttribute('data-bucket-switching', switching)
  const app = document.querySelector('#app')
  if (app) {
    app.toggleAttribute('data-bucket-switching', switching)
    app.setAttribute('aria-busy', String(switching))
  }
  const browser = document.querySelector('#file-browser')
  if (browser) {
    browser.toggleAttribute('data-bucket-switching', switching)
    if (label) browser.setAttribute('data-bucket-label', label)
    else browser.removeAttribute('data-bucket-label')
  }
  document.querySelectorAll('.bucket-switcher-select, #bucket-settings-select, .bucket-add-confirm, .bucket-remove-btn').forEach((element) => {
    const control = /** @type {HTMLButtonElement | HTMLSelectElement} */ (element)
    control.disabled = switching
  })
}

function operationIsBusy() {
  if (state.busyCount > 0) return true
  const uploadPanel = /** @type {HTMLElement | null} */ (document.querySelector('#upload-panel'))
  if (uploadPanel && !uploadPanel.hidden) return true
  return Boolean(document.querySelector('#upload-panel .upload-progress-bar:not(.done):not(.error)'))
}

/** @param {unknown} error */
function switchErrorMessage(error) {
  const value = error instanceof Error ? error.message : String(error)
  if (value === 'HTTP_403') return message('tokenDenied')
  if (value === 'HTTP_404') return message('bucketMissing')
  if (error instanceof TypeError || value.includes('Failed to fetch')) return message('network')
  return value
}

/** @param {string} label */
async function refreshExplorer(label) {
  const previewDialog = /** @type {HTMLDialogElement | null} */ (document.querySelector('#preview-dialog[open]'))
  previewDialog?.close()
  document.querySelector('#context-menu')?.hidePopover?.()
  if (document.querySelector('#app.batch-mode')) {
    /** @type {HTMLButtonElement | null} */ (document.querySelector('#batch-cancel-btn'))?.click()
  }

  const rootButton = /** @type {HTMLButtonElement | null} */ (document.querySelector('#breadcrumb .breadcrumb-btn[data-prefix=""]'))
  rootButton?.click()
  await nextFrame()
  const refreshButton = /** @type {HTMLButtonElement | null} */ (document.querySelector('#refresh-btn'))
  refreshButton?.click()
  await waitForExplorerIdle()
  document.querySelector('#file-browser')?.setAttribute('data-bucket-label', label)
}

/** @param {string} profileId @param {string} bucketId @param {{ silentSuccess?: boolean }} [options] */
async function switchBucket(profileId, bucketId, options = {}) {
  const config = new ConfigManager()
  const profile = config.getActiveProfile()
  const active = config.getActiveBucket()
  if (!profile || !bucketId) return false
  if (active?.id === bucketId) {
    syncActiveBucketFields()
    return true
  }
  if (state.switching || operationIsBusy()) {
    syncActiveBucketFields()
    showFeedback(message('busy'), true)
    return false
  }

  const target = profile.buckets.find((bucket) => bucket.id === bucketId)
  if (!target) return false
  const label = target.alias || target.name
  const previousProfileId = profile.id
  const previousBucketId = active?.id || ''

  setSwitchingState(true, label)
  showFeedback(message('switching', { name: label }))

  try {
    config.setActiveBucket(profileId, bucketId)
    setSwitchingState(true, label)

    const client = new R2Client()
    client.init(config)
    await client.testConnection()

    syncActiveBucketFields()
    await refreshExplorer(label)
    if (!options.silentSuccess) showFeedback(message('switched', { name: label }))
    return true
  } catch (error) {
    if (previousBucketId) config.setActiveBucket(previousProfileId, previousBucketId)
    syncActiveBucketFields()
    showFeedback(message('failed', { message: switchErrorMessage(error) }), true)
    return false
  } finally {
    setSwitchingState(false)
    syncActiveBucketFields()
  }
}

async function handleAddBucket() {
  if (state.switching || operationIsBusy()) {
    showFeedback(message('busy'), true)
    return
  }
  const config = new ConfigManager()
  const name = /** @type {HTMLInputElement | null} */ (document.querySelector('#bucket-add-name'))
  const alias = /** @type {HTMLInputElement | null} */ (document.querySelector('#bucket-add-alias'))
  const domain = /** @type {HTMLInputElement | null} */ (document.querySelector('#bucket-add-domain'))
  const access = /** @type {HTMLSelectElement | null} */ (document.querySelector('#bucket-add-access'))
  if (!name || !alias || !domain || !access) return

  try {
    const bucket = config.addBucket({
      name: name.value,
      alias: alias.value,
      customDomain: domain.value,
      bucketAccess: access.value === 'public' ? 'public' : 'private',
    })
    const profile = config.getActiveProfile()
    if (!profile) return
    const switched = await switchBucket(profile.id, bucket.id)
    if (switched) {
      const panel = /** @type {HTMLElement | null} */ (document.querySelector('.bucket-add-panel'))
      if (panel) panel.hidden = true
      panel?.querySelectorAll('input').forEach((input) => {
        input.value = ''
      })
    }
  } catch (error) {
    const value = error instanceof Error ? error.message : String(error)
    const key = value === 'BUCKET_EXISTS' ? 'duplicate' : value === 'BUCKET_NAME_REQUIRED' ? 'required' : value === 'BUCKET_NAME_INVALID' ? 'invalid' : null
    showFeedback(key ? message(key) : value, true)
  }
}

async function handleRemoveBucket() {
  const config = new ConfigManager()
  const profile = config.getActiveProfile()
  const active = config.getActiveBucket()
  if (!profile || !active) return
  if (profile.buckets.length <= 1) {
    showFeedback(message('lastBucket'), true)
    return
  }
  if (state.switching || operationIsBusy()) {
    showFeedback(message('busy'), true)
    return
  }
  if (!window.confirm(message('confirmDelete'))) return

  const fallback = profile.buckets.find((bucket) => bucket.id !== active.id)
  if (!fallback) return
  const switched = await switchBucket(profile.id, fallback.id, { silentSuccess: true })
  if (!switched) return

  try {
    config.removeBucket(active.id)
    syncActiveBucketFields()
    showFeedback(message('removed'))
  } catch (error) {
    showFeedback(error instanceof Error ? error.message : String(error), true)
  }
}

/** @param {Event} event */
function handleChange(event) {
  const target = /** @type {HTMLElement} */ (event.target)
  const select = /** @type {HTMLSelectElement | null} */ (target.closest('.bucket-switcher-select, #bucket-settings-select'))
  if (!select) return
  event.preventDefault()
  event.stopImmediatePropagation()
  const config = new ConfigManager()
  const profile = config.getActiveProfile()
  if (!profile) return
  void switchBucket(profile.id, select.value)
}

/** @param {Event} event */
function handleClick(event) {
  const target = /** @type {HTMLElement} */ (event.target)
  if (target.closest('.bucket-add-confirm')) {
    event.preventDefault()
    event.stopImmediatePropagation()
    void handleAddBucket()
    return
  }
  if (target.closest('.bucket-remove-btn')) {
    event.preventDefault()
    event.stopImmediatePropagation()
    void handleRemoveBucket()
  }
}

function installSmoothBucketSwitch() {
  if (state.installed) return
  state.installed = true
  patchBusyOperations()
  document.addEventListener('change', handleChange, true)
  document.addEventListener('click', handleClick, true)
  window.addEventListener('r2-config-changed', () => {
    queueMicrotask(() => {
      syncActiveBucketFields()
      if (state.switching) setSwitchingState(true, new ConfigManager().getActiveBucket()?.alias || new ConfigManager().getActiveBucket()?.name || '')
    })
  })
  queueMicrotask(syncActiveBucketFields)
}

export { installSmoothBucketSwitch }
