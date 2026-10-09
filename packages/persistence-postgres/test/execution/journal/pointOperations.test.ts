import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
  type AppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  decodeAppDocumentIdV1,
  decodeAppDocumentIdentityV1,
  type AppDocumentIdV1,
} from "flarex-protocol/app-document-id";
import { MAX_COMMIT_WRITE_OPERATIONS_V1 } from "flarex-protocol/commit-protocol";
import { decodeSchemaManifestAppTableName } from "flarex-protocol/schema-manifest";
import {
  ApplicationRevisionSyscallDocumentValidationV1Error,
  InvalidApplicationRevisionSyscallValidatorV1Error,
} from "../../../src/application/revision/applicationRevisionSyscallValidatorErrors";
import { isCanonicalFlarexRuntimeObjectV1 } from "flarex-protocol/value";
import { expect, expectTypeOf, it, afterAll, beforeAll, describe, vi } from "vitest";
import { Cause, Effect, Exit, Fiber } from "effect";
import {
  resolvePinnedPointTableIdV1Effect,
} from "../../../src/storage/documents/pinnedPointTableResolution";
import {
  PinnedPointTablePersistenceV1Error,
  type ResolvePinnedPointTableIdV1Input,
} from "../../../src/storage/documents/pinnedPointTableErrors";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import {
  SchemaVersionArtifactCorruptionError,
} from "../../../src/storage/catalog/schemaVersionArtifacts";
import {
  InvalidSessionJournalInputV1Error,
  PinnedPointTableCorruptionV1Error,
  PinnedPointTableNotFoundV1Error,
  SessionJournalIdentityGenerationV1Error,
  SessionJournalPersistenceV1Error,
  SessionJournalStorageCorruptionV1Error,
  type RunSessionJournalPointOperationV1Result,
  type SessionJournalPointOperationV1,
  type SessionJournalStorePersistence,
} from "../../../src/execution/journal/api";
import { createSessionJournalStorePersistence } from "../../../src/execution/sessionJournalStore";
import type {
  PointMutationSessionAuthorityResolutionPortsV1,
} from "../../../src/execution/transactionSessionActivation";
import {
  RESOLVE_PINNED_POINT_TABLE_ID_EFFECT_V1,
} from "../../../src/execution/transactionSessionAttemptKernel";
import {
  prepareSessionJournalSeal as prepareSeal,
  runEffect,
  runEffectFailure as runFailure,
  runSessionJournalPointOperation as runPointOperation,
} from "../../support/effectTestRuntime";
import {
  issueSetupSeededSyscallValidatorProofV1,
  revokeSetupSeededSyscallValidatorProofV1,
  SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
} from "../../application/revision/applicationRevisionSyscallValidatorTestSupport";
import { TEST_GRANT_RETENTION_POLICY_V1 } from "../transactionSessionActivationTestSupport";
import {
  selectorFromAnchor,
  syscallSequence,
  documentId,
  requireSeededDocumentId,
  requireInsertedDocumentId,
  uuidSequence,
  deferredSignal,
  delay,
} from "./journalTestSupport";
import {
  createSessionJournalStorePGliteFixture,
  type SessionJournalStorePGliteFixture,
} from "./journalFixture";

function requireInsertedCreationTime(
  result: RunSessionJournalPointOperationV1Result,
): AppCreationTimeV1 {
  if (result.kind !== "completed" || result.outcome.kind !== "inserted") {
    throw new Error("Expected inserted journal outcome.");
  }
  const document = result.outcome.document;
  if (!isCanonicalFlarexRuntimeObjectV1(document)) {
    throw new Error("Inserted outcome is not an app document.");
  }
  return decodeAppCreationTimeV1(document._creationTime);
}

async function semanticBytes(
  documentId: AppDocumentIdV1,
  creationTime: AppCreationTimeV1,
  fields: unknown,
): Promise<number> {
  const identity = decodeAppDocumentIdentityV1(documentId);
  return (await canonicalizeAppDocumentV1({
    tableId: identity.tableId,
    rowId: identity.rowId,
    creationTime,
    fields,
  })).semanticSizeBytes;
}

function nextCreationTime(value: AppCreationTimeV1): AppCreationTimeV1 {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  const high = view.getUint32(0, false);
  const low = view.getUint32(4, false);
  if (low === 0xffff_ffff) {
    view.setUint32(0, high + 1, false);
    view.setUint32(4, 0, false);
  } else {
    view.setUint32(4, low + 1, false);
  }
  return decodeAppCreationTimeV1(view.getFloat64(0, false));
}

function rejectSelectedQuery(
  database: PGliteFlarexPersistence["drizzle"],
  rejectedSelectNumber: number,
  rejectQuery: () => Promise<never>,
): PGliteFlarexPersistence["drizzle"] {
  let selectNumber = 0;
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property !== "select") {
        return Reflect.get(target, property, receiver);
      }
      return (...args: Array<unknown>) => {
        selectNumber += 1;
        return selectNumber === rejectedSelectNumber
          ? new RejectingSelectQuery(rejectQuery)
          : Reflect.apply(target.select, target, args);
      };
    },
  });
}

class RejectingSelectQuery {
  constructor(private readonly rejectQuery: () => Promise<never>) {}

  from(): this {
    return this;
  }

  where(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  then(
    onfulfilled?: ((value: never) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ): Promise<unknown> {
    return this.rejectQuery().then(onfulfilled, onrejected);
  }
}

describe("Journal point operations (PGlite)", () => {
  let fixture: SessionJournalStorePGliteFixture;
  let persistence: SessionJournalStorePGliteFixture["persistence"];
  let scenario: SessionJournalStorePGliteFixture["scenario"];
  let resolutionPorts: SessionJournalStorePGliteFixture["resolutionPorts"];
  let journalCounts: SessionJournalStorePGliteFixture["journalCounts"];
  let journalRoot: SessionJournalStorePGliteFixture["journalRoot"];

  beforeAll(async () => {
    fixture = await createSessionJournalStorePGliteFixture();
    ({ persistence, scenario, resolutionPorts, journalCounts, journalRoot } = fixture);
  });

  afterAll(async () => {
    await fixture?.close();
  });

  it("rejects invalid insert, patch, and replace before journal acceptance", async () => {
    const cases = ["insert", "patch", "replace"] as const;
    for (const operation of cases) {
      const current = await scenario(`c03v_${operation}`, {
        ...(operation === "insert" ? {} : { seedFields: { name: "before" } }),
      });
      const validator = issueSetupSeededSyscallValidatorProofV1({
        scopeId: current.anchor.scopeId,
        schemaVersionId: current.schemaVersionId,
        schemaManifest: current.schemaManifest,
      });
      const document = current.seededDocumentId;
      const invalid = operation === "insert"
        ? {
          kind: "insert" as const,
          syscallSequence: syscallSequence(1n),
          fields: { name: 42 },
        }
        : operation === "patch"
        ? {
          kind: "patch" as const,
          syscallSequence: syscallSequence(1n),
          documentId: document!,
          patch: { name: 42 },
        }
        : {
          kind: "replace" as const,
          syscallSequence: syscallSequence(1n),
          documentId: document!,
          fields: { name: 42 },
        };
      await expect(runFailure(current.store.runPointOperationEffect(
        current.table,
        invalid,
        validator,
      ))).resolves.toBeInstanceOf(
        ApplicationRevisionSyscallDocumentValidationV1Error,
      );
      await expect(journalCounts(current.anchor.sessionId)).resolves.toMatchObject({
        receipts: 0,
        points: 0,
        events: 0,
      });

      const valid = operation === "insert"
        ? {
          kind: "insert" as const,
          syscallSequence: syscallSequence(1n),
          fields: { name: "after" },
        }
        : operation === "patch"
        ? {
          kind: "patch" as const,
          syscallSequence: syscallSequence(1n),
          documentId: document!,
          patch: { name: "after" },
        }
        : {
          kind: "replace" as const,
          syscallSequence: syscallSequence(1n),
          documentId: document!,
          fields: { name: "after" },
        };
      await expect(runEffect(current.store.runPointOperationEffect(
        current.table,
        valid,
        validator,
      ))).resolves.toMatchObject({ kind: "completed", delivery: "executed" });
      await expect(journalCounts(current.anchor.sessionId)).resolves.toMatchObject({
        receipts: 1,
        points: 1,
        events: 1,
      });
    }
  });

  it("validates authority and documents before accepting a sticky limit failure", async () => {
    const current = await scenario("c03v_limit_priority");
    const validator = issueSetupSeededSyscallValidatorProofV1({
      scopeId: current.anchor.scopeId,
      schemaVersionId: current.schemaVersionId,
      schemaManifest: current.schemaManifest,
    });
    await persistence.query(
      `update fx_system_tx_journal
          set write_operations = $2
        where session_id = $1`,
      [current.anchor.sessionId, MAX_COMMIT_WRITE_OPERATIONS_V1],
    );

    await expect(runFailure(current.store.runPointOperationEffect(
      current.table,
      {
        kind: "insert",
        syscallSequence: syscallSequence(1n),
        fields: { name: 42 },
      },
      validator,
    ))).resolves.toBeInstanceOf(
      ApplicationRevisionSyscallDocumentValidationV1Error,
    );
    const revoked = issueSetupSeededSyscallValidatorProofV1({
      scopeId: current.anchor.scopeId,
      schemaVersionId: current.schemaVersionId,
      schemaManifest: current.schemaManifest,
    });
    revokeSetupSeededSyscallValidatorProofV1(revoked);
    await expect(runFailure(current.store.runPointOperationEffect(
      current.table,
      {
        kind: "insert",
        syscallSequence: syscallSequence(1n),
        fields: { name: "valid" },
      },
      revoked,
    ))).resolves.toBeInstanceOf(
      InvalidApplicationRevisionSyscallValidatorV1Error,
    );
    await expect(journalCounts(current.anchor.sessionId)).resolves.toMatchObject({
      receipts: 0,
      points: 0,
      events: 0,
    });
    await expect(journalRoot(current.anchor.sessionId)).resolves.toMatchObject({
      state: "open",
      last_syscall_sequence: "0",
      write_operations: MAX_COMMIT_WRITE_OPERATIONS_V1,
    });

    await expect(runEffect(current.store.runPointOperationEffect(
      current.table,
      {
        kind: "insert",
        syscallSequence: syscallSequence(1n),
        fields: { name: "valid" },
      },
      validator,
    ))).resolves.toMatchObject({
      kind: "rejected",
      issue: { reason: "limitExceeded", dimension: "writeOperations" },
    });
  });

  it("uses the pinned manifest as table authority and stable bindings only as corroboration", async () => {
    type UnsupportedStoreOperation = Extract<
      keyof SessionJournalStorePersistence,
      "scan" | "query" | "range" | "relation" | "payload" | "medusa"
    >;
    expectTypeOf<UnsupportedStoreOperation>().toEqualTypeOf<never>();

    const current = await scenario("table_resolution");
    await expect(
      runEffect(current.store.openAttemptEffect({
        selector: selectorFromAnchor(current.anchor),
        executionClaim: current.executionClaim,
        snapshotToken: current.anchor.snapshotToken,
        schemaVersionId: current.schemaVersionId,
      })),
    ).resolves.toBeDefined();
    const invalidOpenAttemptInput = {
      selector: {
        ...selectorFromAnchor(current.anchor),
        attemptFence: 0n,
      },
      executionClaim: current.executionClaim,
      snapshotToken: current.anchor.snapshotToken,
      schemaVersionId: current.schemaVersionId,
    };
    const invalidOpenAttemptEffect = Reflect.apply(
      current.store.openAttemptEffect,
      undefined,
      [invalidOpenAttemptInput],
    );
    await expect(runFailure(invalidOpenAttemptEffect)).resolves.toMatchObject({
      operation: "openAttempt",
      reason: "invalidAttemptPins",
    } satisfies Partial<InvalidSessionJournalInputV1Error>);
    const propertyAccessCause = new Error("selector access failed");
    const throwingOpenAttemptInput = Object.defineProperty(
      {},
      "selector",
      {
        enumerable: true,
        get: () => {
          throw propertyAccessCause;
        },
      },
    );
    const throwingOpenAttemptEffect = Reflect.apply(
      current.store.openAttemptEffect,
      undefined,
      [throwingOpenAttemptInput],
    );
    const propertyAccessFailure = await runFailure(
      throwingOpenAttemptEffect,
    );
    expect(propertyAccessFailure).toBeInstanceOf(
      InvalidSessionJournalInputV1Error,
    );
    expect(propertyAccessFailure).toMatchObject({
      operation: "openAttempt",
      reason: "invalidAttemptPins",
      cause: propertyAccessCause,
    } satisfies Partial<InvalidSessionJournalInputV1Error>);
    await expect(
      runEffect(current.store.resolvePointTableEffect(
        current.attempt,
        "users",
      )),
    ).resolves.toBeDefined();
    await expect(
      runFailure(current.store.resolvePointTableEffect(
        current.attempt,
        "comments",
      )),
    ).resolves.toBeInstanceOf(PinnedPointTableNotFoundV1Error);
    await expect(
      runFailure(current.store.resolvePointTableEffect(current.attempt, 42)),
    ).resolves.toMatchObject({
      reason: "invalidTableName",
    } satisfies Partial<InvalidSessionJournalInputV1Error>);
    const resolutionCause = new Error("resolution persistence unavailable");
    const failingResolutionPorts = {
      scopeMetadata: {
        getScopeMetadata: async () => {
          throw resolutionCause;
        },
        getScopeMetadataByDeploymentId: async () => {
          throw resolutionCause;
        },
      },
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => {
          throw new Error("Resolution must stop after the metadata failure.");
        },
      },
      scopeSessionTargets: {
        resolve: async () => {
          throw new Error("Resolution must stop after the metadata failure.");
        },
      },
    } satisfies PointMutationSessionAuthorityResolutionPortsV1;
    const failingResolutionStore = createSessionJournalStorePersistence(
      failingResolutionPorts,
      { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1 },
    );
    const resolutionFailure = await runFailure(
      failingResolutionStore.openAttemptEffect({
        selector: selectorFromAnchor(current.anchor),
        executionClaim: current.executionClaim,
        snapshotToken: current.anchor.snapshotToken,
        schemaVersionId: current.schemaVersionId,
      }),
    );
    expect(resolutionFailure).toBeInstanceOf(SessionJournalPersistenceV1Error);
    expect(resolutionFailure).toMatchObject({
      operation: "resolveJournalTarget",
      cause: resolutionCause,
    } satisfies Partial<SessionJournalPersistenceV1Error>);
    await expect(runFailure(current.store.runPointOperationEffect(
      current.table,
      {
        kind: "patch",
        syscallSequence: syscallSequence(1n),
        documentId: documentId(current.tableId, 999),
        patch: { ["r".repeat(1_025)]: undefined },
      },
      SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
    ))).resolves.toBeInstanceOf(InvalidSessionJournalInputV1Error);
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "open",
      last_syscall_sequence: "0",
    });

    const pointInputAccesses: string[] = [];
    const pointInputCause = new Error("syscall sequence access failed");
    const throwingPointInput = Object.defineProperties({}, {
      syscallSequence: {
        enumerable: true,
        get: () => {
          pointInputAccesses.push("syscallSequence");
          throw pointInputCause;
        },
      },
      kind: {
        enumerable: true,
        get: () => {
          pointInputAccesses.push("kind");
          return "get";
        },
      },
    });
    const throwingPointEffect = Reflect.apply(
      current.store.runPointOperationEffect,
      undefined,
      [current.table, throwingPointInput],
    );
    await expect(runFailure(throwingPointEffect)).resolves.toMatchObject({
      operation: "get",
      reason: "invalidOperation",
      cause: pointInputCause,
    } satisfies Partial<InvalidSessionJournalInputV1Error>);
    expect(pointInputAccesses).toEqual(["syscallSequence", "kind"]);

    await persistence.query(
      `
        update fx_control_table
        set logical_name = 'users_retired_for_corruption_test'
        where deployment_id = $1 and logical_name = 'users'
      `,
      [current.deploymentId],
    );
    await persistence.query(
      `
        update fx_control_table
        set logical_name = 'users'
        where deployment_id = $1 and logical_name = 'posts'
      `,
      [current.deploymentId],
    );
    await expect(
      runFailure(
        current.store.resolvePointTableEffect(current.attempt, "users"),
      ),
    ).resolves.toMatchObject({
      reason: "stableBindingMismatch",
      tableName: decodeSchemaManifestAppTableName("users"),
    } satisfies Partial<PinnedPointTableCorruptionV1Error>);
  });

  it("keeps unexpected value-normalizer failures in the defect channel", async () => {
    const current = await scenario("point_input_normalizer_defect");
    const defect = new Error("value proxy inspection failed");
    const fields = new Proxy({}, {
      ownKeys: () => {
        throw defect;
      },
    });

    const exit = await Effect.runPromiseExit(
      current.store.runPointOperationEffect(current.table, {
        kind: "insert",
        syscallSequence: syscallSequence(1n),
        fields,
      }, SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons).toHaveLength(1);
      const reason = exit.cause.reasons[0];
      expect(reason !== undefined && Cause.isDieReason(reason)).toBe(true);
      if (reason !== undefined && Cause.isDieReason(reason)) {
        expect(reason.defect).toBe(defect);
      }
    }
    await expect(journalCounts(current.anchor.sessionId)).resolves.toMatchObject({
      receipts: 0,
      points: 0,
    });
  });

  it("classifies an invalid pinned manifest as stored catalog corruption", async () => {
    const current = await scenario("table_resolution_manifest_corruption");
    await persistence.query(
      `
        update fx_control_schema_version
        set manifest_json = '{}'::jsonb
        where deployment_id = $1 and schema_version_id = $2
      `,
      [current.deploymentId, current.schemaVersionId],
    );

    const failure = await runFailure(current.store.resolvePointTableEffect(
      current.attempt,
      "users",
    ));
    expect(failure).toBeInstanceOf(PinnedPointTableCorruptionV1Error);
    expect(failure).toMatchObject({
      reason: "schemaArtifactInvalid",
      cause: expect.any(SchemaVersionArtifactCorruptionError),
    } satisfies Partial<PinnedPointTableCorruptionV1Error>);
  });

  it("maps a pinned table query rejection once at the resolver boundary", async () => {
    const current = await scenario("table_resolution_sql_failure");
    const input = {
      deploymentId: current.deploymentId,
      schemaVersionId: current.schemaVersionId,
      tableName: decodeSchemaManifestAppTableName("users"),
    };
    const queryFailure = new Error("pinned schema query unavailable");
    const failingDatabase = rejectSelectedQuery(
      persistence.drizzle,
      1,
      () => Promise.reject(queryFailure),
    );
    await expect(runFailure(resolvePinnedPointTableIdV1Effect(
      failingDatabase,
      input,
    ))).resolves.toMatchObject({
      operation: "loadSchemaArtifact",
      cause: queryFailure,
    } satisfies Partial<PinnedPointTablePersistenceV1Error>);

    const bindingQueryFailure = new Error(
      "pinned stable binding query unavailable",
    );
    const bindingFailingDatabase = rejectSelectedQuery(
      persistence.drizzle,
      3,
      () => Promise.reject(bindingQueryFailure),
    );
    await expect(runFailure(resolvePinnedPointTableIdV1Effect(
      bindingFailingDatabase,
      input,
    ))).resolves.toMatchObject({
      operation: "loadStableBinding",
      cause: bindingQueryFailure,
    } satisfies Partial<PinnedPointTablePersistenceV1Error>);

    const basePorts = resolutionPorts(persistence);
    const sessionFailingDatabase = rejectSelectedQuery(
      persistence.drizzle,
      1,
      () => Promise.reject(queryFailure),
    );
    const failingPorts = {
      ...basePorts,
      scopeSessionTargets: {
        resolve: async (physicalLocator) => {
          const target = await basePorts.scopeSessionTargets.resolve(
            physicalLocator,
          );
          return Object.freeze({
            ...target,
            [RESOLVE_PINNED_POINT_TABLE_ID_EFFECT_V1]: (
              resolutionInput: ResolvePinnedPointTableIdV1Input,
            ) =>
              resolvePinnedPointTableIdV1Effect(
                sessionFailingDatabase,
                resolutionInput,
              ),
          });
        },
      },
    } satisfies PointMutationSessionAuthorityResolutionPortsV1;
    const store = createSessionJournalStorePersistence(failingPorts, {
      grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
    });
    const attempt = await runEffect(store.openAttemptEffect({
      selector: selectorFromAnchor(current.anchor),
      executionClaim: current.executionClaim,
      snapshotToken: current.anchor.snapshotToken,
      schemaVersionId: current.schemaVersionId,
    }));
    await expect(runFailure(store.resolvePointTableEffect(
      attempt,
      "users",
    ))).resolves.toMatchObject({
      operation: "resolvePinnedPointTable",
      cause: queryFailure,
    } satisfies Partial<SessionJournalPersistenceV1Error>);
  });

  it("waits for an outstanding pinned table query after interruption", async () => {
    const current = await scenario("table_resolution_interruption");
    const entered = deferredSignal();
    const release = deferredSignal();
    const queryFailure = new Error("interrupted pinned table query settled");
    const pendingDatabase = rejectSelectedQuery(
      persistence.drizzle,
      1,
      async () => {
        entered.resolve();
        await release.promise;
        throw queryFailure;
      },
    );
    const fiber = Effect.runFork(resolvePinnedPointTableIdV1Effect(
      pendingDatabase,
      {
        deploymentId: current.deploymentId,
        schemaVersionId: current.schemaVersionId,
        tableName: decodeSchemaManifestAppTableName("users"),
      },
    ));

    await entered.promise;
    let interruptionSettled = false;
    const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
      interruptionSettled = true;
      return exit;
    });
    try {
      await delay(25);
      expect(interruptionSettled).toBe(false);
    } finally {
      release.resolve();
    }
    await interruption;
    expect(interruptionSettled).toBe(true);
  });

  it("reads the pinned snapshot once, then serves the staged same-row overlay", async () => {
    const current = await scenario("present_overlay", {
      seedFields: { name: "database" },
    });
    const documentId = requireSeededDocumentId(current);

    await expect(runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId,
    })).resolves.toMatchObject({
      kind: "completed",
      outcome: { kind: "present", document: { name: "database" } },
    });
    await expect(runPointOperation(current.store, current.table, {
      kind: "patch",
      syscallSequence: syscallSequence(2n),
      documentId,
      patch: { name: "overlay" },
    })).resolves.toMatchObject({
      kind: "completed",
      outcome: { kind: "unit", operation: "patch" },
    });

    await persistence.query(
      `
        delete from fx_app_row_current
        where scope_uuid = (
          select scope_uuid from fx_system_tx_session where session_id = $1
        )
      `,
      [current.anchor.sessionId],
    );
    await persistence.query(
      `
        delete from fx_app_row_rev
        where scope_uuid = (
          select scope_uuid from fx_system_tx_session where session_id = $1
        )
      `,
      [current.anchor.sessionId],
    );

    await expect(runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(3n),
      documentId,
    })).resolves.toMatchObject({
      kind: "completed",
      outcome: { kind: "present", document: { name: "overlay" } },
    });

    const prepared = await prepareSeal(current.store, current.attempt);
    expect(prepared.journal.readDependencies).toEqual([{
      kind: "appRowPoint",
      documentId,
      observed: { kind: "present", revisionCommitSeq: 1n },
    }]);
    expect(prepared.journal.readUsage.documentsRead).toBe(3);
    expect(prepared.journal.writes).toMatchObject([{
      kind: "patch",
      syscallSequence: 2n,
      documentId,
    }]);
  });

  it("retains raw material writes while deterministically composing insert, patch, replace, delete, and no-op state", async () => {
    const firstUuid = "84000000-0000-4000-8000-000000000001";
    const secondUuid = "84000000-0000-4000-8000-000000000002";
    const generated = uuidSequence(firstUuid, firstUuid, secondUuid);
    const current = await scenario("write_composition", {
      randomUuid: generated,
    });

    const inserted = await runPointOperation(current.store, current.table, {
      kind: "insert",
      syscallSequence: syscallSequence(1n),
      fields: { name: "created", keep: true },
    });
    const firstDocumentId = requireInsertedDocumentId(inserted);
    const firstCreationTime = requireInsertedCreationTime(inserted);

    await expect(runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(2n),
      documentId: firstDocumentId,
    })).resolves.toMatchObject({
      kind: "completed",
      outcome: { kind: "present", document: { name: "created", keep: true } },
    });
    await expect(runPointOperation(current.store, current.table, {
      kind: "patch",
      syscallSequence: syscallSequence(3n),
      documentId: firstDocumentId,
      patch: { name: "patched", keep: undefined },
    })).resolves.toMatchObject({ kind: "completed" });
    await expect(runPointOperation(current.store, current.table, {
      kind: "patch",
      syscallSequence: syscallSequence(4n),
      documentId: firstDocumentId,
      patch: { name: "patched" },
    })).resolves.toMatchObject({ kind: "completed" });
    await expect(runPointOperation(current.store, current.table, {
      kind: "replace",
      syscallSequence: syscallSequence(5n),
      documentId: firstDocumentId,
      fields: { name: "replaced" },
    })).resolves.toMatchObject({ kind: "completed" });
    await expect(runPointOperation(current.store, current.table, {
      kind: "delete",
      syscallSequence: syscallSequence(6n),
      documentId: firstDocumentId,
    })).resolves.toMatchObject({ kind: "completed" });
    await expect(runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(7n),
      documentId: firstDocumentId,
    })).resolves.toMatchObject({
      kind: "completed",
      outcome: { kind: "missing" },
    });
    await expect(runPointOperation(current.store, current.table, {
      kind: "patch",
      syscallSequence: syscallSequence(8n),
      documentId: firstDocumentId,
      patch: { name: "cannot-resurrect" },
    })).resolves.toMatchObject({
      kind: "rejected",
      issue: { reason: "documentNotFound", operation: "patch" },
    });
    await expect(runPointOperation(current.store, current.table, {
      kind: "insert",
      syscallSequence: syscallSequence(9n),
      fields: { name: "collision" },
    })).resolves.toMatchObject({
      kind: "rejected",
      issue: { reason: "documentIdCollision", documentId: firstDocumentId },
    });
    const secondInsert = await runPointOperation(current.store, current.table, {
      kind: "insert",
      syscallSequence: syscallSequence(10n),
      fields: { name: "second" },
    });
    const secondDocumentId = requireInsertedDocumentId(secondInsert);
    const secondCreationTime = requireInsertedCreationTime(secondInsert);
    expect(secondCreationTime).toBe(
      nextCreationTime(nextCreationTime(firstCreationTime)),
    );

    const prepared = await prepareSeal(current.store, current.attempt);
    expect(prepared.journal.finalSyscallSequence).toBe(10n);
    expect(prepared.journal.readDependencies).toMatchObject([
      {
        documentId: firstDocumentId,
        observed: { kind: "missing", basis: { kind: "noVisibleRevision" } },
      },
      {
        documentId: secondDocumentId,
        observed: { kind: "missing", basis: { kind: "noVisibleRevision" } },
      },
    ]);
    expect(prepared.journal.writes.map((write) => ({
      kind: write.kind,
      syscallSequence: write.syscallSequence,
    }))).toEqual([
      { kind: "insert", syscallSequence: 1n },
      { kind: "patch", syscallSequence: 3n },
      { kind: "replace", syscallSequence: 5n },
      { kind: "delete", syscallSequence: 6n },
      { kind: "insert", syscallSequence: 10n },
    ]);

    const expectedBytes = await Promise.all([
      semanticBytes(firstDocumentId, firstCreationTime, {
        name: "created",
        keep: true,
      }),
      semanticBytes(firstDocumentId, firstCreationTime, { name: "patched" }),
      semanticBytes(firstDocumentId, firstCreationTime, { name: "replaced" }),
      semanticBytes(secondDocumentId, secondCreationTime, { name: "second" }),
    ]);
    expect(prepared.journal.writes).toMatchObject([
      { resultingDocumentSemanticBytes: expectedBytes[0] },
      { resultingDocumentSemanticBytes: expectedBytes[1] },
      { resultingDocumentSemanticBytes: expectedBytes[2] },
      { kind: "delete" },
      { resultingDocumentSemanticBytes: expectedBytes[3] },
    ]);

    const root = await journalRoot(current.anchor.sessionId);
    expect(root).toMatchObject({
      last_syscall_sequence: "10",
      point_dependency_count: 2,
      read_documents: 5,
      write_operations: 5,
      next_creation_time: nextCreationTime(secondCreationTime),
    });
    expect(await journalCounts(current.anchor.sessionId)).toMatchObject({
      receipts: 10,
      points: 2,
      events: 5,
    });
  });

  it("uses UUIDv4 identities and IEEE-754 nextUp creation times without rerunning randomness on durable replay", async () => {
    const generatedUuid = "85000000-0000-4000-8000-000000000001";
    let randomCalls = 0;
    const randomUuid = (): string => {
      randomCalls += 1;
      return generatedUuid;
    };
    const current = await scenario("identity_creation_time", { randomUuid });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "open",
      material_write_event_evidence_bytes: 0,
    });
    const request = Object.freeze({
      kind: "insert",
      syscallSequence: syscallSequence(1n),
      fields: { name: "stable" },
    } satisfies SessionJournalPointOperationV1);

    const created = await runPointOperation(current.store, current.table,
      request,
    );
    const creationTime = requireInsertedCreationTime(created);
    expect(requireInsertedDocumentId(created)).toBe(
      decodeAppDocumentIdV1(`${current.tableId}:${generatedUuid}`),
    );
    expect(randomCalls).toBe(1);
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      creation_time_seed: creationTime,
      next_creation_time: nextCreationTime(creationTime),
    });

    const restartedStore = createSessionJournalStorePersistence(
      resolutionPorts(persistence),
      {
        grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
        randomUuid: () => {
          throw new Error("Replay must not request new randomness.");
        },
      },
    );
    const restartedAttempt = await runEffect(
      restartedStore.openAttemptEffect({
        selector: selectorFromAnchor(current.anchor),
        executionClaim: current.executionClaim,
        snapshotToken: current.anchor.snapshotToken,
        schemaVersionId: current.schemaVersionId,
      }),
    );
    const restartedTable = await runEffect(
      restartedStore.resolvePointTableEffect(restartedAttempt, "users"),
    );
    await expect(
      runPointOperation(restartedStore, restartedTable, request),
    ).resolves.toMatchObject({
      kind: "completed",
      delivery: "replayed",
      outcome: { kind: "inserted" },
    });
    expect(randomCalls).toBe(1);

    const invalid = await scenario("invalid_uuid", {
      randomUuid: () => "not-a-v4-uuid",
    });
    await expect(runFailure(invalid.store.runPointOperationEffect(
      invalid.table,
      {
        kind: "insert",
        syscallSequence: syscallSequence(1n),
        fields: { name: "invalid" },
      },
      SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
    ))).resolves.toBeInstanceOf(SessionJournalIdentityGenerationV1Error);
    expect(await journalRoot(invalid.anchor.sessionId)).toMatchObject({
      last_syscall_sequence: "0",
      state: "open",
    });
    expect(await journalCounts(invalid.anchor.sessionId)).toMatchObject({
      receipts: 0,
      points: 0,
      events: 0,
    });
  });

  it("preserves the first request hash defect before transaction work and same-fence retry", async () => {
    const current = await scenario("first_request_hash_defect");
    const request = Object.freeze({
      kind: "get" as const,
      syscallSequence: syscallSequence(1n),
      documentId: documentId(current.tableId, 105),
    });
    const rootBefore = await journalRoot(current.anchor.sessionId);
    const countsBefore = await journalCounts(current.anchor.sessionId);
    const defect = new Error("first request hashing unavailable");
    const digest = vi
      .spyOn(globalThis.crypto.subtle, "digest")
      .mockRejectedValueOnce(defect);
    try {
      const exit = await Effect.runPromiseExit(
        current.store.runPointOperationEffect(
          current.table,
          request,
          SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
        ),
      );
      expect(digest).toHaveBeenCalledTimes(1);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons).toHaveLength(1);
        const reason = exit.cause.reasons[0];
        expect(reason !== undefined && Cause.isDieReason(reason)).toBe(true);
        if (reason !== undefined && Cause.isDieReason(reason))
          expect(reason.defect).toBe(defect);
      }
      expect(await journalRoot(current.anchor.sessionId)).toEqual(rootBefore);
      expect(await journalCounts(current.anchor.sessionId)).toEqual(countsBefore);
    } finally {
      digest.mockRestore();
    }
    await expect(
      runPointOperation(current.store, current.table, request),
    ).resolves.toMatchObject({
      kind: "completed",
      delivery: "executed",
      outcome: { kind: "missing" },
    });
    expect(await journalCounts(current.anchor.sessionId)).toMatchObject({
      receipts: 1,
      points: 1,
      events: 0,
    });
  });

  it("preserves a logical write event hash defect before durable writes and same-fence retry", async () => {
    const current = await scenario("logical_write_event_hash_defect");
    const request = Object.freeze({
      kind: "insert" as const,
      syscallSequence: syscallSequence(1n),
      fields: { name: "event-hash-retry" },
    });
    const rootBefore = await journalRoot(current.anchor.sessionId);
    const countsBefore = await journalCounts(current.anchor.sessionId);
    const defect = new Error("logical write event hashing unavailable");
    const nativeDigest = globalThis.crypto.subtle.digest.bind(
      globalThis.crypto.subtle,
    );
    const digest = vi
      .spyOn(globalThis.crypto.subtle, "digest")
      .mockImplementationOnce(nativeDigest)
      .mockImplementationOnce(nativeDigest)
      .mockRejectedValueOnce(defect);
    try {
      const exit = await Effect.runPromiseExit(
        current.store.runPointOperationEffect(
          current.table,
          request,
          SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
        ),
      );
      expect(digest).toHaveBeenCalledTimes(3);
      // Confirm the rejected native digest received the real logical write event,
      // after request and app-document hashing, before any durable mutation.
      const hashInput = digest.mock.calls[2]?.[1];
      if (hashInput === undefined)
        throw new Error("Missing actual logical write hash input");
      expect(JSON.parse(new TextDecoder().decode(hashInput))).toMatchObject({
        format: "flarex-value",
        value: {
          kind: "insert",
          documentId: expect.any(String),
          resultingDocumentSemanticBytes: expect.any(Number),
        },
        valueCodecVersion: 1,
      });
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons).toHaveLength(1);
        const reason = exit.cause.reasons[0];
        expect(reason !== undefined && Cause.isDieReason(reason)).toBe(true);
        if (reason !== undefined && Cause.isDieReason(reason))
          expect(reason.defect).toBe(defect);
      }
      expect(await journalRoot(current.anchor.sessionId)).toEqual(rootBefore);
      expect(await journalCounts(current.anchor.sessionId)).toEqual(countsBefore);
    } finally {
      digest.mockRestore();
    }
    await expect(
      runPointOperation(current.store, current.table, request),
    ).resolves.toMatchObject({
      kind: "completed",
      delivery: "executed",
      outcome: { kind: "inserted" },
    });
    expect(await journalCounts(current.anchor.sessionId)).toMatchObject({
      receipts: 1,
      points: 1,
      events: 1,
    });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "open",
      last_syscall_sequence: "1",
      write_operations: 1,
    });
  });

  it("preserves an unexpected identity-generator throw as a defect and rolls back", async () => {
    const defect = new Error("point identity generator unavailable");
    const current = await scenario("identity_generation_defect", {
      randomUuid: () => {
        throw defect;
      },
    });

    const exit = await Effect.runPromiseExit(
      current.store.runPointOperationEffect(current.table, {
        kind: "insert",
        syscallSequence: syscallSequence(1n),
        fields: { name: "must-not-persist" },
      }, SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons).toHaveLength(1);
      const reason = exit.cause.reasons[0];
      expect(reason !== undefined && Cause.isDieReason(reason)).toBe(true);
      if (reason !== undefined && Cause.isDieReason(reason)) {
        expect(reason.defect).toBe(defect);
      }
    }
    await expect(journalRoot(current.anchor.sessionId)).resolves.toMatchObject({
      last_syscall_sequence: "0",
      state: "open",
    });
    await expect(journalCounts(current.anchor.sessionId)).resolves.toMatchObject({
      receipts: 0,
      points: 0,
      events: 0,
    });
  });

  it("keeps fresh-plan overlay corruption typed and rolls back the attempted operation", async () => {
    const overlay = await scenario("planning_overlay_corruption", {
      randomUuid: () => "86000000-0000-4000-8000-000000000001",
    });
    const overlayInsert = await runPointOperation(overlay.store, overlay.table, {
      kind: "insert",
      syscallSequence: syscallSequence(1n),
      fields: { name: "overlay" },
    });
    const overlayDocumentId = requireInsertedDocumentId(overlayInsert);
    await persistence.query(
      `
        update fx_system_tx_journal_point
        set overlay_value_sha256 = $2
        where session_id = $1
      `,
      [overlay.anchor.sessionId, new Uint8Array(32)],
    );
    await expect(runFailure(overlay.store.runPointOperationEffect(
      overlay.table,
      {
        kind: "replace",
        syscallSequence: syscallSequence(2n),
        documentId: overlayDocumentId,
        fields: { name: "must-not-persist" },
      },
      SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
    ))).resolves.toMatchObject({
      reason: "liveOverlaySemanticBytesMismatch",
    } satisfies Partial<SessionJournalStorageCorruptionV1Error>);
    await expect(journalRoot(overlay.anchor.sessionId)).resolves.toMatchObject({
      last_syscall_sequence: "1",
    });
    await expect(journalCounts(overlay.anchor.sessionId)).resolves.toMatchObject({
      receipts: 1,
      points: 1,
      events: 1,
    });
  });


});
