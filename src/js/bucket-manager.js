import { ConfigManager } from './config-manager.js'
import { R2Client } from './r2-client.js'
import { getCurrentLang } from './i18n.js'

const messages = {
  zh: {
    manage: '管理 Bucket', add: '添加 Bucket', sync: '同步账户 Bucket', name: 'Bucket 名称', alias: '显示名称（可选）',
    domain: '自定义域名（可选）', access: '可见性', public: '公开', private: '私有', active: '当前', switch: '切换',
    save: '保存', remove: '删除', close: '关闭', empty: '尚未配置 Bucket', added: 'Bucket 已添加', saved: 'Bucket 已保存',
    removed: 'Bucket 配置已删除', syncDone: '同步完成，新增 {count} 个 Bucket', syncNone: '没有发现新的 Bucket',
    syncDenied: '当前密钥没有列出 Bucket 的权限，请手动添加。', confirmDelete: '仅删除本地配置，不会删除 R2 中的真实 Bucket。确认继续？',
    lastBucket: '至少保留一个 Bucket', duplicate: '该 Bucket 已存在', required: '请输入 Bucket 名称', tip: '切换 Bucket 会刷新页面，以隔离文件缓存和上传上下文。',
  },
  zh_TW: {
    manage: '管理 Bucket', add: '新增 Bucket', sync: '同步帳戶 Bucket', name: 'Bucket 名稱', alias: '顯示名稱（選填）',
    domain: '自訂網域（選填）', access: '可見性', public: '公開', private: '私人', active: '目前', switch: '切換',
    save: '儲存', remove: '刪除', close: '關閉', empty: '尚未設定 Bucket', added: 'Bucket 已新增', saved: 'Bucket 已儲存',
    removed: 'Bucket 設定已刪除', syncDone: '同步完成，新增 {count} 個 Bucket', syncNone: '沒有發現新的 Bucket',
    syncDenied: '目前金鑰沒有列出 Bucket 的權限，請手動新增。', confirmDelete: '只刪除本機設定，不會刪除 R2 中的真實 Bucket。確定繼續？',
    lastBucket: '至少保留一個 Bucket', duplicate: '此 Bucket 已存在', required: '請輸入 Bucket 名稱', tip: '切換 Bucket 會重新整理頁面，以隔離檔案快取和上傳內容。',
  },
  en: {
    manage: 'Manage buckets', add: 'Add bucket', sync: 'Sync account buckets', name: 'Bucket name', alias: 'Display name (optional)',
    domain: 'Custom domain (optional)', access: 'Visibility', public: 'Public', private: 'Private', active: 'Active', switch: 'Switch',
    save: 'Save', remove: 'Remove', close: 'Close', empty: 'No bucket configured', added: 'Bucket added', saved: 'Bucket saved',
    removed: 'Bucket configuration removed', syncDone: 'Sync complete. Added {count} bucket(s).', syncNone: 'No new buckets found.',
    syncDenied: 'This token cannot list buckets. Add an authorized bucket manually.', confirmDelete: 'This only removes the local configuration and will not delete the real R2 bucket. Continue?',
    lastBucket: 'Keep at least one bucket', duplicate: 'This bucket already exists', required: 'Enter a bucket name', tip: 'Switching buckets reloads the page to isolate caches and upload context.',
  },
  ja: {
    manage: 'Bucket 管理', add: 'Bucket を追加', sync: 'アカウントの Bucket を同期', name: 'Bucket 名', alias: '表示名（任意）',
    domain: 'カスタムドメイン（任意）', access: '公開範囲', public: '公開', private: '非公開', active: '現在', switch: '切り替え',
    save: '保存', remove: '削除', close: '閉じる', empty: 'Bucket が設定されていません', added: 'Bucket を追加しました', saved: 'Bucket を保存しました',
    removed: 'Bucket 設定を削除しました', syncDone: '同期完了。{count} 個の Bucket を追加しました。', syncNone: '新しい Bucket はありません。',
    syncDenied: 'このキーには Bucket 一覧権限がありません。手動で追加してください。', confirmDelete: 'ローカル設定のみ削除し、R2 の実 Bucket は削除しません。続行しますか？',
    lastBucket: '少なくとも 1 つの Bucket を残してください', duplicate: 'この Bucket は既に存在します', required: 'Bucket 名を入力してください', tip: 'キャッシュとアップロード先を分離するため、Bucket 切り替え時にページを再読み込みします。',
  },
}

class BucketManagerUI {
  /** @type {ConfigManager} */
  #config
  /** @type {HTMLDialogElement | null} */
  #dialog = null

  constructor() {
    this.#config = new ConfigManager()
  }

  init() {
    this.#ensureStyles()
    this.#renderSwitcher()
    window.addEventListener('r2-config-changed', () => this.#renderSwitcher())
  }

  #m(key, params = {}) {
    const lang = getCurrentLang()
    let value = (messages[lang] || messages.zh)[key] || messages.zh[key] || key
    for (const [name, replacement] of Object.entries(params)) value = value.replace(`{${name}}`, String(replacement))
    return value
  }

  #ensureStyles() {
    if (document.querySelector('link[data-bucket-manager-style]')) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'bucket-manager.css'
    link.dataset.bucketManagerStyle = 'true'
    document.head.append(link)
  }

  #renderSwitcher() {
    const titleGroup = document.querySelector('.topbar > .flex.items-center')
    if (!titleGroup) return
    titleGroup.querySelector('.bucket-switcher')?.remove()

    const profile = this.#config.getActiveProfile()
    const active = this.#config.getActiveBucket()
    if (!profile || profile.buckets.length === 0) return

    const group = document.createElement('div')
    group.className = 'bucket-switcher'

    const select = document.createElement('select')
    select.className = 'bucket-switcher-select'
    select.setAttribute('aria-label', this.#m('manage'))
    for (const bucket of profile.buckets) {
      const option = document.createElement('option')
      option.value = bucket.id
      option.textContent = bucket.alias ? `${bucket.alias} · ${bucket.name}` : bucket.name
      option.selected = bucket.id === active?.id
      select.append(option)
    }
    select.addEventListener('change', () => {
      this.#config.setActiveBucket(profile.id, select.value)
      window.location.reload()
    })

    const manage = document.createElement('button')
    manage.type = 'button'
    manage.className = 'bucket-manage-btn'
    manage.textContent = '⋯'
    manage.title = this.#m('manage')
    manage.setAttribute('aria-label', this.#m('manage'))
    manage.addEventListener('click', () => this.#openDialog())

    group.append(select, manage)
    titleGroup.append(group)
  }

  #openDialog() {
    this.#dialog?.remove()
    const dialog = document.createElement('dialog')
    dialog.className = 'bucket-manager-dialog'
    dialog.innerHTML = `
      <div class="bucket-manager-panel">
        <header class="bucket-manager-header">
          <div><h2></h2><p></p></div>
          <button type="button" class="bucket-dialog-close">×</button>
        </header>
        <div class="bucket-manager-actions">
          <button type="button" class="btn secondary bucket-sync-btn"></button>
        </div>
        <form class="bucket-add-form">
          <div class="bucket-form-grid">
            <input name="name" required autocomplete="off" />
            <input name="alias" autocomplete="off" />
            <input name="customDomain" type="url" autocomplete="off" />
            <select name="bucketAccess"><option value="public"></option><option value="private"></option></select>
          </div>
          <button type="submit" class="btn primary"></button>
        </form>
        <div class="bucket-manager-status" role="status"></div>
        <div class="bucket-list"></div>
      </div>`
    dialog.querySelector('h2').textContent = this.#m('manage')
    dialog.querySelector('header p').textContent = this.#m('tip')
    dialog.querySelector('.bucket-dialog-close').setAttribute('aria-label', this.#m('close'))
    dialog.querySelector('.bucket-sync-btn').textContent = this.#m('sync')
    dialog.querySelector('input[name="name"]').placeholder = this.#m('name')
    dialog.querySelector('input[name="alias"]').placeholder = this.#m('alias')
    dialog.querySelector('input[name="customDomain"]').placeholder = this.#m('domain')
    dialog.querySelector('option[value="public"]').textContent = this.#m('public')
    dialog.querySelector('option[value="private"]').textContent = this.#m('private')
    dialog.querySelector('.bucket-add-form button').textContent = this.#m('add')

    dialog.querySelector('.bucket-dialog-close').addEventListener('click', () => dialog.close())
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close() })
    dialog.querySelector('.bucket-add-form').addEventListener('submit', (event) => this.#addBucket(event))
    dialog.querySelector('.bucket-sync-btn').addEventListener('click', (event) => this.#syncBuckets(event))
    dialog.addEventListener('close', () => { dialog.remove(); if (this.#dialog === dialog) this.#dialog = null })

    document.body.append(dialog)
    this.#dialog = dialog
    this.#renderBucketList()
    dialog.showModal()
  }

  #renderBucketList() {
    if (!this.#dialog) return
    const list = this.#dialog.querySelector('.bucket-list')
    list.replaceChildren()
    const profile = this.#config.getActiveProfile()
    const active = this.#config.getActiveBucket()
    if (!profile || profile.buckets.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'bucket-empty'
      empty.textContent = this.#m('empty')
      list.append(empty)
      return
    }

    for (const bucket of profile.buckets) {
      const row = document.createElement('article')
      row.className = 'bucket-row'
      row.dataset.bucketId = bucket.id

      const heading = document.createElement('div')
      heading.className = 'bucket-row-heading'
      const title = document.createElement('strong')
      title.textContent = bucket.alias || bucket.name
      const detail = document.createElement('span')
      detail.textContent = bucket.alias ? bucket.name : bucket.bucketAccess === 'private' ? this.#m('private') : this.#m('public')
      heading.append(title, detail)
      if (bucket.id === active?.id) {
        const badge = document.createElement('em')
        badge.textContent = this.#m('active')
        heading.append(badge)
      }

      const fields = document.createElement('div')
      fields.className = 'bucket-row-fields'
      fields.append(
        this.#input('name', bucket.name, this.#m('name')),
        this.#input('alias', bucket.alias || '', this.#m('alias')),
        this.#input('customDomain', bucket.customDomain || '', this.#m('domain'), 'url'),
      )
      const access = document.createElement('select')
      access.name = 'bucketAccess'
      for (const value of ['public', 'private']) {
        const option = document.createElement('option')
        option.value = value
        option.textContent = this.#m(value)
        option.selected = bucket.bucketAccess === value
        access.append(option)
      }
      fields.append(access)

      const actions = document.createElement('div')
      actions.className = 'bucket-row-actions'
      const save = this.#button(this.#m('save'), 'save')
      const activate = this.#button(this.#m('switch'), 'activate')
      const remove = this.#button(this.#m('remove'), 'remove', 'danger')
      activate.disabled = bucket.id === active?.id
      actions.append(save, activate, remove)
      actions.addEventListener('click', (event) => this.#handleRowAction(event, profile.id, bucket.id))

      row.append(heading, fields, actions)
      list.append(row)
    }
  }

  #input(name, value, placeholder, type = 'text') {
    const input = document.createElement('input')
    input.name = name
    input.type = type
    input.value = value
    input.placeholder = placeholder
    input.autocomplete = 'off'
    return input
  }

  #button(label, action, variant = 'secondary') {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `btn ${variant} sm`
    button.dataset.action = action
    button.textContent = label
    return button
  }

  #status(message, isError = false) {
    if (!this.#dialog) return
    const status = this.#dialog.querySelector('.bucket-manager-status')
    status.textContent = message
    status.dataset.error = String(isError)
  }

  #errorMessage(error) {
    if (error.message === 'LAST_BUCKET') return this.#m('lastBucket')
    if (error.message === 'BUCKET_EXISTS') return this.#m('duplicate')
    if (error.message === 'BUCKET_NAME_REQUIRED') return this.#m('required')
    return error.message || String(error)
  }

  #addBucket(event) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    try {
      this.#config.addBucket({
        name: String(data.get('name') || ''),
        alias: String(data.get('alias') || ''),
        customDomain: String(data.get('customDomain') || ''),
        bucketAccess: data.get('bucketAccess') === 'private' ? 'private' : 'public',
      })
      form.reset()
      this.#status(this.#m('added'))
      this.#renderBucketList()
    } catch (error) {
      this.#status(this.#errorMessage(error), true)
    }
  }

  async #syncBuckets(event) {
    const button = event.currentTarget
    button.disabled = true
    try {
      const client = new R2Client()
      client.init(this.#config)
      const discovered = []
      let token = ''
      do {
        const page = await client.listBuckets(token)
        discovered.push(...page.buckets)
        token = page.isTruncated ? page.nextToken : ''
      } while (token)
      const added = this.#config.mergeDiscoveredBuckets(discovered)
      this.#status(added ? this.#m('syncDone', { count: added }) : this.#m('syncNone'))
      this.#renderBucketList()
    } catch (error) {
      this.#status(error.message === 'HTTP_403' ? this.#m('syncDenied') : this.#errorMessage(error), true)
    } finally {
      button.disabled = false
    }
  }

  #handleRowAction(event, profileId, bucketId) {
    const button = event.target.closest('button[data-action]')
    if (!button) return
    const row = button.closest('.bucket-row')
    const action = button.dataset.action
    try {
      if (action === 'activate') {
        this.#config.setActiveBucket(profileId, bucketId)
        window.location.reload()
        return
      }
      if (action === 'remove') {
        if (!window.confirm(this.#m('confirmDelete'))) return
        const wasActive = this.#config.getActiveBucket()?.id === bucketId
        this.#config.removeBucket(bucketId)
        if (wasActive) window.location.reload()
        else {
          this.#status(this.#m('removed'))
          this.#renderBucketList()
        }
        return
      }
      if (action === 'save') {
        const field = (name) => row.querySelector(`[name="${name}"]`).value
        const wasActive = this.#config.getActiveBucket()?.id === bucketId
        this.#config.updateBucket(bucketId, {
          name: field('name'),
          alias: field('alias'),
          customDomain: field('customDomain'),
          bucketAccess: field('bucketAccess') === 'private' ? 'private' : 'public',
        })
        if (wasActive) window.location.reload()
        else {
          this.#status(this.#m('saved'))
          this.#renderBucketList()
        }
      }
    } catch (error) {
      this.#status(this.#errorMessage(error), true)
    }
  }
}

export { BucketManagerUI }
