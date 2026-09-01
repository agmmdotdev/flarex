import {
  FreeTextSearchFilterKeyPrefix,
  SoftDeletableFilterKey,
  model,
} from "@medusajs/framework/utils"
import {
  isPGliteModuleTestConnection,
  pgliteModulePersistenceAdapter,
  pgliteModuleTestPersistenceAdapter,
} from "../pglite-module-test-persistence-adapter"

const describePGlite =
  process.env.MEDUSA_PGLITE_TESTS === "1" ? describe : describe.skip

type PGliteRepositoryProbe = {
  create(data: Record<string, unknown>[]): Promise<Record<string, unknown>[]>
  delete(ids: string[]): Promise<string[]>
  update(
    data: Array<{
      entity: Record<string, unknown>
      update: Record<string, unknown>
    }>
  ): Promise<Record<string, unknown>[]>
  find(options: {
    where: Record<string, unknown>
    options?: {
      fields?: string[]
      filters?: Record<string | symbol, unknown>
      populateWhere?: Record<string, unknown>
      relations?: string[]
      orderBy?: Record<string, "ASC" | "DESC" | Record<string, "ASC" | "DESC">>
    }
  }): Promise<Record<string, unknown>[]>
  findAndCount(options: {
    where: Record<string, unknown>
    options?: {
      filters?: Record<string | symbol, unknown>
    }
  }): Promise<[Record<string, unknown>[], number]>
  softDelete(
    ids: string[],
    context?: Record<string, unknown>
  ): Promise<[Record<string, unknown>[], Record<string, unknown[]>]>
  restore(
    ids: string[],
    context?: Record<string, unknown>
  ): Promise<[Record<string, unknown>[], Record<string, unknown[]>]>
  upsertWithReplace(
    data: Record<string, unknown>[],
    config: { relations: string[] }
  ): Promise<{
    entities: Record<string, unknown>[]
    performedActions: {
      created: Record<string, Array<{ id: string }>>
      updated: Record<string, Array<{ id: string }>>
      deleted: Record<string, Array<{ id: string }>>
    }
  }>
}

function isPGliteRepositoryProbe(
  value: unknown
): value is PGliteRepositoryProbe {
  return (
    typeof value === "object" &&
    value !== null &&
    "create" in value &&
    typeof value.create === "function" &&
    "delete" in value &&
    typeof value.delete === "function" &&
    "update" in value &&
    typeof value.update === "function" &&
    "find" in value &&
    typeof value.find === "function" &&
    "findAndCount" in value &&
    typeof value.findAndCount === "function" &&
    "softDelete" in value &&
    typeof value.softDelete === "function" &&
    "restore" in value &&
    typeof value.restore === "function" &&
    "upsertWithReplace" in value &&
    typeof value.upsertWithReplace === "function"
  )
}

describePGlite("pgliteModuleTestPersistenceAdapter", () => {
  it("replaces the named Pricing repository", () => {
    const Price = model.define("Price", {
      id: model.id().primaryKey(),
      currency_code: model.text(),
      amount: model.bigNumber(),
    })
    const PriceRule = model.define("PriceRule", {
      id: model.id().primaryKey(),
      price_id: model.text(),
      attribute: model.text(),
      value: model.text(),
      operator: model.text(),
    })
    const PriceList = model.define("PriceList", {
      id: model.id().primaryKey(),
      status: model.text(),
      type: model.text(),
      starts_at: model.dateTime().nullable(),
      ends_at: model.dateTime().nullable(),
      rules_count: model.number().nullable(),
    })
    const PriceListRule = model.define("PriceListRule", {
      id: model.id().primaryKey(),
      price_list_id: model.text(),
      attribute: model.text(),
      value: model.json().nullable(),
    })
    const defaultRepository =
      pgliteModulePersistenceAdapter.createRepository(Price)
    const pricingRepository =
      pgliteModulePersistenceAdapter.createCustomRepository?.({
        repositoryName: "pricingRepository",
        moduleModels: { Price, PriceRule, PriceList, PriceListRule },
        repository: defaultRepository,
      })

    expect(pricingRepository).toBeDefined()
    expect(pricingRepository).not.toBe(defaultRepository)
  })

  it("stores arbitrary-precision BigNumber values without number coercion", async () => {
    const PreciseAmount = model.define("pglitePreciseAmount", {
      id: model.id().primaryKey(),
      amount: model.bigNumber(),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-precise-big-number",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [PreciseAmount],
      })
      await prepared.database.setupDatabase()

      const Repository =
        pgliteModulePersistenceAdapter.createRepository(PreciseAmount)
      const repository = new Repository({ manager: connection })
      if (!isPGliteRepositoryProbe(repository)) {
        throw new Error("Expected a PGlite repository instance")
      }

      const amount = "12345678988754.00000010000000085"
      await repository.create([{ id: "amount_1", amount: { value: amount } }])

      const stored = await connection.client.query<{ amount: string }>(
        'SELECT "amount"::text AS "amount" FROM "medusa_test"."pglite_precise_amount" WHERE "id" = $1',
        ["amount_1"]
      )
      expect(stored.rows).toEqual([{ amount }])
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("renders DML checks and maps check constraint violations", async () => {
    const CheckedAmount = model
      .define("pgliteCheckedAmount", {
        id: model.id().primaryKey(),
        amount: model.number(),
      })
      .checks([(columns) => `${columns.amount} >= 0`])
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-check-constraint",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [CheckedAmount],
      })
      await prepared.database.setupDatabase()

      const Repository =
        pgliteModulePersistenceAdapter.createRepository(CheckedAmount)
      const repository = new Repository({ manager: connection })
      if (!isPGliteRepositoryProbe(repository)) {
        throw new Error("Expected a PGlite repository instance")
      }

      await expect(
        repository.create([{ id: "checked_amount_1", amount: 10 }])
      ).resolves.toHaveLength(1)
      await expect(
        repository.create([{ id: "checked_amount_2", amount: -1 }])
      ).rejects.toMatchObject({
        name: "CheckConstraintViolationException",
      })
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("generates omitted serial values and accepts explicit values", async () => {
    const Displayed = model.define("pgliteDisplayed", {
      id: model.id().primaryKey(),
      display_id: model.autoincrement(),
    })
    const Sequenced = model.define("pgliteSequenced", {
      sequence: model.autoincrement().primaryKey(),
      name: model.text(),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-serial-values",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [Displayed, Sequenced],
      })
      await prepared.database.setupDatabase()

      const DisplayedRepository =
        pgliteModulePersistenceAdapter.createRepository(Displayed)
      const SequencedRepository =
        pgliteModulePersistenceAdapter.createRepository(Sequenced)
      if (!DisplayedRepository || !SequencedRepository) {
        throw new Error("Expected PGlite repositories")
      }
      const repository = new DisplayedRepository({ manager: connection })
      const sequencedRepository = new SequencedRepository({
        manager: connection,
      })
      if (
        !isPGliteRepositoryProbe(repository) ||
        !isPGliteRepositoryProbe(sequencedRepository)
      ) {
        throw new Error("Expected PGlite repository instances")
      }

      await expect(
        repository.create([
          { id: "displayed_1" },
          { id: "displayed_2" },
          { id: "displayed_10", display_id: 10 },
        ])
      ).resolves.toEqual([
        expect.objectContaining({ id: "displayed_1", display_id: 1 }),
        expect.objectContaining({ id: "displayed_2", display_id: 2 }),
        expect.objectContaining({ id: "displayed_10", display_id: 10 }),
      ])
      await expect(
        sequencedRepository.create([{ name: "first" }, { name: "second" }])
      ).resolves.toEqual([
        expect.objectContaining({ sequence: 1, name: "first" }),
        expect.objectContaining({ sequence: 2, name: "second" }),
      ])
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("creates, clears, and destroys an in-process PGlite database", async () => {
    const Tiny = model.define("pgliteTiny", {
      id: model.id().primaryKey(),
      name: model.text(),
      count: model.number().default(0),
      enabled: model.boolean().default(true),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-lifecycle",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    expect(isPGliteModuleTestConnection(connection)).toBe(true)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [Tiny],
      })

      await prepared.database.setupDatabase()
      await connection.client.exec(
        `INSERT INTO "medusa_test"."pglite_tiny" ("id", "name", "created_at", "updated_at") VALUES ('tiny_1', 'Tiny', now(), now())`
      )

      const beforeClear = await connection.client.query<{
        count: number
        enabled: boolean
      }>(
        'SELECT "count", "enabled" FROM "medusa_test"."pglite_tiny" WHERE "id" = $1',
        ["tiny_1"]
      )
      expect(beforeClear.rows).toEqual([{ count: 0, enabled: true }])

      await prepared.database.clearDatabase()

      await expect(
        connection.client.query('SELECT * FROM "medusa_test"."pglite_tiny"')
      ).rejects.toThrow(/pglite_tiny/)
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }

    expect(connection.client.closed).toBe(true)
  })

  it("fails loudly for non-DML models", async () => {
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-models",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    try {
      expect(() =>
        pgliteModuleTestPersistenceAdapter.prepareDatabase({
          connection,
          dbConfig,
          moduleModels: [{}],
        })
      ).toThrow("only supports DML portable entities")
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("round-trips JSON scalar strings through repository filters", async () => {
    const JsonRule = model.define("pgliteJsonRule", {
      id: model.id().primaryKey(),
      value: model.json().nullable(),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-json-scalars",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    expect(isPGliteModuleTestConnection(connection)).toBe(true)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [JsonRule],
      })
      await prepared.database.setupDatabase()

      const Repository =
        pgliteModulePersistenceAdapter.createRepository(JsonRule)
      if (!Repository) {
        throw new Error("Expected a PGlite repository")
      }
      const repository = new Repository({ manager: connection })
      if (!isPGliteRepositoryProbe(repository)) {
        throw new Error("Expected a PGlite repository instance")
      }

      await repository.create([
        { id: "json_1", value: "test" },
        { id: "json_2", value: ["true"] },
        { id: "json_3", value: { nested: "value" } },
      ])

      await expect(
        repository.find({ where: { value: "test" } })
      ).resolves.toEqual([
        expect.objectContaining({ id: "json_1", value: "test" }),
      ])
      await expect(
        repository.find({ where: { value: { $eq: ["true"] } } })
      ).resolves.toEqual([
        expect.objectContaining({ id: "json_2", value: ["true"] }),
      ])
      await expect(
        repository.find({ where: { value: { nested: "value" } } })
      ).resolves.toEqual([
        expect.objectContaining({ id: "json_3", value: { nested: "value" } }),
      ])
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("filters searchable scalar fields with free-text filters", async () => {
    const Searchable = model.define("pgliteSearchable", {
      id: model.id().primaryKey(),
      title: model.text().searchable(),
      handle: model.text(),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-free-text-search",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [Searchable],
      })
      await prepared.database.setupDatabase()

      const Repository =
        pgliteModulePersistenceAdapter.createRepository(Searchable)
      if (!Repository) {
        throw new Error("Expected a PGlite repository")
      }
      const repository = new Repository({ manager: connection })
      if (!isPGliteRepositoryProbe(repository)) {
        throw new Error("Expected a PGlite repository instance")
      }

      await repository.create([
        { id: "search_1", title: "Test Product", handle: "alpha" },
        { id: "search_2", title: "Space X", handle: "hidden-test" },
      ])

      const filterName = `${FreeTextSearchFilterKeyPrefix}${Searchable.name}`
      await expect(
        repository.find({
          where: {},
          options: {
            filters: {
              [filterName]: {
                value: "test",
                fromEntity: Searchable.name,
              },
            },
          },
        })
      ).resolves.toEqual([expect.objectContaining({ id: "search_1" })])
      await expect(
        repository.find({
          where: {},
          options: {
            filters: {
              [filterName]: {
                value: "SPACE",
                fromEntity: Searchable.name,
              },
            },
          },
        })
      ).resolves.toEqual([expect.objectContaining({ id: "search_2" })])
      await expect(
        repository.findAndCount({
          where: {},
          options: {
            filters: {
              [filterName]: {
                value: "SPACE",
                fromEntity: Searchable.name,
              },
            },
          },
        })
      ).resolves.toEqual([[expect.objectContaining({ id: "search_2" })], 1])
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("executes serialized raw alias predicates and rejects unbound parameters", async () => {
    const RawFilter = model.define("pgliteRawFilter", {
      id: model.id().primaryKey(),
      status: model.text(),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-raw-filter",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [RawFilter],
      })
      await prepared.database.setupDatabase()

      const Repository =
        pgliteModulePersistenceAdapter.createRepository(RawFilter)
      if (!Repository) {
        throw new Error("Expected a PGlite repository")
      }
      const repository = new Repository({ manager: connection })
      if (!isPGliteRepositoryProbe(repository)) {
        throw new Error("Expected a PGlite repository instance")
      }

      await repository.create([
        { id: "active", status: "active" },
        { id: "inactive", status: "inactive" },
      ])

      await expect(
        repository.find({
          where: {
            "[raw]: [::alias::].status = 'active' (#0)": true,
          },
          options: { fields: ["status"] },
        })
      ).resolves.toEqual([{ id: "active", status: "active" }])
      await expect(
        repository.find({
          where: {
            "[raw]: [::alias::].status = 'active' (#1)": false,
          },
          options: { orderBy: { id: "ASC" } },
        })
      ).resolves.toEqual([
        expect.objectContaining({ id: "active" }),
        expect.objectContaining({ id: "inactive" }),
      ])
      await expect(
        repository.find({
          where: {
            "[raw]: [::alias::].status = ? (#2)": true,
          },
        })
      ).rejects.toThrow(
        "does not support multiple statements or unbound parameters"
      )
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("honors explicit DML belongsTo foreign key names", async () => {
    const Parent = model.define("pgliteNamedFkParent", {
      id: model.id().primaryKey(),
    })
    const Child = model.define("pgliteNamedFkChild", {
      id: model.id().primaryKey(),
      parent: model.belongsTo(() => Parent, {
        foreignKeyName: "parent_ref",
      }),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-named-foreign-keys",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    expect(isPGliteModuleTestConnection(connection)).toBe(true)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [Parent, Child],
      })
      await prepared.database.setupDatabase()

      const result = await connection.client.query<{
        column_name: string
      }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY column_name`,
        ["medusa_test", "pglite_named_fk_child"]
      )

      expect(result.rows.map((row) => row.column_name)).toContain("parent_ref")
      expect(result.rows.map((row) => row.column_name)).not.toContain(
        "parent_id"
      )
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("separates belongsTo object creation from update replacement", async () => {
    const Target = model.define("pgliteBelongsToTarget", {
      id: model.id().primaryKey(),
      label: model.text(),
    })
    const Owner = model.define("pgliteBelongsToOwner", {
      id: model.id().primaryKey(),
      target: model.belongsTo(() => Target, {
        foreignKeyName: "target_ref",
      }),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-belongs-to-target-reuse",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    expect(isPGliteModuleTestConnection(connection)).toBe(true)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [Target, Owner],
      })
      await prepared.database.setupDatabase()

      const Repository = pgliteModulePersistenceAdapter.createRepository(Owner)
      if (!Repository) {
        throw new Error("Expected a PGlite repository")
      }
      const repository = new Repository({ manager: connection })
      if (!isPGliteRepositoryProbe(repository)) {
        throw new Error("Expected a PGlite repository instance")
      }

      const [created] = await repository.create([
        {
          id: "owner_1",
          target: {
            label: "Reusable target",
          },
        },
      ])

      const result = await connection.client.query<{
        count: string
        owner_target_ref: string
      }>(
        `SELECT count(target.id)::text AS count, max(owner.target_ref) AS owner_target_ref
         FROM "medusa_test"."pglite_belongs_to_target" AS target
         CROSS JOIN "medusa_test"."pglite_belongs_to_owner" AS owner`
      )

      expect(result.rows).toEqual([
        {
          count: "1",
          owner_target_ref: created?.target_ref,
        },
      ])
      await expect(
        repository.find({
          where: { id: "owner_1" },
          options: {
            fields: ["id", "target.id"],
            relations: ["target"],
          },
        })
      ).resolves.toEqual([
        {
          id: "owner_1",
          target_ref: created?.target_ref,
          target: {
            id: created?.target_ref,
          },
        },
      ])

      const [updated] = await repository.update([
        {
          entity: created ?? { id: "owner_1" },
          update: {
            id: "owner_1",
            target: {
              label: "Replacement target",
            },
          },
        },
      ])
      const updatedTargetRef = updated?.target_ref

      const updateResult = await connection.client.query<{
        count: string
        original_label: string
        replacement_label: string
      }>(
        `SELECT count(*)::text AS count,
                min(target.label) AS original_label,
                max(target.label) AS replacement_label
         FROM "medusa_test"."pglite_belongs_to_target" AS target`
      )

      expect(updatedTargetRef).not.toBe(created?.target_ref)
      expect(updateResult.rows).toEqual([
        {
          count: "2",
          original_label: "Replacement target",
          replacement_label: "Reusable target",
        },
      ])
      await expect(
        repository.update([
          {
            entity: updated ?? { id: "owner_1" },
            update: { target_ref: "missing" },
          },
        ])
      ).rejects.toThrow(
        "You tried to set relationship target_ref: missing, but such entity does not exist"
      )
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("creates and hydrates source-owned hasOne relations", async () => {
    const Profile = model.define("pgliteOwnedHasOneProfile", {
      id: model.id().primaryKey(),
      display_name: model.text(),
    })
    const Account = model.define("pgliteOwnedHasOneAccount", {
      id: model.id().primaryKey(),
      profile: model.hasOne(() => Profile, {
        foreignKey: true,
      }),
    })
    const OptionalAccount = model.define("pgliteOptionalOwnedHasOneAccount", {
      id: model.id().primaryKey(),
      profile: model
        .hasOne(() => Profile, {
          foreignKey: true,
        })
        .nullable(),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-owned-has-one",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    expect(isPGliteModuleTestConnection(connection)).toBe(true)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [Account, OptionalAccount, Profile],
      })
      await prepared.database.setupDatabase()

      const AccountRepository =
        pgliteModulePersistenceAdapter.createRepository(Account)
      const ProfileRepository =
        pgliteModulePersistenceAdapter.createRepository(Profile)
      const OptionalAccountRepository =
        pgliteModulePersistenceAdapter.createRepository(OptionalAccount)
      if (
        !AccountRepository ||
        !OptionalAccountRepository ||
        !ProfileRepository
      ) {
        throw new Error("Expected PGlite repositories")
      }
      const accountRepository = new AccountRepository({ manager: connection })
      const optionalAccountRepository = new OptionalAccountRepository({
        manager: connection,
      })
      const profileRepository = new ProfileRepository({ manager: connection })
      if (
        !isPGliteRepositoryProbe(accountRepository) ||
        !isPGliteRepositoryProbe(optionalAccountRepository) ||
        !isPGliteRepositoryProbe(profileRepository)
      ) {
        throw new Error("Expected PGlite repository instances")
      }

      const columnResult = await connection.client.query<{
        column_name: string
      }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY column_name`,
        ["medusa_test", "pglite_owned_has_one_account"]
      )

      expect(columnResult.rows.map((row) => row.column_name)).toContain(
        "profile_id"
      )

      const [created] = await accountRepository.create([
        {
          id: "account_1",
          profile: {
            id: "profile_1",
            display_name: "Ada",
          },
        },
      ])

      expect(created).toEqual(
        expect.objectContaining({
          id: "account_1",
          profile_id: "profile_1",
          profile: expect.objectContaining({
            id: "profile_1",
            display_name: "Ada",
          }),
        })
      )

      await expect(
        accountRepository.find({
          where: { id: "account_1" },
          options: { relations: ["profile"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "account_1",
          profile_id: "profile_1",
          profile: expect.objectContaining({
            id: "profile_1",
            display_name: "Ada",
          }),
        }),
      ])

      await expect(profileRepository.delete(["profile_1"])).resolves.toEqual([
        "profile_1",
      ])
      await expect(
        accountRepository.find({ where: { id: "account_1" } })
      ).resolves.toEqual([])

      await optionalAccountRepository.create([
        {
          id: "optional_account_1",
          profile: {
            id: "profile_2",
            display_name: "Grace",
          },
        },
      ])
      await profileRepository.delete(["profile_2"])
      await expect(
        optionalAccountRepository.find({
          where: { id: "optional_account_1" },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "optional_account_1",
          profile_id: null,
        }),
      ])
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("initializes null source relations and projects hydrated relation fields", async () => {
    const Category = model.define("pgliteProjectionCategory", {
      id: model.id().primaryKey(),
      name: model.text(),
    })
    const Account = model.define("pgliteProjectionAccount", {
      id: model.id().primaryKey(),
      name: model.text(),
      category: model.belongsTo(() => Category).nullable(),
      profile: model
        .hasOne(() => Profile, {
          mappedBy: "account",
        })
        .nullable(),
    })
    const Profile = model.define("pgliteProjectionProfile", {
      id: model.id().primaryKey(),
      display_name: model.text(),
      private_note: model.text(),
      category: model.belongsTo(() => Category).nullable(),
      account: model.belongsTo(() => Account, {
        mappedBy: "profile",
      }),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-relation-projection",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [Account, Category, Profile],
      })
      await prepared.database.setupDatabase()

      const AccountRepository =
        pgliteModulePersistenceAdapter.createRepository(Account)
      const ProfileRepository =
        pgliteModulePersistenceAdapter.createRepository(Profile)
      if (!AccountRepository || !ProfileRepository) {
        throw new Error("Expected PGlite repositories")
      }
      const accountRepository = new AccountRepository({ manager: connection })
      const profileRepository = new ProfileRepository({ manager: connection })
      if (
        !isPGliteRepositoryProbe(accountRepository) ||
        !isPGliteRepositoryProbe(profileRepository)
      ) {
        throw new Error("Expected PGlite repository instances")
      }

      await accountRepository.create([
        { id: "account_1", name: "Ada", category: null },
      ])
      await profileRepository.create([
        {
          id: "profile_1",
          display_name: "Ada Lovelace",
          private_note: "not selected",
          category: null,
          account: "account_1",
        },
      ])

      await expect(
        accountRepository.find({ where: { id: "account_1" } })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "account_1",
          category_id: null,
          category: null,
        }),
      ])
      await expect(
        accountRepository.find({
          where: { id: "account_1" },
          options: {
            fields: ["id", "profile.display_name"],
            relations: ["profile"],
          },
        })
      ).resolves.toEqual([
        {
          id: "account_1",
          profile: {
            id: "profile_1",
            display_name: "Ada Lovelace",
          },
        },
      ])
      await expect(
        accountRepository.find({
          where: { id: "account_1" },
          options: {
            fields: ["id", "profile.id"],
            relations: ["profile.category"],
          },
        })
      ).resolves.toEqual([
        {
          id: "account_1",
          profile: {
            id: "profile_1",
            category_id: null,
            category: null,
          },
        },
      ])
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("projects and filters virtual relation target scalars", async () => {
    const Parent = model.define("pgliteVirtualProjectionParent", {
      id: model.id().primaryKey(),
      children: model.hasMany(() => Child, {
        mappedBy: "parent",
      }),
    })
    const Child = model.define("pgliteVirtualProjectionChild", {
      id: model.id().primaryKey(),
      quantity: model.number(),
      fulfilled_quantity: model.number().default(0),
      parent: model.belongsTo(() => Parent, {
        mappedBy: "children",
      }),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-virtual-relation-projection",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [Parent, Child],
      })
      await prepared.database.setupDatabase()

      const ParentRepository =
        pgliteModulePersistenceAdapter.createRepository(Parent)
      const ChildRepository =
        pgliteModulePersistenceAdapter.createRepository(Child)
      if (!ParentRepository || !ChildRepository) {
        throw new Error("Expected PGlite repositories")
      }
      const parentRepository = new ParentRepository({ manager: connection })
      const childRepository = new ChildRepository({ manager: connection })
      if (
        !isPGliteRepositoryProbe(parentRepository) ||
        !isPGliteRepositoryProbe(childRepository)
      ) {
        throw new Error("Expected PGlite repository instances")
      }

      await parentRepository.create([{ id: "parent_1" }])
      await childRepository.create([
        {
          id: "child_1",
          quantity: 2,
          fulfilled_quantity: 1,
          parent: "parent_1",
        },
      ])

      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: {
            fields: ["id", "children.detail.fulfilled_quantity"],
            relations: ["children", "children.detail"],
          },
        })
      ).resolves.toEqual([
        {
          id: "parent_1",
          children: [{ id: "child_1", fulfilled_quantity: 1 }],
        },
      ])

      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: {
            fields: ["id", "children.detail"],
            relations: ["children", "children.detail"],
          },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "parent_1",
          children: [
            expect.objectContaining({
              id: "child_1",
              quantity: 2,
              fulfilled_quantity: 1,
            }),
          ],
        }),
      ])

      await expect(
        parentRepository.find({
          where: {
            children: {
              detail: { fulfilled_quantity: 1 },
            },
          },
          options: { fields: ["id"] },
        })
      ).resolves.toEqual([{ id: "parent_1" }])

      await expect(
        parentRepository.find({
          where: {
            children: {
              detail: { fulfilled_quantity: 2 },
            },
          },
          options: { fields: ["id"] },
        })
      ).resolves.toEqual([])
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("filters versioned Order hasMany relations to the parent version", async () => {
    const Order = model.define("Order", {
      id: model.id().primaryKey(),
      version: model.number().default(1),
      items: model.hasMany(() => OrderItem, {
        mappedBy: "order",
      }),
    })
    const OrderItem = model.define("OrderItem", {
      id: model.id().primaryKey(),
      version: model.number().default(1),
      fulfilled_quantity: model.number().default(0),
      order: model.belongsTo(() => Order, {
        mappedBy: "items",
      }),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-versioned-relations",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [Order, OrderItem],
      })
      await prepared.database.setupDatabase()

      const OrderRepository =
        pgliteModulePersistenceAdapter.createRepository(Order)
      const OrderItemRepository =
        pgliteModulePersistenceAdapter.createRepository(OrderItem)
      if (!OrderRepository || !OrderItemRepository) {
        throw new Error("Expected PGlite repositories")
      }
      const orderRepository = new OrderRepository({ manager: connection })
      const orderItemRepository = new OrderItemRepository({
        manager: connection,
      })
      if (
        !isPGliteRepositoryProbe(orderRepository) ||
        !isPGliteRepositoryProbe(orderItemRepository)
      ) {
        throw new Error("Expected PGlite repository instances")
      }

      await orderRepository.create([{ id: "order_1", version: 2 }])
      await orderItemRepository.create([
        {
          id: "item_v1",
          version: 1,
          fulfilled_quantity: 0,
          order_id: "order_1",
        },
        {
          id: "item_v2",
          version: 2,
          fulfilled_quantity: 1,
          order_id: "order_1",
        },
      ])

      await expect(
        orderRepository.find({
          where: { id: "order_1" },
          options: {
            fields: ["id", "version", "items.detail"],
          },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "order_1",
          version: 2,
          items: [
            expect.objectContaining({
              id: "item_v2",
              version: 2,
              fulfilled_quantity: 1,
            }),
          ],
        }),
      ])

      await expect(
        orderRepository.find({
          where: { id: "order_1" },
          options: {
            fields: ["id", "items.detail"],
          },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "order_1",
          items: [
            expect.objectContaining({
              id: "item_v2",
              version: 2,
              fulfilled_quantity: 1,
            }),
          ],
        }),
      ])
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("hydrates wildcard empty collection relations", async () => {
    const Parent = model.define("pgliteWildcardParent", {
      id: model.id().primaryKey(),
      children: model.hasMany(() => Child, {
        mappedBy: "parent",
      }),
    })
    const Child = model.define("pgliteWildcardChild", {
      id: model.id().primaryKey(),
      parent: model.belongsTo(() => Parent, {
        mappedBy: "children",
      }),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-wildcard-relations",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [Parent, Child],
      })
      await prepared.database.setupDatabase()

      const ParentRepository =
        pgliteModulePersistenceAdapter.createRepository(Parent)
      if (!ParentRepository) {
        throw new Error("Expected a PGlite repository")
      }
      const parentRepository = new ParentRepository({ manager: connection })
      if (!isPGliteRepositoryProbe(parentRepository)) {
        throw new Error("Expected a PGlite repository instance")
      }

      await parentRepository.create([{ id: "parent_1" }])

      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: { relations: ["*"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "parent_1",
          children: [],
        }),
      ])
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("orders root rows by an inverse hasOne field", async () => {
    const Parent = model.define("pgliteOrderParent", {
      id: model.id().primaryKey(),
      child: model.hasOne(() => Child, {
        mappedBy: "parent",
      }),
    })
    const Child = model.define("pgliteOrderChild", {
      id: model.id().primaryKey(),
      score: model.number(),
      parent: model.belongsTo(() => Parent, {
        mappedBy: "child",
      }),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-relation-order",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [Parent, Child],
      })
      await prepared.database.setupDatabase()

      const ParentRepository =
        pgliteModulePersistenceAdapter.createRepository(Parent)
      const ChildRepository =
        pgliteModulePersistenceAdapter.createRepository(Child)
      if (!ParentRepository || !ChildRepository) {
        throw new Error("Expected PGlite repositories")
      }
      const parentRepository = new ParentRepository({ manager: connection })
      const childRepository = new ChildRepository({ manager: connection })
      if (
        !isPGliteRepositoryProbe(parentRepository) ||
        !isPGliteRepositoryProbe(childRepository)
      ) {
        throw new Error("Expected PGlite repository instances")
      }

      await parentRepository.create([{ id: "parent_1" }, { id: "parent_2" }])
      await childRepository.create([
        { id: "child_1", score: 10, parent: "parent_1" },
        { id: "child_2", score: 20, parent: "parent_2" },
      ])

      await expect(
        parentRepository.find({
          where: {},
          options: {
            relations: ["child"],
            orderBy: { child: { score: "DESC" } },
          },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "parent_2",
          child: expect.objectContaining({ score: 20 }),
        }),
        expect.objectContaining({
          id: "parent_1",
          child: expect.objectContaining({ score: 10 }),
        }),
      ])
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("orders root rows and hydrated rows by a hasMany field", async () => {
    const Parent = model.define("pgliteHasManyOrderParent", {
      id: model.id().primaryKey(),
      children: model.hasMany(() => Child, {
        mappedBy: "parent",
      }),
    })
    const Child = model.define("pgliteHasManyOrderChild", {
      id: model.id().primaryKey(),
      score: model.number(),
      parent: model.belongsTo(() => Parent, {
        mappedBy: "children",
      }),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-has-many-order",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [Parent, Child],
      })
      await prepared.database.setupDatabase()

      const ParentRepository =
        pgliteModulePersistenceAdapter.createRepository(Parent)
      const ChildRepository =
        pgliteModulePersistenceAdapter.createRepository(Child)
      if (!ParentRepository || !ChildRepository) {
        throw new Error("Expected PGlite repositories")
      }
      const parentRepository = new ParentRepository({ manager: connection })
      const childRepository = new ChildRepository({ manager: connection })
      if (
        !isPGliteRepositoryProbe(parentRepository) ||
        !isPGliteRepositoryProbe(childRepository)
      ) {
        throw new Error("Expected PGlite repository instances")
      }

      await parentRepository.create([{ id: "parent_1" }, { id: "parent_2" }])
      await childRepository.create([
        { id: "child_1", score: 10, parent: "parent_1" },
        { id: "child_2", score: 30, parent: "parent_1" },
        { id: "child_3", score: 20, parent: "parent_2" },
        { id: "child_4", score: 40, parent: "parent_2" },
      ])

      await expect(
        parentRepository.find({
          where: {},
          options: {
            relations: ["children"],
            orderBy: { children: { score: "DESC" } },
          },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "parent_2",
          children: [
            expect.objectContaining({ id: "child_4", score: 40 }),
            expect.objectContaining({ id: "child_3", score: 20 }),
          ],
        }),
        expect.objectContaining({
          id: "parent_1",
          children: [
            expect.objectContaining({ id: "child_2", score: 30 }),
            expect.objectContaining({ id: "child_1", score: 10 }),
          ],
        }),
      ])
      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: {
            relations: ["children"],
            populateWhere: {
              children: {
                score: { $gte: 20 },
              },
            },
            orderBy: { children: { score: "DESC" } },
          },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "parent_1",
          children: [expect.objectContaining({ id: "child_2", score: 30 })],
        }),
      ])
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("soft deletes and restores inverse hasOne cascade targets", async () => {
    const Parent = model
      .define("pgliteCascadeParent", {
        id: model.id().primaryKey(),
        child: model
          .hasOne(() => Child, {
            mappedBy: "parent",
          })
          .nullable(),
      })
      .cascades({ delete: ["child"] })
    const Child = model.define("pgliteCascadeChild", {
      id: model.id().primaryKey(),
      label: model.text(),
      parent: model.belongsTo(() => Parent, {
        mappedBy: "child",
      }),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-has-one-cascade",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [Parent, Child],
      })
      await prepared.database.setupDatabase()

      const ParentRepository =
        pgliteModulePersistenceAdapter.createRepository(Parent)
      const ChildRepository =
        pgliteModulePersistenceAdapter.createRepository(Child)
      if (!ParentRepository || !ChildRepository) {
        throw new Error("Expected PGlite repositories")
      }
      const parentRepository = new ParentRepository({ manager: connection })
      const childRepository = new ChildRepository({ manager: connection })
      if (
        !isPGliteRepositoryProbe(parentRepository) ||
        !isPGliteRepositoryProbe(childRepository)
      ) {
        throw new Error("Expected PGlite repository instances")
      }

      await parentRepository.create([{ id: "parent_1" }])
      await childRepository.create([
        { id: "child_1", label: "Child", parent: "parent_1" },
      ])

      const interceptEntityMutationEvents = jest.fn()
      const createEventSubscriber =
        pgliteModulePersistenceAdapter.createEventSubscriber
      const registerEventSubscriber =
        pgliteModulePersistenceAdapter.registerEventSubscriber
      if (!createEventSubscriber || !registerEventSubscriber) {
        throw new Error("Expected PGlite mutation event support")
      }
      const context: Record<string, unknown> = {}
      registerEventSubscriber(
        context,
        createEventSubscriber(["PgliteCascadeParent"], {
          interceptEntityMutationEvents,
        })
      )

      const [, deletedCascades] = await parentRepository.softDelete(
        ["parent_1"],
        context
      )
      expect(deletedCascades).toEqual({
        PgliteCascadeChild: ["child_1"],
      })
      expect(interceptEntityMutationEvents).toHaveBeenCalledTimes(2)
      expect(interceptEntityMutationEvents).toHaveBeenCalledWith(
        "afterUpdate",
        expect.objectContaining({
          entity: expect.objectContaining({ id: "parent_1" }),
          meta: { className: "PgliteCascadeParent" },
          changeSet: {
            entity: { deleted_at: expect.any(String) },
            originalEntity: { deleted_at: null },
          },
        }),
        context
      )
      expect(interceptEntityMutationEvents).toHaveBeenCalledWith(
        "afterUpdate",
        expect.objectContaining({
          entity: expect.objectContaining({ id: "child_1" }),
          meta: { className: "PgliteCascadeChild" },
          changeSet: {
            entity: { deleted_at: expect.any(String) },
            originalEntity: { deleted_at: null },
          },
        }),
        context
      )
      const deleted = await connection.client.query<{
        parent_deleted_at: Date
        child_deleted_at: Date
      }>(
        `SELECT parent.deleted_at AS parent_deleted_at,
                child.deleted_at AS child_deleted_at
         FROM "medusa_test"."pglite_cascade_parent" AS parent
         JOIN "medusa_test"."pglite_cascade_child" AS child
           ON child.parent_id = parent.id
         WHERE parent.id = $1`,
        ["parent_1"]
      )
      expect(deleted.rows).toEqual([
        {
          parent_deleted_at: expect.any(Date),
          child_deleted_at: expect.any(Date),
        },
      ])

      interceptEntityMutationEvents.mockClear()
      const [, restoredCascades] = await parentRepository.restore(
        ["parent_1"],
        context
      )
      expect(restoredCascades).toEqual({
        PgliteCascadeChild: ["child_1"],
      })
      expect(interceptEntityMutationEvents).toHaveBeenCalledTimes(2)
      expect(interceptEntityMutationEvents).toHaveBeenCalledWith(
        "afterUpdate",
        expect.objectContaining({
          entity: expect.objectContaining({ id: "parent_1" }),
          meta: { className: "PgliteCascadeParent" },
          changeSet: {
            entity: { deleted_at: null },
            originalEntity: { deleted_at: expect.any(String) },
          },
        }),
        context
      )
      expect(interceptEntityMutationEvents).toHaveBeenCalledWith(
        "afterUpdate",
        expect.objectContaining({
          entity: expect.objectContaining({ id: "child_1" }),
          meta: { className: "PgliteCascadeChild" },
          changeSet: {
            entity: { deleted_at: null },
            originalEntity: { deleted_at: expect.any(String) },
          },
        }),
        context
      )
      const restored = await connection.client.query<{
        parent_deleted_at: null
        child_deleted_at: null
      }>(
        `SELECT parent.deleted_at AS parent_deleted_at,
                child.deleted_at AS child_deleted_at
         FROM "medusa_test"."pglite_cascade_parent" AS parent
         JOIN "medusa_test"."pglite_cascade_child" AS child
           ON child.parent_id = parent.id
         WHERE parent.id = $1`,
        ["parent_1"]
      )
      expect(restored.rows).toEqual([
        { parent_deleted_at: null, child_deleted_at: null },
      ])
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("maps restore conflicts from partial unique indexes", async () => {
    const UniqueRestore = model
      .define("pgliteUniqueRestore", {
        id: model.id().primaryKey(),
        code: model.text(),
      })
      .indexes([
        {
          on: ["code"],
          unique: true,
          where: "deleted_at IS NULL",
        },
      ])
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-restore-conflict",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [UniqueRestore],
      })
      await prepared.database.setupDatabase()

      const Repository =
        pgliteModulePersistenceAdapter.createRepository(UniqueRestore)
      if (!Repository) {
        throw new Error("Expected a PGlite repository")
      }
      const repository = new Repository({ manager: connection })
      if (!isPGliteRepositoryProbe(repository)) {
        throw new Error("Expected a PGlite repository instance")
      }

      await repository.create([{ id: "original", code: "test" }])
      await repository.softDelete(["original"])
      await repository.create([{ id: "replacement", code: "test" }])

      await expect(repository.restore(["original"])).rejects.toThrow(
        "Pglite unique restore with code: test, already exists."
      )

      const original = await connection.client.query<{
        deleted_at: Date
      }>(
        `SELECT deleted_at
         FROM "medusa_test"."pglite_unique_restore"
         WHERE id = $1`,
        ["original"]
      )
      expect(original.rows).toEqual([{ deleted_at: expect.any(Date) }])
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("filters through nested belongsTo and hasMany relations", async () => {
    const Zone = model.define("pgliteNestedFilterZone", {
      id: model.id().primaryKey(),
      type: model.text(),
      country_code: model.text(),
      region_code: model.text().nullable(),
      service_area: model.belongsTo(() => ServiceArea, {
        mappedBy: "zones",
      }),
    })
    const ServiceGroup = model.define("pgliteNestedFilterServiceGroup", {
      id: model.id().primaryKey(),
      name: model.text(),
      service_areas: model.hasMany(() => ServiceArea, {
        mappedBy: "service_group",
      }),
    })
    const ServiceArea = model.define("pgliteNestedFilterServiceArea", {
      id: model.id().primaryKey(),
      name: model.text(),
      service_group: model.belongsTo(() => ServiceGroup, {
        mappedBy: "service_areas",
      }),
      zones: model.hasMany(() => Zone, {
        mappedBy: "service_area",
      }),
      options: model.hasMany(() => Option, {
        mappedBy: "service_area",
      }),
    })
    const Option = model.define("pgliteNestedFilterOption", {
      id: model.id().primaryKey(),
      name: model.text(),
      service_area: model.belongsTo(() => ServiceArea, {
        mappedBy: "options",
      }),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-nested-relation-filters",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    expect(isPGliteModuleTestConnection(connection)).toBe(true)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [ServiceGroup, ServiceArea, Zone, Option],
      })
      await prepared.database.setupDatabase()

      const ServiceGroupRepository =
        pgliteModulePersistenceAdapter.createRepository(ServiceGroup)
      const OptionRepository =
        pgliteModulePersistenceAdapter.createRepository(Option)
      if (!ServiceGroupRepository || !OptionRepository) {
        throw new Error("Expected PGlite repositories")
      }
      const serviceGroupRepository = new ServiceGroupRepository({
        manager: connection,
      })
      const optionRepository = new OptionRepository({ manager: connection })
      if (
        !isPGliteRepositoryProbe(serviceGroupRepository) ||
        !isPGliteRepositoryProbe(optionRepository)
      ) {
        throw new Error("Expected PGlite repository instances")
      }

      await serviceGroupRepository.create([
        {
          id: "group_1",
          name: "Europe",
          service_areas: [
            {
              id: "area_1",
              name: "France",
              zones: [
                {
                  id: "zone_1",
                  type: "country",
                  country_code: "fr",
                },
                {
                  id: "zone_2",
                  type: "province",
                  country_code: "fr",
                  region_code: "rhone",
                },
              ],
            },
          ],
        },
      ])
      await optionRepository.create([
        {
          id: "option_1",
          name: "Standard",
          service_area: "area_1",
        },
      ])

      const zoneCount = await connection.client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM "medusa_test"."pglite_nested_filter_zone"`
      )
      expect(zoneCount.rows).toEqual([{ count: 2 }])

      await expect(
        optionRepository.find({
          where: {
            service_area: {
              zones: {
                $or: [
                  {
                    type: "country",
                    country_code: "fr",
                  },
                  {
                    type: "province",
                    country_code: "fr",
                    region_code: "rhone",
                  },
                ],
              },
            },
          },
        })
      ).resolves.toEqual([expect.objectContaining({ id: "option_1" })])
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("keeps empty direct-update hasMany relations as no-ops", async () => {
    const Parent = model.define("pgliteDirectUpdateParent", {
      id: model.id().primaryKey(),
      name: model.text(),
      children: model.hasMany(() => Child, {
        mappedBy: "parent",
      }),
    })
    const Child = model.define("pgliteDirectUpdateChild", {
      id: model.id().primaryKey(),
      name: model.text(),
      parent: model.belongsTo(() => Parent, {
        mappedBy: "children",
      }),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-direct-update-empty-has-many",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    expect(isPGliteModuleTestConnection(connection)).toBe(true)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [Parent, Child],
      })
      await prepared.database.setupDatabase()

      const ParentRepository =
        pgliteModulePersistenceAdapter.createRepository(Parent)
      if (!ParentRepository) {
        throw new Error("Expected a PGlite repository")
      }
      const parentRepository = new ParentRepository({ manager: connection })
      if (!isPGliteRepositoryProbe(parentRepository)) {
        throw new Error("Expected a PGlite repository instance")
      }

      const [created] = await parentRepository.create([
        {
          id: "parent_1",
          name: "Parent",
          children: [
            { id: "child_1", name: "First" },
            { id: "child_2", name: "Second" },
            { id: "child_3", name: "Third" },
          ],
        },
      ])

      await parentRepository.update([
        {
          entity: created ?? { id: "parent_1" },
          update: {
            id: "parent_1",
            name: "Parent renamed",
            children: [],
          },
        },
      ])

      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: { relations: ["children"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          name: "Parent renamed",
          children: expect.arrayContaining([
            expect.objectContaining({ id: "child_1", name: "First" }),
            expect.objectContaining({ id: "child_2", name: "Second" }),
            expect.objectContaining({ id: "child_3", name: "Third" }),
          ]),
        }),
      ])

      const afterEmptyUpdate = await connection.client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM "medusa_test"."pglite_direct_update_child" WHERE "parent_id" = $1`,
        ["parent_1"]
      )
      expect(afterEmptyUpdate.rows).toEqual([{ count: 3 }])

      await parentRepository.update([
        {
          entity: { id: "parent_1" },
          update: {
            id: "parent_1",
            children: [
              { id: "child_1" },
              { id: "child_2", name: "Second updated" },
              { id: "child_4", name: "Fourth" },
            ],
          },
        },
      ])

      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: { relations: ["children"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          children: expect.arrayContaining([
            expect.objectContaining({ id: "child_1", name: "First" }),
            expect.objectContaining({ id: "child_2", name: "Second updated" }),
            expect.objectContaining({ id: "child_4", name: "Fourth" }),
          ]),
        }),
      ])

      const afterReplacement = await connection.client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM "medusa_test"."pglite_direct_update_child" WHERE "parent_id" = $1`,
        ["parent_1"]
      )
      expect(afterReplacement.rows).toEqual([{ count: 3 }])
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("hydrates soft-deleted relations when withDeleted is requested", async () => {
    const Parent = model.define("pgliteSoftDeletedRelationParent", {
      id: model.id().primaryKey(),
      name: model.text(),
      children: model.hasMany(() => Child, {
        mappedBy: "parent",
      }),
    })
    const Child = model.define("pgliteSoftDeletedRelationChild", {
      id: model.id().primaryKey(),
      name: model.text(),
      parent: model.belongsTo(() => Parent, {
        mappedBy: "children",
      }),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-soft-deleted-relation-hydration",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    expect(isPGliteModuleTestConnection(connection)).toBe(true)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [Parent, Child],
      })
      await prepared.database.setupDatabase()

      const ParentRepository =
        pgliteModulePersistenceAdapter.createRepository(Parent)
      if (!ParentRepository) {
        throw new Error("Expected a PGlite repository")
      }
      const parentRepository = new ParentRepository({ manager: connection })
      if (!isPGliteRepositoryProbe(parentRepository)) {
        throw new Error("Expected a PGlite repository instance")
      }

      await parentRepository.create([
        {
          id: "parent_1",
          name: "Parent",
          children: [
            { id: "child_active", name: "Active" },
            { id: "child_deleted", name: "Deleted" },
          ],
        },
      ])

      await connection.client.query(
        `UPDATE "medusa_test"."pglite_soft_deleted_relation_child" SET "deleted_at" = now() WHERE "id" = $1`,
        ["child_deleted"]
      )

      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: { relations: ["children"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          children: [
            expect.objectContaining({ id: "child_active", name: "Active" }),
          ],
        }),
      ])

      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: {
            filters: {
              [SoftDeletableFilterKey]: {
                withDeleted: true,
              },
            },
            relations: ["children"],
          },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          children: expect.arrayContaining([
            expect.objectContaining({
              id: "child_active",
              deleted_at: null,
            }),
            expect.objectContaining({
              id: "child_deleted",
              deleted_at: expect.any(Date),
            }),
          ]),
        }),
      ])
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("preserves sibling hasMany aliases during nested create", async () => {
    const Parent = model.define("pgliteAliasParent", {
      id: model.id().primaryKey(),
      first_children: model.hasMany(() => Child, {
        mappedBy: "parent",
      }),
      second_children: model.hasMany(() => Child, {
        mappedBy: "parent",
      }),
    })
    const Child = model.define("pgliteAliasChild", {
      id: model.id().primaryKey(),
      kind: model.text(),
      parent: model.belongsTo(() => Parent, {
        mappedBy: "first_children",
      }),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-has-many-aliases",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [Parent, Child],
      })
      await prepared.database.setupDatabase()

      const ParentRepository =
        pgliteModulePersistenceAdapter.createRepository(Parent)
      if (!ParentRepository) {
        throw new Error("Expected a PGlite repository")
      }
      const parentRepository = new ParentRepository({ manager: connection })
      if (!isPGliteRepositoryProbe(parentRepository)) {
        throw new Error("Expected a PGlite repository instance")
      }

      await parentRepository.create([
        {
          id: "parent_1",
          first_children: [{ id: "child_1", kind: "first" }],
          second_children: [{ id: "child_2", kind: "second" }],
        },
      ])

      const result = await connection.client.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM "medusa_test"."pglite_alias_child"
         WHERE "parent_id" = $1`,
        ["parent_1"]
      )
      expect(result.rows).toEqual([{ count: "2" }])
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("inherits parent context fields into nested hasMany create rows", async () => {
    const Parent = model.define("pgliteInheritedContextParent", {
      id: model.id().primaryKey(),
      owner_id: model.text(),
      version: model.number(),
      children: model.hasMany(() => Child, {
        mappedBy: "parent",
      }),
    })
    const Child = model.define("pgliteInheritedContextChild", {
      id: model.id().primaryKey(),
      owner_id: model.text(),
      version: model.number().nullable(),
      name: model.text(),
      parent: model.belongsTo(() => Parent, {
        mappedBy: "children",
      }),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-inherited-context",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [Parent, Child],
      })
      await prepared.database.setupDatabase()

      const ParentRepository =
        pgliteModulePersistenceAdapter.createRepository(Parent)
      if (!ParentRepository) {
        throw new Error("Expected a PGlite repository")
      }
      const parentRepository = new ParentRepository({ manager: connection })
      if (!isPGliteRepositoryProbe(parentRepository)) {
        throw new Error("Expected a PGlite repository instance")
      }

      await expect(
        parentRepository.create([
          {
            id: "parent_1",
            owner_id: "owner_1",
            version: 3,
            children: [
              { id: "child_1", name: "Inherited child" },
              {
                id: "child_2",
                owner_id: "owner_2",
                version: 7,
                name: "Explicit child",
              },
            ],
          },
        ])
      ).resolves.toEqual([
        expect.objectContaining({
          id: "parent_1",
          children: [
            expect.objectContaining({
              id: "child_1",
              owner_id: "owner_1",
              version: 3,
              parent_id: "parent_1",
            }),
            expect.objectContaining({
              id: "child_2",
              owner_id: "owner_2",
              version: 7,
              parent_id: "parent_1",
            }),
          ],
        }),
      ])
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("creates scalar hasMany children and records replacement actions", async () => {
    const Parent = model.define("pgliteActionParent", {
      id: model.id().primaryKey(),
      name: model.text(),
      children: model.hasMany(() => Child, {
        mappedBy: "parent",
      }),
    })
    const Metadata = model.define("pgliteActionMetadata", {
      id: model.id().primaryKey(),
      value: model.text(),
    })
    const Detail = model.define("pgliteActionDetail", {
      id: model.id().primaryKey(),
      label: model.text(),
      metadata: model.hasOne(() => Metadata, {
        foreignKey: true,
      }),
      notes: model.hasMany(() => Note, {
        mappedBy: "detail",
      }),
    })
    const Note = model.define("pgliteActionNote", {
      id: model.id().primaryKey(),
      message: model.text(),
      detail: model.belongsTo(() => Detail, {
        mappedBy: "notes",
      }),
    })
    const GraphParent = model.define("pgliteGraphParent", {
      id: model.id().primaryKey(),
      children: model.hasMany(() => GraphChild, {
        mappedBy: "parent",
      }),
    })
    const GraphChild = model.define("pgliteGraphChild", {
      id: model.id().primaryKey(),
      name: model.text(),
      parent: model.belongsTo(() => GraphParent, {
        mappedBy: "children",
      }),
      detail: model.hasOne(() => Detail, {
        foreignKey: true,
      }),
    })
    const Child = model
      .define("pgliteActionChild", {
        id: model.id().primaryKey(),
        name: model.text(),
        parent: model.belongsTo(() => Parent, {
          mappedBy: "children",
        }),
        grandchildren: model.hasMany(() => Grandchild, {
          mappedBy: "child",
        }),
      })
      .cascades({ delete: ["grandchildren"] })
    const Grandchild = model.define("pgliteActionGrandchild", {
      id: model.id().primaryKey(),
      name: model.text(),
      child: model.belongsTo(() => Child, {
        mappedBy: "grandchildren",
      }),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-relation-actions",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    expect(isPGliteModuleTestConnection(connection)).toBe(true)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [
          Parent,
          Child,
          GraphParent,
          GraphChild,
          Metadata,
          Detail,
          Note,
          Grandchild,
        ],
      })
      await prepared.database.setupDatabase()

      const Repository = pgliteModulePersistenceAdapter.createRepository(Parent)
      const GraphRepository =
        pgliteModulePersistenceAdapter.createRepository(GraphParent)
      if (!Repository || !GraphRepository) {
        throw new Error("Expected PGlite repositories")
      }
      const repository = new Repository({ manager: connection })
      const graphRepository = new GraphRepository({ manager: connection })
      if (
        !isPGliteRepositoryProbe(repository) ||
        !isPGliteRepositoryProbe(graphRepository)
      ) {
        throw new Error("Expected PGlite repository instances")
      }

      await expect(
        graphRepository.create([
          {
            id: "parent_created",
            name: "Created parent",
            children: {
              id: "child_created",
              name: "Only child",
              detail: {
                id: "detail_created",
                label: "Owned detail",
                metadata: {
                  id: "metadata_created",
                  value: "Nested metadata",
                },
                notes: {
                  id: "note_created",
                  message: "Nested note",
                },
              },
            },
          },
        ])
      ).resolves.toEqual([
        expect.objectContaining({
          id: "parent_created",
          children: [
            expect.objectContaining({
              id: "child_created",
              name: "Only child",
              detail_id: "detail_created",
              detail: expect.objectContaining({
                id: "detail_created",
                label: "Owned detail",
                metadata_id: "metadata_created",
                metadata: expect.objectContaining({
                  id: "metadata_created",
                  value: "Nested metadata",
                }),
                notes: [
                  expect.objectContaining({
                    id: "note_created",
                    message: "Nested note",
                  }),
                ],
              }),
            }),
          ],
        }),
      ])
      await expect(
        graphRepository.find({
          where: { id: "parent_created" },
          options: { relations: ["children"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "parent_created",
          children: [
            expect.objectContaining({
              id: "child_created",
              detail_id: "detail_created",
              detail: expect.objectContaining({
                id: "detail_created",
                label: "Owned detail",
              }),
            }),
          ],
        }),
      ])
      await expect(
        graphRepository.find({
          where: { id: "parent_created" },
          options: { fields: ["id", "children"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "parent_created",
          children: [
            expect.objectContaining({
              id: "child_created",
              detail: expect.objectContaining({ id: "detail_created" }),
            }),
          ],
        }),
      ])
      await expect(
        repository.upsertWithReplace(
          [
            {
              id: "parent_rejected",
              name: "Replacement parent",
              children: { id: "child_rejected", name: "Rejected child" },
            },
          ],
          { relations: ["children"] }
        )
      ).rejects.toThrow("relation children must be an array")

      const initialResult = await repository.upsertWithReplace(
        [
          {
            id: "parent_1",
            name: "Parent",
            children: [
              { id: "child_1", name: "First" },
              {
                id: "child_2",
                name: "Second",
                grandchildren: [{ id: "grandchild_2", name: "Nested second" }],
              },
            ],
          },
        ],
        { relations: ["children"] }
      )
      expect(Object.keys(initialResult.performedActions.created)).toEqual([
        "PgliteActionParent",
        "PgliteActionChild",
        "PgliteActionGrandchild",
      ])

      const result = await repository.upsertWithReplace(
        [
          {
            id: "parent_1",
            children: [
              { id: "child_1", name: "First updated" },
              { id: "child_3", name: "Third" },
            ],
          },
        ],
        { relations: ["children"] }
      )

      expect(result.performedActions.updated).toEqual({
        PgliteActionChild: [{ id: "child_1" }],
        PgliteActionParent: [{ id: "parent_1" }],
      })
      expect(result.performedActions.created).toEqual({
        PgliteActionChild: [{ id: "child_3" }],
      })
      expect(result.performedActions.deleted).toEqual({
        PgliteActionChild: [{ id: "child_2" }],
        PgliteActionGrandchild: [{ id: "grandchild_2" }],
      })
      expect(result.entities).toEqual([
        expect.objectContaining({
          id: "parent_1",
          name: "Parent",
        }),
      ])
      const deletedGrandchildren = await connection.client.query<{
        count: number
      }>(
        `SELECT COUNT(*)::int AS count FROM "medusa_test"."pglite_action_grandchild"`
      )
      expect(deletedGrandchildren.rows).toEqual([{ count: 0 }])
      await expect(
        repository.find({
          where: { id: "parent_1" },
          options: {
            relations: ["children"],
          },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "parent_1",
          children: expect.arrayContaining([
            expect.objectContaining({ id: "child_1", name: "First updated" }),
            expect.objectContaining({ id: "child_3", name: "Third" }),
          ]),
        }),
      ])
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("reassigns an existing hasMany child from a primary-key-only payload", async () => {
    const Parent = model.define("pgliteReassignmentParent", {
      id: model.id().primaryKey(),
      children: model.hasMany(() => Child, {
        mappedBy: "parent",
      }),
    })
    const Child = model.define("pgliteReassignmentChild", {
      id: model.id().primaryKey(),
      name: model.text(),
      parent: model.belongsTo(() => Parent, {
        mappedBy: "children",
      }),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-has-many-reassignment",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [Parent, Child],
      })
      await prepared.database.setupDatabase()

      const Repository = pgliteModulePersistenceAdapter.createRepository(Parent)
      if (!Repository) {
        throw new Error("Expected a PGlite repository")
      }
      const repository = new Repository({ manager: connection })
      if (!isPGliteRepositoryProbe(repository)) {
        throw new Error("Expected a PGlite repository instance")
      }

      await repository.create([
        {
          id: "parent_1",
          children: [{ id: "child_1", name: "Existing child" }],
        },
        { id: "parent_2" },
      ])

      const result = await repository.upsertWithReplace(
        [{ id: "parent_2", children: [{ id: "child_1" }] }],
        { relations: ["children"] }
      )

      expect(result.performedActions.updated).toEqual({
        PgliteReassignmentChild: [{ id: "child_1" }],
        PgliteReassignmentParent: [{ id: "parent_2" }],
      })
      await expect(
        repository.find({
          where: { id: ["parent_1", "parent_2"] },
          options: { relations: ["children"], orderBy: { id: "ASC" } },
        })
      ).resolves.toEqual([
        expect.objectContaining({ id: "parent_1", children: [] }),
        expect.objectContaining({
          id: "parent_2",
          children: [
            expect.objectContaining({
              id: "child_1",
              name: "Existing child",
              parent_id: "parent_2",
            }),
          ],
        }),
      ])
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })

  it("creates, replaces, and hydrates configured implicit many-to-many pivots", async () => {
    const Parent = model.define("pgliteImplicitPivotParent", {
      id: model.id().primaryKey(),
      related: model.manyToMany(() => Related, {
        pivotTable: "pglite_implicit_parent_related",
        joinColumn: "parent_id",
        inverseJoinColumn: "related_id",
        mappedBy: "parents",
      }),
    })
    const Related = model.define("pgliteImplicitPivotRelated", {
      id: model.id().primaryKey(),
      label: model.text(),
      parents: model.manyToMany(() => Parent, {
        mappedBy: "related",
      }),
    })
    const dbConfig = pgliteModuleTestPersistenceAdapter.createDatabaseConfig({
      dbName: "medusa-pglite-adapter-implicit-pivot",
      schema: "medusa_test",
      debug: false,
    })
    const connection =
      pgliteModuleTestPersistenceAdapter.createConnection(dbConfig)

    if (!isPGliteModuleTestConnection(connection)) {
      throw new Error("Expected a PGlite connection")
    }

    try {
      const prepared = pgliteModuleTestPersistenceAdapter.prepareDatabase({
        connection,
        dbConfig,
        moduleModels: [Parent, Related],
      })
      await prepared.database.setupDatabase()

      const ParentRepository =
        pgliteModulePersistenceAdapter.createRepository(Parent)
      const RelatedRepository =
        pgliteModulePersistenceAdapter.createRepository(Related)
      if (!ParentRepository || !RelatedRepository) {
        throw new Error("Expected PGlite repositories")
      }

      const parentRepository = new ParentRepository({ manager: connection })
      const relatedRepository = new RelatedRepository({ manager: connection })
      if (
        !isPGliteRepositoryProbe(parentRepository) ||
        !isPGliteRepositoryProbe(relatedRepository)
      ) {
        throw new Error("Expected PGlite repository instances")
      }

      await parentRepository.create([
        {
          id: "parent_1",
          related: [{ id: "related_1", label: "First" }],
        },
      ])

      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: { relations: ["related"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          related: [
            expect.objectContaining({ id: "related_1", label: "First" }),
          ],
        }),
      ])
      await expect(
        relatedRepository.find({
          where: { id: "related_1" },
          options: { relations: ["parents"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          parents: [expect.objectContaining({ id: "parent_1" })],
        }),
      ])

      await parentRepository.upsertWithReplace(
        [
          {
            id: "parent_1",
            related: [{ id: "related_2", label: "Second" }],
          },
        ],
        { relations: ["related"] }
      )

      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: { relations: ["related"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          related: [
            expect.objectContaining({ id: "related_2", label: "Second" }),
          ],
        }),
      ])
      await expect(
        parentRepository.upsertWithReplace(
          [{ id: "parent_1", related: [{ id: "missing" }] }],
          { relations: ["related"] }
        )
      ).rejects.toThrow(
        "You tried to set relationship pglite_implicit_pivot_related_id: missing, but such entity does not exist"
      )
      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: { relations: ["related"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          related: [expect.objectContaining({ id: "related_2" })],
        }),
      ])
    } finally {
      await pgliteModuleTestPersistenceAdapter.cleanupConnection(connection)
    }
  })
})
