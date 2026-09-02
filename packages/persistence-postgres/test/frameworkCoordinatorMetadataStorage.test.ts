import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as persistenceRoot from "../src";
import {
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import { flarexSchema } from "../src/schema";
import {
  expectFrameworkCoordinatorMetadataStorageCatalog,
} from "./frameworkCoordinatorMetadataStorageTestSupport";

const TARGET_NAMESPACE_TABLE =
  "fx_system_framework_schema_target_namespace";
const COLLISION_DOMAIN_TABLE =
  "fx_system_framework_migration_collision_domain";
const PHYSICAL_ASSIGNMENT_TABLE =
  "fx_system_relational_physical_name_assignment";
const MIGRATION_PLAN_TABLE = "fx_system_framework_migration_plan";
const MIGRATION_PLAN_STEP_TABLE = "fx_system_framework_migration_plan_step";
const MIGRATION_ADMISSION_TABLE =
  "fx_system_framework_migration_plan_admission";
const MIGRATION_ATTEMPT_TABLE = "fx_system_framework_migration_attempt_start";
const MIGRATION_TERMINAL_TABLE =
  "fx_system_framework_migration_attempt_terminal";
const MIGRATION_EVENT_TABLE = "fx_system_framework_migration_event";
const MIGRATION_COLLISION_HEAD_TABLE =
  "fx_system_framework_migration_collision_head";
const SCHEMA_INSTALLATION_TABLE =
  "fx_system_framework_schema_installation";
const SCHEMA_READINESS_TABLE = "fx_system_framework_schema_readiness";
const SCHEMA_AVAILABILITY_HISTORY_TABLE =
  "fx_system_framework_schema_availability_history";

const TUPLE_PLAN_SHA256 = "51".repeat(32);
const TUPLE_REQUIRED_STEP_SET_SHA256 = "52".repeat(32);
const TUPLE_STEP_ID = `step_${"0".repeat(32)}`;
const TUPLE_STEP_SHA256 = "54".repeat(32);
const TUPLE_PRECONDITION_SHA256 = "55".repeat(32);
const TUPLE_POSTCONDITION_SHA256 = "56".repeat(32);
const TUPLE_ADMISSION_SHA256 = "57".repeat(32);
const TUPLE_ATTEMPT_ID = "attempt_tuple_checks";
const TUPLE_ATTEMPT_FENCE = "1";

interface TargetNamespaceInsert {
  readonly deploymentId: string;
  readonly physicalDatabaseIdentity?: string;
  readonly schemaName?: string;
  readonly digestHex?: string;
  readonly frameFormat?: string;
  readonly frameVersion?: number;
  readonly canonicalHex?: string;
  readonly canonicalByteLength?: number;
}

interface CollisionDomainInsert {
  readonly targetNamespaceStorageId: string;
  readonly physicalDatabaseIdentity?: string;
  readonly schemaName?: string;
  readonly owner?: string;
  readonly lineageId: string;
}

interface PhysicalAssignmentInsert {
  readonly collisionStorageId: string;
  readonly physicalDatabaseIdentity?: string;
  readonly schemaName?: string;
  readonly spelling: string;
  readonly nameDigestHex: string;
  readonly assignmentDigestHex: string;
}

interface TupleCheckAuthority {
  readonly collisionStorageId: string;
  readonly planStorageId: string;
  readonly admissionStorageId: string;
  readonly attemptStorageId: string;
}

interface AttemptTerminalInsert {
  readonly outcomeKind: "succeeded" | "failed" | "decisionUncertain";
  readonly requiredStepSetDigestHex: string | null;
  readonly failureReason:
    | "operationFailed"
    | "validationFailed"
    | "leaseLost"
    | "superseded"
    | null;
  readonly evidenceDigestHex: string | null;
  readonly lastReceiptStorageId: string | null;
  readonly lastStepReceiptDigestHex: string | null;
  readonly terminalDigestHex: string;
}

describe("framework coordinator metadata storage - PGlite", () => {
  it("keeps every coordinator declaration outside public schema surfaces", async () => {
    type RootLeak = Extract<
      keyof typeof persistenceRoot,
      | "fxSystemFrameworkSchemaTargetNamespaces"
      | "fxSystemFrameworkMigrationPlans"
      | "fxSystemFrameworkSchemaInstallations"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    for (const exportName of [
      "fxSystemFrameworkSchemaTargetNamespaces",
      "fxSystemFrameworkMigrationPlans",
      "fxSystemFrameworkSchemaInstallations",
    ]) {
      expect(exportName in persistenceRoot).toBe(false);
      expect(exportName in flarexSchema).toBe(false);
    }

    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    const exportTargets = Object.values(packageJson.default.exports);
    expect(exportTargets).not.toContain(
      "./src/migrationCoordination/schema.ts",
    );
    expect(exportTargets).not.toContain(
      "./src/frameworkSchema/installation/schema.ts",
    );
    expect(exportTargets).not.toContain(
      "./src/frameworkSchema/privateMetadataSchemaSupport.ts",
    );
  });

  it("rejects incomplete nullable tuples instead of accepting SQL unknown", async () => {
    const testRoot = await mkdtemp(resolve(
      tmpdir(),
      "flarex-framework-coordinator-tuples-",
    ));
    const db = new PGlite(resolve(testRoot, "database"));

    try {
      const persistence = await createPGlitePersistence({ db });
      await persistence.migrate();
      const authority = await insertTupleCheckAuthority(persistence);

      await expectSqlFailure(insertAttemptTerminal(persistence, authority, {
        outcomeKind: "failed",
        requiredStepSetDigestHex: null,
        failureReason: null,
        evidenceDigestHex: "5b".repeat(32),
        lastReceiptStorageId: null,
        lastStepReceiptDigestHex: null,
        terminalDigestHex: "59".repeat(32),
      }), "23514", "fx_framework_migration_terminal_identity_check");
      await expectSqlFailure(insertAttemptTerminal(persistence, authority, {
        outcomeKind: "succeeded",
        requiredStepSetDigestHex: TUPLE_REQUIRED_STEP_SET_SHA256,
        failureReason: null,
        evidenceDigestHex: null,
        lastReceiptStorageId: null,
        lastStepReceiptDigestHex: null,
        terminalDigestHex: "5a".repeat(32),
      }), "23514", "fx_framework_migration_terminal_identity_check");

      await expectSqlFailure(persistence.query(`
        insert into ${MIGRATION_EVENT_TABLE}
          (collision_storage_id, event_sequence, event_sha256, event_kind,
           subject_sha256, lease_attempt_id, lease_attempt_fence,
           lease_owner_id, lease_expires_at, frame_format, frame_version,
           canonical_byte_length, canonical_bytes)
        values
          ($1, 0, decode(repeat('5c', 32), 'hex'), 'leaseRenewed', null,
           '${TUPLE_ATTEMPT_ID}', null, 'lease_owner_tuple_checks',
           '2030-01-02T03:04:05.123Z', 'flarex.framework-migration-event',
           1, 2, decode('7b7d', 'hex'))
      `, [authority.collisionStorageId]), "23514",
      "fx_framework_migration_event_identity_check");

      await expectSqlFailure(persistence.query(`
        insert into ${MIGRATION_COLLISION_HEAD_TABLE}
          (collision_storage_id, current_plan_storage_id, current_plan_sha256,
           current_admission_storage_id, current_admission_sha256,
           head_revision, attempt_fence, current_attempt_storage_id,
           current_attempt_id, current_attempt_fence, current_lease_owner_id,
           current_lease_expires_at, collision_head_sha256, frame_format,
           frame_version, canonical_byte_length, canonical_bytes)
        values
          ($1, $2, decode($3, 'hex'), $4, decode($5, 'hex'), 0, 1, $6,
           '${TUPLE_ATTEMPT_ID}', null, 'lease_owner_tuple_checks',
           '2030-01-02T03:04:05.123Z', decode(repeat('5d', 32), 'hex'),
           'flarex.framework-migration-collision-head', 1, 2,
           decode('7b7d', 'hex'))
      `, [
        authority.collisionStorageId,
        authority.planStorageId,
        TUPLE_PLAN_SHA256,
        authority.admissionStorageId,
        TUPLE_ADMISSION_SHA256,
        authority.attemptStorageId,
      ]), "23514", "fx_framework_migration_collision_head_identity_check");

      await expectSqlFailure(persistence.query(`
        insert into ${MIGRATION_COLLISION_HEAD_TABLE}
          (collision_storage_id, current_plan_storage_id, current_plan_sha256,
           current_admission_storage_id, current_admission_sha256,
           head_revision, attempt_fence, last_event_storage_id,
           last_event_sequence, last_event_sha256, collision_head_sha256,
           frame_format, frame_version, canonical_byte_length, canonical_bytes)
        values
          ($1, $2, decode($3, 'hex'), $4, decode($5, 'hex'), 0, 1, 999,
           null, decode(repeat('5e', 32), 'hex'),
           decode(repeat('5f', 32), 'hex'),
           'flarex.framework-migration-collision-head', 1, 2,
           decode('7b7d', 'hex'))
      `, [
        authority.collisionStorageId,
        authority.planStorageId,
        TUPLE_PLAN_SHA256,
        authority.admissionStorageId,
        TUPLE_ADMISSION_SHA256,
      ]), "23514", "fx_framework_migration_collision_head_identity_check");

      const receiptStorageId = await insertTupleCheckReceipt(
        persistence,
        authority,
      );
      const terminalStorageId = await insertAttemptTerminal(
        persistence,
        authority,
        {
          outcomeKind: "succeeded",
          requiredStepSetDigestHex: TUPLE_REQUIRED_STEP_SET_SHA256,
          failureReason: null,
          evidenceDigestHex: null,
          lastReceiptStorageId: receiptStorageId,
          lastStepReceiptDigestHex: "60".repeat(32),
          terminalDigestHex: "61".repeat(32),
        },
      );
      const installationStorageId = await insertTupleCheckInstallation(
        persistence,
        authority,
        terminalStorageId,
      );
      const readinessStorageId = await insertTupleCheckReadiness(
        persistence,
        installationStorageId,
      );

      await expectSqlFailure(persistence.query(`
        insert into ${SCHEMA_AVAILABILITY_HISTORY_TABLE}
          (installation_storage_id, readiness_storage_id, readiness_sha256,
           availability_sequence, status, reason_sha256, history_sha256,
           previous_history_storage_id, previous_availability_sequence,
           previous_history_sha256, previous_status, frame_format,
           frame_version, canonical_byte_length, canonical_bytes)
        values
          ($1, $2, decode(repeat('65', 32), 'hex'), 2, 'withdrawn',
           decode(repeat('67', 32), 'hex'), decode(repeat('68', 32), 'hex'),
           999, null, decode(repeat('69', 32), 'hex'), 'ready',
           'flarex.framework-schema-availability-history', 1, 2,
           decode('7b7d', 'hex'))
      `, [installationStorageId, readinessStorageId]), "23514",
      "fx_framework_availability_history_identity_check");
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  }, 120_000);

  it("installs and enforces the private target and collision roots", async () => {
    const testRoot = await mkdtemp(resolve(
      tmpdir(),
      "flarex-framework-coordinator-storage-",
    ));
    const dataDirectory = resolve(testRoot, "database");
    let db: PGlite | undefined = new PGlite(dataDirectory);

    try {
      let persistence = await createPGlitePersistence({ db });
      await expect(persistence.migrate()).resolves.toBeUndefined();
      await expect(persistence.migrate()).resolves.toBeUndefined();
      await expectFrameworkCoordinatorMetadataStorageCatalog(
        persistence,
        "public",
      );

      await expectSqlFailure(persistence.query(`
        insert into ${TARGET_NAMESPACE_TABLE}
          (target_namespace_storage_id, deployment_id,
           physical_database_identity, schema_name, target_namespace_sha256,
           frame_format, frame_version, canonical_byte_length, canonical_bytes)
        values
          (999, 'deployment_caller_identity', 'database_primary', 'public',
           decode(repeat('01', 32), 'hex'),
           'flarex.framework-schema-target-namespace', 1, 2,
           decode('7b7d', 'hex'))
      `), "428C9");
      await expectSqlFailure(insertTargetNamespace(persistence, {
        deploymentId: "deployment_invalid_digest",
        digestHex: "01",
      }), "23514", "fx_framework_target_namespace_identity_check");
      await expectSqlFailure(insertTargetNamespace(persistence, {
        deploymentId: "deployment_invalid_format",
        digestHex: "02".repeat(32),
        frameFormat: "other.framework-target",
      }), "23514", "fx_framework_target_namespace_frame_check");
      await expectSqlFailure(insertTargetNamespace(persistence, {
        deploymentId: "deployment_invalid_version",
        digestHex: "03".repeat(32),
        frameVersion: 2,
      }), "23514", "fx_framework_target_namespace_frame_check");
      await expectSqlFailure(insertTargetNamespace(persistence, {
        deploymentId: "deployment_invalid_length",
        digestHex: "04".repeat(32),
        canonicalByteLength: 1,
      }), "23514", "fx_framework_target_namespace_frame_check");

      const targetNamespaceStorageId = await insertTargetNamespace(
        persistence,
        {
          deploymentId: "deployment_framework_coordinator",
          digestHex: "10".repeat(32),
        },
      );
      await expectSqlFailure(insertCollisionDomain(persistence, {
        targetNamespaceStorageId,
        owner: "payload",
        lineageId: "invalid_owner",
      }), "23514", "fx_framework_migration_collision_identity_check");
      await expectSqlFailure(insertCollisionDomain(persistence, {
        targetNamespaceStorageId,
        physicalDatabaseIdentity: "database_other",
        lineageId: "wrong_target_coordinate",
      }), "23503", "fx_framework_migration_collision_target_fk");

      const collisionStorageId = await insertCollisionDomain(persistence, {
        targetNamespaceStorageId,
        lineageId: "system_catalog",
      });
      await expectSqlFailure(insertPhysicalAssignment(persistence, {
        collisionStorageId,
        spelling: "invalid_physical_name",
        nameDigestHex: "20".repeat(32),
        assignmentDigestHex: "21".repeat(32),
      }), "23514", "fx_relational_name_assignment_identity_check");

      const spelling = `fxrt_${"0".repeat(52)}`;
      await insertPhysicalAssignment(persistence, {
        collisionStorageId,
        spelling,
        nameDigestHex: "30".repeat(32),
        assignmentDigestHex: "31".repeat(32),
      });
      const secondCollisionStorageId = await insertCollisionDomain(
        persistence,
        {
          targetNamespaceStorageId,
          owner: "medusa",
          lineageId: "commerce_catalog",
        },
      );
      await expectSqlFailure(insertPhysicalAssignment(persistence, {
        collisionStorageId: secondCollisionStorageId,
        spelling,
        nameDigestHex: "40".repeat(32),
        assignmentDigestHex: "41".repeat(32),
      }), "23505", "fx_relational_name_assignment_spelling_unique");
      await expectSqlFailure(persistence.query(
        `delete from ${COLLISION_DOMAIN_TABLE}
          where collision_storage_id = $1`,
        [collisionStorageId],
      ), "23503", "fx_relational_name_assignment_collision_fk");
      await expectSqlFailure(persistence.query(
        `delete from ${TARGET_NAMESPACE_TABLE}
          where target_namespace_storage_id = $1`,
        [targetNamespaceStorageId],
      ), "23503", "fx_framework_migration_collision_target_fk");

      const beforeClose = await storedRootCounts(persistence);
      expect(beforeClose).toEqual({
        targetNamespaces: "1",
        collisionDomains: "2",
        physicalAssignments: "1",
      });
      await db.close();
      db = undefined;

      db = new PGlite(dataDirectory);
      persistence = await createPGlitePersistence({ db });
      await expect(persistence.migrate()).resolves.toBeUndefined();
      expect(await storedRootCounts(persistence)).toEqual(beforeClose);
      await expectFrameworkCoordinatorMetadataStorageCatalog(
        persistence,
        "public",
      );
    } finally {
      try {
        await db?.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  }, 120_000);
});

async function expectSqlFailure(
  operation: Promise<unknown>,
  code: string,
  constraint?: string,
): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code });
  if (constraint !== undefined) {
    await expect(operation).rejects.toThrow(constraint);
  }
}

async function insertTargetNamespace(
  persistence: PGliteFlarexPersistence,
  input: TargetNamespaceInsert,
): Promise<string> {
  const canonicalHex = input.canonicalHex ?? "7b7d";
  const result = await persistence.query<{ storage_id: string }>(`
    insert into ${TARGET_NAMESPACE_TABLE}
      (deployment_id, physical_database_identity, schema_name,
       target_namespace_sha256, frame_format, frame_version,
       canonical_byte_length, canonical_bytes)
    values ($1, $2, $3, decode($4, 'hex'), $5, $6, $7, decode($8, 'hex'))
    returning target_namespace_storage_id::text as storage_id
  `, [
    input.deploymentId,
    input.physicalDatabaseIdentity ?? "database_primary",
    input.schemaName ?? "public",
    input.digestHex ?? "aa".repeat(32),
    input.frameFormat ?? "flarex.framework-schema-target-namespace",
    input.frameVersion ?? 1,
    input.canonicalByteLength ?? canonicalHex.length / 2,
    canonicalHex,
  ]);
  const storageId = result.rows[0]?.storage_id;
  if (storageId === undefined) {
    throw new Error("Target namespace insert returned no storage identity.");
  }
  return storageId;
}

async function insertCollisionDomain(
  persistence: PGliteFlarexPersistence,
  input: CollisionDomainInsert,
): Promise<string> {
  const result = await persistence.query<{ storage_id: string }>(`
    insert into ${COLLISION_DOMAIN_TABLE}
      (target_namespace_storage_id, physical_database_identity, schema_name,
       owner, lineage_id, physical_namespace_profile)
    values ($1, $2, $3, $4, $5,
      'relational-postgres-scope-isolated-stable-names')
    returning collision_storage_id::text as storage_id
  `, [
    input.targetNamespaceStorageId,
    input.physicalDatabaseIdentity ?? "database_primary",
    input.schemaName ?? "public",
    input.owner ?? "system",
    input.lineageId,
  ]);
  const storageId = result.rows[0]?.storage_id;
  if (storageId === undefined) {
    throw new Error("Collision domain insert returned no storage identity.");
  }
  return storageId;
}

async function insertPhysicalAssignment(
  persistence: PGliteFlarexPersistence,
  input: PhysicalAssignmentInsert,
): Promise<string> {
  const result = await persistence.query<{ storage_id: string }>(`
    insert into ${PHYSICAL_ASSIGNMENT_TABLE}
      (collision_storage_id, physical_database_identity, schema_name,
       spelling, name_sha256, assignment_sha256, frame_format, frame_version,
       canonical_byte_length, canonical_bytes)
    values ($1, $2, $3, $4, decode($5, 'hex'), decode($6, 'hex'),
      'flarex.relational-physical-name-assignment', 1, 2,
      decode('7b7d', 'hex'))
    returning assignment_storage_id::text as storage_id
  `, [
    input.collisionStorageId,
    input.physicalDatabaseIdentity ?? "database_primary",
    input.schemaName ?? "public",
    input.spelling,
    input.nameDigestHex,
    input.assignmentDigestHex,
  ]);
  const storageId = result.rows[0]?.storage_id;
  if (storageId === undefined) {
    throw new Error("Physical assignment insert returned no storage identity.");
  }
  return storageId;
}

async function insertTupleCheckAuthority(
  persistence: PGliteFlarexPersistence,
): Promise<TupleCheckAuthority> {
  const result = await persistence.query<{
    collision_storage_id: string;
    plan_storage_id: string;
    admission_storage_id: string;
    attempt_storage_id: string;
  }>(`
    with target_namespace as (
      insert into ${TARGET_NAMESPACE_TABLE}
        (deployment_id, physical_database_identity, schema_name,
         target_namespace_sha256, frame_format, frame_version,
         canonical_byte_length, canonical_bytes)
      values
        ('deployment_tuple_checks', 'database_primary', 'public',
         decode(repeat('4f', 32), 'hex'),
         'flarex.framework-schema-target-namespace', 1, 2,
         decode('7b7d', 'hex'))
      returning target_namespace_storage_id
    ), collision_domain as (
      insert into ${COLLISION_DOMAIN_TABLE}
        (target_namespace_storage_id, physical_database_identity, schema_name,
         owner, lineage_id, physical_namespace_profile)
      select target_namespace_storage_id, 'database_primary', 'public',
        'system', 'tuple_checks',
        'relational-postgres-scope-isolated-stable-names'
      from target_namespace
      returning collision_storage_id
    ), migration_plan as (
      insert into ${MIGRATION_PLAN_TABLE}
        (collision_storage_id, artifact_sha256, locator_kind,
         locator_database_key, locator_schema_name, migration_plan_sha256,
         required_step_set_sha256, physical_layout_sha256, frame_format,
         frame_version, canonical_byte_length, canonical_bytes)
      select collision_storage_id, decode(repeat('50', 32), 'hex'),
        'shared_database', 'database_primary', 'public', decode($1, 'hex'),
        decode($2, 'hex'), decode(repeat('53', 32), 'hex'),
        'flarex.framework-migration-plan', 1, 2, decode('7b7d', 'hex')
      from collision_domain
      returning plan_storage_id, collision_storage_id
    ), plan_step as (
      insert into ${MIGRATION_PLAN_STEP_TABLE}
        (plan_storage_id, collision_storage_id, step_ordinal, step_id,
         step_sha256, precondition_sha256, postcondition_sha256, phase,
         operation_format, operation_version, dependency_count)
      select plan_storage_id, collision_storage_id, 0, $3,
        decode($4, 'hex'), decode($5, 'hex'), decode($6, 'hex'), 'expansion',
        'flarex.relational-create-table', 1, 0
      from migration_plan
      returning plan_storage_id
    ), admission as (
      insert into ${MIGRATION_ADMISSION_TABLE}
        (collision_storage_id, plan_storage_id, migration_plan_sha256,
         admission_sha256, admission_profile, assignment_count, frame_format,
         frame_version, canonical_byte_length, canonical_bytes)
      select collision_storage_id, plan_storage_id, decode($1, 'hex'),
        decode($7, 'hex'), 'synthetic-system-fresh', 0,
        'flarex.framework-migration-plan-admission', 1, 2,
        decode('7b7d', 'hex')
      from migration_plan
      returning admission_storage_id, collision_storage_id, plan_storage_id
    ), attempt_start as (
      insert into ${MIGRATION_ATTEMPT_TABLE}
        (collision_storage_id, plan_storage_id, migration_plan_sha256,
         admission_storage_id, admission_sha256, attempt_id, attempt_fence,
         lease_owner_id, lease_expires_at, attempt_start_sha256, frame_format,
         frame_version, canonical_byte_length, canonical_bytes)
      select admission.collision_storage_id, admission.plan_storage_id,
        decode($1, 'hex'), admission.admission_storage_id, decode($7, 'hex'),
        $8, $9, 'lease_owner_tuple_checks', '2030-01-02T03:04:05.123Z',
        decode(repeat('58', 32), 'hex'),
        'flarex.framework-migration-attempt-start', 1, 2,
        decode('7b7d', 'hex')
      from admission
      returning attempt_storage_id
    )
    select collision_domain.collision_storage_id::text,
      migration_plan.plan_storage_id::text,
      admission.admission_storage_id::text,
      attempt_start.attempt_storage_id::text
    from collision_domain
    cross join migration_plan
    cross join plan_step
    cross join admission
    cross join attempt_start
  `, [
    TUPLE_PLAN_SHA256,
    TUPLE_REQUIRED_STEP_SET_SHA256,
    TUPLE_STEP_ID,
    TUPLE_STEP_SHA256,
    TUPLE_PRECONDITION_SHA256,
    TUPLE_POSTCONDITION_SHA256,
    TUPLE_ADMISSION_SHA256,
    TUPLE_ATTEMPT_ID,
    TUPLE_ATTEMPT_FENCE,
  ]);
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Tuple-check authority insert returned no row.");
  }
  return {
    collisionStorageId: row.collision_storage_id,
    planStorageId: row.plan_storage_id,
    admissionStorageId: row.admission_storage_id,
    attemptStorageId: row.attempt_storage_id,
  };
}

async function insertAttemptTerminal(
  persistence: PGliteFlarexPersistence,
  authority: TupleCheckAuthority,
  input: AttemptTerminalInsert,
): Promise<string> {
  const result = await persistence.query<{ storage_id: string }>(`
    insert into ${MIGRATION_TERMINAL_TABLE}
      (collision_storage_id, plan_storage_id, attempt_storage_id,
       admission_storage_id, admission_sha256, attempt_id, attempt_fence,
       outcome_kind, required_step_set_sha256, failure_reason, evidence_sha256,
       last_receipt_storage_id, last_step_receipt_sha256,
       attempt_terminal_sha256, frame_format, frame_version,
       canonical_byte_length, canonical_bytes)
    values
      ($1, $2, $3, $4, decode($5, 'hex'), $6, $7, $8,
       decode($9, 'hex'), $10, decode($11, 'hex'), $12,
       decode($13, 'hex'), decode($14, 'hex'),
       'flarex.framework-migration-attempt-terminal', 1, 2,
       decode('7b7d', 'hex'))
    returning terminal_storage_id::text as storage_id
  `, [
    authority.collisionStorageId,
    authority.planStorageId,
    authority.attemptStorageId,
    authority.admissionStorageId,
    TUPLE_ADMISSION_SHA256,
    TUPLE_ATTEMPT_ID,
    TUPLE_ATTEMPT_FENCE,
    input.outcomeKind,
    input.requiredStepSetDigestHex,
    input.failureReason,
    input.evidenceDigestHex,
    input.lastReceiptStorageId,
    input.lastStepReceiptDigestHex,
    input.terminalDigestHex,
  ]);
  const storageId = result.rows[0]?.storage_id;
  if (storageId === undefined) {
    throw new Error("Attempt-terminal insert returned no storage identity.");
  }
  return storageId;
}

async function insertTupleCheckReceipt(
  persistence: PGliteFlarexPersistence,
  authority: TupleCheckAuthority,
): Promise<string> {
  const result = await persistence.query<{ storage_id: string }>(`
    insert into fx_system_framework_migration_step_receipt
      (collision_storage_id, plan_storage_id, attempt_storage_id, attempt_id,
       attempt_fence, step_id, step_sha256, precondition_sha256,
       postcondition_sha256, observed_postcondition_sha256, dependency_count,
       step_receipt_sha256, frame_format, frame_version,
       canonical_byte_length, canonical_bytes)
    values
      ($1, $2, $3, $4, $5, $6, decode($7, 'hex'), decode($8, 'hex'),
       decode($9, 'hex'), decode($9, 'hex'), 0, decode(repeat('60', 32), 'hex'),
       'flarex.framework-migration-step-receipt', 1, 2,
       decode('7b7d', 'hex'))
    returning receipt_storage_id::text as storage_id
  `, [
    authority.collisionStorageId,
    authority.planStorageId,
    authority.attemptStorageId,
    TUPLE_ATTEMPT_ID,
    TUPLE_ATTEMPT_FENCE,
    TUPLE_STEP_ID,
    TUPLE_STEP_SHA256,
    TUPLE_PRECONDITION_SHA256,
    TUPLE_POSTCONDITION_SHA256,
  ]);
  const storageId = result.rows[0]?.storage_id;
  if (storageId === undefined) {
    throw new Error("Tuple-check receipt insert returned no storage identity.");
  }
  return storageId;
}

async function insertTupleCheckInstallation(
  persistence: PGliteFlarexPersistence,
  authority: TupleCheckAuthority,
  terminalStorageId: string,
): Promise<string> {
  const result = await persistence.query<{ storage_id: string }>(`
    insert into ${SCHEMA_INSTALLATION_TABLE}
      (collision_storage_id, plan_storage_id, migration_plan_sha256,
       admission_storage_id, admission_sha256, terminal_storage_id,
       terminal_outcome_kind, terminal_sha256, installation_sha256,
       installation_receipt_sha256, installed_structure_sha256, frame_format,
       frame_version, canonical_byte_length, canonical_bytes)
    values
      ($1, $2, decode($3, 'hex'), $4, decode($5, 'hex'), $6, 'succeeded',
       decode(repeat('61', 32), 'hex'), decode(repeat('62', 32), 'hex'),
       decode(repeat('63', 32), 'hex'), decode(repeat('64', 32), 'hex'),
       'flarex.framework-schema-installation', 1, 2, decode('7b7d', 'hex'))
    returning installation_storage_id::text as storage_id
  `, [
    authority.collisionStorageId,
    authority.planStorageId,
    TUPLE_PLAN_SHA256,
    authority.admissionStorageId,
    TUPLE_ADMISSION_SHA256,
    terminalStorageId,
  ]);
  const storageId = result.rows[0]?.storage_id;
  if (storageId === undefined) {
    throw new Error("Tuple-check installation insert returned no identity.");
  }
  return storageId;
}

async function insertTupleCheckReadiness(
  persistence: PGliteFlarexPersistence,
  installationStorageId: string,
): Promise<string> {
  const result = await persistence.query<{ storage_id: string }>(`
    insert into ${SCHEMA_READINESS_TABLE}
      (installation_storage_id, installation_sha256,
       installation_receipt_sha256, readiness_sha256, validation_sha256,
       validated_structure_sha256, frame_format, frame_version,
       canonical_byte_length, canonical_bytes)
    values
      ($1, decode(repeat('62', 32), 'hex'), decode(repeat('63', 32), 'hex'),
       decode(repeat('65', 32), 'hex'), decode(repeat('66', 32), 'hex'),
       decode(repeat('64', 32), 'hex'), 'flarex.framework-schema-readiness',
       1, 2, decode('7b7d', 'hex'))
    returning readiness_storage_id::text as storage_id
  `, [installationStorageId]);
  const storageId = result.rows[0]?.storage_id;
  if (storageId === undefined) {
    throw new Error("Tuple-check readiness insert returned no identity.");
  }
  return storageId;
}

async function storedRootCounts(
  persistence: PGliteFlarexPersistence,
) {
  const result = await persistence.query<{
    targetNamespaces: string;
    collisionDomains: string;
    physicalAssignments: string;
  }>(`
    select
      (select count(*)::text from ${TARGET_NAMESPACE_TABLE})
        as "targetNamespaces",
      (select count(*)::text from ${COLLISION_DOMAIN_TABLE})
        as "collisionDomains",
      (select count(*)::text from ${PHYSICAL_ASSIGNMENT_TABLE})
        as "physicalAssignments"
  `);
  const [counts] = result.rows;
  if (counts === undefined) {
    throw new Error("Framework coordinator root count query returned no row.");
  }
  return counts;
}
