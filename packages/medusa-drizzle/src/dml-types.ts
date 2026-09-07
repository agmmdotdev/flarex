export type PortableDataType =
  | "array"
  | "bigNumber"
  | "boolean"
  | "dateTime"
  | "enum"
  | "float"
  | "id"
  | "json"
  | "number"
  | "serial"
  | "text"

export interface PortablePropertyMetadata {
  fieldName: string
  dataType: {
    name: PortableDataType
    options?: Record<string, unknown>
  }
  nullable: boolean
  computed: boolean
  defaultValue?: unknown
  primaryKey?: boolean
  indexes: Array<{
    name?: string
    type: "index" | "unique"
  }>
  relationships: PortableRelationshipMetadata[]
}

export type PortableRelationshipType =
  | "hasOne"
  | "hasOneWithFK"
  | "hasMany"
  | "belongsTo"
  | "manyToMany"

export interface PortableRelationshipMetadata {
  name: string
  type: PortableRelationshipType
  entity: unknown
  nullable?: boolean
  mappedBy?: string
  searchable: boolean
  options: Record<string, unknown>
}

export interface PortableProperty<T = unknown> {
  readonly $dataType?: T
  parse(fieldName: string): PortablePropertyMetadata
}

export interface PortableRelationship<T = unknown> {
  readonly $dataType?: T
  parse(fieldName: string): PortableRelationshipMetadata
}

export interface PortableSchemaMember<T = unknown> {
  readonly $dataType?: T
  parse(
    fieldName: string
  ): PortablePropertyMetadata | PortableRelationshipMetadata
}

export interface PortableEntity {
  name: string
  schema: Record<string, PortableSchemaMember>
  parse(): {
    name: string
    tableName: string
    schema: Record<string, PortableSchemaMember>
    indexes: PortableEntityIndex[]
    checks: unknown[]
    cascades: {
      delete?: string[]
      detach?: string[]
    }
  }
}

export interface PortableEntityIndex {
  name?: string
  unique?: boolean
  on: string[]
  where?: string | Record<string, unknown>
}
