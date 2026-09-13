import { MAX_FRAMEWORK_BINDING_GRAPH_ROOTS } from "../../migrationCoordination/graphLimits";
import { and, eq, getTableColumns, inArray, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { Effect, Encoding, Schema } from "effect";
import type { FlarexMetadataTransaction } from "../../metadataTransaction";
import { detachDriverRows } from "../../detachDriverRows";
import { runDrizzleStatementEffect } from "../../drizzleStatementEffect";
import { FrameworkMigrationRepositoryError } from "../../migrationCoordination/repositoryErrors";
import { verifyStoredFrameworkMigrationValue } from "../../migrationCoordination/canonical";
import { isStoredFreshRelationalMigrationPlanFrame } from "../../migrationCoordination/storedValidation";
import { fxSystemFrameworkMigrationPlanBases as bases } from "../../migrationCoordination/baseSchema";
import {
  fxSystemFrameworkSchemaTargetNamespaces as namespaces,
  fxSystemFrameworkMigrationCollisionDomains as collisions,
  fxSystemFrameworkMigrationPlans as plans,
  fxSystemFrameworkMigrationPlanSteps as steps,
  fxSystemFrameworkMigrationPlanStepDependencies as stepDependencies,
  fxSystemFrameworkMigrationPlanAdmissions as admissions,
  fxSystemFrameworkMigrationAdmissionAssignments as admissionAssignments,
  fxSystemFrameworkMigrationAttemptStarts as attempts,
  fxSystemFrameworkMigrationAttemptTerminals as terminals,
  fxSystemFrameworkMigrationStepReceipts as receipts,
  fxSystemFrameworkMigrationStepReceiptDependencies as receiptDependencies,
  fxSystemRelationalPhysicalNameAssignments as names,
} from "../../migrationCoordination/schema";
import {
  fxSystemFrameworkSchemaInstallations as installations,
  fxSystemFrameworkSchemaReadiness as readiness,
  fxSystemFrameworkSchemaAvailabilityHistory as history,
} from "./schema";
import type { RestoredFrameworkSchemaAvailabilityHead } from "./storedMetadataRestoration";


const MAX_NAMES = 4096;
const MAX_ROWS = 32768;
const ROOT_KINDS = ["installation", "plan", "admission", "attempt", "terminal", "readiness", "history"] as const;
type RootKind = typeof ROOT_KINDS[number];
interface Root { readonly kind: RootKind; readonly id: bigint }
export interface InstallationEvidenceCoordinates {
  readonly roots: Readonly<Record<RootKind, readonly bigint[]>>;
  readonly namespace: bigint;
  readonly collision: bigint;
  readonly receiptPlans: readonly bigint[];
  readonly physicalDatabaseIdentity: string;
  readonly schemaName: string;
  readonly names: readonly string[];
}

export const installationEvidenceDigest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const InstallationEvidenceSchema = Schema.Struct({
  namespace: installationEvidenceDigest,
  collision: installationEvidenceDigest,
  installation: installationEvidenceDigest,
  plan: installationEvidenceDigest,
  steps: installationEvidenceDigest,
  stepDependencies: installationEvidenceDigest,
  base: installationEvidenceDigest,
  admission: installationEvidenceDigest,
  admissionAssignments: installationEvidenceDigest,
  attempt: installationEvidenceDigest,
  terminal: installationEvidenceDigest,
  receipts: installationEvidenceDigest,
  receiptDependencies: installationEvidenceDigest,
  readiness: installationEvidenceDigest,
  history: installationEvidenceDigest,
  names: installationEvidenceDigest,
});
export type InstallationEvidence = typeof InstallationEvidenceSchema.Type;
const decodeInstallationEvidence = Schema.decodeUnknownEffect(InstallationEvidenceSchema, { onExcessProperty: "error" });

const corruption = () => FrameworkMigrationRepositoryError.storedCorruption("readInstallation");
const resource = (cause: unknown) => FrameworkMigrationRepositoryError.resourceFailure("readInstallation", cause);
const read = <Value>(query: PromiseLike<Value>) => runDrizzleStatementEffect(query, resource);

/** Run only after full restoration, in that SAME repeatable-read preparation
 * transaction. Pinned roots select dependencies, not authority. Changed references
 * subsequently change their parent fingerprint before prepared data is accepted. */
export const collectInstallationEvidence = Effect.fn("InstallationRuntime.collectEvidence")(function* (
  tx: FlarexMetadataTransaction, restored: RestoredFrameworkSchemaAvailabilityHead,
) {
  const roots = {
    installation: new Set<bigint>(), plan: new Set<bigint>(), admission: new Set<bigint>(), attempt: new Set<bigint>(),
    terminal: new Set<bigint>(), readiness: new Set<bigint>(), history: new Set<bigint>(),
  } satisfies Record<RootKind, Set<bigint>>;
  const pending: Root[] = [];
  const add = (kind: RootKind, id: bigint | null) => {
    if (id !== null && !roots[kind].has(id)) { roots[kind].add(id); pending.push({ kind, id }); }
  };
  add("installation", restored.installation.storageId);
  add("readiness", restored.readiness.storageId);
  add("history", restored.history.storageId);
  const spellings = new Set<string>();
  const receiptPlans = new Set<bigint>();
  for (let index = 0; index < pending.length; index++) {
    if (pending.length > MAX_FRAMEWORK_BINDING_GRAPH_ROOTS) return yield* Effect.fail(resource("Installation evidence root budget exceeded"));
    const node = pending[index];
    if (node === undefined) return yield* Effect.die(new Error("Missing queued installation evidence root"));
    switch (node.kind) {
      case "installation": {
        const row = (yield* read(tx.select().from(installations).where(eq(installations.installationStorageId, node.id)).limit(1)))[0];
        if (row === undefined) return yield* Effect.fail(corruption());
        add("plan", row.planStorageId); add("admission", row.admissionStorageId); add("terminal", row.terminalStorageId);
        break;
      }
      case "plan": {
        const row = (yield* read(tx.select().from(plans).where(eq(plans.planStorageId, node.id)).limit(1)))[0];
        if (row === undefined) return yield* Effect.fail(corruption());
        const frame = yield* verifyStoredFrameworkMigrationValue({ kind: "plan", canonicalBytes: row.canonicalBytes,
          sha256Hex: Encoding.encodeHex(row.migrationPlanSha256) });
        if (!isStoredFreshRelationalMigrationPlanFrame(frame)) return yield* Effect.fail(corruption());
        // This runtime serves the existing fresh Commerce installation contract.
        // Additive plans also inspect collision-wide admission/attempt budgets;
        // their acceptance needs a separate inventory before it can be prepared.
        if (frame.version !== 1) return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal("readInstallation"));
        for (const assignment of frame.physicalLayout.nameAssignments) spellings.add(assignment.spelling);
        if (spellings.size > MAX_NAMES) return yield* Effect.fail(resource("Installation evidence name budget exceeded"));
        const baseRows = yield* read(tx.select().from(bases).where(eq(bases.planStorageId, node.id)).limit(2));
        for (const base of baseRows) { add("installation", base.installationStorageId); add("readiness", base.readinessStorageId); }
        break;
      }
      case "admission": {
        const row = (yield* read(tx.select().from(admissions).where(eq(admissions.admissionStorageId, node.id)).limit(1)))[0];
        if (row === undefined) return yield* Effect.fail(corruption());
        add("plan", row.planStorageId); add("plan", row.previousPlanStorageId);
        break;
      }
      case "attempt": {
        const row = (yield* read(tx.select().from(attempts).where(eq(attempts.attemptStorageId, node.id)).limit(1)))[0];
        if (row === undefined) return yield* Effect.fail(corruption());
        add("admission", row.admissionStorageId); add("plan", row.planStorageId); add("attempt", row.previousAttemptStorageId);
        break;
      }
      case "terminal": {
        const row = (yield* read(tx.select().from(terminals).where(eq(terminals.terminalStorageId, node.id)).limit(1)))[0];
        if (row === undefined) return yield* Effect.fail(corruption());
        add("attempt", row.attemptStorageId); receiptPlans.add(row.planStorageId);
        break;
      }
      case "readiness": {
        const row = (yield* read(tx.select().from(readiness).where(eq(readiness.readinessStorageId, node.id)).limit(1)))[0];
        if (row === undefined) return yield* Effect.fail(corruption());
        add("installation", row.installationStorageId);
        break;
      }
      case "history": {
        const row = (yield* read(tx.select().from(history).where(eq(history.availabilityHistoryStorageId, node.id)).limit(1)))[0];
        if (row === undefined) return yield* Effect.fail(corruption());
        add("history", row.previousHistoryStorageId); add("readiness", row.readinessStorageId); add("installation", row.installationStorageId);
        break;
      }
    }
  }
  const coordinate = restored.installation.collision;
  return Object.freeze({
    roots: Object.freeze({ installation: Object.freeze([...roots.installation]), plan: Object.freeze([...roots.plan]),
      admission: Object.freeze([...roots.admission]), attempt: Object.freeze([...roots.attempt]), terminal: Object.freeze([...roots.terminal]),
      readiness: Object.freeze([...roots.readiness]), history: Object.freeze([...roots.history]) }),
    namespace: coordinate.targetNamespace.storageId, collision: coordinate.storageId,
    physicalDatabaseIdentity: coordinate.coordinate.targetNamespace.physicalDatabaseIdentity,
    schemaName: coordinate.coordinate.targetNamespace.schemaName,
    names: Object.freeze([...spellings]), receiptPlans: Object.freeze([...receiptPlans]),
  }) satisfies InstallationEvidenceCoordinates;
});

/** This fixed metadata-table inventory includes every column. Canonical bytes are
 * freshly hashed in PostgreSQL BEFORE JSON conversion, avoiding megabytes of hex
 * transport. Other bytea columns are encoded explicitly and timestamps use epoch
 * values so session bytea/date/time-zone formatting cannot change a verdict. */
export function installationEvidenceRowDigest(table: PgTable): SQL<string> {
  const members = Object.values(getTableColumns(table)).map(column =>
    column.name === "canonical_bytes" ? sql`encode(sha256(${column}), 'hex')` :
      column.getSQLType() === "bytea" ? sql`encode(${column}, 'hex')` :
        column.dataType === "date" ? sql`extract(epoch from ${column})::text` : sql`${column}`);
  return sql<string>`encode(sha256(convert_to(jsonb_build_array(${sql.join(members, sql`, `)})::text, 'UTF8')), 'hex')`;
}

function aggregate(query: SQLWrapper): SQL<string> {
  // Fixed-length row digests plus sorted multiset aggregation preserve membership
  // and multiplicity. Section identity is the typed selection key, not a stored hash.
  return sql<string>`(select case when count(*) > ${MAX_ROWS} then null else encode(sha256(convert_to(coalesce(string_agg(evidence_row.digest, '' order by evidence_row.digest collate "C"), ''), 'UTF8')), 'hex') end from (${query}) evidence_row)`;
}

export const readInstallationEvidence = Effect.fn("InstallationRuntime.readEvidence")(function* (
  tx: FlarexMetadataTransaction, coordinates: InstallationEvidenceCoordinates,
) {
  const { roots } = coordinates;
  const section = (table: PgTable, predicate: SQL | undefined) => aggregate(tx.select({ digest: installationEvidenceRowDigest(table).as("digest") })
    .from(table).where(predicate).limit(MAX_ROWS + 1));
  const selectedReceipts = tx.select({ id: receipts.receiptStorageId }).from(receipts)
    .where(inArray(receipts.planStorageId, [...coordinates.receiptPlans]));
  const query = tx.select({
    namespace: section(namespaces, eq(namespaces.targetNamespaceStorageId, coordinates.namespace)),
    collision: section(collisions, eq(collisions.collisionStorageId, coordinates.collision)),
    installation: section(installations, inArray(installations.installationStorageId, [...roots.installation])),
    plan: section(plans, inArray(plans.planStorageId, [...roots.plan])),
    steps: section(steps, inArray(steps.planStorageId, [...roots.plan])),
    stepDependencies: section(stepDependencies, inArray(stepDependencies.planStorageId, [...roots.plan])),
    base: section(bases, inArray(bases.planStorageId, [...roots.plan])),
    admission: section(admissions, inArray(admissions.admissionStorageId, [...roots.admission])),
    admissionAssignments: section(admissionAssignments, inArray(admissionAssignments.admissionStorageId, [...roots.admission])),
    attempt: section(attempts, inArray(attempts.attemptStorageId, [...roots.attempt])),
    terminal: section(terminals, inArray(terminals.terminalStorageId, [...roots.terminal])),
    receipts: section(receipts, inArray(receipts.planStorageId, [...coordinates.receiptPlans])),
    receiptDependencies: section(receiptDependencies, inArray(receiptDependencies.receiptStorageId, selectedReceipts)),
    readiness: section(readiness, inArray(readiness.readinessStorageId, [...roots.readiness])),
    history: section(history, inArray(history.availabilityHistoryStorageId, [...roots.history])),
    names: section(names, and(eq(names.physicalDatabaseIdentity, coordinates.physicalDatabaseIdentity),
      eq(names.schemaName, coordinates.schemaName), inArray(names.spelling, [...coordinates.names]))),
  }).from(sql`(values (1)) as installation_evidence(only_row)`);
  const rows = yield* read(query).pipe(Effect.map(detachDriverRows));
  const value = rows[0];
  if (rows.length !== 1) {
    return yield* Effect.fail(corruption());
  }
  return Object.freeze(yield* decodeInstallationEvidence(value).pipe(Effect.mapError(corruption)));
});

export function installationEvidenceMatches(left: InstallationEvidence, right: InstallationEvidence): boolean {
  return Object.keys(InstallationEvidenceSchema.fields).every(key => Reflect.get(left, key) === Reflect.get(right, key));
}
