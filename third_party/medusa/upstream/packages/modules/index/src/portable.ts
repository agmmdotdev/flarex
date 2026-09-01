import { Module, Modules } from "@medusajs/framework/utils/portable"
import { IndexModuleService } from "./services"
import portableLoader from "./loaders/portable"

export { portableLoader }
export { SqliteIndexStorageProvider } from "./services/sqlite-index-storage-provider"
export type { PortableIndexLoaderOptions } from "./loaders/portable"
export type {
  SqliteIndexExecutor,
  SqliteIndexValue,
} from "./services/sqlite-index-storage-provider"

export default Module(Modules.INDEX, {
  service: IndexModuleService,
  loaders: [portableLoader],
})
