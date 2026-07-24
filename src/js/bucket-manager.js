import { ConfigManager } from './config-manager.js'
import { R2Client } from './r2-client.js'
import { getCurrentLang } from './i18n.js'

/** @param {ParentNode} root @param {string} selector */
function must(root, selector) {
  const element = root.querySelector(selector)
  if (!element) throw new Error(`Missing element: ${selector}`)
  return /** @type {HTMLElement} */ (element)
}

const messages = {
  zh: {
    manage: 'Bucket 管理', add: '添加 Bucket', list: 'Bucket 列表', name: 'Bucket 名称', alias: '显示名称',
    domain: '自定义域名', access: '链接访问方式', public: '公开域名', private: '预签名链接', active: '当前使用',
    save: '保存配置', remove: '删除配置', close: '关闭', switch: '切换到此 Bucket', edit: '编辑 Bucket',
    empty: '尚未配置 Bucket', added: 'Bucket 已添加', saved: 'Bucket 配置已保存', removed: 'Bucket 配置已删除',
    confirmDelete: '只删除浏览器中的本地配置，不会删除 Cloudflare R2 中的真实 Bucket。确认继续？',
    lastBucket: '至少需要保留一个 Bucket', duplicate: '该 Bucket 已存在', required: '请输入 Bucket 名称', invalid: 'Bucket 名称格式不正确',
    intro: 'Bucket 通过手动添加管理。切换后页面会刷新，以隔离文件缓存和上传上下文。',
    account: '当前账户', unnamedAccount: 'Cloudflare R2', newBucket: '新建 Bucket', optional: '可选',
    domainHint: '自定义域名只用于生成公开文件链接，文件管理始终访问 R2 S3 API 域名。',
    accessHint: '此选项不会修改 Cloudflare 中 Bucket 的真实公开状态，只决定复制链接时使用公开域名还是预签名 URL。',
    connection: '连接与跨域检查', origin: '当前网页 Origin', test: '测试当前 Bucket', testing: '正在测试…', testOk: '连接成功，当前凭据可以读取此 Bucket。',
    testFirst: '请先切换到此 Bucket，再进行连接测试。', tokenDenied: '访问被拒绝。请确认 API Token 已授权当前 Bucket，而不只是配置了 CORS。',
    bucketMissing: 'Bucket 不存在或名称填写错误。', corsFailed: '浏览器无法读取响应。请检查当前 Origin 是否精确加入 CORS，并确认网络和 Token 权限。',
    corsConfig: '推荐 CORS 配置', copyCors: '复制配置', copied: 'CORS 配置已复制',
    corsHint: '配置后可能需要等待片刻，并清除浏览器中旧的预检缓存。Origin 不要带路径或结尾斜杠。',
  },
  zh_TW: {
    manage: 'Bucket 管理', add: '新增 Bucket', list: 'Bucket 清單', name: 'Bucket 名稱', alias: '顯示名稱',
    domain: '自訂網域', access: '連結存取方式', public: '公開網域', private: '預簽名連結', active: '目前使用',
    save: '儲存設定', remove: '刪除設定', close: '關閉', switch: '切換到此 Bucket', edit: '編輯 Bucket',
    empty: '尚未設定 Bucket', added: 'Bucket 已新增', saved: 'Bucket 設定已儲存', removed: 'Bucket 設定已刪除',
    confirmDelete: '只刪除瀏覽器中的本機設定，不會刪除 Cloudflare R2 中的真實 Bucket。確定繼續？',
    lastBucket: '至少需要保留一個 Bucket', duplicate: '此 Bucket 已存在', required: '請輸入 Bucket 名稱', invalid: 'Bucket 名稱格式不正確',
    intro: 'Bucket 透過手動新增管理。切換後頁面會重新整理，以隔離檔案快取與上傳內容。',
    account: '目前帳戶', unnamedAccount: 'Cloudflare R2', newBucket: '新增 Bucket', optional: '選填',
    domainHint: '自訂網域只用於產生公開檔案連結，檔案管理仍會存取 R2 S3 API 網域。',
    accessHint: '此選項不會修改 Cloudflare 中 Bucket 的真實公開狀態，只決定複製連結時使用公開網域或預簽名 URL。',
    connection: '連線與跨網域檢查', origin: '目前網頁 Origin', test: '測試目前 Bucket', testing: '測試中…', testOk: '連線成功，目前憑證可以讀取此 Bucket。',
    testFirst: '請先切換到此 Bucket，再進行連線測試。', tokenDenied: '存取遭拒。請確認 API Token 已授權目前 Bucket，而不只是設定了 CORS。',
    bucketMissing: 'Bucket 不存在或名稱錯誤。', corsFailed: '瀏覽器無法讀取回應。請檢查目前 Origin 是否精確加入 CORS，並確認網路與 Token 權限。',
    corsConfig: '建議 CORS 設定', copyCors: '複製設定', copied: 'CORS 設定已複製',
    corsHint: '設定後可能需要稍候，並清除瀏覽器舊的預檢快取。Origin 不要帶路徑或結尾斜線。',
  },
  en: {
    manage: 'Bucket manager', add: 'Add bucket', list: 'Buckets', name: 'Bucket name', alias: 'Display name',
    domain: 'Custom domain', access: 'Link mode', public: 'Public domain', private: 'Presigned URL', active: 'Active',
    save: 'Save', remove: 'Remove', close: 'Close', switch: 'Switch to this bucket', edit: 'Edit bucket',
    empty: 'No bucket configured', added: 'Bucket added', saved: 'Bucket saved', removed: 'Bucket removed',
    confirmDelete: 'This only removes the local browser configuration. It will not delete the real R2 bucket. Continue?',
    lastBucket: 'Keep at least one bucket', duplicate: 'This bucket already exists', required: 'Enter a bucket name', invalid: 'Invalid bucket name',
    intro: 'Buckets are added manually. Switching reloads the page to isolate caches and upload context.',
    account: 'Account', unnamedAccount: 'Cloudflare R2', newBucket: 'New bucket', optional: 'Optional',
    domainHint: 'The custom domain is only used for public links. File management always uses the R2 S3 API domain.',
    accessHint: 'This does not change the real Cloudflare bucket visibility. It only controls public-domain versus presigned links.',
    connection: 'Connection and CORS check', origin: 'Current page origin', test: 'Test active bucket', testing: 'Testing…', testOk: 'Connection succeeded. The credentials can read this bucket.',
    testFirst: 'Switch to this bucket before testing it.', tokenDenied: 'Access denied. Confirm that the API token is authorized for this bucket, not only that CORS is configured.',
    bucketMissing: 'The bucket does not exist or its name is incorrect.', corsFailed: 'The browser could not read the response. Check the exact Origin in CORS, network access, and token scope.',
    corsConfig: 'Recommended CORS policy', copyCors: 'Copy policy', copied: 'CORS policy copied',
    corsHint: 'Changes may take a moment. Clear cached preflight responses if needed. Do not include a path or trailing slash in Origin.',
  },
  ja: {
    manage: 'Bucket 管理', add: 'Bucket を追加', list: 'Bucket 一覧', name: 'Bucket 名', alias: '表示名',
    domain: 'カスタムドメイン', access: 'リンク方式', public: '公開ドメイン', private: '署名付き URL', active: '使用中',
    save: '保存', remove: '削除', close: '閉じる', switch: 'この Bucket に切り替え', edit: 'Bucket を編集',
    empty: 'Bucket が設定されていません', added: 'Bucket を追加しました', saved: 'Bucket を保存しました', removed: 'Bucket を削除しました',
    confirmDelete: 'ブラウザ内の設定のみ削除し、Cloudflare R2 の実 Bucket は削除しません。続行しますか？',
    lastBucket: '少なくとも 1 つの Bucket を残してください', duplicate: 'この Bucket は既に存在します', required: 'Bucket 名を入力してください', invalid: 'Bucket 名の形式が正しくありません',
    intro: 'Bucket は手動で追加します。切り替え時にページを再読み込みし、キャッシュとアップロード先を分離します。',
    account: '現在のアカウント', unnamedAccount: 'Cloudflare R2', newBucket: '新しい Bucket', optional: '任意',
    domainHint: 'カスタムドメインは公開リンク生成にのみ使用し、ファイル管理は R2 S3 API ドメインへアクセスします。',
    accessHint: 'Cloudflare 上の実際の公開設定は変更しません。公開ドメインと署名付き URL のどちらを使うかだけを指定します。',
    connection: '接続と CORS チェック', origin: '現在の Origin', test: '現在の Bucket をテスト', testing: 'テスト中…', testOk: '接続に成功しました。この認証情報で Bucket を読み取れます。',
    testFirst: '先にこの Bucket へ切り替えてからテストしてください。', tokenDenied: 'アクセスが拒否されました。CORS だけでなく、API Token がこの Bucket を許可しているか確認してください。',
    bucketMissing: 'Bucket が存在しないか、名前が正しくありません。', corsFailed: 'ブラウザが応答を読み取れません。CORS の Origin、ネットワーク、Token 権限を確認してください。',
    corsConfig: '推奨 CORS 設定', copyCors: '設定をコピー', copied: 'CORS 設定をコピーしました',
    corsHint: '反映に少し時間がかかる場合があります。必要に応じてプリフライトキャッシュを消去してください。Origin にパスや末尾のスラッシュは不要です。',
  },
}

class BucketManagerUI {
  /** @type {ConfigManager} */
  #config
  /** @type {HTMLDialogElement | null} */
  #dialog = null
  /** @type {string | null} */
  #selectedBucketId = null

  constructor() {
    this.#config = new ConfigManager()
  }

  init() {
    this.#renderSwitcher()
    window.addEventListener('r2-config-changed', () => this.#renderSwitcher())
  }

  /** @param {string} key @param {Record<string, string | number>} [params] */
  #m(key, params = {}) {
    const lang = getCurrentLang()
    let value = (messages[lang] || messages.zh)[key] || messages.zh[key] || key
    for (const [name, replacement] of Object.entries(params)) value = value.replace(`{${name}}`, String(replacement))
    return value
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
      option.textContent = bucket.alias || bucket.name
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
    manage.innerHTML = '<span aria-hidden="true">⚙</span>'
    manage.title = this.#m('manage')
    manage.setAttribute('aria-label', this.#m('manage'))
    manage.addEventListener('click', () => this.#openDialog())

    group.append(select, manage)
    titleGroup.append(group)
  }

  #openDialog() {
    this.#dialog?.remove()
    const active = this.#config.getActiveBucket()
    this.#selectedBucketId = active?.id || null

    const dialog = document.createElement('dialog')
    dialog.className = 'bucket-manager-dialog'
    dialog.innerHTML = `
      <div class="bucket-manager-panel">
        <header class="bucket-manager-header">
          <div>
            <h2></h2>
            <p class="bucket-manager-intro"></p>
            <p class="bucket-manager-account"></p>
          </div>
          <button type="button" class="bucket-dialog-close" aria-label="${this.#m('close')}">×</button>
        </header>
        <div class="bucket-manager-layout">
          <aside class="bucket-sidebar">
            <div class="bucket-sidebar-header">
              <strong></strong>
              <button type="button" class="btn secondary sm bucket-add-btn"></button>
            </div>
            <div class="bucket-nav" role="listbox"></div>
          </aside>
          <main class="bucket-workspace">
            <div class="bucket-editor"></div>
            <section class="bucket-diagnostics"></section>
          </main>
        </div>
        <div class="bucket-manager-status" role="status" aria-live="polite"></div>
      </div>`

    must(dialog, 'h2').textContent = this.#m('manage')
    must(dialog, '.bucket-manager-intro').textContent = this.#m('intro')
    must(dialog, '.bucket-sidebar-header strong').textContent = this.#m('list')
    must(dialog, '.bucket-add-btn').textContent = this.#m('add')
    const profile = this.#config.getActiveProfile()
    must(dialog, '.bucket-manager-account').textContent = `${this.#m('account')}：${profile?.name || this.#m('unnamedAccount')} · ${this.#maskAccount(profile?.accountId || '')}`

    must(dialog, '.bucket-dialog-close').addEventListener('click', () => dialog.close())
    must(dialog, '.bucket-add-btn').addEventListener('click', () => {
      this.#selectedBucketId = null
      this.#renderDialog()
    })
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close()
    })
    dialog.addEventListener('close', () => {
      dialog.remove()
      if (this.#dialog === dialog) this.#dialog = null
    })

    document.body.append(dialog)
    this.#dialog = dialog
    this.#renderDialog()
    dialog.showModal()
  }

  /** @param {string} value */
  #maskAccount(value) {
    if (!value) return '—'
    if (value.length <= 8) return value
    return `${value.slice(0, 4)}…${value.slice(-4)}`
  }

  #renderDialog() {
    this.#renderSidebar()
    this.#renderEditor()
    this.#renderDiagnostics()
  }

  #renderSidebar() {
    if (!this.#dialog) return
    const nav = must(this.#dialog, '.bucket-nav')
    nav.replaceChildren()
    const profile = this.#config.getActiveProfile()
    const active = this.#config.getActiveBucket()

    if (!profile || profile.buckets.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'bucket-empty'
      empty.textContent = this.#m('empty')
      nav.append(empty)
      return
    }

    for (const bucket of profile.buckets) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'bucket-nav-item'
      button.dataset.selected = String(bucket.id === this.#selectedBucketId)
      button.setAttribute('role', 'option')
      button.setAttribute('aria-selected', String(bucket.id === this.#selectedBucketId))

      const text = document.createElement('span')
      const title = document.createElement('strong')
      title.textContent = bucket.alias || bucket.name
      const detail = document.createElement('small')
      detail.textContent = bucket.alias ? bucket.name : bucket.bucketAccess === 'private' ? this.#m('private') : this.#m('public')
      text.append(title, detail)
      button.append(text)

      if (bucket.id === active?.id) {
        const badge = document.createElement('em')
        badge.textContent = this.#m('active')
        button.append(badge)
      }

      button.addEventListener('click', () => {
        this.#selectedBucketId = bucket.id
        this.#renderDialog()
      })
      nav.append(button)
    }
  }

  #renderEditor() {
    if (!this.#dialog) return
    const editor = must(this.#dialog, '.bucket-editor')
    const bucket = this.#config.getBuckets().find((item) => item.id === this.#selectedBucketId) || null
    const active = this.#config.getActiveBucket()
    const isNew = !bucket

    editor.innerHTML = `
      <form class="bucket-editor-form">
        <div class="bucket-editor-heading">
          <div><span class="bucket-editor-kicker"></span><h3></h3></div>
          <span class="bucket-active-badge" hidden></span>
        </div>
        <div class="bucket-field-grid">
          <label><span>${this.#m('name')}</span><input name="name" required autocomplete="off" /></label>
          <label><span>${this.#m('alias')} <small>${this.#m('optional')}</small></span><input name="alias" autocomplete="off" /></label>
          <label class="bucket-field-wide"><span>${this.#m('domain')} <small>${this.#m('optional')}</small></span><input name="customDomain" type="url" autocomplete="off" placeholder="https://cdn.example.com" /></label>
          <label><span>${this.#m('access')}</span><select name="bucketAccess"><option value="public">${this.#m('public')}</option><option value="private">${this.#m('private')}</option></select></label>
        </div>
        <div class="bucket-field-notes"><p>${this.#m('domainHint')}</p><p>${this.#m('accessHint')}</p></div>
        <div class="bucket-editor-actions">
          <button type="button" class="btn danger bucket-remove-btn" ${isNew ? 'hidden' : ''}>${this.#m('remove')}</button>
          <span></span>
          <button type="button" class="btn secondary bucket-switch-btn" ${isNew || bucket?.id === active?.id ? 'disabled' : ''}>${this.#m('switch')}</button>
          <button type="submit" class="btn primary">${this.#m('save')}</button>
        </div>
      </form>`

    must(editor, '.bucket-editor-kicker').textContent = isNew ? this.#m('add') : this.#m('edit')
    must(editor, 'h3').textContent = isNew ? this.#m('newBucket') : bucket.alias || bucket.name
    const badge = must(editor, '.bucket-active-badge')
    if (bucket?.id === active?.id) {
      badge.hidden = false
      badge.textContent = this.#m('active')
    }

    const form = /** @type {HTMLFormElement} */ (must(editor, '.bucket-editor-form'))
    const nameInput = /** @type {HTMLInputElement} */ (must(form, '[name="name"]'))
    const aliasInput = /** @type {HTMLInputElement} */ (must(form, '[name="alias"]'))
    const domainInput = /** @type {HTMLInputElement} */ (must(form, '[name="customDomain"]'))
    const accessInput = /** @type {HTMLSelectElement} */ (must(form, '[name="bucketAccess"]'))
    nameInput.value = bucket?.name || ''
    aliasInput.value = bucket?.alias || ''
    domainInput.value = bucket?.customDomain || ''
    accessInput.value = bucket?.bucketAccess || 'private'

    form.addEventListener('submit', (event) => this.#saveBucket(event, bucket?.id || null))
    must(form, '.bucket-switch-btn').addEventListener('click', () => this.#activateBucket(bucket?.id || ''))
    must(form, '.bucket-remove-btn').addEventListener('click', () => this.#removeBucket(bucket?.id || ''))
  }

  #renderDiagnostics() {
    if (!this.#dialog) return
    const diagnostics = must(this.#dialog, '.bucket-diagnostics')
    const active = this.#config.getActiveBucket()
    const selectedIsActive = Boolean(active && active.id === this.#selectedBucketId)
    const cors = this.#corsPolicy()

    diagnostics.innerHTML = `
      <div class="bucket-diagnostics-heading"><h3>${this.#m('connection')}</h3><button type="button" class="btn secondary sm bucket-test-btn" ${selectedIsActive ? '' : 'disabled'}>${this.#m('test')}</button></div>
      <dl><div><dt>${this.#m('origin')}</dt><dd></dd></div></dl>
      <div class="bucket-cors-card">
        <div><strong>${this.#m('corsConfig')}</strong><button type="button" class="btn secondary sm bucket-copy-cors-btn">${this.#m('copyCors')}</button></div>
        <pre></pre>
        <p>${this.#m('corsHint')}</p>
      </div>`
    must(diagnostics, 'dd').textContent = window.location.origin
    must(diagnostics, 'pre').textContent = cors
    must(diagnostics, '.bucket-test-btn').addEventListener('click', (event) => this.#testConnection(event, selectedIsActive))
    must(diagnostics, '.bucket-copy-cors-btn').addEventListener('click', () => this.#copyCors(cors))
  }

  #corsPolicy() {
    return JSON.stringify(
      [
        {
          AllowedOrigins: [window.location.origin],
          AllowedMethods: ['GET', 'PUT', 'DELETE', 'HEAD'],
          AllowedHeaders: ['Content-Type', 'x-amz-copy-source', 'x-amz-metadata-directive'],
          ExposeHeaders: ['ETag', 'Content-Length', 'Content-Type', 'Last-Modified'],
          MaxAgeSeconds: 3600,
        },
      ],
      null,
      2,
    )
  }

  /** @param {string} cors */
  async #copyCors(cors) {
    try {
      await navigator.clipboard.writeText(cors)
      this.#status(this.#m('copied'))
    } catch (error) {
      this.#status(error instanceof Error ? error.message : String(error), true)
    }
  }

  /** @param {Event} event @param {boolean} selectedIsActive */
  async #testConnection(event, selectedIsActive) {
    if (!selectedIsActive) {
      this.#status(this.#m('testFirst'), true)
      return
    }
    const button = /** @type {HTMLButtonElement} */ (event.currentTarget)
    button.disabled = true
    const oldText = button.textContent
    button.textContent = this.#m('testing')
    try {
      const client = new R2Client()
      client.init(this.#config)
      await client.testConnection()
      this.#status(this.#m('testOk'))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message === 'HTTP_403') this.#status(this.#m('tokenDenied'), true)
      else if (message === 'HTTP_404') this.#status(this.#m('bucketMissing'), true)
      else if (error instanceof TypeError) this.#status(this.#m('corsFailed'), true)
      else this.#status(message, true)
    } finally {
      button.disabled = false
      button.textContent = oldText
    }
  }

  /** @param {Event} event @param {string | null} bucketId */
  #saveBucket(event, bucketId) {
    event.preventDefault()
    const form = /** @type {HTMLFormElement} */ (event.currentTarget)
    const data = new FormData(form)
    const value = {
      name: String(data.get('name') || ''),
      alias: String(data.get('alias') || ''),
      customDomain: String(data.get('customDomain') || ''),
      bucketAccess: data.get('bucketAccess') === 'public' ? /** @type {'public'} */ ('public') : /** @type {'private'} */ ('private'),
    }
    try {
      if (bucketId) {
        this.#config.updateBucket(bucketId, value)
        this.#selectedBucketId = bucketId
        this.#status(this.#m('saved'))
      } else {
        const added = this.#config.addBucket(value)
        this.#selectedBucketId = added.id
        this.#status(this.#m('added'))
      }
      this.#renderDialog()
    } catch (error) {
      this.#status(this.#errorMessage(error), true)
    }
  }

  /** @param {string} bucketId */
  #activateBucket(bucketId) {
    const profile = this.#config.getActiveProfile()
    if (!profile || !bucketId) return
    this.#config.setActiveBucket(profile.id, bucketId)
    window.location.reload()
  }

  /** @param {string} bucketId */
  #removeBucket(bucketId) {
    if (!bucketId || !window.confirm(this.#m('confirmDelete'))) return
    try {
      const wasActive = this.#config.getActiveBucket()?.id === bucketId
      this.#config.removeBucket(bucketId)
      if (wasActive) {
        window.location.reload()
        return
      }
      this.#selectedBucketId = this.#config.getActiveBucket()?.id || null
      this.#status(this.#m('removed'))
      this.#renderDialog()
    } catch (error) {
      this.#status(this.#errorMessage(error), true)
    }
  }

  /** @param {unknown} error */
  #errorMessage(error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'LAST_BUCKET') return this.#m('lastBucket')
    if (message === 'BUCKET_EXISTS') return this.#m('duplicate')
    if (message === 'BUCKET_NAME_REQUIRED') return this.#m('required')
    if (message === 'BUCKET_NAME_INVALID') return this.#m('invalid')
    return message
  }

  /** @param {string} message @param {boolean} [isError] */
  #status(message, isError = false) {
    if (!this.#dialog) return
    const status = must(this.#dialog, '.bucket-manager-status')
    status.textContent = message
    status.dataset.error = String(isError)
  }
}

export { BucketManagerUI }
