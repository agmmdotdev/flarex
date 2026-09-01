import {
  createSqliteIndexWorkerEventBus,
  createSqliteIndexWorkerProofRuntime,
  createSqliteIndexWorkerRemoteQuery,
  type SqliteIndexExecutor,
  type SqliteIndexWorkerRuntimeOptions,
} from "../worker-composition"

class UnusedExecutor implements SqliteIndexExecutor {
  async execute(): Promise<readonly Record<string, never>[]> {
    throw new Error("Proof runtime constructor should not execute SQL")
  }
}

describe("SQLite Index Worker proof runtime", () => {
  it("assigns stable instance ids without starting the service", () => {
    const firstRuntime = createSqliteIndexWorkerProofRuntime(
      createRuntimeOptions()
    )
    const secondRuntime = createSqliteIndexWorkerProofRuntime(
      createRuntimeOptions()
    )

    expect(firstRuntime.instanceId).not.toEqual(secondRuntime.instanceId)
    expect(firstRuntime.instanceId).toEqual(firstRuntime.instanceId)
    expect(firstRuntime.serviceInitializations).toEqual(0)
    expect(secondRuntime.serviceInitializations).toEqual(0)
  })
})

function createRuntimeOptions(): SqliteIndexWorkerRuntimeOptions {
  return {
    eventBus: createSqliteIndexWorkerEventBus(),
    executor: new UnusedExecutor(),
    joinerConfigs: [],
    query: createSqliteIndexWorkerRemoteQuery({ records: [] }),
    schema: `
      type ProductCategory @Listeners(values: ["product.product-category.created"]) {
        id: ID!
      }
    `,
    workerMode: "worker",
  }
}
