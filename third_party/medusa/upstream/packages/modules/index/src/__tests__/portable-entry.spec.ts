import { readFileSync } from "fs"
import { join } from "path"

function readSource(relativePath: string): string {
  return readFileSync(join(__dirname, "..", relativePath), "utf8")
}

describe("Index portable entry", () => {
  it("keeps the portable entry and shared service out of the Postgres import graph", () => {
    const portableEntry = readSource("portable.ts")
    const portableLoader = readSource("loaders/portable.ts")
    const indexModuleService = readSource("services/index-module-service.ts")
    const sqliteIndexStorageProvider = readSource(
      "services/sqlite-index-storage-provider.ts"
    )
    const sqliteQueryBuilder = readSource("utils/sqlite-query-builder.ts")
    const sqliteServiceComposition = readSource(
      "sqlite-index-service-composition.ts"
    )
    const workerComposition = readSource("worker-composition.ts")
    const sqliteIndexWorkerRuntime = readSource(
      "sqlite-index-worker-runtime.ts"
    )
    const sqliteIndexWorkerProofRuntime = readSource(
      "sqlite-index-worker-proof-runtime.ts"
    )
    const sqliteIndexWorkerProofChecks = readSource(
      "sqlite-index-worker-proof-checks.ts"
    )
    const sqliteIndexWorkerEventBus = readSource(
      "sqlite-index-worker-event-bus.ts"
    )
    const sqliteIndexWorkerRemoteQuery = readSource(
      "sqlite-index-worker-remote-query.ts"
    )
    const sqliteIndexWorkerProofDependencies = readSource(
      "sqlite-index-worker-proof-dependencies.ts"
    )
    const sqliteIndexWorkerStaticModuleInput = readSource(
      "sqlite-index-worker-static-module-input.ts"
    )

    for (const source of [
      portableEntry,
      portableLoader,
      indexModuleService,
      sqliteIndexStorageProvider,
      sqliteQueryBuilder,
      sqliteServiceComposition,
      workerComposition,
      sqliteIndexWorkerRuntime,
      sqliteIndexWorkerProofRuntime,
      sqliteIndexWorkerProofChecks,
      sqliteIndexWorkerEventBus,
      sqliteIndexWorkerRemoteQuery,
      sqliteIndexWorkerProofDependencies,
      sqliteIndexWorkerStaticModuleInput,
    ]) {
      expect(source).not.toContain("postgres-provider")
      expect(source).not.toContain("@medusajs/framework/mikro-orm")
      expect(source).not.toContain("MikroOrmBaseRepository")
      expect(source).not.toContain("toMikroORMEntity")
    }
  })

  it("keeps the Worker composition entry out of the proof fixture graph", () => {
    const sqliteServiceComposition = readSource(
      "sqlite-index-service-composition.ts"
    )
    const workerComposition = readSource("worker-composition.ts")
    const sqliteIndexWorkerRuntime = readSource(
      "sqlite-index-worker-runtime.ts"
    )
    const sqliteIndexWorkerProofRuntime = readSource(
      "sqlite-index-worker-proof-runtime.ts"
    )
    const sqliteIndexWorkerProofChecks = readSource(
      "sqlite-index-worker-proof-checks.ts"
    )
    const sqliteIndexWorkerEventBus = readSource(
      "sqlite-index-worker-event-bus.ts"
    )
    const sqliteIndexWorkerRemoteQuery = readSource(
      "sqlite-index-worker-remote-query.ts"
    )
    const sqliteIndexWorkerProofDependencies = readSource(
      "sqlite-index-worker-proof-dependencies.ts"
    )
    const sqliteIndexWorkerStaticModuleInput = readSource(
      "sqlite-index-worker-static-module-input.ts"
    )

    for (const source of [
      sqliteServiceComposition,
      workerComposition,
      sqliteIndexWorkerRuntime,
      sqliteIndexWorkerProofRuntime,
      sqliteIndexWorkerProofChecks,
      sqliteIndexWorkerEventBus,
      sqliteIndexWorkerRemoteQuery,
      sqliteIndexWorkerProofDependencies,
      sqliteIndexWorkerStaticModuleInput,
    ]) {
      expect(source).not.toContain("relation-query-proof-fixture")
      expect(source).not.toContain("relation-query-proof-runner")
    }
  })
})
