import { App } from './js/app.js'
import { BucketManagerUI } from './js/bucket-manager.js'
import { ShareConfigSecurityNotice } from './js/share-config-security.js'
import { installSmoothBucketSwitch } from './js/smooth-bucket-switch.js'

installSmoothBucketSwitch()

// Boot
new App()
new BucketManagerUI().init()
new ShareConfigSecurityNotice().init()
