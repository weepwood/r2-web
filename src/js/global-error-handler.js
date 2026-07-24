import { UIManager } from './ui-manager.js'
import { getErrorMessage } from './utils.js'
import { t } from './i18n.js'

/**
 * 公共异步入口（拖拽、粘贴、文件选择器）有部分事件回调不会 await Promise。
 * 这里仅处理已知的 R2 请求错误，避免 403 或网络中断变成无提示的 unhandled rejection。
 */
function initGlobalErrorHandler() {
  const ui = new UIManager()

  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason
    if (!(error instanceof Error)) return

    const isHttpError = ['HTTP_401', 'HTTP_403', 'HTTP_404'].includes(error.message)
    const isFetchError = error instanceof TypeError && /failed to fetch|networkerror/i.test(error.message)
    if (!isHttpError && !isFetchError) return

    event.preventDefault()
    const errorKey = getErrorMessage(error)
    if (errorKey === 'networkError') {
      ui.toast(t('networkError', { msg: error.message }), 'error')
    } else {
      ui.toast(t(errorKey), 'error')
    }
  })
}

export { initGlobalErrorHandler }
