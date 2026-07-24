import { getCurrentLang } from './i18n.js'

const notices = {
  zh: '分享链接不包含账户凭据；接收方需要自行配置 Account ID 和访问密钥。',
  zh_TW: '分享連結不包含帳戶憑證；接收方需要自行設定 Account ID 和存取金鑰。',
  en: 'The shared link does not include account credentials. The recipient must configure their own Account ID and access keys.',
  ja: '共有リンクにはアカウント認証情報が含まれません。受信者は自身の Account ID とアクセスキーを設定する必要があります。',
}

class ShareConfigSecurityNotice {
  init() {
    this.#apply()
    window.addEventListener('r2-config-changed', () => this.#apply())
  }

  #apply() {
    const warning = document.querySelector('#share-warning')
    if (!warning) return
    warning.textContent = notices[getCurrentLang()] || notices.zh
  }
}

export { ShareConfigSecurityNotice }
