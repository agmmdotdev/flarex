import { model } from "@medusajs/utils/dml/model"
import { describe, expect, it } from "vitest"
import { compileDmlSchema } from "../src/schema"

describe("native one-to-one DML indexes", () => {
  it("preserves active uniqueness for belongsTo with a hasOne inverse", () => {
    const Owner = model.define("ReferenceOwner", {
      id: model.id().primaryKey(),
      target: model.belongsTo(() => Target, {
        mappedBy: "owner", foreignKeyName: "target_ref",
      }).nullable(),
    }).indexes([{ name: "authored_lookup", on: ["target_ref"] }])
    const Target = model.define("ReferenceTarget", {
      id: model.id().primaryKey(),
      owner: model.hasOne(() => Owner, { mappedBy: "target" }),
    })
    const schema = compileDmlSchema([Owner, Target])
    expect(schema.tables[0].indexes).toEqual([
      { name: "authored_lookup", columns: ["target_ref"], unique: false, where: "deleted_at IS NULL" },
      { name: "reference_owner_target_ref_unique", columns: ["target_ref"], unique: true,
        where: "deleted_at IS NULL" },
    ])
    expect(schema.tables[0].columns.find(column => column.name === "target_ref"))
      .toMatchObject({ nullable: true })
    expect(schema.tables[1].indexes).toEqual([])
    expect(schema.tables[1].foreignKeys).toEqual([])
  })

  it("uses the model name for the native default inverse when the table name differs", () => {
    const Owner = model.define({ name: "DefaultReferenceOwner", tableName: "renamed_owner" }, {
      id: model.id().primaryKey(),
      target: model.belongsTo(() => Target),
    })
    const Target = model.define("DefaultReferenceTarget", {
      id: model.id().primaryKey(),
      default_reference_owner: model.hasOne(() => Owner, { mappedBy: "target" }),
    })
    expect(compileDmlSchema([Owner, Target]).tables[0].indexes).toEqual([
      { name: "renamed_owner_target_id_unique", columns: ["target_id"], unique: true,
        where: "deleted_at IS NULL" },
    ])
  })

  it("does not duplicate an authored active unique index", () => {
    const Owner = model.define("IndexedReferenceOwner", {
      id: model.id().primaryKey(),
      target: model.belongsTo(() => Target, { mappedBy: "owner" }),
    }).indexes([{ name: "authored_active_unique", on: ["target_id"], unique: true,
      where: "deleted_at IS NULL" }])
    const Target = model.define("IndexedReferenceTarget", {
      id: model.id().primaryKey(),
      owner: model.hasOne(() => Owner, { mappedBy: "target" }),
    })
    expect(compileDmlSchema([Owner, Target]).tables[0].indexes).toEqual([
      { name: "authored_active_unique", columns: ["target_id"], unique: true, where: "deleted_at IS NULL" },
    ])
  })

  it.each([undefined, ""])("preserves native numeric-name normalization and falsy mappedBy (%s)", mappedBy => {
    const Owner = model.define({ name: "record2_owner", tableName: "named_owner" }, {
      id: model.id().primaryKey(),
      target: model.belongsTo(() => Target, { mappedBy }).nullable(),
    })
    const Target = model.define("NumericTarget", {
      id: model.id().primaryKey(),
      record2owner: model.hasOne(() => Owner, { mappedBy: "target" }),
    })
    expect(Owner.parse().name).toBe("Record2Owner")
    expect(compileDmlSchema([Owner, Target]).tables[0].indexes).toEqual([
      { name: "named_owner_target_id_unique", columns: ["target_id"], unique: true,
        where: "deleted_at IS NULL" },
    ])
  })

  it("recognizes a hasOneWithFK inverse without making its own foreign key unique", () => {
    const Owner = model.define("WithForeignKeyOwner", {
      id: model.id().primaryKey(),
      target: model.belongsTo(() => Target, { mappedBy: "owner" }),
    })
    const Target = model.define("WithForeignKeyTarget", {
      id: model.id().primaryKey(),
      owner: model.hasOne(() => Owner, { foreignKey: true, mappedBy: "target" }),
    })
    const schema = compileDmlSchema([Owner, Target])
    expect(schema.tables[0].indexes).toEqual([
      { name: "with_foreign_key_owner_target_id_unique", columns: ["target_id"], unique: true,
        where: "deleted_at IS NULL" },
    ])
    expect(schema.tables[1].indexes).toEqual([
      { name: "with_foreign_key_target_owner_id_index", columns: ["owner_id"], unique: false },
    ])
  })

  it("retains many-to-one and unidirectional owning hasOneWithFK cardinality", () => {
    const Parent = model.define("PluralReferenceParent", {
      id: model.id().primaryKey(),
      children: model.hasMany(() => Child, { mappedBy: "parent" }),
    })
    const Child = model.define("PluralReferenceChild", {
      id: model.id().primaryKey(),
      parent: model.belongsTo(() => Parent, { mappedBy: "children" }).nullable(),
      provider: model.hasOne(() => Parent, { foreignKey: true, mappedBy: undefined }).nullable(),
    })
    expect(compileDmlSchema([Parent, Child]).tables[1].indexes).toEqual([
      { name: "plural_reference_child_parent_id_index", columns: ["parent_id"], unique: false },
      { name: "plural_reference_child_provider_id_index", columns: ["provider_id"], unique: false },
    ])
  })
})
