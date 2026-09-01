import { resolve } from "node:path"

import { model } from "@medusajs/framework/utils"
import {
  isPGliteModuleTestConnection,
  moduleIntegrationTestRunner,
  pgliteModuleTestPersistenceAdapter,
  resolveTestWorkerIdentity,
  type ModuleTestConnection,
  type ModuleTestPersistenceAdapter,
  type PGliteModuleTestConnection,
} from "@medusajs/test-utils"

const CONTRACT_TIMEOUT = 10_000
const lifecycleEvents: string[] = []
let activeTest = false
let foundationConnection: PGliteModuleTestConnection | null = null
let foundationDatabaseName: string | null = null

const LifecycleProbe = model.define("runnerLifecycleProbe", {
  id: model.id().primaryKey(),
})
const testModuleFixturePath = resolve(
  process.cwd(),
  "dist/__fixtures__/test-module"
)

const lifecyclePersistenceAdapter = {
  ...pgliteModuleTestPersistenceAdapter,
  name: "pglite-runner-lifecycle-foundation",

  createDatabaseConfig(options) {
    foundationDatabaseName = options.dbName
    return pgliteModuleTestPersistenceAdapter.createDatabaseConfig(options)
  },

  createConnection(dbConfig) {
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected the lifecycle foundation to use PGlite")
    }

    foundationConnection = connection
    lifecycleEvents.push("connection:create")
    return connection
  },

  prepareDatabase(options) {
    const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase(options)
    const setupDatabase = prepared.database.setupDatabase.bind(
      prepared.database
    )
    const clearDatabase = prepared.database.clearDatabase.bind(
      prepared.database
    )

    lifecycleEvents.push("database:prepare")

    return {
      ...prepared,
      database: {
        async setupDatabase(): Promise<void> {
          await setupDatabase()
          lifecycleEvents.push("database:setup")
        },
        async clearDatabase(): Promise<void> {
          await clearDatabase()
          lifecycleEvents.push("database:clear")
        },
      },
    }
  },

  async cleanupConnection(connection: ModuleTestConnection): Promise<void> {
    await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)

    if (
      !isPGliteModuleTestConnection(connection) ||
      !connection.client.closed
    ) {
      throw new Error("Expected PGlite cleanup to close the foundation client")
    }

    lifecycleEvents.push("connection:cleanup")
  },
} satisfies ModuleTestPersistenceAdapter

if (process.env.MEDUSA_PGLITE_TESTS !== "1") {
  throw new Error(
    "The module integration lifecycle foundation requires MEDUSA_PGLITE_TESTS=1"
  )
}

describe("runner-neutral module integration lifecycle", () => {
  beforeAll(() => {
    lifecycleEvents.push("suite:before-all")
  }, CONTRACT_TIMEOUT)

  moduleIntegrationTestRunner({
    moduleName: "test",
    moduleModels: [LifecycleProbe],
    moduleOptions: {
      lifecycleFoundation: true,
    },
    persistenceAdapter: lifecyclePersistenceAdapter,
    resolve: testModuleFixturePath,
    hooks: {
      async beforeModuleInit(): Promise<void> {
        lifecycleEvents.push("hook:before-module-init")
      },
      async afterModuleInit(): Promise<void> {
        lifecycleEvents.push("hook:after-module-init")
      },
    },
    testSuite: () => {
      describe("ordered hooks", () => {
        it(
          "initializes the first test after setup and module hooks",
          () => {
            expect(activeTest).toBe(false)
            activeTest = true
            lifecycleEvents.push("test:first")

            const identity = resolveTestWorkerIdentity()
            expect(process.env.MEDUSA_MODULE_TEST_PERSISTENCE).toBe("pglite")
            expect(process.env.MEDUSA_PGLITE_TESTS).toBe("1")
            expect(process.env.DB_TEMP_NAME).toBeDefined()
            if (process.env.MEDUSA_TEST_EXPECT_GENERATED_DB_TEMP_NAME === "1") {
              expect(process.env.DB_TEMP_NAME).toBe(
                `medusa-integration-${identity.databaseSuffix}-1`
              )
            }
            expect(foundationDatabaseName).toBe(
              `medusa-test-integration-${identity.databaseSuffix}`
            )
            expect(globalThis.performance).toBeDefined()
            expect(lifecycleEvents).toEqual([
              "connection:create",
              "database:prepare",
              "suite:before-all",
              "database:setup",
              "hook:before-module-init",
              "hook:after-module-init",
              "test:first",
            ])
          },
          CONTRACT_TIMEOUT
        )

        it(
          "cleans the first test before initializing the second",
          () => {
            expect(activeTest).toBe(false)
            activeTest = true
            lifecycleEvents.push("test:second")

            expect(lifecycleEvents).toEqual([
              "connection:create",
              "database:prepare",
              "suite:before-all",
              "database:setup",
              "hook:before-module-init",
              "hook:after-module-init",
              "test:first",
              "database:clear",
              "contract:after-each",
              "database:setup",
              "hook:before-module-init",
              "hook:after-module-init",
              "test:second",
            ])
          },
          CONTRACT_TIMEOUT
        )
      })
    },
  })

  afterEach(() => {
    expect(activeTest).toBe(true)
    expect(lifecycleEvents.at(-1)).toBe("database:clear")
    activeTest = false
    lifecycleEvents.push("contract:after-each")
  }, CONTRACT_TIMEOUT)

  afterAll(() => {
    expect(activeTest).toBe(false)
    expect(lifecycleEvents).toEqual([
      "connection:create",
      "database:prepare",
      "suite:before-all",
      "database:setup",
      "hook:before-module-init",
      "hook:after-module-init",
      "test:first",
      "database:clear",
      "contract:after-each",
      "database:setup",
      "hook:before-module-init",
      "hook:after-module-init",
      "test:second",
      "database:clear",
      "contract:after-each",
      "connection:cleanup",
    ])

    if (!foundationConnection) {
      throw new Error("Expected the lifecycle foundation connection")
    }

    expect(foundationConnection.client.closed).toBe(true)
  }, CONTRACT_TIMEOUT)
})
