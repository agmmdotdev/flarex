import type {
  PortableEntity,
  PortablePropertyMetadata,
  PortableRelationshipMetadata,
} from "@medusajs/dml"
import type { FilterQuery, Primitive } from "./types"

type PortableMemberMetadata =
  | PortablePropertyMetadata
  | PortableRelationshipMetadata

export function getPrimaryKeys(entity: PortableEntity): string[] {
  const keys = Object.entries(entity.parse().schema)
    .filter(([fieldName, property]) => {
      const metadata = property.parse(fieldName)
      return isPropertyMetadata(metadata) && metadata.primaryKey
    })
    .map(([fieldName]) => fieldName)

  return keys.length ? keys : ["id"]
}

export function toPrimaryKeyFilter<T extends object>(
  entity: PortableEntity,
  input: Primitive | Primitive[] | Record<string, Primitive>
): FilterQuery<T> {
  const primaryKeys = getPrimaryKeys(entity)

  if (Array.isArray(input)) {
    if (primaryKeys.length !== 1) {
      throw new Error("Composite primary keys require an object value")
    }

    return { [primaryKeys[0]]: input } as FilterQuery<T>
  }

  if (typeof input === "object" && input !== null && !(input instanceof Date)) {
    return input as FilterQuery<T>
  }

  if (primaryKeys.length !== 1) {
    throw new Error("Composite primary keys require an object value")
  }

  return { [primaryKeys[0]]: input } as FilterQuery<T>
}

export function applyModelDefaults<T extends object>(
  entity: PortableEntity,
  input: Partial<T>,
  now = new Date()
): T {
  const output = { ...input } as Record<string, unknown>

  for (const [fieldName, property] of Object.entries(entity.parse().schema)) {
    const metadata = property.parse(fieldName)
    if (!isPropertyMetadata(metadata)) {
      continue
    }

    if (
      output[fieldName] === undefined &&
      metadata.defaultValue !== undefined
    ) {
      output[fieldName] =
        typeof metadata.defaultValue === "function"
          ? metadata.defaultValue()
          : metadata.defaultValue
    }

    if (fieldName === "created_at" && output[fieldName] === undefined) {
      output[fieldName] = now
    }

    if (fieldName === "updated_at") {
      output[fieldName] = now
    }

    if (metadata.dataType.name === "id" && output[fieldName] === undefined) {
      const prefix =
        typeof metadata.dataType.options?.prefix === "string"
          ? metadata.dataType.options.prefix
          : undefined
      output[fieldName] = generateEntityId(prefix)
    }
  }

  return output as T
}

function isPropertyMetadata(
  metadata: PortableMemberMetadata
): metadata is PortablePropertyMetadata {
  return "dataType" in metadata
}

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

function generateEntityId(prefix?: string): string {
  const id = `${encodeTime(Date.now(), 10)}${encodeRandom(16)}`

  return prefix ? `${prefix}_${id}` : id
}

function encodeTime(time: number, length: number): string {
  let encoded = ""

  for (let index = 0; index < length; index += 1) {
    encoded = ENCODING[time % 32] + encoded
    time = Math.floor(time / 32)
  }

  return encoded
}

function encodeRandom(length: number): string {
  const randomBytes = new Uint8Array(length)
  crypto.getRandomValues(randomBytes)

  return Array.from(randomBytes, (byte) => ENCODING[byte % 32]).join("")
}
