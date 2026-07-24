import { App } from './js/app.js'
import { BucketManagerUI } from './js/bucket-manager.js'
import { ShareConfigSecurityNotice } from './js/share-config-security.js'
import { initGlobalErrorHandler } from './js/global-error-handler.js'

// Boot
initGlobalErrorHandler()
new App()
new BucketManagerUI().init()
new ShareConfigSecurityNotice().init()
