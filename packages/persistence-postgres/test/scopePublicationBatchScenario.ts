import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import {
  writeCe0PublicationReference,
  advanceCe0PublicationReference,
} from "./ce0PublicationReference";
import {
  createCommittedPointOutcomeResolverV1,
  CommittedPointOutcomeRequestKeyReuseErrorV1,
} from "../src/committedPointOutcome";
import { expect } from "vitest";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import {
  appRowIdHexV1ToBytes,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import { FLAREX_VALUE_CODEC_VERSION_V1 } from "flarex-protocol/value";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
  FlarexDbV1StorageGenerationSchema,
  decodeReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionRequestSha256V1Schema,
  TransactionAuthorizationRevocationEpochSchema,
} from "flarex-protocol/transaction-session";
import {
  writeScopePublicationPrefix,
  advanceScopePublicationClock,
} from "../src/commitPublication/publication";
import {
  ScopePublicationCorruptionError,
  type ScopePublicationContribution,
  type ScopePublicationKernel,
  type ScopePublicationOptions,
} from "../src/commitPublication/scopePublicationModel";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  getScopeClock,
  lockScopeClockForUpdateInTransactionEffect,
  lockScopeClockForSnapshotReadInTransactionEffect,
  openExactAttemptScopeClockObservation,
  closeExactAttemptScopeClockObservation,
} from "../src/scopeClock";
import {
  fxAppRowRevisions,
  fxSystemCommitAppRowChanges,
  fxSystemCommits,
  fxSystemIdempotency,
  fxSystemCommitWakes,
  fxSystemScopeClocks,
} from "../src/schema";
import { runEffect } from "./effectTestRuntime";

export type PublicationCandidate = "core" | "reference";
const publicationTime = new Date(1_725_000_000_000);

/** Tests both private publication persistence candidates, not participant admission. */
export async function scopePublicationBatchScenario(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
) {
  for (const count of [0, 1, 499, 500, 501, 1000, 1001]) {
    let expectedState: string | undefined;
    for (const candidate of ["core", "reference"] as const) {
      const fixture = await createScopePublicationFixture(persistence, count);
      const { readState } = fixture;
      const publish = (failAtBatch?: number) =>
        fixture.publish(
          candidate,
          failAtBatch === undefined ? {} : { failAtBatch },
        );
      const before = await readState();
      if (count === 1001) {
        for (const failAt of [1, 2, 3]) {
          const failed = publish(failAt);
          await expect(failed.work).rejects.toThrow(
            "Deliberate batch rollback",
          );
          expect(failed.steps()).toBe(failAt);
          expect(await readState()).toEqual(before);
        }
        // Valid SQL shapes with incomplete or out-of-batch RETURNING evidence must roll back.
        for (const body of [
          "return null;",
          "new.change_ordinal := new.change_ordinal + 10000; return new;",
        ]) {
          await persistence.exec(
            `create function fx_test_batch_return() returns trigger language plpgsql as $$ begin ${body} end $$`,
          );
          try {
            await persistence.exec(
              "create trigger fx_test_batch_return before insert on fx_system_commit_app_row_change for each row execute function fx_test_batch_return()",
            );
            await expect(publish().work).rejects.toBeInstanceOf(
              ScopePublicationCorruptionError,
            );
            expect(await readState()).toEqual(before);
          } finally {
            await persistence.exec(
              "drop trigger if exists fx_test_batch_return on fx_system_commit_app_row_change",
            );
            await persistence.exec("drop function fx_test_batch_return()");
          }
        }
      }
      await expect(
        fixture.publish(candidate, { staleClock: true }).work,
      ).rejects.toBeInstanceOf(ScopePublicationCorruptionError);
      expect(await readState()).toEqual(before);
      await expect(
        fixture.publish(candidate, { failBeforeCommit: true }).work,
      ).rejects.toThrow("Deliberate publication rollback");
      expect(await readState()).toEqual(before);
      const published = publish();
      await published.work;
      expect(published.parameters).toEqual(
        Array.from(
          { length: Math.ceil(count / 500) },
          (_, index) => Math.min(500, count - index * 500) * 6,
        ),
      );
      expect(published.steps()).toBe(Math.ceil(count / 500));
      await fixture.verify();
      const after = await readState();
      const normalized = fixture.normalize(after);
      if (expectedState === undefined) expectedState = normalized;
      else expect(normalized).toBe(expectedState);
      await expect(
        fixture.publish(candidate, { nextCommit: true }).work,
      ).rejects.toMatchObject({ operation: "writeOutcome" });
      expect(await readState()).toEqual(after);
    }
  }
}

export async function createScopePublicationFixture(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  count: number,
) {
  const scopeUuid = ScopeUuidV1Schema.make(randomUUID());
  const epochUuid = ScopeEpochUuidV1Schema.make(randomUUID());
  const scopeId = decodeReplacementScopeIdV1(`scope_${scopeUuid}`);
  await persistence.drizzle.insert(fxSystemScopeClocks).values({
    scopeId,
    epoch: ScopeEpochSchema.make(`epoch_${epochUuid}`),
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
  });
  const commitSeq = CommitSeqSchema.make(1n);
  const tableId = CatalogTableIdSchema.make(1);
  const rowIntents = Array.from({ length: count }, (_, index) => ({
    tableId,
    rowId: decodeAppRowIdHexV1((index + 1).toString(16).padStart(32, "0")),
  }));
  const result = await runEffect(
    canonicalizeSuccessfulResultV1Effect({ ok: true, count }),
  );
  const command = {
    authorityPins: {
      scopeId,
      requestKey: TransactionRequestKeyV1Schema.make(randomUUID()),
      functionPath: TransactionFunctionPathV1Schema.make("publication:batch"),
    },
    rowIntents,
    successfulResult: { ...result, encoding: "application-value" },
    resultSha256: Buffer.from(result.evidence.sha256Hex, "hex"),
    requestSha256: new Uint8Array(32).fill(2),
    identityAccessPolicySha256: new Uint8Array(32).fill(3),
  } satisfies ScopePublicationContribution;
  const readState = async () => ({
    rows: await persistence.drizzle
      .select()
      .from(fxAppRowRevisions)
      .where(eq(fxAppRowRevisions.scopeUuid, scopeUuid))
      .orderBy(fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
    facts: await persistence.drizzle
      .select()
      .from(fxSystemCommitAppRowChanges)
      .where(eq(fxSystemCommitAppRowChanges.scopeUuid, scopeUuid))
      .orderBy(fxSystemCommitAppRowChanges.changeOrdinal),
    headers: await persistence.drizzle
      .select()
      .from(fxSystemCommits)
      .where(eq(fxSystemCommits.scopeUuid, scopeUuid)),
    outcomes: await persistence.drizzle
      .select()
      .from(fxSystemIdempotency)
      .where(eq(fxSystemIdempotency.scopeUuid, scopeUuid)),
    wakes: await persistence.drizzle
      .select()
      .from(fxSystemCommitWakes)
      .where(eq(fxSystemCommitWakes.scopeUuid, scopeUuid)),
    clock: await getScopeClock(persistence.drizzle, scopeId),
  });
  const publish = (
    candidate: PublicationCandidate,
    controls: {
      failAtBatch?: number;
      staleClock?: boolean;
      failBeforeCommit?: boolean;
      nextCommit?: boolean;
      beforePublication?: () => void;
      afterPublication?: () => void;
      observeParameters?: boolean;
    } = {},
  ) => {
    const parameters: number[] = [];
    let steps = 0;
    const work = persistence.drizzle.transaction(async (tx) => {
      const record = await runEffect(
        lockScopeClockForUpdateInTransactionEffect(tx, scopeId),
      );
      const commitSeq = CommitSeqSchema.make(controls.nextCommit ? 2n : 1n);
      const kernel = {
        clock: {
          record: controls.staleClock
            ? { ...record, lastCommitSeq: CommitSeqSchema.make(1n) }
            : record,
          scopeUuid,
          epochUuid,
        },
        commitSeq,
        publicationTimeMilliseconds: publicationTime.getTime(),
        relationAdjacencyChanges: [],
      } satisfies ScopePublicationKernel;
      // Pre-existing row owner output is a fixture input to this publication-only proof.
      if (rowIntents.length > 0)
        await tx.insert(fxAppRowRevisions).values(
          rowIntents.map((row) => ({
            scopeUuid,
            tableId,
            rowId: appRowIdHexV1ToBytes(row.rowId),
            commitSeq,
            prevCommitSeq: controls.nextCommit
              ? CommitSeqSchema.make(1n)
              : null,
            writeEpochUuid: epochUuid,
            schemaVersionId: CatalogSchemaVersionIdSchema.make("batch_fixture"),
            creationTime: AppCreationTimeV1Schema.make(1),
            valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
            isTombstone: true,
          })),
        );
      const options = {
        observeQuery: (query: {
          readonly name: string;
          readonly params: readonly unknown[];
        }) => {
          if (
            controls.observeParameters !== false &&
            query.name === "writeCommitChange"
          )
            parameters.push(query.params.length);
        },
        afterTransactionStep: async (event: { readonly step: string }) => {
          if (
            event.step === "commitChangeWritten" &&
            ++steps === controls.failAtBatch
          )
            throw new Error("Deliberate batch rollback");
        },
      };
      const selectedOptions: ScopePublicationOptions =
        controls.observeParameters === false
          ? { afterTransactionStep: options.afterTransactionStep }
          : options;
      controls.beforePublication?.();
      if (candidate === "core") {
        await writeScopePublicationPrefix(tx, command, kernel, selectedOptions);
        openExactAttemptScopeClockObservation(tx, record, TransactionAuthorizationRevocationEpochSchema.make(0n), "attempt");
        try {
          await advanceScopePublicationClock(tx, command, kernel, selectedOptions);
          const refreshed = await runEffect(lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId));
          expect(refreshed.lastCommitSeq).toBe(commitSeq);
          expect(refreshed.updatedAt).toEqual(publicationTime);
        } finally { closeExactAttemptScopeClockObservation(tx); }
      } else {
        await writeCe0PublicationReference(
          tx,
          command,
          kernel,
          selectedOptions,
        );
        await advanceCe0PublicationReference(
          tx,
          command,
          kernel,
          selectedOptions,
        );
      }
      controls.afterPublication?.();
      if (controls.failBeforeCommit)
        throw new Error("Deliberate publication rollback");
    });
    return { work, parameters, steps: () => steps };
  };

  const normalize = (state: Awaited<ReturnType<typeof readState>>) =>
    JSON.stringify(state, (_key, value: unknown) => {
      if (typeof value === "bigint") return value.toString();
      if (value === scopeUuid) return "<scopeUuid>";
      if (value === epochUuid) return "<epochUuid>";
      if (value === scopeId) return "<scopeId>";
      if (value === `epoch_${epochUuid}`) return "<epoch>";
      if (value === command.authorityPins.requestKey) return "<requestKey>";
      return value;
    });
  const verify = async () => {
    const after = await readState();
    expect(after.rows).toHaveLength(count);
    expect(
      after.facts.map((fact) => ({
        tableId: fact.tableId,
        rowId: Buffer.from(fact.rowId).toString("hex"),
        commitSeq: fact.commitSeq,
        changeOrdinal: fact.changeOrdinal,
      })),
    ).toEqual(
      rowIntents.map((row, changeOrdinal) => ({
        ...row,
        commitSeq,
        changeOrdinal,
      })),
    );
    expect(after.headers).toEqual([
      {
        scopeUuid,
        epochUuid,
        commitSeq,
        changeCount: count,
        relationAdjacencyChangeCount: 0,
        payloadPreferenceDeletionCount: 0,
        relationalChangeCount: 0,
        eventCount: 0,
        eventSha256: null,
        committedAt: publicationTime,
      },
    ]);
    expect(after.outcomes).toHaveLength(1);
    expect(after.outcomes[0]).toMatchObject({
      scopeUuid,
      epochUuid,
      commitSeq,
      requestKey: command.authorityPins.requestKey,
      functionPath: command.authorityPins.functionPath,
      resultState: "available",
      resultEncoding: "application-value",
      resultExpiredAt: null,
      createdAt: publicationTime,
    });
    expect(after.wakes).toEqual([
      {
        scopeUuid,
        epochUuid,
        commitSeq,
        deliveryState: "pending",
        createdAt: publicationTime,
        nextAttemptAt: publicationTime,
        claimFence: 0n,
        claimOwner: null,
        claimedAt: null,
        claimExpiresAt: null,
        lastFailureCode: null,
        lastFailureSummary: null,
        lastFailedAt: null,
        deliveredAt: null,
        deadLetteredAt: null,
      },
    ]);
    expect(after.clock?.lastCommitSeq).toBe(1n);
    const resolver = createCommittedPointOutcomeResolverV1(persistence.drizzle);
    const input = {
      scopeUuid,
      requestKey: command.authorityPins.requestKey,
      expectedFunctionPath: command.authorityPins.functionPath,
      expectedIdentityAccessPolicySha256:
        TransactionIdentityAccessPolicySha256V1Schema.make(
          command.identityAccessPolicySha256,
        ),
      expectedRequestSha256: TransactionRequestSha256V1Schema.make(
        command.requestSha256,
      ),
    };
    const outcome = await runEffect(resolver.resolve(input));
    expect(outcome).toMatchObject({
      kind: "available",
      token: { scopeUuid, epochUuid, commitSeq },
    });
    if (outcome.kind !== "available")
      throw new Error("Missing publication result.");
    expect(Buffer.from(outcome.successfulResult.canonicalBytes)).toEqual(
      Buffer.from(result.canonicalBytes),
    );
    expect(Buffer.from(outcome.successfulResult.sha256)).toEqual(
      Buffer.from(command.resultSha256),
    );
    expect(outcome.successfulResult.semanticSizeBytes).toBe(
      result.semanticSizeBytes,
    );
    const reused = await runEffect(
      resolver
        .resolve({
          ...input,
          expectedRequestSha256: TransactionRequestSha256V1Schema.make(
            new Uint8Array(32).fill(4),
          ),
        })
        .pipe(Effect.result),
    );
    expect(Result.isFailure(reused)).toBe(true);
    if (Result.isFailure(reused))
      expect(reused.failure).toBeInstanceOf(
        CommittedPointOutcomeRequestKeyReuseErrorV1,
      );
    expect(await readState()).toEqual(after);
  };
  return { publish, readState, normalize, verify };
}
