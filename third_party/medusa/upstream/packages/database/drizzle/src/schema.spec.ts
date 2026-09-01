import { model } from "@medusajs/dml"
import { model as medusaModel } from "@medusajs/utils/dml/model"
import { describe, expect, it } from "vitest"
import { compileDmlSchema } from "./schema"

describe("compileDmlSchema", () => {
  it("compiles portable DML metadata without ORM-specific types", () => {
    const Currency = model.define("currency", {
      code: model.text().primaryKey(),
      decimal_digits: model.number().default(0),
      rounding: model.bigNumber().default(0),
    })

    const schema = compileDmlSchema([Currency])
    const table = schema.tables[0]

    expect(table.name).toBe("currency")
    expect(table.columns.map((column) => column.name)).toEqual([
      "code",
      "decimal_digits",
      "rounding",
      "raw_rounding",
      "created_at",
      "updated_at",
      "deleted_at",
    ])
    expect(
      table.columns.find((column) => column.name === "code")?.primaryKey
    ).toBe(true)
  })

  it("preserves real Medusa DML relationship and cascade metadata", () => {
    const Child = medusaModel.define("CompilerChild", {
      id: medusaModel.id().primaryKey(),
      parent: medusaModel
        .belongsTo(() => Parent, {
          mappedBy: "children",
          foreignKeyName: "parent_ref",
        })
        .nullable(),
    })
    const Parent = medusaModel
      .define("CompilerParent", {
        id: medusaModel.id().primaryKey(),
        children: medusaModel.hasMany(() => Child, { mappedBy: "parent" }),
      })
      .cascades({ delete: ["children"] })

    const schema = compileDmlSchema([Parent, Child])

    expect(schema.tables[0]).toEqual(
      expect.objectContaining({
        name: "compiler_parent",
        cascades: { delete: ["children"], detach: [] },
        relationships: [
          expect.objectContaining({
            name: "children",
            type: "hasMany",
            targetModel: "CompilerChild",
            targetTable: "compiler_child",
            mappedBy: "parent",
            cascadeDelete: true,
          }),
        ],
      })
    )
    expect(schema.tables[0].columns.map((column) => column.name)).not.toContain(
      "children"
    )
    expect(schema.tables[1].relationships).toEqual([
      expect.objectContaining({
        name: "parent",
        type: "belongsTo",
        targetModel: "CompilerParent",
        targetTable: "compiler_parent",
        mappedBy: "children",
        foreignKeyName: "parent_ref",
        foreignKeyNames: ["parent_ref"],
        nullable: true,
        cascadeDelete: false,
      }),
    ])
    expect(schema.tables[1].columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "parent_ref",
          type: "id",
          nullable: true,
          generated: true,
        }),
      ])
    )
    expect(schema.tables[1].foreignKeys).toEqual([
      {
        name: "compiler_child_parent_ref_foreign",
        columns: ["parent_ref"],
        referencedTable: "compiler_parent",
        referencedColumns: ["id"],
        onDelete: "cascade",
      },
    ])
  })

  it("preserves DML check constraints with generated columns", () => {
    const Child = medusaModel
      .define("CompilerCheckedChild", {
        id: medusaModel.id().primaryKey(),
        amount: medusaModel.bigNumber(),
        parent: medusaModel.belongsTo(() => Parent, { mappedBy: "children" }),
      })
      .checks([
        {
          name: "amount_non_negative",
          expression: (columns) => `${columns.amount} >= 0`,
        },
      ])
    const Parent = medusaModel.define("CompilerCheckedParent", {
      id: medusaModel.id().primaryKey(),
      children: medusaModel.hasMany(() => Child, { mappedBy: "parent" }),
    })

    const schema = compileDmlSchema([Parent, Child])
    const childTable = schema.tables.find(
      (table) => table.name === "compiler_checked_child"
    )

    expect(childTable?.checks).toEqual([
      {
        name: "amount_non_negative",
        expression: '"amount" >= 0',
      },
    ])
    expect(childTable?.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "parent_id", generated: true }),
      ])
    )
  })

  it("generates composite relationship foreign keys from target primary keys", () => {
    const Child = medusaModel.define("CompilerCompositeChild", {
      id: medusaModel.id().primaryKey(),
      parent: medusaModel
        .belongsTo(() => Parent, { mappedBy: "children" })
        .nullable(),
    })
    const Parent = medusaModel
      .define("CompilerCompositeParent", {
        tenant_id: medusaModel.text().primaryKey(),
        external_id: medusaModel.text().primaryKey(),
        children: medusaModel.hasMany(() => Child, { mappedBy: "parent" }),
      })
      .cascades({ delete: ["children"] })

    const schema = compileDmlSchema([Parent, Child])
    const childTable = schema.tables.find(
      (table) => table.name === "compiler_composite_child"
    )

    expect(childTable?.relationships[0]).toEqual(
      expect.objectContaining({
        foreignKeyNames: ["parent_tenant_id", "parent_external_id"],
      })
    )
    expect(childTable?.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "parent_tenant_id",
          type: "text",
          nullable: true,
          generated: true,
        }),
        expect.objectContaining({
          name: "parent_external_id",
          type: "text",
          nullable: true,
          generated: true,
        }),
      ])
    )
    expect(childTable?.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          columns: ["parent_tenant_id", "parent_external_id"],
          unique: false,
        }),
      ])
    )
    expect(childTable?.foreignKeys).toEqual([
      {
        name: "compiler_composite_child_parent_tenant_id_parent_external_id_foreign",
        columns: ["parent_tenant_id", "parent_external_id"],
        referencedTable: "compiler_composite_parent",
        referencedColumns: ["tenant_id", "external_id"],
        onDelete: "cascade",
      },
    ])
  })

  it("rejects a singular custom foreign key name for a composite target", () => {
    const Child = medusaModel.define("CompilerNamedCompositeChild", {
      id: medusaModel.id().primaryKey(),
      parent: medusaModel.belongsTo(() => Parent, {
        foreignKeyName: "parent_ref",
      }),
    })
    const Parent = medusaModel.define("CompilerNamedCompositeParent", {
      tenant_id: medusaModel.text().primaryKey(),
      external_id: medusaModel.text().primaryKey(),
    })

    expect(() => compileDmlSchema([Parent, Child])).toThrow(
      'Relationship "compiler_named_composite_child.parent" cannot map composite target primary key columns with the singular foreignKeyName option'
    )
  })

  it("generates implicit pivot tables for manyToMany relationships", () => {
    const OptionValue = medusaModel.define("CompilerPivotOptionValue", {
      id: medusaModel.id().primaryKey(),
      variants: medusaModel.manyToMany(() => Variant, {
        mappedBy: "options",
      }),
    })
    const Variant = medusaModel.define("CompilerPivotVariant", {
      id: medusaModel.id().primaryKey(),
      options: medusaModel.manyToMany(() => OptionValue, {
        mappedBy: "variants",
        pivotTable: "compiler_variant_option",
        joinColumn: "variant_id",
        inverseJoinColumn: "option_value_id",
      }),
    })

    const schema = compileDmlSchema([Variant, OptionValue])
    const variantTable = schema.tables.find(
      (table) => table.name === "compiler_pivot_variant"
    )
    const optionValueTable = schema.tables.find(
      (table) => table.name === "compiler_pivot_option_value"
    )
    const pivotTable = schema.tables.find(
      (table) => table.name === "compiler_variant_option"
    )

    expect(variantTable?.relationships[0]).toEqual(
      expect.objectContaining({
        name: "options",
        pivotTable: "compiler_variant_option",
        joinColumns: ["variant_id"],
        inverseJoinColumns: ["option_value_id"],
      })
    )
    expect(optionValueTable?.relationships[0]).toEqual(
      expect.objectContaining({
        name: "variants",
        pivotTable: "compiler_variant_option",
        joinColumns: ["option_value_id"],
        inverseJoinColumns: ["variant_id"],
      })
    )
    expect(pivotTable).toEqual(
      expect.objectContaining({
        columns: [
          expect.objectContaining({ name: "variant_id", type: "id" }),
          expect.objectContaining({ name: "option_value_id", type: "id" }),
        ],
        foreignKeys: [
          expect.objectContaining({
            columns: ["variant_id"],
            referencedTable: "compiler_pivot_variant",
            referencedColumns: ["id"],
            onDelete: "cascade",
          }),
          expect.objectContaining({
            columns: ["option_value_id"],
            referencedTable: "compiler_pivot_option_value",
            referencedColumns: ["id"],
            onDelete: "cascade",
          }),
        ],
      })
    )
  })

  it("generates implicit pivot tables for composite-key relationships", () => {
    const Tag = medusaModel.define("CompilerCompositePivotTag", {
      tenant_id: medusaModel.text().primaryKey(),
      code: medusaModel.text().primaryKey(),
      parents: medusaModel.manyToMany(() => Parent, {
        mappedBy: "tags",
      }),
    })
    const Parent = medusaModel.define("CompilerCompositePivotParent", {
      tenant_id: medusaModel.text().primaryKey(),
      external_id: medusaModel.text().primaryKey(),
      tags: medusaModel.manyToMany(() => Tag, {
        mappedBy: "parents",
        pivotTable: "compiler_composite_parent_tag",
      }),
    })

    const schema = compileDmlSchema([Parent, Tag])
    const parentTable = schema.tables.find(
      (table) => table.name === "compiler_composite_pivot_parent"
    )
    const tagTable = schema.tables.find(
      (table) => table.name === "compiler_composite_pivot_tag"
    )
    const pivotTable = schema.tables.find(
      (table) => table.name === "compiler_composite_parent_tag"
    )
    const parentColumns = [
      "compiler_composite_pivot_parent_tenant_id",
      "compiler_composite_pivot_parent_external_id",
    ]
    const tagColumns = [
      "compiler_composite_pivot_tag_tenant_id",
      "compiler_composite_pivot_tag_code",
    ]

    expect(parentTable?.relationships[0]).toEqual(
      expect.objectContaining({
        joinColumns: parentColumns,
        inverseJoinColumns: tagColumns,
      })
    )
    expect(tagTable?.relationships[0]).toEqual(
      expect.objectContaining({
        joinColumns: tagColumns,
        inverseJoinColumns: parentColumns,
      })
    )
    expect(pivotTable).toEqual(
      expect.objectContaining({
        columns: [
          expect.objectContaining({ name: parentColumns[0], type: "text" }),
          expect.objectContaining({ name: parentColumns[1], type: "text" }),
          expect.objectContaining({ name: tagColumns[0], type: "text" }),
          expect.objectContaining({ name: tagColumns[1], type: "text" }),
        ],
        foreignKeys: [
          expect.objectContaining({
            columns: parentColumns,
            referencedTable: "compiler_composite_pivot_parent",
            referencedColumns: ["tenant_id", "external_id"],
          }),
          expect.objectContaining({
            columns: tagColumns,
            referencedTable: "compiler_composite_pivot_tag",
            referencedColumns: ["tenant_id", "code"],
          }),
        ],
      })
    )
    expect(pivotTable?.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ columns: parentColumns }),
        expect.objectContaining({ columns: tagColumns }),
        expect.objectContaining({
          columns: [...parentColumns, ...tagColumns],
          unique: true,
        }),
      ])
    )
  })

  it("rejects incomplete custom pivot columns for composite keys", () => {
    const Tag = medusaModel.define("CompilerNamedCompositePivotTag", {
      tenant_id: medusaModel.text().primaryKey(),
      code: medusaModel.text().primaryKey(),
      parents: medusaModel.manyToMany(() => Parent, {
        mappedBy: "tags",
      }),
    })
    const Parent = medusaModel.define("CompilerNamedCompositePivotParent", {
      tenant_id: medusaModel.text().primaryKey(),
      external_id: medusaModel.text().primaryKey(),
      tags: medusaModel.manyToMany(() => Tag, {
        mappedBy: "parents",
        pivotTable: "compiler_named_composite_parent_tag",
        joinColumn: "parent_ref",
      }),
    })

    expect(() => compileDmlSchema([Parent, Tag])).toThrow(
      'Relationship "compiler_named_composite_pivot_parent.tags" requires 2 pivot columns for "compiler_named_composite_pivot_parent"'
    )
  })
})
