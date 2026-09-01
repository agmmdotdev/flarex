import type {
  PortableEntity,
  PortableRelationshipMetadata,
  PortableSchemaMember,
} from "@medusajs/dml"

export function relationshipTargets(model: PortableEntity): PortableEntity[] {
  const visited = new Map<string, PortableEntity>([[model.name, model]])
  const targets: PortableEntity[] = []

  collectRelationshipTargets(model, visited, targets)

  return targets
}

export function isRelationshipMetadata(
  metadata: ReturnType<PortableSchemaMember["parse"]>
): metadata is PortableRelationshipMetadata {
  return "type" in metadata && "entity" in metadata && !("dataType" in metadata)
}

export function resolveRelationshipTarget(value: unknown): PortableEntity {
  const target = typeof value === "function" ? value() : value
  if (
    !target ||
    typeof target !== "object" ||
    !("name" in target) ||
    typeof target.name !== "string" ||
    !("parse" in target) ||
    typeof target.parse !== "function"
  ) {
    throw new Error("Drizzle relationship loading requires a DML target entity")
  }

  return target
}

export function resolveOptionalRelationshipTarget(
  value: unknown
): PortableEntity | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  return resolveRelationshipTarget(value)
}

function collectRelationshipTargets(
  model: PortableEntity,
  visited: Map<string, PortableEntity>,
  targets: PortableEntity[]
): void {
  const relationships = Object.values(model.parse().schema)
    .map((member) => member.parse(""))
    .filter(isRelationshipMetadata)

  for (const relationship of relationships) {
    const pivot = resolveOptionalRelationshipTarget(
      relationship.options.pivotEntity
    )
    if (pivot && !visited.has(pivot.name)) {
      visited.set(pivot.name, pivot)
      targets.push(pivot)
      collectRelationshipTargets(pivot, visited, targets)
    }

    const target = resolveRelationshipTarget(relationship.entity)
    if (visited.has(target.name)) {
      continue
    }

    visited.set(target.name, target)
    targets.push(target)
    collectRelationshipTargets(target, visited, targets)
  }
}
