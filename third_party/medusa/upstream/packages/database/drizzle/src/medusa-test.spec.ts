import { sql } from "drizzle-orm"
import { model } from "@medusajs/dml"
import { model as medusaModel } from "@medusajs/utils/dml/model"
import type {
  Context,
  EventBusTypes,
  IMessageAggregator,
  Message,
  MessageAggregatorFormat,
} from "@medusajs/types"
import { describe, expect, it } from "vitest"
import { drizzleModulePersistenceAdapter } from "./medusa"
import { drizzleModuleTestPersistenceAdapter } from "./medusa-test"
import { dispatchDrizzleMutationEvent } from "./mutation-events"
import { compileDmlSchema } from "./schema"
import { renderD1MigrationSql } from "./d1"

describe("drizzleModuleTestPersistenceAdapter", () => {
  it("clears related module tables in dependency order", async () => {
    const Child = medusaModel.define("ClearDatabaseChild", {
      id: medusaModel.id().primaryKey(),
      parent: medusaModel.belongsTo(() => Parent, {
        mappedBy: "children",
      }),
    })
    const Parent = medusaModel.define("ClearDatabaseParent", {
      id: medusaModel.id().primaryKey(),
      children: medusaModel.hasMany(() => Child, { mappedBy: "parent" }),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    const prepared = drizzleModuleTestPersistenceAdapter.prepareDatabase({
      connection,
      moduleModels: [Child, Parent],
      dbConfig: {
        clientUrl: ":memory:",
        schema: "test",
        debug: false,
      },
    })

    try {
      await prepared.database.setupDatabase()
      connection.sqlite.exec(
        'INSERT INTO "clear_database_parent" ("id", "created_at", "updated_at") VALUES (\'parent_1\', 1, 1)'
      )
      connection.sqlite.exec(
        'INSERT INTO "clear_database_child" ("id", "parent_id", "created_at", "updated_at") VALUES (\'child_1\', \'parent_1\', 1, 1)'
      )

      await expect(prepared.database.clearDatabase()).resolves.toBeUndefined()
    } finally {
      await connection.destroy()
    }
  })

  it("persists Medusa BigNumber numeric and raw fields together", async () => {
    const Price = medusaModel.define("RepositoryBigNumberPrice", {
      id: medusaModel.id().primaryKey(),
      amount: medusaModel.bigNumber(),
      optional_amount: medusaModel.bigNumber().nullable(),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(renderD1MigrationSql(compileDmlSchema([Price])))
    const Repository = drizzleModulePersistenceAdapter.createRepository(Price)
    const repository = new Repository({ manager: connection })
    if (typeof repository === "function") {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      const [created] = await repository.create([
        { id: "price_1", amount: "100.5000", optional_amount: null },
      ])
      expect(created).toEqual(
        expect.objectContaining({
          amount: 100.5,
          raw_amount: { value: "100.5", precision: 20 },
          optional_amount: null,
          raw_optional_amount: null,
        })
      )

      const [updated] = await repository.update([
        {
          entity: created,
          update: { amount: { value: "42.125", precision: 8 } },
        },
      ])
      expect(updated).toEqual(
        expect.objectContaining({
          amount: 42.125,
          raw_amount: { value: "42.125", precision: 8 },
        })
      )
    } finally {
      await connection.destroy()
    }
  })

  it("coerces DML dateTime strings before persistence", async () => {
    const Scheduled = medusaModel.define("RepositoryScheduled", {
      id: medusaModel.id().primaryKey(),
      starts_at: medusaModel.dateTime().nullable(),
      ends_at: medusaModel.dateTime().nullable(),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(renderD1MigrationSql(compileDmlSchema([Scheduled])))
    const Repository = drizzleModulePersistenceAdapter.createRepository(Scheduled)
    const repository = new Repository({ manager: connection })
    if (typeof repository === "function") {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      const [created] = await repository.create([
        {
          id: "scheduled_1",
          starts_at: "2023-10-01T00:00:00.000Z",
          ends_at: null,
        },
      ])
      expect(created.starts_at).toEqual(new Date("2023-10-01T00:00:00.000Z"))
      expect(created.ends_at).toBeNull()

      const [updated] = await repository.update([
        {
          entity: created,
          update: { ends_at: "2023-10-30T00:00:00.000Z" },
        },
      ])
      expect(updated.ends_at).toEqual(new Date("2023-10-30T00:00:00.000Z"))

    } finally {
      await connection.destroy()
    }
  })

  it("matches null and custom date fields inside $or filters", async () => {
    const Token = medusaModel.define("RepositoryToken", {
      id: medusaModel.id().primaryKey(),
      label: medusaModel.text(),
      revoked_at: medusaModel.dateTime().nullable(),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(renderD1MigrationSql(compileDmlSchema([Token])))
    const Repository = drizzleModulePersistenceAdapter.createRepository(Token)
    const repository = new Repository({ manager: connection })
    if (typeof repository === "function") {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await repository.create([
        { id: "token_active", label: "active", revoked_at: null },
        {
          id: "token_future",
          label: "future",
          revoked_at: "3000-01-01T00:00:00.000Z",
        },
        {
          id: "token_past",
          label: "past",
          revoked_at: "2020-01-01T00:00:00.000Z",
        },
      ])

      await expect(
        repository.find({
          where: {
            $or: [
              { revoked_at: { $eq: null } },
              { revoked_at: { $gt: new Date("2999-01-01T00:00:00.000Z") } },
            ],
          },
        })
      ).resolves.toEqual([
        expect.objectContaining({ id: "token_active" }),
        expect.objectContaining({ id: "token_future" }),
      ])

      await expect(
        repository.find({
          where: {
            revoked_at: { $ne: null },
          },
        })
      ).resolves.toEqual([
        expect.objectContaining({ id: "token_future" }),
        expect.objectContaining({ id: "token_past" }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("validates required DML properties before persistence", async () => {
    const RequiredProperty = medusaModel.define("RequiredProperty", {
      required_value: medusaModel.text(),
      nullable_value: medusaModel.text().nullable(),
      default_value: medusaModel.text().default("default"),
      sequence: medusaModel.autoincrement().primaryKey(),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      renderD1MigrationSql(compileDmlSchema([RequiredProperty]))
    )
    const Repository =
      drizzleModulePersistenceAdapter.createRepository(RequiredProperty)
    const repository = new Repository({ manager: connection })
    if (typeof repository === "function") {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await expect(repository.create([{}])).rejects.toThrow(
        "Value for RequiredProperty.required_value is required, 'undefined' found"
      )
      await expect(
        repository.create([{ required_value: null }])
      ).rejects.toThrow(
        "Value for RequiredProperty.required_value is required, 'null' found"
      )
      await expect(
        repository.create([{ required_value: "present" }])
      ).resolves.toEqual([
        expect.objectContaining({
          required_value: "present",
          nullable_value: null,
          default_value: "default",
        }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("generates missing non-primary autoincrement values", async () => {
    const Displayed = medusaModel.define("Displayed", {
      id: medusaModel.id().primaryKey(),
      display_id: medusaModel.autoincrement(),
      name: medusaModel.text(),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(renderD1MigrationSql(compileDmlSchema([Displayed])))
    const Repository = drizzleModulePersistenceAdapter.createRepository(Displayed)
    const repository = new Repository({ manager: connection })
    if (typeof repository === "function") {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      const created = await repository.create([
        { name: "first" },
        { name: "second" },
        { name: "explicit", display_id: 10 },
        { name: "after explicit" },
      ])

      expect(created).toEqual([
        expect.objectContaining({ name: "first", display_id: 1 }),
        expect.objectContaining({ name: "second", display_id: 2 }),
        expect.objectContaining({ name: "explicit", display_id: 10 }),
        expect.objectContaining({ name: "after explicit", display_id: 11 }),
      ])

      await expect(
        repository.find({
          where: { id: [created[1].id, created[0].id] },
        })
      ).resolves.toEqual([
        expect.objectContaining({ name: "first", display_id: 1 }),
        expect.objectContaining({ name: "second", display_id: 2 }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("uses Order display_id for generated default id ordering", async () => {
    const Order = medusaModel.define("Order", {
      id: medusaModel.id().primaryKey(),
      display_id: medusaModel.autoincrement(),
      name: medusaModel.text(),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(renderD1MigrationSql(compileDmlSchema([Order])))
    const Repository = drizzleModulePersistenceAdapter.createRepository(Order)
    const repository = new Repository({ manager: connection })
    if (typeof repository === "function") {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await repository.create([
        { id: "order_z", name: "first" },
        { id: "order_a", name: "second" },
      ])

      await expect(
        repository.find({
          where: {},
          options: {
            orderBy: { id: "ASC" },
          },
        })
      ).resolves.toEqual([
        expect.objectContaining({ id: "order_z", display_id: 1 }),
        expect.objectContaining({ id: "order_a", display_id: 2 }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("maps SQLite check constraint failures to Medusa's expected error name", async () => {
    const Checked = medusaModel
      .define("RepositoryCheckedAmount", {
        id: medusaModel.id().primaryKey(),
        amount: medusaModel.bigNumber(),
      })
      .checks([(columns) => `${columns.amount} >= 0`])
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(renderD1MigrationSql(compileDmlSchema([Checked])))
    const Repository = drizzleModulePersistenceAdapter.createRepository(Checked)
    const repository = new Repository({ manager: connection })
    if (typeof repository === "function") {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await expect(
        repository.create([{ id: "checked_1", amount: -1 }])
      ).rejects.toMatchObject({
        name: "CheckConstraintViolationException",
      })
    } finally {
      await connection.destroy()
    }
  })

  it("preserves primary-key $or selector order despite default id ordering", async () => {
    const Ordered = medusaModel.define("RepositoryOrderedFind", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(renderD1MigrationSql(compileDmlSchema([Ordered])))
    const Repository = drizzleModulePersistenceAdapter.createRepository(Ordered)
    const repository = new Repository({ manager: connection })
    if (typeof repository === "function") {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await repository.create([
        { id: "ordered_b", name: "second-alphabetically" },
        { id: "ordered_a", name: "first-alphabetically" },
      ])

      await expect(
        repository.find({
          where: {
            $or: [{ id: "ordered_b" }, { id: "ordered_a" }],
          },
          options: {
            orderBy: { id: "ASC" },
          },
        })
      ).resolves.toEqual([
        expect.objectContaining({ id: "ordered_b" }),
        expect.objectContaining({ id: "ordered_a" }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("preserves primary-key array selector order when id ordering is explicit", async () => {
    const Ordered = medusaModel.define("RepositoryOrderedArrayFind", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(renderD1MigrationSql(compileDmlSchema([Ordered])))
    const Repository = drizzleModulePersistenceAdapter.createRepository(Ordered)
    const repository = new Repository({ manager: connection })
    if (typeof repository === "function") {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await repository.create([
        { id: "ordered_b", name: "second-alphabetically" },
        { id: "ordered_a", name: "first-alphabetically" },
      ])

      await expect(
        repository.find({
          where: {
            id: ["ordered_b", "ordered_a"],
          },
          options: {
            orderBy: { id: "ASC" },
          },
        })
      ).resolves.toEqual([
        expect.objectContaining({ id: "ordered_b" }),
        expect.objectContaining({ id: "ordered_a" }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("uses insertion order for unordered root and relation reads", async () => {
    const Child = medusaModel.define("RepositoryInsertionOrderChild", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
      parent: medusaModel
        .belongsTo(() => Parent, {
          mappedBy: "children",
          foreignKeyName: "parent_id",
        })
        .nullable(),
    })
    const Parent = medusaModel.define("RepositoryInsertionOrderParent", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
      children: medusaModel.hasMany(() => Child, { mappedBy: "parent" }),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(renderD1MigrationSql(compileDmlSchema([Parent, Child])))
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const ChildRepository =
      drizzleModulePersistenceAdapter.createRepository(Child)
    const parentRepository = new ParentRepository({ manager: connection })
    const childRepository = new ChildRepository({ manager: connection })
    if (
      typeof parentRepository === "function" ||
      typeof childRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await parentRepository.create([
        { id: "parent_b", name: "Parent B" },
        { id: "parent_a", name: "Parent A" },
      ])
      await childRepository.create([
        { id: "child_b", name: "Child B", parent_id: "parent_b" },
        { id: "child_a", name: "Child A", parent_id: "parent_b" },
      ])

      await expect(parentRepository.find()).resolves.toEqual([
        expect.objectContaining({ id: "parent_b" }),
        expect.objectContaining({ id: "parent_a" }),
      ])
      await expect(
        parentRepository.find({
          where: { id: "parent_b" },
          options: { populate: ["children"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          children: [
            expect.objectContaining({ id: "child_b" }),
            expect.objectContaining({ id: "child_a" }),
          ],
        }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("applies direct relation ordering while loading populated relations", async () => {
    const Child = medusaModel.define("RepositoryOrderedRelationChild", {
      id: medusaModel.id().primaryKey(),
      rank: medusaModel.number(),
      parent: medusaModel.belongsTo(() => Parent, { mappedBy: "children" }),
    })
    const Parent = medusaModel.define("RepositoryOrderedRelationParent", {
      id: medusaModel.id().primaryKey(),
      children: medusaModel.hasMany(() => Child, { mappedBy: "parent" }),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(renderD1MigrationSql(compileDmlSchema([Parent, Child])))
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const ChildRepository =
      drizzleModulePersistenceAdapter.createRepository(Child)
    const parentRepository = new ParentRepository({ manager: connection })
    const childRepository = new ChildRepository({ manager: connection })
    if (
      typeof parentRepository === "function" ||
      typeof childRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await parentRepository.create([{ id: "parent_1" }])
      await childRepository.create([
        { id: "child_2", rank: 2, parent_id: "parent_1" },
        { id: "child_1", rank: 1, parent_id: "parent_1" },
      ])

      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: {
            populate: ["children"],
            orderBy: {
              children: { rank: "ASC" },
            },
          },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          children: [
            expect.objectContaining({ id: "child_1", rank: 1 }),
            expect.objectContaining({ id: "child_2", rank: 2 }),
          ],
        }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("uses display_id order before rowid when present", async () => {
    const Displayed = medusaModel.define("RepositoryDisplayOrder", {
      id: medusaModel.id().primaryKey(),
      display_id: medusaModel.number(),
      name: medusaModel.text(),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(renderD1MigrationSql(compileDmlSchema([Displayed])))
    const Repository = drizzleModulePersistenceAdapter.createRepository(Displayed)
    const repository = new Repository({ manager: connection })
    if (typeof repository === "function") {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await repository.create([
        { id: "displayed_late", display_id: 2, name: "Late" },
        { id: "displayed_early", display_id: 1, name: "Early" },
      ])

      await expect(repository.find()).resolves.toEqual([
        expect.objectContaining({ id: "displayed_early" }),
        expect.objectContaining({ id: "displayed_late" }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("projects relation scalar fields requested through virtual DTO segments", async () => {
    const Child = medusaModel.define("RepositoryVirtualProjectionChild", {
      id: medusaModel.id().primaryKey(),
      quantity: medusaModel.number(),
      fulfilled_quantity: medusaModel.number().default(0),
      parent: medusaModel
        .belongsTo(() => Parent, {
          mappedBy: "children",
          foreignKeyName: "parent_id",
        })
        .nullable(),
    })
    const Parent = medusaModel.define("RepositoryVirtualProjectionParent", {
      id: medusaModel.id().primaryKey(),
      children: medusaModel.hasMany(() => Child, { mappedBy: "parent" }),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(renderD1MigrationSql(compileDmlSchema([Parent, Child])))
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const ChildRepository =
      drizzleModulePersistenceAdapter.createRepository(Child)
    const parentRepository = new ParentRepository({ manager: connection })
    const childRepository = new ChildRepository({ manager: connection })
    if (
      typeof parentRepository === "function" ||
      typeof childRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await parentRepository.create([{ id: "parent_1" }])
      await childRepository.create([
        {
          id: "child_1",
          quantity: 2,
          fulfilled_quantity: 1,
          parent_id: "parent_1",
        },
      ])

      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: {
            fields: [
              "id",
              "children.id",
              "children.quantity",
              "children.detail.fulfilled_quantity",
            ],
            populate: ["children", "children.detail"],
          },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          children: [
            expect.objectContaining({
              id: "child_1",
              quantity: 2,
              fulfilled_quantity: 1,
            }),
          ],
        }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("loads complete relation rows selected directly as fields", async () => {
    const Child = medusaModel.define("RepositoryFieldRelationChild", {
      id: medusaModel.id().primaryKey(),
      version: medusaModel.number().default(1),
      quantity: medusaModel.number(),
      fulfilled_quantity: medusaModel.number().default(0),
      parent: medusaModel
        .belongsTo(() => Parent, {
          mappedBy: "children",
          foreignKeyName: "parent_id",
        })
        .nullable(),
    })
    const Parent = medusaModel.define("RepositoryFieldRelationParent", {
      id: medusaModel.id().primaryKey(),
      children: medusaModel.hasMany(() => Child, { mappedBy: "parent" }),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(renderD1MigrationSql(compileDmlSchema([Parent, Child])))
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const ChildRepository =
      drizzleModulePersistenceAdapter.createRepository(Child)
    const parentRepository = new ParentRepository({ manager: connection })
    const childRepository = new ChildRepository({ manager: connection })
    if (
      typeof parentRepository === "function" ||
      typeof childRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await parentRepository.create([{ id: "parent_1" }])
      await childRepository.create([
        {
          id: "child_1",
          version: 1,
          quantity: 2,
          fulfilled_quantity: 1,
          parent_id: "parent_1",
        },
      ])

      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: {
            fields: ["id", "children"],
          },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "parent_1",
          children: [
            expect.objectContaining({
              id: "child_1",
              version: 1,
              quantity: 2,
              fulfilled_quantity: 1,
              parent_id: "parent_1",
            }),
          ],
        }),
      ])

      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: {
            fields: ["id", "children.detail"],
          },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "parent_1",
          children: [
            expect.objectContaining({
              id: "child_1",
              version: 1,
              quantity: 2,
              fulfilled_quantity: 1,
              parent_id: "parent_1",
            }),
          ],
        }),
      ])

      await expect(
        parentRepository.find({
          where: {
            children: {
              detail: {
                fulfilled_quantity: 1,
              },
            },
          },
          options: {
            fields: ["id", "children.detail"],
          },
        })
      ).resolves.toHaveLength(1)

      await expect(
        parentRepository.find({
          where: {
            children: {
              detail: {
                fulfilled_quantity: 2,
              },
            },
          },
          options: {
            fields: ["id", "children.detail"],
          },
        })
      ).resolves.toHaveLength(0)
    } finally {
      await connection.destroy()
    }
  })

  it("filters versioned Order hasMany relations to the parent version", async () => {
    const OrderItem = medusaModel.define("OrderItem", {
      id: medusaModel.id().primaryKey(),
      version: medusaModel.number().default(1),
      quantity: medusaModel.number(),
      fulfilled_quantity: medusaModel.number().default(0),
      order: medusaModel.belongsTo(() => Order, { mappedBy: "items" }),
    })
    const Order = medusaModel.define("Order", {
      id: medusaModel.id().primaryKey(),
      version: medusaModel.number().default(1),
      items: medusaModel.hasMany(() => OrderItem, { mappedBy: "order" }),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      renderD1MigrationSql(compileDmlSchema([Order, OrderItem]))
    )
    const OrderRepository =
      drizzleModulePersistenceAdapter.createRepository(Order)
    const OrderItemRepository =
      drizzleModulePersistenceAdapter.createRepository(OrderItem)
    const orderRepository = new OrderRepository({ manager: connection })
    const orderItemRepository = new OrderItemRepository({ manager: connection })
    if (
      typeof orderRepository === "function" ||
      typeof orderItemRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await orderRepository.create([{ id: "order_1", version: 2 }])
      await orderItemRepository.create([
        {
          id: "item_v1",
          version: 1,
          quantity: 1,
          fulfilled_quantity: 0,
          order_id: "order_1",
        },
        {
          id: "item_v2",
          version: 2,
          quantity: 1,
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
      await connection.destroy()
    }
  })

  it("provides real atomic transactions for Node SQLite tests", async () => {
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      'CREATE TABLE "transaction_probe" ("value" TEXT NOT NULL)'
    )

    try {
      await expect(
        connection.transaction(async (transactionManager) => {
          await transactionManager.database.run(
            sql`INSERT INTO transaction_probe (value) VALUES ('rolled-back')`
          )
          throw new Error("rollback")
        })
      ).rejects.toThrow("rollback")

      expect(
        connection.sqlite
          .prepare('SELECT "value" FROM "transaction_probe"')
          .all()
      ).toEqual([])

      await connection.transaction(async (transactionManager) => {
        await transactionManager.database.run(
          sql`INSERT INTO transaction_probe (value) VALUES ('committed')`
        )
        await expect(
          transactionManager.transaction(async (nestedTransactionManager) => {
            await nestedTransactionManager.database.run(
              sql`INSERT INTO transaction_probe (value) VALUES ('nested-rollback')`
            )
            throw new Error("nested rollback")
          })
        ).rejects.toThrow("nested rollback")
      })

      expect(
        connection.sqlite
          .prepare('SELECT "value" FROM "transaction_probe"')
          .all()
      ).toEqual([{ value: "committed" }])
    } finally {
      await connection.destroy()
    }
  })

  it("soft deletes and restores through the Medusa repository contract", async () => {
    const Currency = model.define("currency_soft_delete_test", {
      code: model.text().primaryKey(),
      name: model.text(),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(renderD1MigrationSql(compileDmlSchema([Currency])))
    const Repository =
      drizzleModulePersistenceAdapter.createRepository(Currency)
    const repository = new Repository({ manager: connection })
    if (typeof repository === "function") {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await repository.create([{ code: "usd", name: "US Dollar" }])

      const [softDeleted, softDeletedMap] = await repository.softDelete(["usd"])
      expect(softDeleted).toEqual([
        expect.objectContaining({ code: "usd", deleted_at: expect.any(Date) }),
      ])
      expect(softDeletedMap).toEqual({
        CurrencySoftDeleteTest: softDeleted,
      })
      expect(await repository.find({ where: { code: "usd" } })).toEqual([])

      const [restored, restoredMap] = await repository.restore(["usd"])
      expect(restored).toEqual([
        expect.objectContaining({ code: "usd", deleted_at: null }),
      ])
      expect(restoredMap).toEqual({ CurrencySoftDeleteTest: restored })
      expect(await repository.find({ where: { code: "usd" } })).toEqual([
        expect.objectContaining({ code: "usd", deleted_at: null }),
      ])

      await expect(repository.softDelete([])).resolves.toEqual([[], {}])
      await expect(repository.restore([])).resolves.toEqual([[], {}])
    } finally {
      await connection.destroy()
    }
  })

  it("uses composite primary keys for repository mutations", async () => {
    const Translation = model.define("repository_composite_translation", {
      entity_id: model.text().primaryKey(),
      locale: model.text().primaryKey(),
      value: model.text(),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      renderD1MigrationSql(compileDmlSchema([Translation]))
    )
    const Repository =
      drizzleModulePersistenceAdapter.createRepository(Translation)
    const repository = new Repository({ manager: connection })
    if (typeof repository === "function") {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await repository.create([
        { entity_id: "product_1", locale: "en", value: "Shirt" },
        { entity_id: "product_1", locale: "fr", value: "Chemise" },
      ])

      await expect(
        repository.find({
          where: { entity_id: "product_1", locale: "en" },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          entity_id: "product_1",
          locale: "en",
          value: "Shirt",
        }),
      ])

      await repository.update([
        {
          entity: { entity_id: "product_1", locale: "en" },
          update: { value: "Updated Shirt" },
        },
      ])
      await expect(
        repository.find({
          where: { entity_id: "product_1", locale: "en" },
        })
      ).resolves.toEqual([expect.objectContaining({ value: "Updated Shirt" })])

      await repository.upsert([
        { entity_id: "product_1", locale: "fr", value: "Chemise updated" },
        { entity_id: "product_2", locale: "en", value: "Pants" },
      ])
      await expect(
        repository.find({
          where: {
            $or: [
              { entity_id: "product_1", locale: "fr" },
              { entity_id: "product_2", locale: "en" },
            ],
          },
          options: { orderBy: { entity_id: "ASC" } },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          entity_id: "product_1",
          locale: "fr",
          value: "Chemise updated",
        }),
        expect.objectContaining({
          entity_id: "product_2",
          locale: "en",
          value: "Pants",
        }),
      ])

      await repository.delete({ entity_id: "product_1", locale: "en" })
      await expect(
        repository.find({
          where: { entity_id: "product_1", locale: "en" },
        })
      ).resolves.toEqual([])
    } finally {
      await connection.destroy()
    }
  })

  it("serializes array columns during upsert conflict updates", async () => {
    const Provider = model.define("repository_array_upsert_provider", {
      id: model.id().primaryKey(),
      channels: model.array().default([]),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(renderD1MigrationSql(compileDmlSchema([Provider])))
    const Repository = drizzleModulePersistenceAdapter.createRepository(Provider)
    const repository = new Repository({ manager: connection })
    if (typeof repository === "function") {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await repository.upsert([{ id: "provider_1", channels: ["email"] }])
      await repository.upsert([
        { id: "provider_1", channels: ["email", "sms"] },
      ])

      await expect(
        repository.find({ where: { id: "provider_1" } })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "provider_1",
          channels: ["email", "sms"],
        }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("loads FK-backed hasMany and belongsTo relations", async () => {
    const Grandchild = medusaModel.define("RepositoryRelationGrandchild", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
      child: medusaModel
        .belongsTo(() => Child, {
          mappedBy: "grandchildren",
          foreignKeyName: "child_id",
        })
        .nullable(),
    })
    const Child = medusaModel.define("RepositoryRelationChild", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
      parent: medusaModel
        .belongsTo(() => Parent, {
          mappedBy: "children",
          foreignKeyName: "parent_id",
        })
        .nullable(),
      grandchildren: medusaModel.hasMany(() => Grandchild, {
        mappedBy: "child",
      }),
    })
    const Parent = medusaModel
      .define("RepositoryRelationParent", {
        id: medusaModel.id().primaryKey(),
        name: medusaModel.text(),
        children: medusaModel.hasMany(() => Child, { mappedBy: "parent" }),
      })
      .cascades({ delete: ["children"] })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      renderD1MigrationSql(compileDmlSchema([Parent, Child, Grandchild]))
    )
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const ChildRepository =
      drizzleModulePersistenceAdapter.createRepository(Child)
    const GrandchildRepository =
      drizzleModulePersistenceAdapter.createRepository(Grandchild)
    const parentRepository = new ParentRepository({ manager: connection })
    const childRepository = new ChildRepository({ manager: connection })
    const grandchildRepository = new GrandchildRepository({
      manager: connection,
    })
    if (
      typeof parentRepository === "function" ||
      typeof childRepository === "function" ||
      typeof grandchildRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await parentRepository.create([
        { id: "parent_1", name: "Parent" },
        { id: "parent_2", name: "Other Parent" },
      ])
      await childRepository.create([
        { id: "child_1", name: "Child 1", parent_id: "parent_1" },
        { id: "child_2", name: "Child 2", parent_id: "parent_1" },
      ])
      await grandchildRepository.create([
        { id: "grandchild_1", name: "Grandchild 1", child_id: "child_1" },
      ])

      const parents = await parentRepository.find({
        where: { id: "parent_1" },
        options: { populate: ["children"] },
      })
      expect(parents).toEqual([
        expect.objectContaining({
          id: "parent_1",
          children: [
            expect.objectContaining({ id: "child_1", parent_id: "parent_1" }),
            expect.objectContaining({ id: "child_2", parent_id: "parent_1" }),
          ],
        }),
      ])
      const parentsWithOnlyRelations = await parentRepository.find({
        where: { id: "parent_1" },
        options: { fields: [], populate: ["children"] },
      })
      expect(Object.keys(parentsWithOnlyRelations[0]).sort()).toEqual([
        "children",
        "id",
      ])
      expect(parentsWithOnlyRelations[0]?.children).toEqual([
        expect.objectContaining({
          id: "child_1",
          name: "Child 1",
          parent_id: "parent_1",
        }),
        expect.objectContaining({
          id: "child_2",
          name: "Child 2",
          parent_id: "parent_1",
        }),
      ])

      const children = await childRepository.find({
        where: { id: "child_1" },
        options: { populate: ["parent"] },
      })
      expect(children).toEqual([
        expect.objectContaining({
          id: "child_1",
          parent: expect.objectContaining({ id: "parent_1" }),
        }),
      ])
      await expect(
        childRepository.find({
          where: { parent: { id: "parent_1" } },
          options: { orderBy: { id: "ASC" } },
        })
      ).resolves.toEqual([
        expect.objectContaining({ id: "child_1", parent_id: "parent_1" }),
        expect.objectContaining({ id: "child_2", parent_id: "parent_1" }),
      ])

      const parentsWithNestedRelations = await parentRepository.find({
        where: { id: "parent_1" },
        options: { populate: ["children.grandchildren"] },
      })
      expect(parentsWithNestedRelations).toEqual([
        expect.objectContaining({
          id: "parent_1",
          children: expect.arrayContaining([
            expect.objectContaining({
              id: "child_1",
              grandchildren: [
                expect.objectContaining({
                  id: "grandchild_1",
                  child_id: "child_1",
                }),
              ],
            }),
            expect.objectContaining({
              id: "child_2",
              grandchildren: [],
            }),
          ]),
        }),
      ])

      const parentsWithNestedScalarFields = await parentRepository.find({
        where: { id: "parent_1" },
        options: {
          fields: ["name"],
          populate: ["children.name", "children.grandchildren.name"],
        },
      })
      expect(parentsWithNestedScalarFields).toEqual([
        expect.objectContaining({
          id: "parent_1",
          name: "Parent",
          children: [
            expect.objectContaining({
              id: "child_1",
              name: "Child 1",
              grandchildren: [
                expect.objectContaining({
                  id: "grandchild_1",
                  name: "Grandchild 1",
                }),
              ],
            }),
            expect.objectContaining({
              id: "child_2",
              name: "Child 2",
              grandchildren: [],
            }),
          ],
        }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("creates FK-backed hasMany relations from a single child object", async () => {
    const Child = medusaModel.define("RepositorySingleChildCreateChild", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
      parent: medusaModel
        .belongsTo(() => Parent, {
          mappedBy: "children",
          foreignKeyName: "parent_id",
        })
        .nullable(),
    })
    const Parent = medusaModel.define("RepositorySingleChildCreateParent", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
      children: medusaModel.hasMany(() => Child, { mappedBy: "parent" }),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(renderD1MigrationSql(compileDmlSchema([Parent, Child])))
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const parentRepository = new ParentRepository({ manager: connection })
    if (typeof parentRepository === "function") {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await parentRepository.create([
        {
          id: "parent_1",
          name: "Parent",
          children: {
            id: "child_1",
            name: "Child",
          },
        },
      ])

      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: { populate: ["children"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "parent_1",
          children: [
            expect.objectContaining({
              id: "child_1",
              name: "Child",
              parent_id: "parent_1",
            }),
          ],
        }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("inherits matching context fields into nested hasMany create rows", async () => {
    const Child = medusaModel.define("RepositoryInheritedContextChild", {
      id: medusaModel.id().primaryKey(),
      owner_id: medusaModel.text(),
      version: medusaModel.number().nullable(),
      name: medusaModel.text(),
      parent: medusaModel.belongsTo(() => Parent, {
        mappedBy: "children",
        foreignKeyName: "parent_id",
      }),
    })
    const Parent = medusaModel.define("RepositoryInheritedContextParent", {
      id: medusaModel.id().primaryKey(),
      owner_id: medusaModel.text(),
      version: medusaModel.number(),
      children: medusaModel.hasMany(() => Child, { mappedBy: "parent" }),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(renderD1MigrationSql(compileDmlSchema([Parent, Child])))
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const parentRepository = new ParentRepository({ manager: connection })
    if (typeof parentRepository === "function") {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await parentRepository.create([
        {
          id: "parent_1",
          owner_id: "owner_1",
          version: 3,
          children: [{ id: "child_1", name: "Child" }],
        },
      ])

      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: { populate: ["children"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          children: [
            expect.objectContaining({
              id: "child_1",
              owner_id: "owner_1",
              version: 3,
            }),
          ],
        }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("expands wrapper hasMany populate paths through owned hasOne relations", async () => {
    const Tag = medusaModel.define("RepositoryOwnedPopulateTag", {
      id: medusaModel.id().primaryKey(),
      label: medusaModel.text(),
      child: medusaModel
        .belongsTo(() => Child, {
          mappedBy: "tags",
          foreignKeyName: "child_id",
        })
        .nullable(),
    })
    const Child = medusaModel.define("RepositoryOwnedPopulateChild", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
      tags: medusaModel.hasMany(() => Tag, { mappedBy: "child" }),
    })
    const Link = medusaModel.define("RepositoryOwnedPopulateLink", {
      id: medusaModel.id().primaryKey(),
      quantity: medusaModel.number(),
      parent: medusaModel.belongsTo(() => Parent, {
        mappedBy: "links",
        foreignKeyName: "parent_id",
      }),
      child: medusaModel.hasOne(() => Child, {
        mappedBy: undefined,
        foreignKey: true,
      }),
    })
    const Parent = medusaModel.define("RepositoryOwnedPopulateParent", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
      links: medusaModel.hasMany(() => Link, { mappedBy: "parent" }),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      renderD1MigrationSql(compileDmlSchema([Parent, Link, Child, Tag]))
    )
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const LinkRepository = drizzleModulePersistenceAdapter.createRepository(Link)
    const ChildRepository =
      drizzleModulePersistenceAdapter.createRepository(Child)
    const TagRepository = drizzleModulePersistenceAdapter.createRepository(Tag)
    const parentRepository = new ParentRepository({ manager: connection })
    const linkRepository = new LinkRepository({ manager: connection })
    const childRepository = new ChildRepository({ manager: connection })
    const tagRepository = new TagRepository({ manager: connection })
    if (
      typeof parentRepository === "function" ||
      typeof linkRepository === "function" ||
      typeof childRepository === "function" ||
      typeof tagRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await parentRepository.create([{ id: "parent_1", name: "Parent" }])
      await childRepository.create([{ id: "child_1", name: "Child" }])
      await linkRepository.create([
        {
          id: "link_1",
          quantity: 2,
          parent_id: "parent_1",
          child_id: "child_1",
        },
      ])
      await tagRepository.create([
        { id: "tag_1", label: "Tag", child_id: "child_1" },
      ])

      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: { populate: ["links", "links.tags"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "parent_1",
          links: [
            expect.objectContaining({
              id: "link_1",
              child: expect.objectContaining({
                id: "child_1",
                tags: [expect.objectContaining({ id: "tag_1" })],
              }),
            }),
          ],
        }),
      ])

      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: { populate: ["links.detail"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "parent_1",
          links: [
            expect.objectContaining({
              id: "link_1",
              child: expect.objectContaining({
                id: "child_1",
              }),
            }),
          ],
        }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("creates nested relations under owned hasOne targets", async () => {
    const Tag = medusaModel.define("RepositoryOwnedNestedCreateTag", {
      id: medusaModel.id().primaryKey(),
      label: medusaModel.text(),
      child: medusaModel
        .belongsTo(() => Child, {
          mappedBy: "tags",
          foreignKeyName: "child_id",
        })
        .nullable(),
    })
    const Child = medusaModel.define("RepositoryOwnedNestedCreateChild", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
      tags: medusaModel.hasMany(() => Tag, { mappedBy: "child" }),
    })
    const Link = medusaModel.define("RepositoryOwnedNestedCreateLink", {
      id: medusaModel.id().primaryKey(),
      parent: medusaModel.belongsTo(() => Parent, {
        mappedBy: "links",
        foreignKeyName: "parent_id",
      }),
      child: medusaModel.hasOne(() => Child, {
        mappedBy: undefined,
        foreignKey: true,
      }),
    })
    const Parent = medusaModel.define("RepositoryOwnedNestedCreateParent", {
      id: medusaModel.id().primaryKey(),
      links: medusaModel.hasMany(() => Link, { mappedBy: "parent" }),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      renderD1MigrationSql(compileDmlSchema([Parent, Link, Child, Tag]))
    )
    drizzleModulePersistenceAdapter.prepareModels([Parent, Link, Child, Tag])
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const parentRepository = new ParentRepository({ manager: connection })
    if (typeof parentRepository === "function") {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await parentRepository.create([
        {
          id: "parent_1",
          links: [
            {
              id: "link_1",
              child: {
                id: "child_1",
                name: "Child",
                tags: [{ id: "tag_1", label: "Tag" }],
              },
            },
          ],
        },
      ])

      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: { populate: ["links.child.tags"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          links: [
            expect.objectContaining({
              child: expect.objectContaining({
                id: "child_1",
                tags: [expect.objectContaining({ id: "tag_1" })],
              }),
            }),
          ],
        }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("deletes required inbound hasOne wrappers before deleting owned rows", async () => {
    const Child = medusaModel.define("RepositoryOwnedDeleteChild", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
    })
    const Link = medusaModel.define("RepositoryOwnedDeleteLink", {
      id: medusaModel.id().primaryKey(),
      parent: medusaModel.belongsTo(() => Parent, {
        mappedBy: "links",
        foreignKeyName: "parent_id",
      }),
      child: medusaModel.hasOne(() => Child, {
        mappedBy: undefined,
        foreignKey: true,
      }),
    })
    const Parent = medusaModel.define("RepositoryOwnedDeleteParent", {
      id: medusaModel.id().primaryKey(),
      links: medusaModel.hasMany(() => Link, { mappedBy: "parent" }),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      renderD1MigrationSql(compileDmlSchema([Parent, Link, Child]))
    )
    drizzleModulePersistenceAdapter.prepareModels([Parent, Link, Child])
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const LinkRepository = drizzleModulePersistenceAdapter.createRepository(Link)
    const ChildRepository =
      drizzleModulePersistenceAdapter.createRepository(Child)
    const parentRepository = new ParentRepository({ manager: connection })
    const linkRepository = new LinkRepository({ manager: connection })
    const childRepository = new ChildRepository({ manager: connection })
    if (
      typeof parentRepository === "function" ||
      typeof linkRepository === "function" ||
      typeof childRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await parentRepository.create([{ id: "parent_1" }])
      await childRepository.create([{ id: "child_1", name: "Child" }])
      await linkRepository.create([
        { id: "link_1", parent_id: "parent_1", child_id: "child_1" },
      ])

      await childRepository.delete("child_1")

      await expect(linkRepository.find()).resolves.toEqual([])
      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: { populate: ["links"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "parent_1",
          links: [],
        }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("loads and cascades FK-backed composite-key relations", async () => {
    const Child = medusaModel.define("RepositoryCompositeRelationChild", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
      parent: medusaModel.belongsTo(() => Parent, {
        mappedBy: "children",
      }),
    })
    const Parent = medusaModel
      .define("RepositoryCompositeRelationParent", {
        tenant_id: medusaModel.text().primaryKey(),
        external_id: medusaModel.text().primaryKey(),
        name: medusaModel.text(),
        children: medusaModel.hasMany(() => Child, { mappedBy: "parent" }),
      })
      .cascades({ delete: ["children"] })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      renderD1MigrationSql(compileDmlSchema([Parent, Child]))
    )
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const ChildRepository =
      drizzleModulePersistenceAdapter.createRepository(Child)
    const parentRepository = new ParentRepository({ manager: connection })
    const childRepository = new ChildRepository({ manager: connection })
    if (
      typeof parentRepository === "function" ||
      typeof childRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await parentRepository.create([
        {
          tenant_id: "tenant_1",
          external_id: "shared",
          name: "Parent 1",
        },
        {
          tenant_id: "tenant_2",
          external_id: "shared",
          name: "Parent 2",
        },
      ])
      await childRepository.create([
        {
          id: "child_1",
          name: "Child 1",
          parent_tenant_id: "tenant_1",
          parent_external_id: "shared",
        },
        {
          id: "child_2",
          name: "Child 2",
          parent_tenant_id: "tenant_2",
          parent_external_id: "shared",
        },
      ])

      await expect(
        parentRepository.find({
          where: { tenant_id: "tenant_1", external_id: "shared" },
          options: { populate: ["children"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          tenant_id: "tenant_1",
          children: [expect.objectContaining({ id: "child_1" })],
        }),
      ])
      await expect(
        childRepository.find({
          where: { id: "child_2" },
          options: { populate: ["parent"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "child_2",
          parent: expect.objectContaining({
            tenant_id: "tenant_2",
            external_id: "shared",
          }),
        }),
      ])

      await parentRepository.softDelete({
        tenant_id: "tenant_1",
        external_id: "shared",
      })
      await expect(
        childRepository.find({ where: { id: ["child_1", "child_2"] } })
      ).resolves.toEqual([expect.objectContaining({ id: "child_2" })])

      await parentRepository.restore({
        tenant_id: "tenant_1",
        external_id: "shared",
      })
      await expect(
        childRepository.find({ where: { id: ["child_1", "child_2"] } })
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "child_1" }),
          expect.objectContaining({ id: "child_2" }),
        ])
      )
    } finally {
      await connection.destroy()
    }
  })

  it("loads pivotEntity-backed manyToMany relations", async () => {
    const Link = medusaModel.define("RepositoryManyToManyLink", {
      id: medusaModel.id().primaryKey(),
      parent: medusaModel.belongsTo(() => Parent, {
        mappedBy: "tags",
      }),
      tag: medusaModel.belongsTo(() => Tag, {
        mappedBy: "parents",
      }),
    })
    const Tag = medusaModel.define("RepositoryManyToManyTag", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
      parents: medusaModel.manyToMany(() => Parent, {
        mappedBy: "tags",
        pivotEntity: () => Link,
      }),
    })
    const Parent = medusaModel.define("RepositoryManyToManyParent", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
      tags: medusaModel.manyToMany(() => Tag, {
        mappedBy: "parents",
        pivotEntity: () => Link,
      }),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      renderD1MigrationSql(compileDmlSchema([Parent, Tag, Link]))
    )
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const TagRepository = drizzleModulePersistenceAdapter.createRepository(Tag)
    const LinkRepository =
      drizzleModulePersistenceAdapter.createRepository(Link)
    const parentRepository = new ParentRepository({ manager: connection })
    const tagRepository = new TagRepository({ manager: connection })
    const linkRepository = new LinkRepository({ manager: connection })
    if (
      typeof parentRepository === "function" ||
      typeof tagRepository === "function" ||
      typeof linkRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await parentRepository.create([
        { id: "parent_1", name: "Parent 1" },
        { id: "parent_2", name: "Parent 2" },
      ])
      await tagRepository.create([
        { id: "tag_1", name: "Tag 1" },
        { id: "tag_2", name: "Tag 2" },
      ])
      await linkRepository.create([
        { id: "link_1", parent_id: "parent_1", tag_id: "tag_1" },
        { id: "link_2", parent_id: "parent_1", tag_id: "tag_2" },
        { id: "link_3", parent_id: "parent_2", tag_id: "tag_2" },
      ])

      const parents = await parentRepository.find({
        where: { id: "parent_1" },
        options: { populate: ["tags"] },
      })
      expect(parents).toEqual([
        expect.objectContaining({
          id: "parent_1",
          tags: expect.arrayContaining([
            expect.objectContaining({ id: "tag_1" }),
            expect.objectContaining({ id: "tag_2" }),
          ]),
        }),
      ])

      const tags = await tagRepository.find({
        where: { id: "tag_2" },
        options: { populate: ["parents"] },
      })
      expect(tags).toEqual([
        expect.objectContaining({
          id: "tag_2",
          parents: expect.arrayContaining([
            expect.objectContaining({ id: "parent_1" }),
            expect.objectContaining({ id: "parent_2" }),
          ]),
        }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("loads composite-key pivotEntity-backed manyToMany relations", async () => {
    const Link = medusaModel.define("RepositoryCompositePivotEntityLink", {
      id: medusaModel.id().primaryKey(),
      parent: medusaModel.belongsTo(() => Parent, {
        mappedBy: "tags",
      }),
      tag: medusaModel.belongsTo(() => Tag, {
        mappedBy: "parents",
      }),
    })
    const Tag = medusaModel.define("RepositoryCompositePivotEntityTag", {
      tenant_id: medusaModel.text().primaryKey(),
      code: medusaModel.text().primaryKey(),
      parents: medusaModel.manyToMany(() => Parent, {
        mappedBy: "tags",
        pivotEntity: () => Link,
      }),
    })
    const Parent = medusaModel.define("RepositoryCompositePivotEntityParent", {
      tenant_id: medusaModel.text().primaryKey(),
      external_id: medusaModel.text().primaryKey(),
      tags: medusaModel.manyToMany(() => Tag, {
        mappedBy: "parents",
        pivotEntity: () => Link,
      }),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      renderD1MigrationSql(compileDmlSchema([Parent, Tag, Link]))
    )
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const TagRepository = drizzleModulePersistenceAdapter.createRepository(Tag)
    const LinkRepository =
      drizzleModulePersistenceAdapter.createRepository(Link)
    const parentRepository = new ParentRepository({ manager: connection })
    const tagRepository = new TagRepository({ manager: connection })
    const linkRepository = new LinkRepository({ manager: connection })
    if (
      typeof parentRepository === "function" ||
      typeof tagRepository === "function" ||
      typeof linkRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await parentRepository.create([
        { tenant_id: "tenant_1", external_id: "shared" },
        { tenant_id: "tenant_2", external_id: "shared" },
      ])
      await tagRepository.create([
        { tenant_id: "tenant_1", code: "shared" },
        { tenant_id: "tenant_2", code: "shared" },
      ])
      await linkRepository.create([
        {
          id: "link_1",
          parent_tenant_id: "tenant_1",
          parent_external_id: "shared",
          tag_tenant_id: "tenant_1",
          tag_code: "shared",
        },
        {
          id: "link_2",
          parent_tenant_id: "tenant_2",
          parent_external_id: "shared",
          tag_tenant_id: "tenant_2",
          tag_code: "shared",
        },
      ])

      await expect(
        parentRepository.find({
          where: { external_id: "shared" },
          options: { populate: ["tags"], orderBy: { tenant_id: "ASC" } },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          tenant_id: "tenant_1",
          tags: [expect.objectContaining({ tenant_id: "tenant_1" })],
        }),
        expect.objectContaining({
          tenant_id: "tenant_2",
          tags: [expect.objectContaining({ tenant_id: "tenant_2" })],
        }),
      ])
      await expect(
        tagRepository.find({
          where: { code: "shared" },
          options: { populate: ["parents"], orderBy: { tenant_id: "ASC" } },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          tenant_id: "tenant_1",
          parents: [expect.objectContaining({ tenant_id: "tenant_1" })],
        }),
        expect.objectContaining({
          tenant_id: "tenant_2",
          parents: [expect.objectContaining({ tenant_id: "tenant_2" })],
        }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("loads implicit pivotTable-backed manyToMany relations", async () => {
    const Tag = medusaModel.define("RepositoryImplicitPivotTag", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
      parents: medusaModel.manyToMany(() => Parent, {
        mappedBy: "tags",
      }),
    })
    const Parent = medusaModel.define("RepositoryImplicitPivotParent", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
      tags: medusaModel.manyToMany(() => Tag, {
        mappedBy: "parents",
        pivotTable: "repository_implicit_pivot_parent_tag",
        joinColumn: "parent_id",
        inverseJoinColumn: "tag_id",
      }),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      renderD1MigrationSql(compileDmlSchema([Parent, Tag]))
    )
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const TagRepository = drizzleModulePersistenceAdapter.createRepository(Tag)
    const parentRepository = new ParentRepository({ manager: connection })
    const tagRepository = new TagRepository({ manager: connection })
    if (
      typeof parentRepository === "function" ||
      typeof tagRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await parentRepository.create([
        { id: "parent_1", name: "Parent 1" },
        { id: "parent_2", name: "Parent 2" },
      ])
      await tagRepository.create([
        { id: "tag_1", name: "Tag 1" },
        { id: "tag_2", name: "Tag 2" },
      ])
      connection.sqlite.exec(`
        INSERT INTO "repository_implicit_pivot_parent_tag" ("parent_id", "tag_id")
        VALUES
          ('parent_1', 'tag_1'),
          ('parent_1', 'tag_2'),
          ('parent_2', 'tag_2')
      `)

      const parents = await parentRepository.find({
        where: { id: "parent_1" },
        options: { populate: ["tags"] },
      })
      expect(parents).toEqual([
        expect.objectContaining({
          id: "parent_1",
          tags: expect.arrayContaining([
            expect.objectContaining({ id: "tag_1" }),
            expect.objectContaining({ id: "tag_2" }),
          ]),
        }),
      ])

      const tags = await tagRepository.find({
        where: { id: "tag_2" },
        options: { populate: ["parents"] },
      })
      expect(tags).toEqual([
        expect.objectContaining({
          id: "tag_2",
          parents: expect.arrayContaining([
            expect.objectContaining({ id: "parent_1" }),
            expect.objectContaining({ id: "parent_2" }),
          ]),
        }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("loads implicit composite-key pivotTable relations", async () => {
    const Tag = medusaModel.define("RepositoryCompositePivotTag", {
      tenant_id: medusaModel.text().primaryKey(),
      code: medusaModel.text().primaryKey(),
      name: medusaModel.text(),
      parents: medusaModel.manyToMany(() => Parent, {
        mappedBy: "tags",
      }),
    })
    const Parent = medusaModel.define("RepositoryCompositePivotParent", {
      tenant_id: medusaModel.text().primaryKey(),
      external_id: medusaModel.text().primaryKey(),
      name: medusaModel.text(),
      tags: medusaModel.manyToMany(() => Tag, {
        mappedBy: "parents",
        pivotTable: "repository_composite_parent_tag",
      }),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      renderD1MigrationSql(compileDmlSchema([Parent, Tag]))
    )
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const TagRepository = drizzleModulePersistenceAdapter.createRepository(Tag)
    const parentRepository = new ParentRepository({ manager: connection })
    const tagRepository = new TagRepository({ manager: connection })
    if (
      typeof parentRepository === "function" ||
      typeof tagRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await parentRepository.create([
        {
          tenant_id: "tenant_1",
          external_id: "shared",
          name: "Parent 1",
        },
        {
          tenant_id: "tenant_2",
          external_id: "shared",
          name: "Parent 2",
        },
      ])
      await tagRepository.create([
        { tenant_id: "tenant_1", code: "shared", name: "Tag 1" },
        { tenant_id: "tenant_2", code: "shared", name: "Tag 2" },
      ])
      connection.sqlite.exec(`
        INSERT INTO "repository_composite_parent_tag" (
          "repository_composite_pivot_parent_tenant_id",
          "repository_composite_pivot_parent_external_id",
          "repository_composite_pivot_tag_tenant_id",
          "repository_composite_pivot_tag_code"
        )
        VALUES
          ('tenant_1', 'shared', 'tenant_1', 'shared'),
          ('tenant_2', 'shared', 'tenant_2', 'shared')
      `)

      await expect(
        parentRepository.find({
          where: { external_id: "shared" },
          options: { populate: ["tags"], orderBy: { tenant_id: "ASC" } },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          tenant_id: "tenant_1",
          tags: [expect.objectContaining({ tenant_id: "tenant_1" })],
        }),
        expect.objectContaining({
          tenant_id: "tenant_2",
          tags: [expect.objectContaining({ tenant_id: "tenant_2" })],
        }),
      ])
      await expect(
        tagRepository.find({
          where: { code: "shared" },
          options: { populate: ["parents"], orderBy: { tenant_id: "ASC" } },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          tenant_id: "tenant_1",
          parents: [expect.objectContaining({ tenant_id: "tenant_1" })],
        }),
        expect.objectContaining({
          tenant_id: "tenant_2",
          parents: [expect.objectContaining({ tenant_id: "tenant_2" })],
        }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("replaces implicit manyToMany relations through upsertWithReplace", async () => {
    const Tag = medusaModel.define("RepositoryReplaceTag", {
      tenant_id: medusaModel.text().primaryKey(),
      code: medusaModel.text().primaryKey(),
      parents: medusaModel.manyToMany(() => Parent, {
        mappedBy: "tags",
      }),
    })
    const Parent = medusaModel.define("RepositoryReplaceParent", {
      tenant_id: medusaModel.text().primaryKey(),
      external_id: medusaModel.text().primaryKey(),
      name: medusaModel.text(),
      tags: medusaModel.manyToMany(() => Tag, {
        mappedBy: "parents",
        pivotTable: "repository_replace_parent_tag",
      }),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      renderD1MigrationSql(compileDmlSchema([Parent, Tag]))
    )
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const TagRepository = drizzleModulePersistenceAdapter.createRepository(Tag)
    const parentRepository = new ParentRepository({ manager: connection })
    const tagRepository = new TagRepository({ manager: connection })
    if (
      typeof parentRepository === "function" ||
      typeof tagRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await tagRepository.create([
        { tenant_id: "tenant_1", code: "tag_1" },
        { tenant_id: "tenant_1", code: "tag_2" },
      ])

      const created = await parentRepository.upsertWithReplace(
        [
          {
            tenant_id: "tenant_1",
            external_id: "parent",
            name: "Parent",
            tags: [{ tenant_id: "tenant_1", code: "tag_1" }],
          },
        ],
        { relations: ["tags"] }
      )
      expect(created.performedActions).toEqual({
        created: {
          RepositoryReplaceParent: [
            { tenant_id: "tenant_1", external_id: "parent" },
          ],
        },
        updated: {},
        deleted: {},
      })
      expect(created.entities).toEqual([
        expect.objectContaining({
          name: "Parent",
          tags: [expect.objectContaining({ code: "tag_1" })],
        }),
      ])

      const replaced = await parentRepository.upsertWithReplace(
        [
          {
            tenant_id: "tenant_1",
            external_id: "parent",
            name: "Updated Parent",
            tags: [{ tenant_id: "tenant_1", code: "tag_2" }],
          },
        ],
        { relations: ["tags"] }
      )
      expect(replaced.performedActions).toEqual({
        created: {},
        updated: {
          RepositoryReplaceParent: [
            { tenant_id: "tenant_1", external_id: "parent" },
          ],
        },
        deleted: {},
      })
      expect(replaced.entities).toEqual([
        expect.objectContaining({
          name: "Updated Parent",
          tags: [expect.objectContaining({ code: "tag_2" })],
        }),
      ])
      await expect(tagRepository.find()).resolves.toHaveLength(2)

      await expect(
        parentRepository.upsertWithReplace(
          [
            {
              tenant_id: "tenant_1",
              external_id: "parent",
              tags: [{ tenant_id: "tenant_1", code: "missing" }],
            },
          ],
          { relations: ["tags"] }
      )
      ).rejects.toThrow(
        "You tried to set relationship repository_replace_tag_code: missing, but such entity does not exist"
      )
      await expect(
        parentRepository.find({
          where: { tenant_id: "tenant_1", external_id: "parent" },
          options: { populate: ["tags"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          tags: [expect.objectContaining({ code: "tag_2" })],
        }),
      ])

      const detached = await parentRepository.upsertWithReplace(
        [
          {
            tenant_id: "tenant_1",
            external_id: "parent",
            tags: [],
          },
        ],
        { relations: ["tags"] }
      )
      expect(detached.entities).toEqual([expect.objectContaining({ tags: [] })])
      await expect(
        parentRepository.find({
          where: { tenant_id: "tenant_1", external_id: "parent" },
          options: { populate: ["tags"] },
        })
      ).resolves.toEqual([expect.objectContaining({ tags: [] })])
    } finally {
      await connection.destroy()
    }
  })

  it("replaces explicit pivotEntity manyToMany relations through upsertWithReplace", async () => {
    const Link = medusaModel.define("RepositoryReplacePivotLink", {
      id: medusaModel.id().primaryKey(),
      parent: medusaModel.belongsTo(() => Parent, {
        mappedBy: "tags",
      }),
      tag: medusaModel.belongsTo(() => Tag, {
        mappedBy: "parents",
      }),
    })
    const Tag = medusaModel.define("RepositoryReplacePivotTag", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
      parents: medusaModel.manyToMany(() => Parent, {
        mappedBy: "tags",
        pivotEntity: () => Link,
      }),
    })
    const Parent = medusaModel.define("RepositoryReplacePivotParent", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
      tags: medusaModel.manyToMany(() => Tag, {
        mappedBy: "parents",
        pivotEntity: () => Link,
      }),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      renderD1MigrationSql(compileDmlSchema([Parent, Tag, Link]))
    )
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const TagRepository = drizzleModulePersistenceAdapter.createRepository(Tag)
    const LinkRepository =
      drizzleModulePersistenceAdapter.createRepository(Link)
    const parentRepository = new ParentRepository({ manager: connection })
    const tagRepository = new TagRepository({ manager: connection })
    const linkRepository = new LinkRepository({ manager: connection })
    if (
      typeof parentRepository === "function" ||
      typeof tagRepository === "function" ||
      typeof linkRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await tagRepository.create([
        { id: "tag_1", name: "Tag 1" },
        { id: "tag_2", name: "Tag 2" },
      ])

      const created = await parentRepository.upsertWithReplace(
        [{ id: "parent_1", name: "Parent", tags: [{ id: "tag_1" }] }],
        { relations: ["tags"] }
      )
      expect(created.performedActions).toEqual({
        created: { RepositoryReplacePivotParent: [{ id: "parent_1" }] },
        updated: {},
        deleted: {},
      })
      expect(created.entities).toEqual([
        expect.objectContaining({
          id: "parent_1",
          tags: [expect.objectContaining({ id: "tag_1" })],
        }),
      ])
      await expect(linkRepository.find()).resolves.toEqual([
        expect.objectContaining({ parent_id: "parent_1", tag_id: "tag_1" }),
      ])

      const replaced = await parentRepository.upsertWithReplace(
        [{ id: "parent_1", name: "Updated Parent", tags: [{ id: "tag_2" }] }],
        { relations: ["tags"] }
      )
      expect(replaced.entities).toEqual([
        expect.objectContaining({
          name: "Updated Parent",
          tags: [expect.objectContaining({ id: "tag_2" })],
        }),
      ])
      await expect(linkRepository.find()).resolves.toEqual([
        expect.objectContaining({ parent_id: "parent_1", tag_id: "tag_2" }),
      ])
      await expect(tagRepository.find()).resolves.toHaveLength(2)

      await expect(
        parentRepository.upsertWithReplace(
          [{ id: "parent_1", tags: [{ id: "missing" }] }],
          { relations: ["tags"] }
      )
      ).rejects.toThrow(
        "You tried to set relationship repository_replace_pivot_tag_id: missing, but such entity does not exist"
      )
      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: { populate: ["tags"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          tags: [expect.objectContaining({ id: "tag_2" })],
        }),
      ])

      const detached = await parentRepository.upsertWithReplace(
        [{ id: "parent_1", tags: [] }],
        { relations: ["tags"] }
      )
      expect(detached.entities).toEqual([expect.objectContaining({ tags: [] })])
      await expect(linkRepository.find()).resolves.toEqual([])
    } finally {
      await connection.destroy()
    }
  })

  it("creates owner-side singular relations through upsertWithReplace", async () => {
    const Profile = medusaModel.define("RepositoryReplaceProfile", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
    })
    const Account = medusaModel.define("RepositoryReplaceAccount", {
      id: medusaModel.id().primaryKey(),
      profile: medusaModel
        .hasOne(() => Profile, {
          mappedBy: undefined,
          foreignKey: true,
        })
        .nullable(),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      renderD1MigrationSql(compileDmlSchema([Account, Profile]))
    )
    const AccountRepository =
      drizzleModulePersistenceAdapter.createRepository(Account)
    const ProfileRepository =
      drizzleModulePersistenceAdapter.createRepository(Profile)
    const accountRepository = new AccountRepository({ manager: connection })
    const profileRepository = new ProfileRepository({ manager: connection })
    if (
      typeof accountRepository === "function" ||
      typeof profileRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      const [directlyCreated] = await accountRepository.create([
        { id: "account_0", profile: { name: "Direct Profile" } },
      ])
      await expect(
        accountRepository.find({
          where: { id: directlyCreated.id },
          options: { populate: ["profile"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "account_0",
          profile_id: expect.any(String),
          profile: expect.objectContaining({ name: "Direct Profile" }),
        }),
      ])

      await profileRepository.create([
        { id: "profile_existing", name: "Existing Profile" },
      ])
      const [createdWithRelationId] = await accountRepository.create([
        { id: "account_existing", profile: "profile_existing" },
      ])
      await expect(
        accountRepository.find({
          where: { id: createdWithRelationId.id },
          options: { populate: ["profile"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "account_existing",
          profile_id: "profile_existing",
          profile: expect.objectContaining({ name: "Existing Profile" }),
        }),
      ])

      const [updatedThroughUpdate] = await accountRepository.update([
        {
          entity: { id: "account_0" },
          update: { profile: { name: "Update Profile" } },
        },
      ])
      expect(updatedThroughUpdate).toEqual(
        expect.objectContaining({
          id: "account_0",
          profile_id: expect.any(String),
          profile: expect.objectContaining({ name: "Update Profile" }),
        })
      )

      const created = await accountRepository.upsertWithReplace(
        [{ id: "account_1", profile: { name: "Profile" } }],
        { relations: ["profile"] }
      )
      const profile = (created.entities[0] as Record<string, unknown>)
        .profile as Record<string, unknown>
      expect(created.entities).toEqual([
        expect.objectContaining({
          id: "account_1",
          profile_id: profile.id,
          profile: expect.objectContaining({ name: "Profile" }),
        }),
      ])
      expect(created.performedActions).toEqual({
        created: {
          RepositoryReplaceProfile: [{ id: profile.id }],
          RepositoryReplaceAccount: [{ id: "account_1" }],
        },
        updated: {},
        deleted: {},
      })

      const updated = await accountRepository.upsertWithReplace(
        [
          {
            id: "account_1",
            profile: { id: profile.id, name: "Updated Profile" },
          },
        ],
        { relations: ["profile"] }
      )
      expect(updated.entities).toEqual([
        expect.objectContaining({
          id: "account_1",
          profile_id: profile.id,
          profile: expect.objectContaining({
            id: profile.id,
            name: "Updated Profile",
          }),
        }),
      ])
      expect(updated.performedActions).toEqual({
        created: {},
        updated: {
          RepositoryReplaceProfile: [{ id: profile.id }],
          RepositoryReplaceAccount: [{ id: "account_1" }],
        },
        deleted: {},
      })
      await expect(profileRepository.find()).resolves.toHaveLength(4)
    } finally {
      await connection.destroy()
    }
  })

  it("creates, updates, and deletes hasMany children through upsertWithReplace", async () => {
    const Child = medusaModel.define("RepositoryReplaceChild", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
      parent: medusaModel.belongsTo(() => Parent, {
        mappedBy: "children",
      }),
    })
    const Parent = medusaModel.define("RepositoryReplaceHasManyParent", {
      tenant_id: medusaModel.text().primaryKey(),
      external_id: medusaModel.text().primaryKey(),
      name: medusaModel.text(),
      children: medusaModel.hasMany(() => Child, { mappedBy: "parent" }),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      renderD1MigrationSql(compileDmlSchema([Parent, Child]))
    )
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const ChildRepository =
      drizzleModulePersistenceAdapter.createRepository(Child)
    const parentRepository = new ParentRepository({ manager: connection })
    const childRepository = new ChildRepository({ manager: connection })
    if (
      typeof parentRepository === "function" ||
      typeof childRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      const created = await parentRepository.upsertWithReplace(
        [
          {
            tenant_id: "tenant_1",
            external_id: "parent",
            name: "Parent",
            children: [{ id: "child_1", name: "Child 1" }, { name: "Child 2" }],
          },
        ],
        { relations: ["children"] }
      )
      const createdChildren = (
        created.entities[0] as {
          children: Array<Record<string, unknown>>
        }
      ).children
      const generatedChild = createdChildren.find(
        (child) => child.id !== "child_1"
      )
      expect(generatedChild?.id).toEqual(expect.any(String))
      expect(created.performedActions).toEqual({
        created: {
          RepositoryReplaceHasManyParent: [
            { tenant_id: "tenant_1", external_id: "parent" },
          ],
          RepositoryReplaceChild: expect.arrayContaining([
            { id: "child_1" },
            { id: generatedChild?.id },
          ]),
        },
        updated: {},
        deleted: {},
      })
      await expect(
        childRepository.upsert([{ id: "child_1", name: "Child 1 renamed" }])
      ).resolves.toEqual([
        expect.objectContaining({
          id: "child_1",
          name: "Child 1 renamed",
          parent_tenant_id: "tenant_1",
          parent_external_id: "parent",
        }),
      ])

      const replaced = await parentRepository.upsertWithReplace(
        [
          {
            tenant_id: "tenant_1",
            external_id: "parent",
            children: [
              { id: "child_1" },
              { name: "Child 3" },
            ],
          },
        ],
        { relations: ["children"] }
      )
      expect(replaced.performedActions).toEqual({
        created: {
          RepositoryReplaceChild: [
            expect.objectContaining({ id: expect.any(String) }),
          ],
        },
        updated: {
          RepositoryReplaceHasManyParent: [
            { tenant_id: "tenant_1", external_id: "parent" },
          ],
        },
        deleted: {
          RepositoryReplaceChild: [{ id: generatedChild?.id }],
        },
      })
      expect(replaced.entities).toEqual([
        expect.objectContaining({
          children: expect.arrayContaining([
            expect.objectContaining({
              id: "child_1",
              name: "Child 1 renamed",
              parent_tenant_id: "tenant_1",
              parent_external_id: "parent",
            }),
            expect.objectContaining({ name: "Child 3" }),
          ]),
        }),
      ])
      await expect(childRepository.find()).resolves.toHaveLength(2)

      await expect(
        parentRepository.upsertWithReplace(
          [
            {
              tenant_id: "tenant_1",
              external_id: "parent",
              children: [
                { id: "child_1" },
                { id: "child_1" },
              ],
            },
          ],
          { relations: ["children"] }
        )
      ).rejects.toThrow(
        'Drizzle upsertWithReplace relation "children" requires unique child primary keys'
      )
      await expect(childRepository.find()).resolves.toHaveLength(2)

      const detached = await parentRepository.upsertWithReplace(
        [
          {
            tenant_id: "tenant_1",
            external_id: "parent",
            children: [],
          },
        ],
        { relations: ["children"] }
      )
      expect(detached.entities).toEqual([
        expect.objectContaining({ children: [] }),
      ])
      await expect(childRepository.find()).resolves.toEqual([])
    } finally {
      await connection.destroy()
    }
  })

  it("creates, updates, and deletes hasMany children through update", async () => {
    const Child = medusaModel.define("RepositoryUpdateChild", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
      parent: medusaModel.belongsTo(() => Parent, {
        mappedBy: "children",
      }),
    })
    const Parent = medusaModel.define("RepositoryUpdateHasManyParent", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
      children: medusaModel.hasMany(() => Child, { mappedBy: "parent" }),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      renderD1MigrationSql(compileDmlSchema([Parent, Child]))
    )
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const ChildRepository =
      drizzleModulePersistenceAdapter.createRepository(Child)
    const parentRepository = new ParentRepository({ manager: connection })
    const childRepository = new ChildRepository({ manager: connection })
    if (
      typeof parentRepository === "function" ||
      typeof childRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      const [created] = await parentRepository.create([
        {
          id: "parent_1",
          name: "Parent",
          children: [
            { id: "child_1", name: "Child 1" },
            { id: "child_2", name: "Child 2" },
          ],
        },
      ])
      const [updated] = await parentRepository.update([
        {
          entity: created,
          update: {
            name: "Updated Parent",
            children: [
              { id: "child_1", name: "Child 1 renamed" },
              { id: "child_3", name: "Child 3" },
            ],
          },
        },
      ])

      expect(updated).toEqual(
        expect.objectContaining({
          id: "parent_1",
          name: "Updated Parent",
          children: expect.arrayContaining([
            expect.objectContaining({
              id: "child_1",
              name: "Child 1 renamed",
              parent_id: "parent_1",
            }),
            expect.objectContaining({
              id: "child_3",
              name: "Child 3",
              parent_id: "parent_1",
            }),
          ]),
        })
      )
      await expect(childRepository.find()).resolves.toEqual([
        expect.objectContaining({ id: "child_1", name: "Child 1 renamed" }),
        expect.objectContaining({ id: "child_3", name: "Child 3" }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("creates hasMany children when the root id is generated during upsertWithReplace", async () => {
    const Child = medusaModel.define("GeneratedReplaceChild", {
      id: medusaModel.id().primaryKey(),
      code: medusaModel.text(),
      is_default: medusaModel.boolean().default(false),
      parent: medusaModel.belongsTo(() => Parent, {
        mappedBy: "children",
      }),
    })
    const Parent = medusaModel.define("GeneratedReplaceParent", {
      id: medusaModel.id({ prefix: "parent" }).primaryKey(),
      name: medusaModel.text(),
      children: medusaModel.hasMany(() => Child, { mappedBy: "parent" }),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      renderD1MigrationSql(compileDmlSchema([Parent, Child]))
    )
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const ChildRepository =
      drizzleModulePersistenceAdapter.createRepository(Child)
    const parentRepository = new ParentRepository({ manager: connection })
    const childRepository = new ChildRepository({ manager: connection })
    if (
      typeof parentRepository === "function" ||
      typeof childRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      const created = await parentRepository.upsertWithReplace(
        [
          {
            name: "Generated Parent",
            children: [
              { code: "eur", is_default: true },
              { code: "usd" },
            ],
          },
        ],
        { relations: ["children"] }
      )

      expect(created.entities).toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^parent_[0-9A-HJKMNP-TV-Z]{26}$/),
          name: "Generated Parent",
          children: expect.arrayContaining([
            expect.objectContaining({
              code: "eur",
              is_default: true,
              parent_id: expect.stringMatching(
                /^parent_[0-9A-HJKMNP-TV-Z]{26}$/
              ),
            }),
            expect.objectContaining({
              code: "usd",
              is_default: false,
              parent_id: expect.stringMatching(
                /^parent_[0-9A-HJKMNP-TV-Z]{26}$/
              ),
            }),
          ]),
        }),
      ])
      const [parent] = created.entities
      if (!("id" in parent) || typeof parent.id !== "string") {
        throw new Error("Generated parent id was not returned")
      }
      expect(created.performedActions).toEqual({
        created: {
          GeneratedReplaceParent: [{ id: parent.id }],
          GeneratedReplaceChild: expect.arrayContaining([
            { id: expect.any(String) },
            { id: expect.any(String) },
          ]),
        },
        updated: {},
        deleted: {},
      })
      await expect(
        childRepository.find({ where: { parent_id: parent.id } })
      ).resolves.toHaveLength(2)
    } finally {
      await connection.destroy()
    }
  })

  it("applies populateWhere filters while loading hasMany relations", async () => {
    const Child = medusaModel.define("RepositoryPopulateWhereChild", {
      id: medusaModel.id().primaryKey(),
      kind: medusaModel.text().nullable(),
      parent: medusaModel.belongsTo(() => Parent, {
        mappedBy: "children",
      }),
    })
    const Parent = medusaModel.define("RepositoryPopulateWhereParent", {
      id: medusaModel.id().primaryKey(),
      children: medusaModel.hasMany(() => Child, { mappedBy: "parent" }),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      renderD1MigrationSql(compileDmlSchema([Parent, Child]))
    )
    const Repository = drizzleModulePersistenceAdapter.createRepository(Parent)
    const repository = new Repository({ manager: connection })
    if (typeof repository === "function") {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await repository.upsertWithReplace(
        [
          {
            id: "parent_1",
            children: [
              { id: "child_public", kind: "public" },
              { id: "child_private", kind: "private" },
            ],
          },
        ],
        { relations: ["children"] }
      )

      const findOptions = {
        where: { id: "parent_1" },
        options: {
          populate: ["children"],
          populateWhere: {
            children: {
              kind: "public",
            },
          },
        },
      }

      await expect(repository.find(findOptions)).resolves.toEqual([
        expect.objectContaining({
          id: "parent_1",
          children: [
            expect.objectContaining({
              id: "child_public",
              kind: "public",
            }),
          ],
        }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("soft deletes and restores FK-backed cascaded relations recursively", async () => {
    const Grandchild = medusaModel.define("RepositoryCascadeGrandchild", {
      id: medusaModel.id().primaryKey(),
      name: medusaModel.text(),
      child: medusaModel
        .belongsTo(() => Child, {
          mappedBy: "grandchildren",
          foreignKeyName: "child_id",
        })
        .nullable(),
    })
    const Child = medusaModel
      .define("RepositoryCascadeChild", {
        id: medusaModel.id().primaryKey(),
        name: medusaModel.text(),
        parent: medusaModel
          .belongsTo(() => Parent, {
            mappedBy: "children",
            foreignKeyName: "parent_id",
          })
          .nullable(),
        grandchildren: medusaModel.hasMany(() => Grandchild, {
          mappedBy: "child",
        }),
      })
      .cascades({ delete: ["grandchildren"] })
    const Parent = medusaModel
      .define("RepositoryCascadeParent", {
        id: medusaModel.id().primaryKey(),
        name: medusaModel.text(),
        children: medusaModel.hasMany(() => Child, { mappedBy: "parent" }),
      })
      .cascades({ delete: ["children"] })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      renderD1MigrationSql(compileDmlSchema([Parent, Child, Grandchild]))
    )
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const ChildRepository =
      drizzleModulePersistenceAdapter.createRepository(Child)
    const GrandchildRepository =
      drizzleModulePersistenceAdapter.createRepository(Grandchild)
    const parentRepository = new ParentRepository({ manager: connection })
    const childRepository = new ChildRepository({ manager: connection })
    const grandchildRepository = new GrandchildRepository({
      manager: connection,
    })
    if (
      typeof parentRepository === "function" ||
      typeof childRepository === "function" ||
      typeof grandchildRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await parentRepository.create([{ id: "parent_1", name: "Parent" }])
      await childRepository.create([
        { id: "child_1", name: "Child 1", parent_id: "parent_1" },
        { id: "child_2", name: "Child 2", parent_id: "parent_1" },
      ])
      await grandchildRepository.create([
        { id: "grandchild_1", name: "Grandchild 1", child_id: "child_1" },
      ])

      const [softDeleted, softDeletedMap] = await parentRepository.softDelete([
        "parent_1",
      ])
      expect(softDeleted).toEqual([
        expect.objectContaining({
          id: "parent_1",
          deleted_at: expect.any(Date),
        }),
      ])
      expect(softDeletedMap).toEqual({
        RepositoryCascadeParent: [expect.objectContaining({ id: "parent_1" })],
        RepositoryCascadeChild: expect.arrayContaining([
          expect.objectContaining({ id: "child_1" }),
          expect.objectContaining({ id: "child_2" }),
        ]),
        RepositoryCascadeGrandchild: [
          expect.objectContaining({ id: "grandchild_1" }),
        ],
      })
      await expect(
        parentRepository.find({ where: { id: "parent_1" } })
      ).resolves.toEqual([])
      await expect(
        childRepository.find({ where: { parent_id: "parent_1" } })
      ).resolves.toEqual([])
      await expect(
        grandchildRepository.find({ where: { child_id: "child_1" } })
      ).resolves.toEqual([])

      const [restored, restoredMap] = await parentRepository.restore([
        "parent_1",
      ])
      expect(restored).toEqual([
        expect.objectContaining({ id: "parent_1", deleted_at: null }),
      ])
      expect(restoredMap).toEqual({
        RepositoryCascadeParent: [expect.objectContaining({ id: "parent_1" })],
        RepositoryCascadeChild: expect.arrayContaining([
          expect.objectContaining({ id: "child_1", deleted_at: null }),
          expect.objectContaining({ id: "child_2", deleted_at: null }),
        ]),
        RepositoryCascadeGrandchild: [
          expect.objectContaining({ id: "grandchild_1", deleted_at: null }),
        ],
      })
      await expect(
        parentRepository.find({
          where: { id: "parent_1" },
          options: { populate: ["children"] },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "parent_1",
          children: expect.arrayContaining([
            expect.objectContaining({ id: "child_1" }),
            expect.objectContaining({ id: "child_2" }),
          ]),
        }),
      ])
    } finally {
      await connection.destroy()
    }
  })

  it("maps partial unique index violations to Medusa duplicate messages", async () => {
    const CustomerAddress = medusaModel
      .define("CustomerAddress", {
        id: medusaModel.id().primaryKey(),
        customer_id: medusaModel.text(),
        is_default_shipping: medusaModel.boolean().default(false),
      })
      .indexes([
        {
          name: "IDX_customer_address_unique_customer_shipping",
          on: ["customer_id"],
          unique: true,
          where: '"is_default_shipping" = true AND deleted_at IS NULL',
        },
      ])
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(renderD1MigrationSql(compileDmlSchema([CustomerAddress])))
    const AddressRepository =
      drizzleModulePersistenceAdapter.createRepository(CustomerAddress)
    const addressRepository = new AddressRepository({ manager: connection })
    if (typeof addressRepository === "function") {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await expect(
        addressRepository.create([
          {
            id: "address_1",
            customer_id: "customer_1",
            is_default_shipping: false,
          },
          {
            id: "address_2",
            customer_id: "customer_1",
            is_default_shipping: false,
          },
        ])
      ).resolves.toHaveLength(2)

      await expect(
        addressRepository.create([
          {
            id: "address_3",
            customer_id: "customer_1",
            is_default_shipping: true,
          },
          {
            id: "address_4",
            customer_id: "customer_1",
            is_default_shipping: true,
          },
        ])
      ).rejects.toThrow(
        "Customer address with customer_id: customer_1, already exists."
      )
    } finally {
      await connection.destroy()
    }
  })

  it("filters and detaches pivotEntity many-to-many relations", async () => {
    const Link = medusaModel.define("RepositoryDetachManyToManyLink", {
      id: medusaModel.id().primaryKey(),
      parent: medusaModel.belongsTo(() => Parent, {
        mappedBy: "tags",
      }),
      tag: medusaModel.belongsTo(() => Tag, {
        mappedBy: "parents",
      }),
    })
    const Tag = medusaModel
      .define("RepositoryDetachManyToManyTag", {
        id: medusaModel.id().primaryKey(),
        parents: medusaModel.manyToMany(() => Parent, {
          mappedBy: "tags",
          pivotEntity: () => Link,
        }),
      })
      .cascades({ detach: ["parents"] })
    const Parent = medusaModel
      .define("RepositoryDetachManyToManyParent", {
        id: medusaModel.id().primaryKey(),
        tags: medusaModel.manyToMany(() => Tag, {
          mappedBy: "parents",
          pivotEntity: () => Link,
        }),
      })
      .cascades({ detach: ["tags"] })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(renderD1MigrationSql(compileDmlSchema([Parent, Tag, Link])))
    const ParentRepository =
      drizzleModulePersistenceAdapter.createRepository(Parent)
    const TagRepository = drizzleModulePersistenceAdapter.createRepository(Tag)
    const LinkRepository =
      drizzleModulePersistenceAdapter.createRepository(Link)
    const parentRepository = new ParentRepository({ manager: connection })
    const tagRepository = new TagRepository({ manager: connection })
    const linkRepository = new LinkRepository({ manager: connection })
    if (
      typeof parentRepository === "function" ||
      typeof tagRepository === "function" ||
      typeof linkRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await parentRepository.create([{ id: "parent_1" }])
      await tagRepository.create([{ id: "tag_1" }])
      await linkRepository.create([
        { id: "link_1", parent_id: "parent_1", tag_id: "tag_1" },
      ])

      await expect(parentRepository.find({ where: { tags: "tag_1" } }))
        .resolves.toEqual([expect.objectContaining({ id: "parent_1" })])

      await parentRepository.delete({ id: "parent_1" })

      await expect(
        linkRepository.find({ where: { parent_id: "parent_1" } })
      ).resolves.toEqual([])
    } finally {
      await connection.destroy()
    }
  })

  it("exposes Inventory computed quantities and aggregate repository methods", async () => {
    const InventoryLevel = medusaModel.define("InventoryLevel", {
      id: medusaModel.id().primaryKey(),
      location_id: medusaModel.text(),
      stocked_quantity: medusaModel.bigNumber().default(0),
      reserved_quantity: medusaModel.bigNumber().default(0),
      incoming_quantity: medusaModel.bigNumber().default(0),
      inventory_item: medusaModel.belongsTo(() => InventoryItem, {
        mappedBy: "location_levels",
      }),
      available_quantity: medusaModel.bigNumber().computed(),
    })
    const InventoryItem = medusaModel.define("InventoryItem", {
      id: medusaModel.id().primaryKey(),
      sku: medusaModel.text().nullable(),
      location_levels: medusaModel.hasMany(() => InventoryLevel, {
        mappedBy: "inventory_item",
      }),
      reserved_quantity: medusaModel.number().computed(),
      stocked_quantity: medusaModel.number().computed(),
    })
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(
      renderD1MigrationSql(compileDmlSchema([InventoryItem, InventoryLevel]))
    )
    const ItemRepository =
      drizzleModulePersistenceAdapter.createRepository(InventoryItem)
    const LevelRepository =
      drizzleModulePersistenceAdapter.createRepository(InventoryLevel)
    const itemRepository = new ItemRepository({ manager: connection })
    const levelRepository = new LevelRepository({ manager: connection })
    if (
      typeof itemRepository === "function" ||
      typeof levelRepository === "function"
    ) {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      await itemRepository.create([{ id: "iitem_1", sku: "test-sku" }])
      await levelRepository.create([
        {
          id: "ilev_1",
          inventory_item_id: "iitem_1",
          location_id: "location_1",
          stocked_quantity: 5,
          reserved_quantity: 2,
        },
      ])

      await expect(levelRepository.find({ where: { id: "ilev_1" } }))
        .resolves.toEqual([
          expect.objectContaining({
            stocked_quantity: 5,
            reserved_quantity: 2,
            available_quantity: 3,
          }),
        ])
      await expect(
        itemRepository.find({
          where: { id: "iitem_1" },
          options: {
            fields: ["id", "reserved_quantity", "stocked_quantity"],
          },
        })
      ).resolves.toEqual([
        {
          id: "iitem_1",
          reserved_quantity: 2,
          stocked_quantity: 5,
        },
      ])

      expect(
        await inventoryLevelAggregateRepository(levelRepository)
          .getStockedQuantity("iitem_1", ["location_1"])
          .then((quantity) => quantity.numeric)
      ).toBe(5)
      expect(
        await inventoryLevelAggregateRepository(levelRepository)
          .getReservedQuantity("iitem_1", ["location_1"])
          .then((quantity) => quantity.numeric)
      ).toBe(2)
      expect(
        await inventoryLevelAggregateRepository(levelRepository)
          .getAvailableQuantity("iitem_1", ["location_1"])
          .then((quantity) => quantity.numeric)
      ).toBe(3)
    } finally {
      await connection.destroy()
    }
  })

  it("uses Inventory as the conventional event source for reservation items", async () => {
    const savedMessages: Array<{ source: string; eventName: string }> = []
    const messageAggregator: IMessageAggregator = {
      save(_msg: Message | Message[]) {},
      getMessages(_format?: MessageAggregatorFormat) {
        return {}
      },
      clearMessages() {},
      saveRawMessageData() {},
    }
    messageAggregator.saveRawMessageData = function saveRawMessageData<T>(
      messageData:
        | EventBusTypes.RawMessageFormat<T>
        | EventBusTypes.RawMessageFormat<T>[]
    ) {
      const messages = Array.isArray(messageData) ? messageData : [messageData]
      for (const message of messages) {
        if (
          typeof message.source === "string" &&
          typeof message.eventName === "string"
        ) {
          savedMessages.push({
            source: message.source,
            eventName: message.eventName,
          })
        }
      }
    }
    const context: Context = { messageAggregator }

    await dispatchDrizzleMutationEvent(
      "afterUpdate",
      {
        entity: { id: "resitem_1" },
        meta: { className: "ReservationItem" },
      },
      context
    )

    expect(savedMessages).toEqual([
      expect.objectContaining({
        source: "inventory",
        eventName: "inventory.reservation-item.updated",
      }),
    ])
  })

  it("uses Fulfillment as the conventional event source for Fulfillment-owned nested models", async () => {
    const savedMessages: Array<{ source: string; eventName: string }> = []
    const messageAggregator: IMessageAggregator = {
      save(_msg: Message | Message[]) {},
      getMessages(_format?: MessageAggregatorFormat) {
        return {}
      },
      clearMessages() {},
      saveRawMessageData() {},
    }
    messageAggregator.saveRawMessageData = function saveRawMessageData<T>(
      messageData:
        | EventBusTypes.RawMessageFormat<T>
        | EventBusTypes.RawMessageFormat<T>[]
    ) {
      const messages = Array.isArray(messageData) ? messageData : [messageData]
      for (const message of messages) {
        if (
          typeof message.source === "string" &&
          typeof message.eventName === "string"
        ) {
          savedMessages.push({
            source: message.source,
            eventName: message.eventName,
          })
        }
      }
    }
    const context: Context = { messageAggregator }

    await dispatchDrizzleMutationEvent(
      "afterCreate",
      {
        entity: { id: "fgz_1" },
        meta: { className: "GeoZone" },
      },
      context
    )
    await dispatchDrizzleMutationEvent(
      "afterUpdate",
      {
        entity: { id: "sorul_1" },
        meta: { className: "ShippingOptionRule" },
      },
      context
    )

    expect(savedMessages).toEqual([
      expect.objectContaining({
        source: "fulfillment",
        eventName: "fulfillment.geo-zone.created",
      }),
      expect.objectContaining({
        source: "fulfillment",
        eventName: "fulfillment.shipping-option-rule.updated",
      }),
    ])
  })

  it("emits created mutations for owned to-one nested create targets", async () => {
    const Type = medusaModel.define("RepositoryNestedOwnedType", {
      id: medusaModel.id().primaryKey(),
      code: medusaModel.text(),
      owners: medusaModel.hasMany(() => Owner, {
        mappedBy: "type",
      }),
    })
    const Owner = medusaModel.define("RepositoryNestedOwnedOwner", {
      id: medusaModel.id().primaryKey(),
      type: medusaModel.belongsTo(() => Type, {
        foreignKey: true,
        foreignKeyName: "type_id",
        mappedBy: "owners",
      }),
    })
    const savedMessages: Array<{ eventName: string }> = []
    const messageAggregator: IMessageAggregator = {
      save(_msg: Message | Message[]) {},
      getMessages(_format?: MessageAggregatorFormat) {
        return {}
      },
      clearMessages() {},
      saveRawMessageData() {},
    }
    messageAggregator.saveRawMessageData = function saveRawMessageData<T>(
      messageData:
        | EventBusTypes.RawMessageFormat<T>
        | EventBusTypes.RawMessageFormat<T>[]
    ) {
      const messages = Array.isArray(messageData) ? messageData : [messageData]
      for (const message of messages) {
        if (typeof message.eventName === "string") {
          savedMessages.push({ eventName: message.eventName })
        }
      }
    }
    const connection = drizzleModuleTestPersistenceAdapter.createConnection()
    connection.sqlite.exec(renderD1MigrationSql(compileDmlSchema([Type, Owner])))
    const Repository = drizzleModulePersistenceAdapter.createRepository(Owner)
    const repository = new Repository({ manager: connection })
    if (typeof repository === "function") {
      throw new Error("The Drizzle adapter returned a nested repository class")
    }

    try {
      const [created] = await repository.create(
        [
          {
            id: "owner_1",
            type: {
              id: "type_1",
              code: "standard",
            },
          },
        ],
        { messageAggregator }
      )

      expect(created).toEqual(
        expect.objectContaining({
          id: "owner_1",
          type_id: "type_1",
          type: expect.objectContaining({
            id: "type_1",
            code: "standard",
          }),
        })
      )
      expect(savedMessages.map((message) => message.eventName)).toEqual(
        expect.arrayContaining([
          "repository.repository-nested-owned-type.created",
          "repository.repository-nested-owned-owner.created",
        ])
      )
    } finally {
      await connection.destroy()
    }
  })
})

type InventoryLevelAggregateRepository = {
  getStockedQuantity(
    inventoryItemId: string,
    locationIds: string[]
  ): Promise<{ numeric: number }>
  getReservedQuantity(
    inventoryItemId: string,
    locationIds: string[]
  ): Promise<{ numeric: number }>
  getAvailableQuantity(
    inventoryItemId: string,
    locationIds: string[]
  ): Promise<{ numeric: number }>
}

function inventoryLevelAggregateRepository(
  repository: object
): InventoryLevelAggregateRepository {
  if (
    "getStockedQuantity" in repository &&
    "getReservedQuantity" in repository &&
    "getAvailableQuantity" in repository &&
    isInventoryAggregateMethod(repository.getStockedQuantity) &&
    isInventoryAggregateMethod(repository.getReservedQuantity) &&
    isInventoryAggregateMethod(repository.getAvailableQuantity)
  ) {
    return {
      getStockedQuantity: repository.getStockedQuantity.bind(repository),
      getReservedQuantity: repository.getReservedQuantity.bind(repository),
      getAvailableQuantity: repository.getAvailableQuantity.bind(repository),
    }
  }

  throw new Error("InventoryLevel repository aggregate methods are missing")
}

function isInventoryAggregateMethod(
  value: unknown
): value is (
  inventoryItemId: string,
  locationIds: string[]
) => Promise<{ numeric: number }> {
  return typeof value === "function"
}
