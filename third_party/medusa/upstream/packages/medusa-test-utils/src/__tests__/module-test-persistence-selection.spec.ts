import { mikroOrmModuleTestPersistenceAdapter } from "../module-test-persistence-adapter"
import { getConfiguredPersistenceAdapter } from "../module-test-runner"
import { pgliteModuleTestPersistenceAdapter } from "../pglite-module-test-persistence-adapter"

describe("module test persistence selection", () => {
  const originalPersistence = process.env.MEDUSA_MODULE_TEST_PERSISTENCE

  afterEach(() => {
    if (originalPersistence === undefined) {
      delete process.env.MEDUSA_MODULE_TEST_PERSISTENCE
      return
    }

    process.env.MEDUSA_MODULE_TEST_PERSISTENCE = originalPersistence
  })

  it("defaults to the MikroORM adapter", () => {
    delete process.env.MEDUSA_MODULE_TEST_PERSISTENCE

    expect(getConfiguredPersistenceAdapter()).toBe(
      mikroOrmModuleTestPersistenceAdapter
    )
  })

  it("allows explicitly selecting the MikroORM adapter", () => {
    process.env.MEDUSA_MODULE_TEST_PERSISTENCE = "mikroorm"

    expect(getConfiguredPersistenceAdapter()).toBe(
      mikroOrmModuleTestPersistenceAdapter
    )
  })

  it("selects the PGlite adapter", () => {
    process.env.MEDUSA_MODULE_TEST_PERSISTENCE = "pglite"

    expect(getConfiguredPersistenceAdapter()).toBe(
      pgliteModuleTestPersistenceAdapter
    )
  })

  it("rejects unknown adapter values", () => {
    process.env.MEDUSA_MODULE_TEST_PERSISTENCE = "sqlite"

    expect(() => getConfiguredPersistenceAdapter()).toThrow(
      'Unsupported MEDUSA_MODULE_TEST_PERSISTENCE value "sqlite"'
    )
  })
})
