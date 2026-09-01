import type {
  PortableDataType,
  PortableEntity,
  PortableEntityIndex,
  PortableProperty,
  PortablePropertyMetadata,
  PortableSchemaMember,
} from "./types"

const IsDmlEntity = Symbol.for("isDmlEntity")

export class Property<T = unknown> implements PortableProperty<T> {
  declare readonly $dataType?: T

  readonly #metadata: PortablePropertyMetadata

  constructor(dataType: PortableDataType, options?: Record<string, unknown>) {
    this.#metadata = {
      fieldName: "",
      dataType: { name: dataType, options },
      nullable: false,
      computed: false,
      indexes: [],
      relationships: [],
    }
  }

  default(value: unknown): this {
    this.#metadata.defaultValue = value
    return this
  }

  nullable(): this {
    this.#metadata.nullable = true
    return this
  }

  computed(): this {
    this.#metadata.computed = true
    return this
  }

  primaryKey(): this {
    this.#metadata.primaryKey = true
    return this
  }

  index(name?: string): this {
    this.#metadata.indexes.push({ name, type: "index" })
    return this
  }

  unique(name?: string): this {
    this.#metadata.indexes.push({ name, type: "unique" })
    return this
  }

  searchable(): this {
    this.#metadata.dataType.options = {
      ...this.#metadata.dataType.options,
      searchable: true,
    }
    return this
  }

  translatable(): this {
    this.#metadata.dataType.options = {
      ...this.#metadata.dataType.options,
      translatable: true,
    }
    return this
  }

  parse(fieldName: string): PortablePropertyMetadata {
    return {
      ...this.#metadata,
      fieldName,
      dataType: {
        ...this.#metadata.dataType,
        options: { ...this.#metadata.dataType.options },
      },
      indexes: this.#metadata.indexes.map((entry) => ({ ...entry })),
      relationships: [],
    }
  }
}

export class DmlEntity implements PortableEntity {
  readonly [IsDmlEntity] = true
  readonly name: string
  readonly schema: Record<string, PortableSchemaMember>

  readonly #tableName: string
  #indexes: PortableEntityIndex[] = []
  #checks: unknown[] = []
  #cascades: { delete?: string[]; detach?: string[] } = {}

  constructor(name: string, schema: Record<string, PortableProperty>) {
    this.name = toPascalCase(name)
    this.#tableName = name
    this.schema = {
      ...schema,
      ...createBigNumberProperties(schema),
      created_at: new Property<Date>("dateTime"),
      updated_at: new Property<Date>("dateTime"),
      deleted_at: new Property<Date | null>("dateTime").nullable(),
    }
  }

  indexes(indexes: PortableEntityIndex[]): this {
    this.#indexes = indexes
    return this
  }

  checks(checks: unknown[]): this {
    this.#checks = checks
    return this
  }

  cascades(cascades: Record<string, string[]>): this {
    this.#cascades = cascades
    return this
  }

  parse() {
    return {
      name: this.name,
      tableName: this.#tableName,
      schema: this.schema,
      indexes: this.#indexes,
      checks: this.#checks,
      cascades: this.#cascades,
    }
  }
}

function createBigNumberProperties(
  schema: Record<string, PortableProperty>
): Record<string, PortableProperty> {
  return Object.fromEntries(
    Object.entries(schema)
      .filter(
        ([, property]) => property.parse("").dataType.name === "bigNumber"
      )
      .map(([fieldName]) => [
        `raw_${fieldName}`,
        new Property("json").nullable(),
      ])
  )
}

function toPascalCase(value: string): string {
  return value
    .split(/[._-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
}

export const model = {
  array: () => new Property<string[]>("array"),
  autoincrement: () => new Property<number>("serial"),
  bigNumber: () => new Property<number>("bigNumber"),
  boolean: () => new Property<boolean>("boolean"),
  dateTime: () => new Property<Date>("dateTime"),
  define: (name: string, schema: Record<string, PortableProperty>) =>
    new DmlEntity(name, schema),
  enum: <T>(choices: readonly T[]) =>
    new Property<T>("enum", { choices: [...choices] }),
  float: () => new Property<number>("float"),
  id: (options?: { prefix?: string }) =>
    new Property<string>("id", { prefix: options?.prefix }),
  json: () => new Property<Record<string, unknown>>("json"),
  number: () => new Property<number>("number"),
  text: () => new Property<string>("text"),
}
