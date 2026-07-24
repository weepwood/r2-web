import { App } from './js/app.js'
import { BucketManagerUI } from './js/bucket-manager.js'
import { ShareConfigSecurityNotice } from './js/share-config-security.js'

// Boot
new App()
new BucketManagerUI().init()
new ShareConfigSecurityNotice().init()
