import type {
  JoinerRelationship,
  ModuleJoinerConfig,
} from "@medusajs/framework/types"
import { composeTableName } from "@medusajs/utils/link/compose-link-name"
import { compressName } from "@medusajs/utils/common/compress-name"
import { simpleHash } from "@medusajs/utils/common/simple-hash"

/** Native structural generation without ORM classes, filters or lifecycle hooks. */
export function generateEntityDefinition(
  joinerConfig: ModuleJoinerConfig,
  primary: JoinerRelationship,
  foreign: JoinerRelationship
) {
  const fieldNames = primary.foreignKey.split(",").concat(foreign.foreignKey)

  const tableName =
    joinerConfig.databaseConfig?.tableName ??
    composeTableName(
      primary.serviceName,
      primary.foreignKey,
      foreign.serviceName,
      foreign.foreignKey
    ).toLowerCase()

  const fields = fieldNames.reduce((acc, curr) => {
    acc[curr] = {
      type: "string",
      nullable: false,
      primary: true,
    }
    return acc
  }, {})

  const extraFields = joinerConfig.databaseConfig?.extraFields ?? {}

  for (const column in extraFields) {
    fieldNames.push(column)

    fields[column] = {
      type: extraFields[column].type,
      nullable: !!extraFields[column].nullable,
      defaultRaw: extraFields[column].defaultValue,
      ...(extraFields[column].options ?? {}),
    }
  }

  const hashTableName = simpleHash(tableName)

  return {
    tableName: compressName(tableName),
    properties: {
      id: {
        type: "string",
        nullable: false,
      },
      ...fields,
      created_at: {
        columnType: "timestamptz",
        type: "date",
        nullable: false,
        defaultRaw: "CURRENT_TIMESTAMP",
      },
      updated_at: {
        columnType: "timestamptz",
        type: "date",
        nullable: false,
        defaultRaw: "CURRENT_TIMESTAMP",
      },
      deleted_at: {
        columnType: "timestamptz",
        type: "date",
        nullable: true,
      },
    },
    indexes: [
      {
        properties: ["id"],
        name: "IDX_id_" + hashTableName,
      },
      {
        properties: primary.foreignKey.split(","),
        name:
          "IDX_" +
          primary.foreignKey.split(",").join("_") +
          "_" +
          hashTableName,
        expression:
          "CREATE INDEX IF NOT EXISTS " +
          '"IDX_' +
          primary.foreignKey.split(",").join("_") +
          "_" +
          hashTableName +
          '" ON "' +
          compressName(tableName) +
          '" ("' +
          primary.foreignKey.split(",").join(",") +
          '") WHERE deleted_at IS NULL',
      },
      {
        properties: foreign.foreignKey,
        name: "IDX_" + foreign.foreignKey + "_" + hashTableName,
        expression:
          "CREATE INDEX IF NOT EXISTS " +
          '"IDX_' +
          foreign.foreignKey +
          "_" +
          hashTableName +
          '" ON "' +
          compressName(tableName) +
          '" ("' +
          foreign.foreignKey +
          '") WHERE deleted_at IS NULL',
      },
      {
        properties: ["deleted_at"],
        name: "IDX_deleted_at_" + hashTableName,
      },
    ],
  }
}
