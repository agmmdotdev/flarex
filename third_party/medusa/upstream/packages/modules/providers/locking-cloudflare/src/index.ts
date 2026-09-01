import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import {
  CloudflareDurableObjectLockingProvider,
  lockingCloudflareProvider,
} from "./provider"

export {
  CloudflareDurableObjectLockingProvider,
  lockingCloudflareProvider,
}

export default ModuleProvider(Modules.LOCKING, lockingCloudflareProvider)
