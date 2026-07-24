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
    current: '当前 Bucket',
    add: '添加 Bucket',
    addTitle: '添加新的 Bucket',
    name: 'Bucket 名称',
    alias: '显示名称',
    optional: '可选',
    domain: '自定义域名',
    access: '链接访问方式',
    public: '公开域名',
    private: '预签名链接',
    remove: '删除当前 Bucket',
    test: '测试连接',
    testing: '正在测试…',
    cancel: '取消',
    confirmAdd: '添加并切换',
    count: '已配置 {count} 个 Bucket',
    intro: 'Bucket 使用同一组账户凭据，通过设置页手动管理。切换后页面会刷新。',
    aliasHint: '显示名称只用于界面展示，不会修改 Cloudflare 中的 Bucket 名称。',
    domainHint: '自定义域名只用于生成公开文件链接；文件管理始终访问 R2 S3 API。',
    accessHint: '此选项只决定复制链接时使用公开域名还是预签名 URL，不会修改 Bucket 的真实公开状态。',
    added: 'Bucket 已添加，正在切换…',
    removed: 'Bucket 配置已删除',
    confirmDelete: '只删除浏览器中的本地配置，不会删除 Cloudflare R2 中的真实 Bucket。确认继续？',
    lastBucket: '至少需要保留一个 Bucket',
    duplicate: '该 Bucket 已存在',
    required: '请输入 Bucket 名称',
    invalid: 'Bucket 名称格式不正确',
    diagnostics: '连接与跨域',
    origin: '当前网页 Origin',
    corsConfig: '推荐 CORS 配置',
    copyCors: '复制配置',
    copied: 'CORS 配置已复制',
    testOk: '连接成功，当前凭据可以读取此 Bucket。',
    tokenDenied: '访问被拒绝。请确认 API Token 已授权当前 Bucket，而不只是配置了 CORS。',
    bucketMissing: 'Bucket 不存在或名称填写错误。',
    corsFailed: '浏览器无法读取响应。请检查当前 Origin、网络和 Token 权限。',
    corsHint: 'Origin 不要包含路径或结尾斜杠。修改 CORS 后可能需要清除旧的预检缓存。',
  },
  zh_TW: {
    current: '目前 Bucket',
    add: '新增 Bucket',
    addTitle: '新增 Bucket',
    name: 'Bucket 名稱',
    alias: '顯示名稱',
    optional: '選填',
    domain: '自訂網域',
    access: '連結存取方式',
    public: '公開網域',
    private: '預簽名連結',
    remove: '刪除目前 Bucket',
    test: '測試連線',
    testing: '測試中…',
    cancel: '取消',
    confirmAdd: '新增並切換',
    count: '已設定 {count} 個 Bucket',
    intro: 'Bucket 共用同一組帳戶憑證，透過設定頁手動管理。切換後頁面會重新整理。',
    aliasHint: '顯示名稱只用於介面，不會修改 Cloudflare 中的 Bucket 名稱。',
    domainHint: '自訂網域只用於產生公開連結；檔案管理仍存取 R2 S3 API。',
    accessHint: '此選項只決定公開網域或預簽名 URL，不會修改 Bucket 的真實公開狀態。',
    added: 'Bucket 已新增，正在切換…',
    removed: 'Bucket 設定已刪除',
    confirmDelete: '只刪除瀏覽器中的本機設定，不會刪除 Cloudflare R2 中的真實 Bucket。確定繼續？',
    lastBucket: '至少需要保留一個 Bucket',
    duplicate: '此 Bucket 已存在',
    required: '請輸入 Bucket 名稱',
    invalid: 'Bucket 名稱格式不正確',
    diagnostics: '連線與跨網域',
    origin: '目前網頁 Origin',
    corsConfig: '建議 CORS 設定',
    copyCors: '複製設定',
    copied: 'CORS 設定已複製',
    testOk: '連線成功，目前憑證可以讀取此 Bucket。',
    tokenDenied: '存取遭拒。請確認 API Token 已授權目前 Bucket，而不只是設定了 CORS。',
    bucketMissing: 'Bucket 不存在或名稱錯誤。',
    corsFailed: '瀏覽器無法讀取回應。請檢查目前 Origin、網路和 Token 權限。',
    corsHint: 'Origin 不要包含路徑或結尾斜線。修改 CORS 後可能需要清除舊的預檢快取。',
  },
  en: {
    current: 'Current bucket',
    add: 'Add bucket',
    addTitle: 'Add a bucket',
    name: 'Bucket name',
    alias: 'Display name',
    optional: 'Optional',
    domain: 'Custom domain',
    access: 'Link mode',
    public: 'Public domain',
    private: 'Presigned URL',
    remove: 'Remove current bucket',
    test: 'Test connection',
    testing: 'Testing…',
    cancel: 'Cancel',
    confirmAdd: 'Add and switch',
    count: '{count} buckets configured',
    intro: 'Buckets share the same account credentials and are managed manually in Settings. Switching reloads the page.',
    aliasHint: 'The display name is only used in the interface and does not rename the Cloudflare bucket.',
    domainHint: 'The custom domain is only used for public links. File management always uses the R2 S3 API.',
    accessHint: 'This only controls public-domain versus presigned links. It does not change the real bucket visibility.',
    added: 'Bucket added. Switching…',
    removed: 'Bucket configuration removed',
    confirmDelete: 'This only removes the local browser configuration. It will not delete the real R2 bucket. Continue?',
    lastBucket: 'Keep at least one bucket',
    duplicate: 'This bucket already exists',
    required: 'Enter a bucket name',
    invalid: 'Invalid bucket name',
    diagnostics: 'Connection and CORS',
    origin: 'Current page origin',
    corsConfig: 'Recommended CORS policy',
    copyCors: 'Copy policy',
    copied: 'CORS policy copied',
    testOk: 'Connection succeeded. The credentials can read this bucket.',
    tokenDenied: 'Access denied. Confirm that the API token is authorized for this bucket, not only that CORS is configured.',
    bucketMissing: 'The bucket does not exist or its name is incorrect.',
    corsFailed: 'The browser could not read the response. Check the exact origin, network access, and token scope.',
    corsHint: 'Do not include a path or trailing slash in Origin. Clear cached preflight responses after changing CORS.',
  },
  ja: {
    current: '現在の Bucket',
    add: 'Bucket を追加',
    addTitle: 'Bucket を追加',
    name: 'Bucket 名',
    alias: '表示名',
    optional: '任意',
    domain: 'カスタムドメイン',
    access: 'リンク方式',
    public: '公開ドメイン',
    private: '署名付き URL',
    remove: '現在の Bucket を削除',
    test: '接続テスト',
    testing: 'テスト中…',
    cancel: 'キャンセル',
    confirmAdd: '追加して切り替え',
    count: '{count} 個の Bucket を設定済み',
    intro: 'Bucket は同じアカウント認証情報を共有し、設定画面で手動管理します。切り替え時にページを再読み込みします。',
    aliasHint: '表示名は画面表示専用で、Cloudflare 上の Bucket 名は変更しません。',
    domainHint: 'カスタムドメインは公開リンク生成にのみ使用し、ファイル管理は R2 S3 API を使用します。',
    accessHint: '公開ドメインと署名付き URL の選択だけを制御し、Bucket の実際の公開状態は変更しません。',
    added: 'Bucket を追加しました。切り替えています…',
    removed: 'Bucket 設定を削除しました',
    confirmDelete: 'ブラウザ内の設定のみ削除し、Cloudflare R2 の実 Bucket は削除しません。続行しますか？',
    lastBucket: '少なくとも 1 つの Bucket を残してください',
    duplicate: 'この Bucket は既に存在します',
    required: 'Bucket 名を入力してください',
    invalid: 'Bucket 名の形式が正しくありません',
    diagnostics: '接続と CORS',
    origin: '現在のページ Origin',
    corsConfig: '推奨 CORS 設定',
    copyCors: '設定をコピー',
    copied: 'CORS 設定をコピーしました',
    testOk: '接続に成功しました。この認証情報で Bucket を読み取れます。',
    tokenDenied: 'アクセスが拒否されました。CORS だけでなく、API Token がこの Bucket を許可しているか確認してください。',
    bucketMissing: 'Bucket が存在しないか、名前が正しくありません。',
    corsFailed: 'ブラウザが応答を読み取れません。Origin、ネットワーク、Token 権限を確認してください。',
    corsHint: 'Origin にパスや末尾のスラッシュを含めないでください。CORS 変更後はプリフライトキャッシュを消去してください。',
  },
}

class BucketManagerUI {
  /** @type {ConfigManager} */
  #config
  /** @type {MutationObserver | null} */
  #dialogObserver = null
  #bound = false

  constructor() {
    this.#config = new ConfigManager()
  }

  init() {
    this.#renderSwitcher()
    this.#ensureSettingsUI()
    this.#observeConfigDialog()
    window.addEventListener('r2-config-changed', () => {
      this.#renderSwitcher()
      this.#renderSettings()
    })
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
    select.setAttribute('aria-label', this.#m('current'))
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

    group.append(select)
    titleGroup.append(group)
  }

  #ensureSettingsUI() {
    if (document.querySelector('#bucket-settings-manager')) return
    const section = document.querySelector('[data-panel="r2"] .config-section')
    const bucketField = document.querySelector('#cfg-bucket')?.closest('.field')
    const domainField = document.querySelector('#cfg-custom-domain')?.closest('.field')
    if (!section || !bucketField || !domainField) return

    const manager = document.createElement('section')
    manager.id = 'bucket-settings-manager'
    manager.className = 'bucket-settings-manager'
    manager.innerHTML = `
      <div class="bucket-settings-heading">
        <div>
          <h3></h3>
          <p class="bucket-settings-intro"></p>
        </div>
        <button type="button" class="btn secondary sm bucket-add-toggle"></button>
      </div>
      <div class="field bucket-current-field">
        <div class="field-label">
          <label for="bucket-settings-select"></label>
          <span class="bucket-count"></span>
        </div>
        <div class="bucket-control-row">
          <select id="bucket-settings-select"></select>
          <button type="button" class="btn secondary sm bucket-test-btn"></button>
          <button type="button" class="btn secondary sm bucket-remove-btn"></button>
        </div>
      </div>
      <div class="bucket-add-panel" hidden>
        <div class="bucket-add-panel-heading"></div>
        <div class="bucket-add-grid">
          <div class="field">
            <div class="field-label"><label for="bucket-add-name"></label></div>
            <input id="bucket-add-name" autocomplete="off" />
          </div>
          <div class="field">
            <div class="field-label"><label for="bucket-add-alias"></label></div>
            <input id="bucket-add-alias" autocomplete="off" />
          </div>
          <div class="field">
            <div class="field-label"><label for="bucket-add-domain"></label></div>
            <input id="bucket-add-domain" type="url" autocomplete="off" placeholder="https://cdn.example.com" />
          </div>
          <div class="field">
            <div class="field-label"><label for="bucket-add-access"></label></div>
            <select id="bucket-add-access">
              <option value="public"></option>
              <option value="private"></option>
            </select>
          </div>
        </div>
        <div class="bucket-add-actions">
          <button type="button" class="btn secondary bucket-add-cancel"></button>
          <button type="button" class="btn primary bucket-add-confirm"></button>
        </div>
      </div>
      <div class="bucket-settings-status" role="status" aria-live="polite"></div>
      <details class="bucket-cors-details">
        <summary></summary>
        <div class="bucket-cors-content">
          <dl><div><dt></dt><dd></dd></div></dl>
          <div class="bucket-cors-header">
            <strong></strong>
            <button type="button" class="btn secondary sm bucket-copy-cors"></button>
          </div>
          <pre></pre>
          <p></p>
        </div>
      </details>`

    section.insertBefore(manager, bucketField)

    const aliasField = document.createElement('div')
    aliasField.id = 'bucket-alias-field'
    aliasField.className = 'field'
    aliasField.innerHTML = `
      <div class="field-label">
        <label for="cfg-bucket-alias"></label>
      </div>
      <input id="cfg-bucket-alias" name="bucketAlias" type="text" autocomplete="off" />
      <small class="field-hint"></small>`
    domainField.parentNode?.insertBefore(aliasField, domainField)

    this.#bindSettingsEvents()
    this.#renderSettings()
  }

  #observeConfigDialog() {
    const dialog = document.querySelector('#config-dialog')
    if (!dialog || this.#dialogObserver) return
    this.#dialogObserver = new MutationObserver(() => {
      if (dialog.hasAttribute('open')) queueMicrotask(() => this.#renderSettings())
    })
    this.#dialogObserver.observe(dialog, { attributes: true, attributeFilter: ['open'] })
  }

  #bindSettingsEvents() {
    if (this.#bound) return
    const manager = /** @type {HTMLElement | null} */ (document.querySelector('#bucket-settings-manager'))
    if (!manager) return
    this.#bound = true

    must(manager, '.bucket-add-toggle').addEventListener('click', () => this.#toggleAddPanel(true))
    must(manager, '.bucket-add-cancel').addEventListener('click', () => this.#toggleAddPanel(false))
    must(manager, '.bucket-add-confirm').addEventListener('click', () => this.#addBucket())
    must(manager, '.bucket-remove-btn').addEventListener('click', () => this.#removeCurrentBucket())
    must(manager, '.bucket-test-btn').addEventListener('click', (event) => this.#testConnection(event))
    must(manager, '.bucket-copy-cors').addEventListener('click', () => this.#copyCors())
    must(manager, '#bucket-settings-select').addEventListener('change', (event) => {
      const profile = this.#config.getActiveProfile()
      const select = /** @type {HTMLSelectElement} */ (event.currentTarget)
      if (!profile || !select.value) return
      this.#config.setActiveBucket(profile.id, select.value)
      window.location.reload()
    })

    const submit = document.querySelector('#config-submit')
    submit?.addEventListener(
      'click',
      () => {
        const active = this.#config.getActiveBucket()
        const alias = /** @type {HTMLInputElement | null} */ (document.querySelector('#cfg-bucket-alias'))
        if (active && alias) this.#config.updateBucket(active.id, { alias: alias.value.trim() })
      },
      { capture: true },
    )
  }

  #renderSettings() {
    const manager = /** @type {HTMLElement | null} */ (document.querySelector('#bucket-settings-manager'))
    if (!manager) return
    const profile = this.#config.getActiveProfile()
    const active = this.#config.getActiveBucket()
    const buckets = profile?.buckets || []

    must(manager, '.bucket-settings-heading h3').textContent = this.#m('current')
    must(manager, '.bucket-settings-intro').textContent = this.#m('intro')
    must(manager, '.bucket-add-toggle').textContent = this.#m('add')
    must(manager, '.bucket-current-field label').textContent = this.#m('current')
    must(manager, '.bucket-count').textContent = this.#m('count', { count: buckets.length })
    must(manager, '.bucket-test-btn').textContent = this.#m('test')
    must(manager, '.bucket-remove-btn').textContent = this.#m('remove')
    must(manager, '.bucket-add-panel-heading').textContent = this.#m('addTitle')
    must(manager, 'label[for="bucket-add-name"]').textContent = this.#m('name')
    must(manager, 'label[for="bucket-add-alias"]').textContent = `${this.#m('alias')} · ${this.#m('optional')}`
    must(manager, 'label[for="bucket-add-domain"]').textContent = `${this.#m('domain')} · ${this.#m('optional')}`
    must(manager, 'label[for="bucket-add-access"]').textContent = this.#m('access')
    must(manager, '#bucket-add-access option[value="public"]').textContent = this.#m('public')
    must(manager, '#bucket-add-access option[value="private"]').textContent = this.#m('private')
    must(manager, '.bucket-add-cancel').textContent = this.#m('cancel')
    must(manager, '.bucket-add-confirm').textContent = this.#m('confirmAdd')

    const selector = /** @type {HTMLSelectElement} */ (must(manager, '#bucket-settings-select'))
    selector.replaceChildren()
    for (const bucket of buckets) {
      const option = document.createElement('option')
      option.value = bucket.id
      option.textContent = bucket.alias ? `${bucket.alias} · ${bucket.name}` : bucket.name
      option.selected = bucket.id === active?.id
      selector.append(option)
    }
    selector.disabled = buckets.length === 0

    const removeButton = /** @type {HTMLButtonElement} */ (must(manager, '.bucket-remove-btn'))
    removeButton.disabled = buckets.length <= 1

    const aliasLabel = document.querySelector('#bucket-alias-field label')
    const aliasHint = document.querySelector('#bucket-alias-field .field-hint')
    const aliasInput = /** @type {HTMLInputElement | null} */ (document.querySelector('#cfg-bucket-alias'))
    if (aliasLabel) aliasLabel.textContent = `${this.#m('alias')}（${this.#m('optional')}）`
    if (aliasHint) aliasHint.textContent = this.#m('aliasHint')
    if (aliasInput) aliasInput.value = active?.alias || ''

    must(manager, '.bucket-cors-details summary').textContent = this.#m('diagnostics')
    must(manager, '.bucket-cors-content dt').textContent = this.#m('origin')
    must(manager, '.bucket-cors-content dd').textContent = window.location.origin
    must(manager, '.bucket-cors-header strong').textContent = this.#m('corsConfig')
    must(manager, '.bucket-copy-cors').textContent = this.#m('copyCors')
    must(manager, '.bucket-cors-content pre').textContent = this.#corsPolicy()
    must(manager, '.bucket-cors-content p').textContent = this.#m('corsHint')

    manager.hidden = !profile || buckets.length === 0
  }

  /** @param {boolean} open */
  #toggleAddPanel(open) {
    const panel = /** @type {HTMLElement | null} */ (document.querySelector('.bucket-add-panel'))
    if (!panel) return
    panel.hidden = !open
    if (open) {
      const name = /** @type {HTMLInputElement | null} */ (panel.querySelector('#bucket-add-name'))
      name?.focus()
    } else {
      panel.querySelectorAll('input').forEach((input) => {
        input.value = ''
      })
      const access = /** @type {HTMLSelectElement | null} */ (panel.querySelector('#bucket-add-access'))
      if (access) access.value = 'private'
      this.#status('')
    }
  }

  #addBucket() {
    const name = /** @type {HTMLInputElement} */ (must(document, '#bucket-add-name'))
    const alias = /** @type {HTMLInputElement} */ (must(document, '#bucket-add-alias'))
    const domain = /** @type {HTMLInputElement} */ (must(document, '#bucket-add-domain'))
    const access = /** @type {HTMLSelectElement} */ (must(document, '#bucket-add-access'))
    try {
      const bucket = this.#config.addBucket({
        name: name.value,
        alias: alias.value,
        customDomain: domain.value,
        bucketAccess: access.value === 'public' ? 'public' : 'private',
      })
      const profile = this.#config.getActiveProfile()
      if (!profile) return
      this.#status(this.#m('added'))
      this.#config.setActiveBucket(profile.id, bucket.id)
      window.location.reload()
    } catch (error) {
      this.#status(this.#errorMessage(error), true)
    }
  }

  #removeCurrentBucket() {
    const active = this.#config.getActiveBucket()
    if (!active || !window.confirm(this.#m('confirmDelete'))) return
    try {
      this.#config.removeBucket(active.id)
      this.#status(this.#m('removed'))
      window.location.reload()
    } catch (error) {
      this.#status(this.#errorMessage(error), true)
    }
  }

  /** @param {Event} event */
  async #testConnection(event) {
    const button = /** @type {HTMLButtonElement} */ (event.currentTarget)
    const oldText = button.textContent
    button.disabled = true
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

  async #copyCors() {
    try {
      await navigator.clipboard.writeText(this.#corsPolicy())
      this.#status(this.#m('copied'))
    } catch (error) {
      this.#status(error instanceof Error ? error.message : String(error), true)
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
    const status = document.querySelector('.bucket-settings-status')
    if (!status) return
    status.textContent = message
    status.setAttribute('data-error', String(isError))
  }
}

export { BucketManagerUI }
