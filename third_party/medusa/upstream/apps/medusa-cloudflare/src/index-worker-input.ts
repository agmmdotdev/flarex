import {
  createSqliteIndexWorkerStaticModuleInput,
} from "@medusajs/index/worker-composition"
import { indexWorkerStaticManifest } from "./index-worker-static-manifest"

export const indexWorkerInput = createSqliteIndexWorkerStaticModuleInput({
  manifest: indexWorkerStaticManifest,
})
