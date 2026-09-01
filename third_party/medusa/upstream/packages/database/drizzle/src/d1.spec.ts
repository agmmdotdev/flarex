import { model } from "@medusajs/dml"
import { model as medusaModel } from "@medusajs/utils/dml/model"
import { describe, expect, it } from "vitest"
import { renderD1MigrationSql } from "./d1"
import { compileDmlSchema } from "./schema"
import type { DatabaseSchema } from "./schema"

describe("renderD1MigrationSql", () => {
  it("renders deterministic SQLite schema SQL from compiled DML", () => {
    const Currency = model.define("currency", {
      code: model.text().primaryKey(),
      decimal_digits: model.number().default(0),
      metadata: model.json().default({ source: "DML" }),
    })

    const sql = renderD1MigrationSql(compileDmlSchema([Currency]))
    expect(sql).toContain('"code" TEXT PRIMARY KEY NOT NULL')
    expect(sql).toContain(
      '"metadata" TEXT NOT NULL DEFAULT \'{"source":"DML"}\''
    )

    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void
        prepare(sql: string): {
          all(): Record<string, unknown>[]
        }
        close(): void
      }
    }
    const database = new DatabaseSync(":memory:")
    try {
      database.exec(sql)
      const metadata = database
        .prepare("PRAGMA table_info(currency)")
        .all()
        .find((column) => column.name === "metadata")
      expect(metadata).toMatchObject({
        notnull: 1,
        dflt_value: `'{"source":"DML"}'`,
      })
    } finally {
      database.close()
    }
  })

  it("renders relationship foreign keys from compiled schema metadata", () => {
    const schema: DatabaseSchema = {
      tables: [
        {
          name: "d1_parent",
          columns: [
            {
              name: "id",
              type: "id",
              nullable: false,
              primaryKey: true,
            },
          ],
          indexes: [],
          checks: [],
          foreignKeys: [],
          relationships: [],
          cascades: { delete: [], detach: [] },
        },
        {
          name: "d1_child",
          columns: [
            {
              name: "id",
              type: "id",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "parent_ref",
              type: "id",
              nullable: true,
              primaryKey: false,
              generated: true,
            },
          ],
          indexes: [],
          checks: [],
          foreignKeys: [
            {
              name: "d1_child_parent_ref_foreign",
              columns: ["parent_ref"],
              referencedTable: "d1_parent",
              referencedColumns: ["id"],
              onDelete: "cascade",
            },
          ],
          relationships: [],
          cascades: { delete: [], detach: [] },
        },
      ],
    }

    const sql = renderD1MigrationSql(schema)
    expect(sql).toContain('"parent_ref" TEXT')
    expect(sql).toContain(
      'CONSTRAINT "d1_child_parent_ref_foreign" FOREIGN KEY ("parent_ref") REFERENCES "d1_parent" ("id") ON DELETE CASCADE'
    )

    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void
        prepare(sql: string): {
          all(): Record<string, unknown>[]
        }
        close(): void
      }
    }
    const database = new DatabaseSync(":memory:")
    try {
      database.exec("PRAGMA foreign_keys = ON")
      database.exec(sql)
      const columns = database.prepare("PRAGMA table_info(d1_child)").all()
      expect(columns).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "parent_ref", type: "TEXT" }),
        ])
      )
      const foreignKeys = database
        .prepare("PRAGMA foreign_key_list(d1_child)")
        .all()
      expect(foreignKeys).toEqual([
        expect.objectContaining({
          table: "d1_parent",
          from: "parent_ref",
          to: "id",
          on_delete: "CASCADE",
        }),
      ])
    } finally {
      database.close()
    }
  })

  it("renders executable DML check constraints", () => {
    const Checked = model
      .define("D1Checked", {
        id: model.text().primaryKey(),
        amount: model.bigNumber(),
      })
      .checks([(columns) => `${columns.amount} >= 0`])

    const sql = renderD1MigrationSql(compileDmlSchema([Checked]))
    expect(sql).toContain(
      'CONSTRAINT "d1_checked_check_0" CHECK ("amount" >= 0)'
    )

    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void
        close(): void
      }
    }
    const database = new DatabaseSync(":memory:")
    try {
      database.exec(sql)
      expect(() =>
        database.exec(
          'INSERT INTO "d1_checked" ("id", "amount", "raw_amount", "created_at", "updated_at") VALUES (\'checked_1\', -1, \'{"value":"-1","precision":20}\', 1, 1)'
        )
      ).toThrow(/CHECK constraint failed/)
    } finally {
      database.close()
    }
  })

  it("renders composite primary keys as table constraints", () => {
    const Translation = model.define("d1_translation", {
      entity_id: model.text().primaryKey(),
      locale: model.text().primaryKey(),
      value: model.text(),
    })

    const sql = renderD1MigrationSql(compileDmlSchema([Translation]))
    expect(sql).toContain(
      'CONSTRAINT "d1_translation_primary_key" PRIMARY KEY ("entity_id", "locale")'
    )
    expect(sql).not.toContain('"entity_id" TEXT PRIMARY KEY')
    expect(sql).not.toContain('"locale" TEXT PRIMARY KEY')

    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void
        prepare(sql: string): {
          all(): Record<string, unknown>[]
        }
        close(): void
      }
    }
    const database = new DatabaseSync(":memory:")
    try {
      database.exec(sql)
      const primaryColumns = database
        .prepare("PRAGMA table_info(d1_translation)")
        .all()
        .filter((column) => Number(column.pk) > 0)
      expect(primaryColumns).toEqual([
        expect.objectContaining({ name: "entity_id", pk: 1 }),
        expect.objectContaining({ name: "locale", pk: 2 }),
      ])
    } finally {
      database.close()
    }
  })

  it("renders executable composite relationship foreign keys", () => {
    const Child = medusaModel.define("d1_composite_child", {
      id: medusaModel.id().primaryKey(),
      parent: medusaModel.belongsTo(() => Parent, { mappedBy: "children" }),
    })
    const Parent = medusaModel
      .define("d1_composite_parent", {
        tenant_id: medusaModel.text().primaryKey(),
        external_id: medusaModel.text().primaryKey(),
        children: medusaModel.hasMany(() => Child, { mappedBy: "parent" }),
      })
      .cascades({ delete: ["children"] })

    const sql = renderD1MigrationSql(compileDmlSchema([Parent, Child]))
    expect(sql).toContain(
      'FOREIGN KEY ("parent_tenant_id", "parent_external_id") REFERENCES "d1_composite_parent" ("tenant_id", "external_id") ON DELETE CASCADE'
    )

    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void
        prepare(sql: string): {
          all(): Record<string, unknown>[]
        }
        close(): void
      }
    }
    const database = new DatabaseSync(":memory:")
    try {
      database.exec("PRAGMA foreign_keys = ON")
      database.exec(sql)
      database.exec(
        "INSERT INTO d1_composite_parent (tenant_id, external_id, created_at, updated_at) VALUES ('tenant', 'parent', 0, 0)"
      )
      database.exec(
        "INSERT INTO d1_composite_child (id, parent_tenant_id, parent_external_id, created_at, updated_at) VALUES ('child', 'tenant', 'parent', 0, 0)"
      )
      expect(() =>
        database.exec(
          "INSERT INTO d1_composite_child (id, parent_tenant_id, parent_external_id, created_at, updated_at) VALUES ('invalid', 'tenant', 'missing', 0, 0)"
        )
      ).toThrow()
      database.exec(
        "DELETE FROM d1_composite_parent WHERE tenant_id = 'tenant' AND external_id = 'parent'"
      )
      expect(
        database.prepare("SELECT id FROM d1_composite_child").all()
      ).toEqual([])
    } finally {
      database.close()
    }
  })
})
