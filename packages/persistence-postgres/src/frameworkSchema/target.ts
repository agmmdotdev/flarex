import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect } from "effect";
import type { FlarexMetadataDatabase } from "../deployments";
import type { ScopePhysicalLocator } from "../scopeMetadataTypes";
import {
  captureFrameworkSchemaTargetNamespace,
  type FrameworkSchemaTargetNamespace,
} from "../migrationCoordination/targetNamespace";
import { isBoundedPrivateValueIdentityText } from "./privateStoredValueShape";

const targetBrand: unique symbol = Symbol("FlarexDB/FrameworkSchemaTarget");

/** Database-bound placement evidence. This carries no driver, SQL or settlement capability. */
export interface FrameworkSchemaTarget {
  readonly [targetBrand]: true;
}

export interface FrameworkSchemaTargetInput {
  readonly database: FlarexMetadataDatabase;
  readonly deploymentId: string;
  readonly canonicalPhysicalDatabaseIdentity: string;
  readonly physicalLocator: ScopePhysicalLocator;
}

export interface FrameworkSchemaTargetSnapshot {
  readonly namespace: FrameworkSchemaTargetNamespace;
  readonly physicalLocator: ScopePhysicalLocator;
}

export class FrameworkSchemaTargetCompositionError extends Data.TaggedError(
  "FrameworkSchemaTargetCompositionError",
)<{
  readonly reason: "invalidInput" | "databaseIdentityConflict";
  readonly message: string;
}> {}

interface TargetState extends FrameworkSchemaTargetSnapshot {
  readonly database: FlarexMetadataDatabase;
}
const targets = new WeakMap<FrameworkSchemaTarget, TargetState>();
const databaseIdentities = new WeakMap<FlarexMetadataDatabase, string>();

/** Source-private trusted composition, not a physical database resolver. Many
 * handles may coexist; the caller owns the borrowed database's lifetime. */
export const makeFrameworkSchemaTarget = Effect.fn(
  "FrameworkSchemaTarget.make",
)(function* (input: FrameworkSchemaTargetInput) {
  const database = input.database;
  const deploymentId = input.deploymentId;
  const identity = input.canonicalPhysicalDatabaseIdentity;
  const physicalLocator = capturePhysicalLocator(input.physicalLocator);
  if (
    !isWeakMapKey(database) ||
    !isBoundedPrivateValueIdentityText(deploymentId) ||
    !isBoundedPrivateValueIdentityText(identity) ||
    physicalLocator === undefined
  ) {
    return yield* Effect.fail(
      new FrameworkSchemaTargetCompositionError({
        reason: "invalidInput",
        message: "Framework schema target input is invalid",
      }),
    );
  }
  const prior = databaseIdentities.get(database);
  if (prior !== undefined && prior !== identity) {
    return yield* Effect.fail(
      new FrameworkSchemaTargetCompositionError({
        reason: "databaseIdentityConflict",
        message: "Framework database identity conflicts with prior binding",
      }),
    );
  }
  const namespace = yield* captureFrameworkSchemaTargetNamespace({
    deploymentId,
    physicalDatabaseIdentity: identity,
    schemaName: physicalLocator.schemaName,
  });
  // Canonical capture can yield. Recheck before issuing either concurrent handle.
  const current = databaseIdentities.get(database);
  if (current !== undefined && current !== identity) {
    return yield* Effect.fail(
      new FrameworkSchemaTargetCompositionError({
        reason: "databaseIdentityConflict",
        message: "Framework database identity conflicts with prior binding",
      }),
    );
  }
  const target: FrameworkSchemaTarget = Object.freeze({
    [targetBrand]: true,
  } satisfies FrameworkSchemaTarget);
  databaseIdentities.set(database, identity);
  targets.set(target, Object.freeze({ database, namespace, physicalLocator }));
  return target;
});

export function frameworkSchemaTargetSnapshot(
  target: FrameworkSchemaTarget,
): FrameworkSchemaTargetSnapshot | undefined {
  const state = targets.get(target);
  return state === undefined
    ? undefined
    : Object.freeze({
        namespace: state.namespace,
        physicalLocator: state.physicalLocator,
      });
}

export function hasFrameworkSchemaTargetDatabase(
  target: FrameworkSchemaTarget,
  database: FlarexMetadataDatabase,
): boolean {
  const state = targets.get(target);
  return state !== undefined && state.database === database;
}

// Preserve the existing capture contract: read each supplied locator field once,
// reject throwing accessors, and retain a detached immutable locator. Identity
// text and namespace canonicalization remain with their authoritative codecs.
function capturePhysicalLocator(
  value: unknown,
): ScopePhysicalLocator | undefined {
  try {
    if (!isNonArrayRecord(value)) return undefined;
    const kind = value.kind;
    const databaseKey = value.databaseKey;
    const schemaName = value.schemaName;
    if (
      !isBoundedPrivateValueIdentityText(databaseKey) ||
      !isBoundedPrivateValueIdentityText(schemaName, 63)
    )
      return undefined;
    switch (kind) {
      case "shared_database":
      case "schema_per_scope":
      case "database_per_scope":
        return Object.freeze({ kind, databaseKey, schemaName });
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

function isWeakMapKey(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}
