import type { ModuleJoinerConfig } from "@medusajs/framework/types"
import {
  buildModuleResourceEventName,
  CommonEvents,
} from "@medusajs/framework/utils/portable"
import {
  Kind,
  parse,
  print,
  visit,
  type ConstDirectiveNode,
  type DocumentNode,
  type FieldDefinitionNode,
  type ObjectTypeDefinitionNode,
  type TypeNode,
} from "graphql"
import type { SqliteIndexWorkerRuntimeDependencies } from "./sqlite-index-worker-runtime"

export type SqliteIndexWorkerModuleManifest = {
  moduleDefinition: {
    key: string
  }
  resources: {
    indexEntities?: readonly SqliteIndexWorkerStaticModuleEntity[]
    joinerConfig?: ModuleJoinerConfig
  }
}

export type SqliteIndexWorkerStaticManifest = {
  manifests: readonly SqliteIndexWorkerModuleManifest[]
}

export type SqliteIndexWorkerStaticModuleEntity = {
  entity: string
  eventActions?: readonly string[]
  events?: readonly string[]
  fields?: readonly string[]
}

export type SqliteIndexWorkerStaticModuleInputEntity = {
  entity: string
  listeners: readonly string[]
  moduleKey: string
  serviceName: string
}

export type SqliteIndexWorkerStaticModuleInput = Pick<
  SqliteIndexWorkerRuntimeDependencies,
  "joinerConfigs" | "schema"
> & {
  entities: readonly SqliteIndexWorkerStaticModuleInputEntity[]
}

export type GetSqliteIndexWorkerRequiredEntityListenerOptions = {
  action: string
  context?: string
  entity: string
  input: Pick<SqliteIndexWorkerStaticModuleInput, "entities">
}

export type CreateSqliteIndexWorkerStaticManifestOptions = {
  manifests: readonly SqliteIndexWorkerModuleManifest[]
}

export type CreateSqliteIndexWorkerStaticModuleInputOptions = {
  entities?: readonly SqliteIndexWorkerStaticModuleEntity[]
} & (
  | {
      manifest: SqliteIndexWorkerStaticManifest
      manifests?: never
    }
  | {
      manifest?: never
      manifests: readonly SqliteIndexWorkerModuleManifest[]
    }
)

export function createSqliteIndexWorkerStaticManifest({
  manifests,
}: CreateSqliteIndexWorkerStaticManifestOptions): SqliteIndexWorkerStaticManifest {
  assertUniqueModuleManifests(manifests)

  return {
    manifests,
  }
}

const defaultIndexWorkerEventActions = [
  CommonEvents.CREATED,
  CommonEvents.UPDATED,
  CommonEvents.DELETED,
] as const satisfies readonly string[]

export function createSqliteIndexWorkerStaticModuleInput({
  entities,
  manifest,
  manifests,
}: CreateSqliteIndexWorkerStaticModuleInputOptions): SqliteIndexWorkerStaticModuleInput {
  const moduleManifests = manifest ? manifest.manifests : manifests
  assertUniqueModuleManifests(moduleManifests)

  const requestedIndexEntities =
    entities ??
    moduleManifests.flatMap(
      (moduleManifest) => moduleManifest.resources.indexEntities ?? []
    )
  const requestedEntities = new Map(
    requestedIndexEntities.map((entity) => [entity.entity, entity])
  )

  if (!requestedEntities.size) {
    throw new Error(
      "SQLite Index Worker static input requires at least one indexed entity"
    )
  }

  const resolvedEntities = new Set<string>()
  const indexedEntities: SqliteIndexWorkerStaticModuleInputEntity[] = []
  const joinerConfigs = collectJoinerConfigs(moduleManifests)
  const schemaFieldTypes = buildSchemaFieldTypeMap(joinerConfigs)
  const schemas: string[] = []

  for (const moduleManifest of moduleManifests) {
    const joinerConfig = moduleManifest.resources.joinerConfig
    const joinerSchema = joinerConfig?.schema

    if (!joinerConfig || !joinerSchema) {
      continue
    }

    const schemaDocument = parse(joinerSchema)
    const schemaEntityNames = readObjectTypeNames(schemaDocument)
    const indexEntityInputs = new Map<string, IndexedEntityInput>()
    const serviceName =
      joinerConfig.serviceName ?? moduleManifest.moduleDefinition.key

    for (const requestedEntity of requestedEntities.values()) {
      if (!schemaEntityNames.has(requestedEntity.entity)) {
        continue
      }

      if (resolvedEntities.has(requestedEntity.entity)) {
        throw new Error(
          `SQLite Index Worker static input found duplicate entity ${requestedEntity.entity}`
        )
      }

      const listeners =
        requestedEntity.events ??
        createSqliteIndexWorkerEntityEvents({
          actions: requestedEntity.eventActions,
          entity: requestedEntity.entity,
          serviceName,
        })

      indexEntityInputs.set(requestedEntity.entity, {
        fields: requestedEntity.fields,
        listeners,
      })
      indexedEntities.push({
        entity: requestedEntity.entity,
        listeners,
        moduleKey: moduleManifest.moduleDefinition.key,
        serviceName,
      })
      resolvedEntities.add(requestedEntity.entity)
    }

    if (!indexEntityInputs.size) {
      continue
    }

    schemas.push(
      buildIndexedEntitySchema({
        indexEntityInputs,
        joinerConfigs,
        schemaDocument,
        schemaFieldTypes,
        serviceName,
      })
    )
  }

  const missingEntities = [...requestedEntities.keys()].filter(
    (entity) => !resolvedEntities.has(entity)
  )

  if (missingEntities.length) {
    throw new Error(
      `SQLite Index Worker static input could not find entities: ${missingEntities.join(
        ", "
      )}`
    )
  }

  return {
    entities: indexedEntities,
    joinerConfigs,
    schema: schemas.join("\n"),
  }
}

function collectJoinerConfigs(
  moduleManifests: readonly SqliteIndexWorkerModuleManifest[]
): ModuleJoinerConfig[] {
  return moduleManifests
    .map((moduleManifest) => moduleManifest.resources.joinerConfig)
    .filter(
      (joinerConfig): joinerConfig is ModuleJoinerConfig =>
        joinerConfig !== undefined
    )
}

function assertUniqueModuleManifests(
  manifests: readonly SqliteIndexWorkerModuleManifest[]
): void {
  const moduleKeys = new Set<string>()

  for (const manifest of manifests) {
    const moduleKey = manifest.moduleDefinition.key

    if (moduleKeys.has(moduleKey)) {
      throw new Error(
        `SQLite Index Worker static manifest contains duplicate module ${moduleKey}`
      )
    }

    moduleKeys.add(moduleKey)
  }
}

export function createSqliteIndexWorkerEntityEvents({
  actions = defaultIndexWorkerEventActions,
  entity,
  serviceName,
}: {
  actions?: readonly string[]
  entity: string
  serviceName: string
}): readonly string[] {
  return actions.map((action) =>
    buildModuleResourceEventName({
      action,
      objectName: entity,
      prefix: serviceName,
    })
  )
}

export function getSqliteIndexWorkerRequiredEntityListener({
  action,
  context = "SQLite Index Worker static input",
  entity,
  input,
}: GetSqliteIndexWorkerRequiredEntityListenerOptions): string {
  const indexedEntity = input.entities.find(
    (inputEntity) => inputEntity.entity === entity
  )
  const listener = indexedEntity?.listeners.find((eventName) =>
    eventName.endsWith(`.${action}`)
  )

  if (!listener) {
    throw new Error(`${context} is missing ${entity}.${action} listener`)
  }

  return listener
}

type IndexedEntityInput = {
  fields: readonly string[] | undefined
  listeners: readonly string[]
}

type BuildIndexedEntitySchemaOptions = {
  indexEntityInputs: ReadonlyMap<string, IndexedEntityInput>
  joinerConfigs: readonly ModuleJoinerConfig[]
  schemaDocument: DocumentNode
  schemaFieldTypes: SchemaFieldTypeMap
  serviceName: string
}

function buildIndexedEntitySchema({
  indexEntityInputs,
  joinerConfigs,
  schemaDocument,
  schemaFieldTypes,
  serviceName,
}: BuildIndexedEntitySchemaOptions): string {
  const extendedFields = collectExtendedFields({
    indexEntityInputs,
    joinerConfigs,
    schemaFieldTypes,
    serviceName,
  })

  return print(
    visit(schemaDocument, {
      ObjectTypeDefinition(node) {
        const entityInput = indexEntityInputs.get(node.name.value)

        if (!entityInput) {
          return null
        }

        return createIndexedEntityTypeDefinition(
          addExtendedFields(node, extendedFields.get(node.name.value)),
          entityInput
        )
      },
      EnumTypeDefinition() {
        return null
      },
      InputObjectTypeDefinition() {
        return null
      },
      InterfaceTypeDefinition() {
        return null
      },
      ScalarTypeDefinition() {
        return null
      },
      UnionTypeDefinition() {
        return null
      },
    })
  )
}

type SchemaFieldTypeMap = ReadonlyMap<string, ReadonlyMap<string, TypeNode>>

function buildSchemaFieldTypeMap(
  joinerConfigs: readonly ModuleJoinerConfig[]
): SchemaFieldTypeMap {
  const schemaFieldTypes = new Map<string, Map<string, TypeNode>>()

  for (const joinerConfig of joinerConfigs) {
    if (!joinerConfig.schema) {
      continue
    }

    const schemaDocument = parse(joinerConfig.schema)

    for (const definition of schemaDocument.definitions) {
      if (definition.kind !== Kind.OBJECT_TYPE_DEFINITION) {
        continue
      }

      const fields = new Map<string, TypeNode>()

      for (const field of definition.fields ?? []) {
        fields.set(field.name.value, field.type)
      }

      schemaFieldTypes.set(definition.name.value, fields)
    }
  }

  return schemaFieldTypes
}

type CollectExtendedFieldsOptions = {
  indexEntityInputs: ReadonlyMap<string, IndexedEntityInput>
  joinerConfigs: readonly ModuleJoinerConfig[]
  schemaFieldTypes: SchemaFieldTypeMap
  serviceName: string
}

function collectExtendedFields({
  indexEntityInputs,
  joinerConfigs,
  schemaFieldTypes,
  serviceName,
}: CollectExtendedFieldsOptions): ReadonlyMap<string, ReadonlyMap<string, TypeNode>> {
  const extendedFields = new Map<string, Map<string, TypeNode>>()

  for (const joinerConfig of joinerConfigs) {
    for (const extension of joinerConfig.extends ?? []) {
      if (extension.serviceName !== serviceName || !extension.entity) {
        continue
      }

      const entityInput = indexEntityInputs.get(extension.entity)
      if (!entityInput) {
        continue
      }

      const selectedFields = entityInput.fields
        ? new Set(entityInput.fields)
        : undefined

      for (const [fieldName, fieldAlias] of Object.entries(
        extension.fieldAlias ?? {}
      )) {
        if (selectedFields && !selectedFields.has(fieldName)) {
          continue
        }

        const fieldType = resolveFieldAliasType({
          extension,
          fieldAlias,
          joinerConfig,
          schemaFieldTypes,
        })

        if (!fieldType) {
          throw new Error(
            `SQLite Index Worker static input could not resolve extended field ${extension.entity}.${fieldName} from path ${readFieldAliasPath(
              fieldAlias
            )}`
          )
        }

        const entityFields =
          extendedFields.get(extension.entity) ?? new Map<string, TypeNode>()
        entityFields.set(fieldName, fieldType)
        extendedFields.set(extension.entity, entityFields)
      }
    }
  }

  return extendedFields
}

type JoinerExtension = NonNullable<ModuleJoinerConfig["extends"]>[number]
type FieldAlias = NonNullable<JoinerExtension["fieldAlias"]>[string]

type ResolveFieldAliasTypeOptions = {
  extension: JoinerExtension
  fieldAlias: FieldAlias
  joinerConfig: ModuleJoinerConfig
  schemaFieldTypes: SchemaFieldTypeMap
}

function resolveFieldAliasType({
  extension,
  fieldAlias,
  joinerConfig,
  schemaFieldTypes,
}: ResolveFieldAliasTypeOptions): TypeNode | undefined {
  if (!extension.entity) {
    return undefined
  }

  const path = readFieldAliasPath(fieldAlias)
  const pathParts = path.split(".").filter(Boolean)
  let currentEntity = extension.entity

  for (const [index, pathPart] of pathParts.entries()) {
    const isLastPart = index === pathParts.length - 1
    const schemaFieldType = schemaFieldTypes.get(currentEntity)?.get(pathPart)

    if (schemaFieldType) {
      if (isLastPart) {
        return schemaFieldType
      }

      currentEntity = getNamedTypeName(schemaFieldType)
      continue
    }

    const linkEntityName = getPrimaryAliasEntity(joinerConfig)
    const extensionRelationshipAlias = extension.relationship.alias

    if (pathPart === extensionRelationshipAlias && linkEntityName) {
      currentEntity = linkEntityName
      continue
    }

    const relationship = joinerConfig.relationships?.find(
      (candidate) => candidate.alias === pathPart
    )

    if (relationship?.entity) {
      if (isLastPart) {
        return createNamedFieldType(
          relationship.entity,
          readFieldAliasIsList(fieldAlias)
        )
      }

      currentEntity = relationship.entity
      continue
    }

    return undefined
  }

  return undefined
}

function readFieldAliasPath(fieldAlias: FieldAlias): string {
  return typeof fieldAlias === "string" ? fieldAlias : fieldAlias.path
}

function readFieldAliasIsList(fieldAlias: FieldAlias): boolean {
  return typeof fieldAlias === "string" ? false : fieldAlias.isList === true
}

function getPrimaryAliasEntity(
  joinerConfig: ModuleJoinerConfig
): string | undefined {
  return joinerConfig.alias?.[0]?.entity
}

function getNamedTypeName(typeNode: TypeNode): string {
  if (typeNode.kind === Kind.NAMED_TYPE) {
    return typeNode.name.value
  }

  return getNamedTypeName(typeNode.type)
}

function createNamedFieldType(entityName: string, isList: boolean): TypeNode {
  const namedType = {
    kind: Kind.NAMED_TYPE,
    name: {
      kind: Kind.NAME,
      value: entityName,
    },
  } satisfies TypeNode

  if (!isList) {
    return namedType
  }

  return {
    kind: Kind.LIST_TYPE,
    type: namedType,
  }
}

function addExtendedFields(
  node: ObjectTypeDefinitionNode,
  fields: ReadonlyMap<string, TypeNode> | undefined
): ObjectTypeDefinitionNode {
  if (!fields?.size) {
    return node
  }

  const existingFields = new Set(
    (node.fields ?? []).map((field) => field.name.value)
  )

  return {
    ...node,
    fields: [
      ...(node.fields ?? []),
      ...[...fields.entries()]
        .filter(([fieldName]) => !existingFields.has(fieldName))
        .map(([fieldName, fieldType]) =>
          createFieldDefinition(fieldName, fieldType)
        ),
    ],
  }
}

function createFieldDefinition(
  fieldName: string,
  fieldType: TypeNode
): FieldDefinitionNode {
  return {
    arguments: [],
    directives: [],
    kind: Kind.FIELD_DEFINITION,
    name: {
      kind: Kind.NAME,
      value: fieldName,
    },
    type: fieldType,
  }
}

function createIndexedEntityTypeDefinition(
  node: ObjectTypeDefinitionNode,
  entityInput: IndexedEntityInput
): ObjectTypeDefinitionNode {
  const selectedFields = entityInput.fields
    ? new Set(entityInput.fields)
    : undefined
  const directives = (node.directives ?? []).filter(
    (directive) => directive.name.value !== "Listeners"
  )

  return {
    ...node,
    directives: [...directives, createListenersDirective(entityInput.listeners)],
    fields: selectedFields
      ? (node.fields ?? []).filter((field) =>
          selectedFields.has(field.name.value)
        )
      : node.fields,
  }
}

function createListenersDirective(
  listeners: readonly string[]
): ConstDirectiveNode {
  return {
    arguments: [
      {
        kind: Kind.ARGUMENT,
        name: {
          kind: Kind.NAME,
          value: "values",
        },
        value: {
          kind: Kind.LIST,
          values: listeners.map((listener) => ({
            kind: Kind.STRING,
            value: listener,
          })),
        },
      },
    ],
    kind: Kind.DIRECTIVE,
    name: {
      kind: Kind.NAME,
      value: "Listeners",
    },
  }
}

function readObjectTypeNames(schemaDocument: DocumentNode): ReadonlySet<string> {
  const entityNames = new Set<string>()

  for (const definition of schemaDocument.definitions) {
    if (definition.kind === Kind.OBJECT_TYPE_DEFINITION) {
      entityNames.add(definition.name.value)
    }
  }

  return entityNames
}
