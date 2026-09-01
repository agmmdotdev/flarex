import { ModuleExports } from "@medusajs/framework/types"
import CloudflareEventBus from "./services/event-bus-cloudflare"

export const service = CloudflareEventBus
export const loaders = []

const moduleDefinition: ModuleExports = {
  service,
  loaders,
}

export default moduleDefinition
export { CloudflareEventBus }
export type {
  CloudflareEventBusModuleOptions,
  CloudflareEventBusQueuedMessage,
  CloudflareQueueProducer,
} from "./types"
export { isCloudflareEventBusQueuedMessage } from "./types"
