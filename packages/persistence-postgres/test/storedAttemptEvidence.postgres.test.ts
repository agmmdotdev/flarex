import { Effect, Schema } from "effect";
import {
  CommitEnvelopeV1Schema,
  canonicalizeSessionJournalV1Effect,
  canonicalizeSuccessfulResultV1Effect,
} from "flarex-protocol/commit-protocol";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { describe, expect, it, vi } from "vitest";

import {
  createPointMutationSessionAttemptLoadingV1,
  type PointMutationSessionAttemptSelectorWireV1,
} from "../../executor/src/pointMutationSessionActivation";
import {
  createStoredAttemptAuthenticationV1,
} from "../../executor/src/storedAttemptAuthentication";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import type { LocatedScopeClockReader } from "../src/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from "../src/scopeMetadataTypes";
import { createSessionJournalStorePersistenceV1 } from "../src/sessionJournalStore";
import {
  createStoredAttemptEvidenceLoaderV1,
  type StoredAttemptEvidenceLoaderOptionsV1,
  type StoredAttemptEvidenceQueryV1,
} from "../src/storedAttemptEvidence";
import {
  createPointMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptLoadPersistenceV1,
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "../src/transactionSessionActivation";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import {
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const encodeEnvelope = Schema.encodeSync(CommitEnvelopeV1Schema);

describePostgres("real Postgres C04A stored-attempt authentication", () => {
  it("closes repeatable read before hashing and binds one complete sealed snapshot", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const observedQueries = new Map<
        StoredAttemptEvidenceQueryV1["name"],
        StoredAttemptEvidenceQueryV1
      >();
      const current = await scenario(persistence, "closed_before_hash", {
        observeQuery: (query) => {
          observedQueries.set(query.name, query);
        },
      });
      const prepared = await current.store.prepareSeal(current.attempt);
      const journal = await runEffect(
        canonicalizeSessionJournalV1Effect(prepared.journal),
      );
      const result = await runEffect(
        canonicalizeSuccessfulResultV1Effect({ ok: true }),
      );
      const envelope = await current.store.completeSeal(
        prepared.preparation,
        journal,
        result,
      );
      const loadedAttempt = await current.loading.load(selectorWire(
        current.anchor,
      ));
      const authentication = createStoredAttemptAuthenticationV1(
        current.loader,
      );
      const authority = await runEffect(
        authentication.deriveAuthority(loadedAttempt),
      );
      const before = await attemptTimestamps(
        persistence,
        current.anchor.sessionId,
      );

      const digestEntered = deferredSignal();
      const releaseDigest = deferredSignal();
      const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
      let gatedDigest = false;
      const digestSpy = vi.spyOn(crypto.subtle, "digest").mockImplementation(
        async (algorithm, data) => {
          if (!gatedDigest) {
            gatedDigest = true;
            digestEntered.resolve();
            await releaseDigest.promise;
          }
          return originalDigest(algorithm, data);
        },
      );
      const authenticationPromise = runEffect(authentication.authenticate(
        authority,
        encodeEnvelope(envelope),
      ));
      await digestEntered.promise;

      const locker = await persistence.pool.connect();
      let lockTransactionOpen = false;
      try {
        await locker.query("begin");
        lockTransactionOpen = true;
        await locker.query("set local lock_timeout = '2s'");
        await locker.query(`
          lock table
            fx_system_tx_session,
            fx_system_snapshot_lease,
            fx_system_tx_journal,
            fx_system_tx_journal_point
          in access exclusive mode nowait
        `);
        await locker.query("rollback");
        lockTransactionOpen = false;
      } finally {
        if (lockTransactionOpen) {
          await locker.query("rollback").catch(() => undefined);
        }
        locker.release();
        releaseDigest.resolve();
      }
      let authenticated: Awaited<typeof authenticationPromise>;
      try {
        authenticated = await authenticationPromise;
      } finally {
        releaseDigest.resolve();
        digestSpy.mockRestore();
      }

      expect(authentication.isAuthenticated(authenticated)).toBe(true);
      expect(await attemptTimestamps(
        persistence,
        current.anchor.sessionId,
      )).toEqual(before);
      const plans = await lookupPlans(persistence, observedQueries);
      expect(plans.session).toContain("Index Scan");
      expect(plans.session).toContain("session_id");
      expect(plans.sessionPrimaryKey).toContain("scope_uuid, session_id");
      expect(plans.lease).toContain(
        "fx_system_snapshot_lease_scope_uuid_session_id_pk",
      );
      expect(plans.root).toContain("fx_system_tx_journal_pk");
      expect(plans.points).toContain("fx_system_tx_journal_point_pk");
    });
  }, 120_000);

  it("linearizes seal/load and treats detached success as non-authoritative", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const racing = await scenario(persistence, "seal_load_race");
      const prepared = await racing.store.prepareSeal(racing.attempt);
      const journal = await runEffect(
        canonicalizeSessionJournalV1Effect(prepared.journal),
      );
      const result = await runEffect(
        canonicalizeSuccessfulResultV1Effect(null),
      );
      const [loadResult, envelope] = await Promise.all([
        racing.loader.load(racing.authority),
        racing.store.completeSeal(prepared.preparation, journal, result),
      ]);
      expect(["loaded", "notPlannable"]).toContain(loadResult.kind);
      if (loadResult.kind === "loaded") {
        expect(loadResult.evidence.root.sealedFinalSyscallSequence).toBe(0n);
      } else {
        expect(loadResult).toMatchObject({
          kind: "notPlannable",
          reason: "rootNotSealed",
        });
      }

      const loadedAttempt = await racing.loading.load(selectorWire(
        racing.anchor,
      ));
      const authentication = createStoredAttemptAuthenticationV1(
        racing.loader,
      );
      const authority = await runEffect(
        authentication.deriveAuthority(loadedAttempt),
      );
      const authenticated = await runEffect(authentication.authenticate(
        authority,
        encodeEnvelope(envelope),
      ));
      expect(authentication.isAuthenticated(authenticated)).toBe(true);

      await persistence.query(
        `
          update fx_system_tx_session
          set lifecycle = 'expired', updated_at = clock_timestamp()
          where session_id = $1
        `,
        [racing.anchor.sessionId],
      );
      expect(authentication.isAuthenticated(authenticated)).toBe(true);
      await expect(racing.loader.load(racing.authority)).resolves
        .toMatchObject({
          kind: "notPlannable",
          reason: "lifecycle",
          lifecycle: "expired",
        });
    });
  }, 120_000);
});

interface Scenario {
  readonly anchor: PointMutationSessionAnchorV1;
  readonly authority: Parameters<
    ReturnType<typeof createStoredAttemptEvidenceLoaderV1>["load"]
  >[0];
  readonly store: ReturnType<typeof createSessionJournalStorePersistenceV1>;
  readonly attempt: ReturnType<
    ReturnType<typeof createSessionJournalStorePersistenceV1>["openAttempt"]
  >;
  readonly loader: ReturnType<typeof createStoredAttemptEvidenceLoaderV1>;
  readonly loading: ReturnType<
    typeof createPointMutationSessionAttemptLoadingV1
  >;
}

async function scenario(
  persistence: PostgresFlarexPersistence,
  label: string,
  loaderOptions: StoredAttemptEvidenceLoaderOptionsV1 = {},
): Promise<Scenario> {
  const randomUuid = uuidFactory("94000000");
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    `deployment_stored_attempt_postgres_${label}`,
  );
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    `schema_stored_attempt_postgres_${label}`,
  );
  const locator = sharedLocator(`stored-attempt-${label}`);
  const provisioned = await createPostgresSharedScopeAuthorityProvisioner(
    persistence,
    { physicalLocator: locator, randomUuid },
  ).ensure({
    deploymentId,
    projectId: `project_stored_attempt_postgres_${label}`,
  });
  const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
  await setFlarexActivationClock(persistence, scopeId);
  await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    tables: [appTable("users")],
    indexes: [],
  });
  const ports = resolutionPorts(persistence);
  const activation = await createPointMutationSessionActivationPersistenceV1(
    ports,
    { leaseDurationMilliseconds: 60_000, randomUuid },
  ).activate(pointMutationSessionActivationFixture(
    deploymentId,
    scopeId,
    { evidence: { schemaVersionId } },
  ));
  const store = createSessionJournalStorePersistenceV1(ports, {
    randomUuid,
  });
  const attempt = store.openAttempt({
    selector: {
      deploymentId,
      scopeId,
      sessionId: activation.anchor.sessionId,
      attemptFence: activation.anchor.attemptFence,
    },
    snapshotToken: activation.anchor.snapshotToken,
    schemaVersionId,
  });
  return Object.freeze({
    anchor: activation.anchor,
    authority: Object.freeze({
      deploymentId,
      scopeId,
      sessionId: activation.anchor.sessionId,
      attemptFence: activation.anchor.attemptFence,
      storageGeneration: activation.anchor.storageGeneration,
      storageGenerationFence: activation.anchor.storageGenerationFence,
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId,
    }),
    store,
    attempt,
    loader: createStoredAttemptEvidenceLoaderV1(ports, loaderOptions),
    loading: createPointMutationSessionAttemptLoadingV1(
      createPointMutationSessionAttemptLoadPersistenceV1(ports),
    ),
  });
}

function resolutionPorts(
  persistence: PostgresFlarexPersistence,
): PointMutationSessionAuthorityResolutionPortsV1 {
  return {
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("Shared placement must not read split receipts.");
      },
    },
    scopeSessionTargets: {
      resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
        createPostgresLocatedPointMutationSessionActivationTargetV1(
          persistence,
          physicalLocator,
        ),
    },
  };
}

function selectorWire(
  anchor: PointMutationSessionAnchorV1,
): PointMutationSessionAttemptSelectorWireV1 {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence.toString(),
  });
}

function sharedLocator(
  databaseKey: string,
): SharedDatabaseScopePhysicalLocator {
  return Object.freeze({
    kind: "shared_database",
    databaseKey,
    schemaName: "public",
  });
}

function appTable(
  logicalName: string,
): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: {
        type: "object",
        value: {
          name: {
            fieldType: { type: "string" },
            optional: true,
          },
        },
      },
    },
  };
}

function uuidFactory(prefix: string): () => string {
  let sequence = 1;
  return () => {
    const suffix = sequence.toString().padStart(12, "0");
    sequence += 1;
    return `${prefix}-0000-4000-8000-${suffix}`;
  };
}

async function attemptTimestamps(
  persistence: PostgresFlarexPersistence,
  sessionId: PointMutationSessionAnchorV1["sessionId"],
): Promise<Readonly<Record<string, string>>> {
  const result = await persistence.query<Readonly<Record<string, string>>>(
    `
      select
        (select updated_at::text from fx_system_tx_session
          where session_id = $1) as session_updated_at,
        (select updated_at::text from fx_system_tx_journal
          where session_id = $1) as root_updated_at
    `,
    [sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing attempt timestamps.");
  return row;
}

async function lookupPlans(
  persistence: PostgresFlarexPersistence,
  queries: ReadonlyMap<
    StoredAttemptEvidenceQueryV1["name"],
    StoredAttemptEvidenceQueryV1
  >,
): Promise<Readonly<Record<
  "session" | "sessionPrimaryKey" | "lease" | "root" | "points",
  string
>>> {
  const client = await persistence.pool.connect();
  try {
    await client.query("set enable_seqscan = off");
    const sessionPrimaryKey = await client.query<{ definition: string }>(`
      select pg_get_indexdef(indexrelid) as definition
      from pg_index
      where indrelid = 'fx_system_tx_session'::regclass
        and indisprimary
    `);
    const sessionPrimaryKeyDefinition =
      sessionPrimaryKey.rows[0]?.definition;
    if (sessionPrimaryKeyDefinition === undefined) {
      throw new Error("Missing transaction-session primary key.");
    }
    return Object.freeze({
      session: await explainObserved(
        client,
        requireObservedQuery(queries, "session"),
      ),
      sessionPrimaryKey: sessionPrimaryKeyDefinition,
      lease: await explainObserved(
        client,
        requireObservedQuery(queries, "lease"),
      ),
      root: await explainObserved(
        client,
        requireObservedQuery(queries, "root"),
      ),
      points: await explainObserved(
        client,
        requireObservedQuery(queries, "points"),
      ),
    });
  } finally {
    client.release();
  }
}

function requireObservedQuery(
  queries: ReadonlyMap<
    StoredAttemptEvidenceQueryV1["name"],
    StoredAttemptEvidenceQueryV1
  >,
  name: StoredAttemptEvidenceQueryV1["name"],
): StoredAttemptEvidenceQueryV1 {
  const query = queries.get(name);
  if (query === undefined) {
    throw new Error(`Loader did not execute its ${name} query.`);
  }
  return query;
}

async function explainObserved(
  client: {
    query(
      text: string,
      values?: readonly unknown[],
    ): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
  },
  query: StoredAttemptEvidenceQueryV1,
): Promise<string> {
  const result = await client.query(
    `explain (format json) ${query.sql}`,
    query.params,
  );
  return JSON.stringify(result.rows);
}

function deferredSignal(): Readonly<{
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}> {
  let resolver: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return Object.freeze({
    promise,
    resolve: () => resolver?.(),
  });
}

function runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}
