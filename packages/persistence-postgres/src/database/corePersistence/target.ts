import { Cause, Effect, Option, Schema } from "effect";
import { CorePersistenceError } from "../../core/contracts";
import type { CoreSqlDriver } from "./driver";
import { CORE_PHYSICAL_STATEMENTS, CORE_PHYSICAL_TEMPLATE_NAMESPACE } from "./layout.generated";
import { decodeCorePersistenceNamespace, invalidPhysicalLayout, verifyCorePhysicalLayout } from "./physicalLayout";
import { fenceCorePhysicalLeases, lockCorePhysicalMaintenance, readCorePhysicalBaseline,
  writeCorePhysicalBaseline, writeCorePhysicalFormat } from "./physicalMaintenance";

export { coreTableName } from "./physicalLayout";

const isDuplicateNamespace = Schema.is(Schema.Struct({ code: Schema.Literals(["42P06"]) }));
export interface CorePersistenceTarget { readonly namespace: string }
export interface CorePersistenceTargetData { readonly namespace: string; readonly driver: CoreSqlDriver }
const targets = new WeakMap<CorePersistenceTarget, CorePersistenceTargetData>();

/** A structural object never grants access to persistence or maintenance. */
export function inspectCorePersistenceTarget(target: CorePersistenceTarget): CorePersistenceTargetData | undefined {
  return targets.get(target);
}
function issueTarget(driver: CoreSqlDriver, namespace: string): CorePersistenceTarget {
  const target = Object.freeze({ namespace });
  targets.set(target, Object.freeze({ namespace, driver }));
  return target;
}

/** Fresh, atomic installation consumes the actual generated Drizzle statements. */
export const installCorePersistence = Effect.fn("CorePersistence.install")(function* (
  driver: CoreSqlDriver, namespaceInput = "flarex_core",
) {
  const namespace = yield* decodeCorePersistenceNamespace(namespaceInput).pipe(Effect.mapError(invalidPhysicalLayout));
  yield* driver.transaction(connection => Effect.gen(function* () {
    for (const statement of CORE_PHYSICAL_STATEMENTS) yield* connection.query(statement.replaceAll(
      `"${CORE_PHYSICAL_TEMPLATE_NAMESPACE}"`, `"${namespace}"`));
    yield* verifyCorePhysicalLayout(connection, namespace);
    yield* writeCorePhysicalFormat(connection, namespace);
    yield* writeCorePhysicalBaseline(connection, namespace, "executed");
  }).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, error =>
    error.reason === "unavailable" && isDuplicateNamespace(error.cause)
      ? new CorePersistenceError({ reason: "invalidTarget", cause: error.cause }) : error)))));
  return issueTarget(driver, namespace);
});

/**
 * Explicit offline maintenance for the actual c554 five-table format.
 * The caller must close and drain every serving/worker owner first and reconstruct
 * them after success. This name documents that precondition; it is not a proof
 * token. Durable lease locking/fencing below invalidates predecessor writers.
 * No caller callback or application execution spans this SQL transaction.
 */
export const adoptCorePersistenceAfterDrain = Effect.fn("CorePersistence.adoptAfterDrain")(function* (
  driver: CoreSqlDriver, namespaceInput = "flarex_core",
) {
  const namespace = yield* decodeCorePersistenceNamespace(namespaceInput).pipe(Effect.mapError(invalidPhysicalLayout));
  yield* driver.transaction(connection => Effect.gen(function* () {
    yield* verifyCorePhysicalLayout(connection, namespace);
    const leases = yield* lockCorePhysicalMaintenance(connection, namespace);
    const baseline = yield* readCorePhysicalBaseline(connection, namespace, true);
    // A successful replay verifies the catalog/checksums without revoking a new owner.
    if (Option.isSome(baseline)) return;
    yield* fenceCorePhysicalLeases(connection, namespace, leases);
    yield* writeCorePhysicalBaseline(connection, namespace, "adopted");
  }));
  return issueTarget(driver, namespace);
});

/** Serving loads are SELECT-only and never install/adopt missing platform metadata. */
export const loadCorePersistenceTarget = Effect.fn("CorePersistence.loadTarget")(function* (
  driver: CoreSqlDriver, namespaceInput = "flarex_core",
) {
  const namespace = yield* decodeCorePersistenceNamespace(namespaceInput).pipe(Effect.mapError(invalidPhysicalLayout));
  yield* verifyCorePhysicalLayout(driver, namespace);
  const baseline = yield* readCorePhysicalBaseline(driver, namespace);
  if (Option.isNone(baseline)) return yield* invalidPhysicalLayout("Explicit physical maintenance is required before serving");
  return issueTarget(driver, namespace);
});
