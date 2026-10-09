import { createHash } from "node:crypto";
import { lockInstallationForCurrentTransaction, closeInstallationAdmission, requireAdmittedTargetInstallationSchema } from "../../../src/installation/installationLifecycle";
import { expect } from "vitest";
import { Effect, Result, Schema } from "effect";
import { and, eq, getTableName, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  type ScopeId,
  type ScopeEpoch,
  projectScopeIdUuidV1,
} from "flarex-protocol/storage-authority";
import { orderedIndexValueFromFlarexValueV1 } from "flarex-protocol/ordered-index";
import type { FlarexPersistence } from "../../../src";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import {
  appendPreparedAppRowRevisionsInTransactionEffect,
  type AppendPreparedLiveAppRowRevisionV1Input,
} from "../../../src/storage/documents/appRows";
import { canonicalizeAppUniqueKeyV1Result, decodeAppUniqueConstraintIdV1Result } from "../../../src/storage/unique/appUniqueKeyContract";
import {
  applyAppUniqueKeyMutationsInTransactionEffect,
  type ApplyAppUniqueKeyMutationV1Input,
  AppUniqueKeyConflictError,
  AppUniqueKeyStorageCorruptionError,
  AppUniqueKeyPersistenceError,
  AppUniqueKeyScopeAuthorityUnavailableError,
  AppUniqueKeyPreviousClaimMismatchError,
  InvalidAppUniqueKeyMutationV1Error,
  CanonicalAppUniqueKeyHashCollisionError,
  prepareAppUniqueMutationApplicationEffect,
  preparedAppUniqueApplicationFailure,
} from "../../../src/storage/unique/appUniqueKeys";
import { runEffect } from "../../support/effectTestRuntime";
import { fxAppUniqueKeys, fxAppRowRevisions, fxAppRowCurrent } from "../../../src/database/schema";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { applicationDomainFailureDetail } from "../../../src/storage/materialization/domainApplication";

export async function verifyUniqueBatches(
  persistence: Pick<FlarexPersistence, "query">,
  db: FlarexMetadataDatabase,
  scopeId: ScopeId,
  writeEpoch: ScopeEpoch,
  observeCaughtRollback: (run: () => Promise<void>) => Promise<void> = run => run(),
) {
  const fixtureCommand = (statement: string) => Effect.tryPromise({ try: () => persistence.query(statement),
    catch: cause => new Error("Unique batch fixture SQL", { cause }) });
  const schemaName = await db.transaction(async tx => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try { return await runEffect(Effect.fromResult(requireAdmittedTargetInstallationSchema(tx))); }
    finally { closeInstallationAdmission(tx); }
  });
  const qualifiedName = (name: string) => new PgDialect().sqlToQuery(sql`${sql.identifier(schemaName)}.${sql.identifier(name)}`).sql;
  const uniqueTableName = new PgDialect().sqlToQuery(sql`${sql.identifier(schemaName)}.${sql.identifier(getTableName(fxAppUniqueKeys))}`).sql;
  const apply = (inputs: readonly ApplyAppUniqueKeyMutationV1Input[]) =>
    db.transaction(async (tx) => {
      await runEffect(lockInstallationForCurrentTransaction(tx));
      try {
        return await runEffect(applyAppUniqueKeyMutationsInTransactionEffect(tx, inputs));
      } finally { closeInstallationAdmission(tx); }
    },
    );
  expect(await apply([])).toEqual([]);
  for (const count of [1, 32, 33, 128]) {
    const tableId = decodeCatalogTableId(1);
    const constraintId = Result.getOrThrow(
      decodeAppUniqueConstraintIdV1Result(count + 10),
    );
    const creationTime = decodeAppCreationTimeV1(42);
    const rows: AppendPreparedLiveAppRowRevisionV1Input[] = [];
    const actions: ApplyAppUniqueKeyMutationV1Input[] = [];
    for (let i = 0; i < count; i += 1) {
      const rowId = decodeAppRowIdHexV1(
        (count * 1000 + i).toString(16).padStart(32, "0"),
      );
      rows.push({
        kind: "live",
        scopeId,
        writeEpoch,
        tableId,
        rowId,
        creationTime,
        schemaVersionId: decodeCatalogSchemaVersionId("ce1_unique_batch"),
        commitSeq: CommitSeqSchema.make(1n),
        prevCommitSeq: null,
        document: await canonicalizeAppDocumentV1({
          tableId,
          rowId,
          creationTime,
          fields: { ordinal: i },
        }),
      });
      actions.push({
        scopeId,
        writeEpoch,
        constraintId,
        tableId,
        rowId,
        previous: null,
        next: {
          sparse: false,
          localeKey: null,
          values: [orderedIndexValueFromFlarexValueV1(`key_${i}`)],
        },
      });
    }
    await db.transaction(async (tx) => {
      await runEffect(lockInstallationForCurrentTransaction(tx));
      try {
        return await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, rows));
      } finally { closeInstallationAdmission(tx); }
    },
    );
    const first = actions[0];
    const last = actions.at(-1);
    if (first === undefined || last === undefined)
      throw new Error("Missing unique actions");
    const state = () => db.select().from(fxAppUniqueKeys).where(and(
      eq(fxAppUniqueKeys.scopeUuid, projectScopeIdUuidV1(scopeId).scopeUuid), eq(fxAppUniqueKeys.constraintId, constraintId)))
      .orderBy(fxAppUniqueKeys.rowId);
    const completeState = async () => ({
      claims: await state(),
      rows: await db.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, projectScopeIdUuidV1(scopeId).scopeUuid))
        .orderBy(fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
      pointers: await db.select().from(fxAppRowCurrent).where(eq(fxAppRowCurrent.scopeUuid, projectScopeIdUuidV1(scopeId).scopeUuid))
        .orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId),
    });
    // Trigger claims use the genuine canonical contract and SHA256 over its
    // exact bytes. Only the absence obligation is violated.
    const hiddenKey = Result.getOrThrow(canonicalizeAppUniqueKeyV1Result({
      sparse: false, localeKey: null, values: [orderedIndexValueFromFlarexValueV1("hidden_owner_claim")],
    }));
    if (hiddenKey.kind !== "claim") throw new Error("Missing canonical hidden claim");
    const hiddenDigest = createHash("sha256").update(hiddenKey.canonicalKeyBytes).digest("hex");
    const hiddenInsert = (source: "NEW" | "OLD") => `insert into ${uniqueTableName}
      ("${fxAppUniqueKeys.scopeUuid.name}", "${fxAppUniqueKeys.constraintId.name}", "${fxAppUniqueKeys.localeKey.name}",
       "${fxAppUniqueKeys.canonicalKeySha256.name}", "${fxAppUniqueKeys.keyCodecVersion.name}", "${fxAppUniqueKeys.encodedKey.name}",
       "${fxAppUniqueKeys.tableId.name}", "${fxAppUniqueKeys.rowId.name}")
      values (${source}."${fxAppUniqueKeys.scopeUuid.name}", ${source}."${fxAppUniqueKeys.constraintId.name}", '',
        decode('${hiddenDigest}', 'hex'), ${hiddenKey.keyCodecVersion}, decode('${hiddenKey.encodedKey}', 'hex'),
        ${source}."${fxAppUniqueKeys.tableId.name}", decode('${first.rowId}', 'hex'));`;
    const caught = (values: readonly ApplyAppUniqueKeyMutationV1Input[], inspect?: (failure: AppUniqueKeyStorageCorruptionError) => void) => observeCaughtRollback(() => db.transaction(async (tx) => {
      await runEffect(lockInstallationForCurrentTransaction(tx));
      try {
        const refusal = await runEffect(Effect.result(applyAppUniqueKeyMutationsInTransactionEffect(tx, values)));
        expect(Result.isFailure(refusal)).toBe(true);
        if (Result.isSuccess(refusal)) throw new Error("Corrupt unique batch was accepted");
        if (!(refusal.failure instanceof AppUniqueKeyStorageCorruptionError)) throw refusal.failure;
        expect(refusal.failure).toBeInstanceOf(AppUniqueKeyStorageCorruptionError);
        expect(refusal.failure.cause).toMatchObject({ cause: { code: "FX001" } });
        inspect?.(refusal.failure);
        await expect(tx.execute(sql`select 1`)).rejects.toMatchObject({ cause: { code: "25P02" } });
      } finally { closeInstallationAdmission(tx); }
    }));
    await expect(apply([first, first])).rejects.toBeInstanceOf(
      InvalidAppUniqueKeyMutationV1Error,
    );
    await expect(
      apply([
        {
          ...first,
          writeEpoch: ScopeEpochSchema.make(
            "epoch_00000000-0000-0000-0000-000000000001",
          ),
        },
      ]),
    ).rejects.toBeInstanceOf(AppUniqueKeyScopeAuthorityUnavailableError);
    if (count > 1) {
      await expect(
        apply(actions.map((action) => ({ ...action, next: first.next }))),
      ).rejects.toBeInstanceOf(AppUniqueKeyConflictError);
      await expect(
        db.transaction(async (tx) => {
          await runEffect(lockInstallationForCurrentTransaction(tx));
          try {
            return await runEffect(
              applyAppUniqueKeyMutationsInTransactionEffect(
                tx,
                actions,
                async () => new Uint8Array(32).fill(7),
              ),
            );
          } finally { closeInstallationAdmission(tx); }
        },
        ),
      ).rejects.toBeInstanceOf(CanonicalAppUniqueKeyHashCollisionError);
      expect(await state()).toHaveLength(0);
    }
    if (count === 33) {
      await runEffect(Effect.scoped(Effect.gen(function* () {
        yield* Effect.acquireRelease(fixtureCommand(`create function corrupt_unique_batch() returns trigger language plpgsql as $$
          begin if new.row_id = decode('${last.rowId}', 'hex') then
            new.encoded_key := new.encoded_key || decode('00','hex'); end if; return new; end $$`),
          () => fixtureCommand("drop function corrupt_unique_batch()").pipe(Effect.orDie));
        yield* Effect.acquireRelease(fixtureCommand(
          "create trigger corrupt_unique_batch before insert on fx_app_unique_key for each row execute function corrupt_unique_batch()",
        ), () => fixtureCommand("drop trigger corrupt_unique_batch on fx_app_unique_key").pipe(Effect.orDie));
        yield* Effect.tryPromise({ try: async () => {
          await expect(apply(actions)).rejects.toBeInstanceOf(AppUniqueKeyStorageCorruptionError);
          await caught(actions);
          expect(await state()).toHaveLength(0);
        }, catch: cause => new Error("Unique batch BEFORE witness", { cause }) }).pipe(Effect.uninterruptible);
      })));
      await runEffect(Effect.scoped(Effect.gen(function* () {
        yield* Effect.acquireRelease(fixtureCommand(`create function corrupt_unique_batch_after() returns trigger language plpgsql as $$
          begin if new.row_id = decode('${last.rowId}', 'hex') then
            update ${uniqueTableName} set "${fxAppUniqueKeys.encodedKey.name}" = "${fxAppUniqueKeys.encodedKey.name}" || decode('00','hex')
              where "${fxAppUniqueKeys.scopeUuid.name}" = NEW."${fxAppUniqueKeys.scopeUuid.name}"
                and "${fxAppUniqueKeys.constraintId.name}" = NEW."${fxAppUniqueKeys.constraintId.name}"
                and "${fxAppUniqueKeys.localeKey.name}" = NEW."${fxAppUniqueKeys.localeKey.name}"
                and "${fxAppUniqueKeys.canonicalKeySha256.name}" = NEW."${fxAppUniqueKeys.canonicalKeySha256.name}";
          end if; return new; end $$`), () => fixtureCommand("drop function corrupt_unique_batch_after()").pipe(Effect.orDie));
        yield* Effect.acquireRelease(fixtureCommand("create trigger corrupt_unique_batch_after after insert on fx_app_unique_key for each row execute function corrupt_unique_batch_after()"),
          () => fixtureCommand("drop trigger corrupt_unique_batch_after on fx_app_unique_key").pipe(Effect.orDie));
        yield* Effect.tryPromise({ try: async () => {
          await caught(actions);
          expect(await state()).toHaveLength(0);
        }, catch: cause => new Error("Unique batch AFTER witness", { cause }) }).pipe(Effect.uninterruptible);
      })));
      const omittedInputs = actions.map((action, ordinal) => ordinal === 0 ? { ...action,
        next: { sparse: true, localeKey: null, values: [{ kind: "missing" as const }] },
      } : action);
      const beforeHiddenOmittedClaim = await completeState();
      await runEffect(Effect.scoped(Effect.gen(function* () {
        const functionName = qualifiedName("hidden_omitted_unique_after");
        yield* Effect.acquireRelease(fixtureCommand(`create function ${functionName}() returns trigger language plpgsql as $$
          begin if NEW."${fxAppUniqueKeys.rowId.name}" = decode('${last.rowId}', 'hex') then
            ${hiddenInsert("NEW")}
          end if; return NEW; end $$`), () => fixtureCommand(`drop function ${functionName}()`).pipe(Effect.orDie));
        yield* Effect.acquireRelease(fixtureCommand(`create trigger hidden_omitted_unique_after after insert on ${uniqueTableName}
          for each row execute function ${functionName}()`),
          () => fixtureCommand(`drop trigger hidden_omitted_unique_after on ${uniqueTableName}`).pipe(Effect.orDie));
        yield* Effect.tryPromise({ try: async () => {
          await caught(omittedInputs, failure => {
            expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({
              kind: Schema.Literal("proof"), releaseOffset: Schema.Literal(0), releaseCount: Schema.Literal(0),
              claimOffset: Schema.Literal(0), claimCount: Schema.Literal(32),
              detail: Schema.fromJsonString(Schema.Struct({
                reason: Schema.Literal("storedCorruption"), phase: Schema.Literal("absentOwner"),
                stage: Schema.Literal("verify"), ordinal: Schema.Literal(0),
                actualTableId: Schema.Null, actualRowIdHex: Schema.Null, actualKeyHex: Schema.Null, actualCodec: Schema.Null,
              })),
            })), { onExcessProperty: "error" })(applicationDomainFailureDetail(failure.cause, "fx_apply_app_unique_mutations"))).toEqual({
              kind: "proof", releaseOffset: 0, releaseCount: 0, claimOffset: 0, claimCount: 32,
              detail: { reason: "storedCorruption", phase: "absentOwner", stage: "verify", ordinal: 0,
                actualTableId: null, actualRowIdHex: null, actualKeyHex: null, actualCodec: null },
            });
          });
          expect(await completeState()).toEqual(beforeHiddenOmittedClaim);
        }, catch: cause => new Error("Unique omitted owner hidden-claim AFTER witness", { cause }) }).pipe(Effect.uninterruptible);
      })));
      const beforeEarlierPageTamper = await state();
      await runEffect(Effect.scoped(Effect.gen(function* () {
        yield* Effect.acquireRelease(fixtureCommand(`create function corrupt_earlier_unique_batch_after() returns trigger language plpgsql as $$
          begin if new.row_id = decode('${last.rowId}', 'hex') then
            update ${uniqueTableName} set "${fxAppUniqueKeys.encodedKey.name}" = "${fxAppUniqueKeys.encodedKey.name}" || decode('00','hex')
              where "${fxAppUniqueKeys.scopeUuid.name}" = NEW."${fxAppUniqueKeys.scopeUuid.name}"
                and "${fxAppUniqueKeys.constraintId.name}" = NEW."${fxAppUniqueKeys.constraintId.name}"
                and "${fxAppUniqueKeys.localeKey.name}" = NEW."${fxAppUniqueKeys.localeKey.name}"
                and "${fxAppUniqueKeys.tableId.name}" = NEW."${fxAppUniqueKeys.tableId.name}"
                and "${fxAppUniqueKeys.rowId.name}" = decode('${first.rowId}', 'hex');
          end if; return new; end $$`), () => fixtureCommand("drop function corrupt_earlier_unique_batch_after()").pipe(Effect.orDie));
        yield* Effect.acquireRelease(fixtureCommand("create trigger corrupt_earlier_unique_batch_after after insert on fx_app_unique_key for each row execute function corrupt_earlier_unique_batch_after()"),
          () => fixtureCommand("drop trigger corrupt_earlier_unique_batch_after on fx_app_unique_key").pipe(Effect.orDie));
        yield* Effect.tryPromise({ try: async () => {
          await caught(actions, failure => {
            expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({
              kind: Schema.Literal("proof"), releaseOffset: Schema.Literal(0), releaseCount: Schema.Literal(0),
              claimOffset: Schema.Literal(32), claimCount: Schema.Literal(1),
              detail: Schema.fromJsonString(Schema.Struct({
                reason: Schema.Literal("storedCorruption"), phase: Schema.Literal("claim"),
                stage: Schema.Literal("verify"), ordinal: Schema.Literal(0),
                actualTableId: Schema.Null, actualRowIdHex: Schema.Null, actualKeyHex: Schema.Null, actualCodec: Schema.Null,
              })),
            })), { onExcessProperty: "error" })(applicationDomainFailureDetail(failure.cause, "fx_apply_app_unique_mutations"))).toEqual({
              kind: "proof", releaseOffset: 0, releaseCount: 0, claimOffset: 32, claimCount: 1,
              detail: { reason: "storedCorruption", phase: "claim", stage: "verify", ordinal: 0,
                actualTableId: null, actualRowIdHex: null, actualKeyHex: null, actualCodec: null },
            });
          });
          expect(await state()).toEqual(beforeEarlierPageTamper);
        }, catch: cause => new Error("Unique batch earlier-page AFTER witness", { cause }) }).pipe(Effect.uninterruptible);
      })));
    }
    expect((await apply(actions)).map((result) => result.status)).toEqual(
      actions.map(() => "claimed"),
    );
    const initial = await state();
    if (count === 1) {
      await db.transaction(async tx => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
          // The prepared transitions belong to this genuine admitted owner.
          // Only the foreign error record is varied to exercise the decoder's
          // exact reachable primitive-invocation contract.
          const combined = await runEffect(prepareAppUniqueMutationApplicationEffect(tx, [{ ...first,
            previous: first.next, next: { sparse: false, localeKey: null,
              values: [orderedIndexValueFromFlarexValueV1("replacement_decoder_claim")] } }]));
          expect(combined.releases).toHaveLength(1);
          expect(combined.claims).toHaveLength(1);
          const nativeProof = (releaseCount: number, claimCount: number, phase: "claim" | "absentOwner") => ({
            code: "FX001", message: "fx_apply_app_unique_mutations", detail: JSON.stringify({ kind: "proof",
              releaseOffset: 0, releaseCount, claimOffset: 0, claimCount,
              detail: JSON.stringify({ reason: "storedCorruption", phase, stage: "verify", ordinal: 0,
                actualTableId: null, actualRowIdHex: null, actualKeyHex: null, actualCodec: null }),
            }),
          });
          for (const [releaseCount, claimCount] of [[0, 0], [0, 1], [1, 0]] as const) {
            const cause = nativeProof(releaseCount, claimCount, "claim");
            const failure = preparedAppUniqueApplicationFailure(cause, combined);
            expect(failure).toBeInstanceOf(AppUniqueKeyPersistenceError);
            expect(failure.cause).toBe(cause);
          }
          const canonicalCombinedCause = nativeProof(1, 1, "claim");
          const canonicalCombinedFailure = preparedAppUniqueApplicationFailure(canonicalCombinedCause, combined);
          expect(canonicalCombinedFailure).toBeInstanceOf(AppUniqueKeyStorageCorruptionError);
          expect(canonicalCombinedFailure.cause).toBe(canonicalCombinedCause);

          // No write pages are invoked for a retained-only transition; an
          // absent-owner obligation genuinely invokes the zero/zero proof.
          const retained = await runEffect(prepareAppUniqueMutationApplicationEffect(tx,
            [{ ...first, previous: first.next, next: first.next }]));
          expect(retained.releases).toHaveLength(0);
          expect(retained.claims).toHaveLength(0);
          expect(retained.absentOwners).toHaveLength(0);
          const retainedCause = nativeProof(0, 0, "claim");
          const retainedFailure = preparedAppUniqueApplicationFailure(retainedCause, retained);
          expect(retainedFailure).toBeInstanceOf(AppUniqueKeyPersistenceError);
          expect(retainedFailure.cause).toBe(retainedCause);

          const absent = await runEffect(prepareAppUniqueMutationApplicationEffect(tx, [{ ...first,
            next: { sparse: true, localeKey: "en", values: [{ kind: "missing" }] } }]));
          expect(absent.releases).toHaveLength(0);
          expect(absent.claims).toHaveLength(0);
          expect(absent.absentOwners).toHaveLength(1);
          const absentCause = nativeProof(0, 0, "absentOwner");
          const absentFailure = preparedAppUniqueApplicationFailure(absentCause, absent);
          expect(absentFailure).toBeInstanceOf(AppUniqueKeyStorageCorruptionError);
          expect(absentFailure.cause).toBe(absentCause);
        } finally { closeInstallationAdmission(tx); }
      });
      expect(await state()).toEqual(initial);
    }
    const omittedLocales = ["en", "fr"].map(localeKey => ({ ...first,
      next: { sparse: true, localeKey, values: [{ kind: "missing" as const }] },
    }));
    expect((await apply(omittedLocales)).map(result => result.status)).toEqual(["omitted", "omitted"]);
    await expect(apply([{ ...first, next: { sparse: true, localeKey: null, values: [{ kind: "missing" }] } }]))
      .rejects.toBeInstanceOf(AppUniqueKeyPreviousClaimMismatchError);
    expect(await state()).toEqual(initial);
    const unchanged = actions.map((action) => ({
      ...action,
      previous: action.next,
    }));
    expect((await apply(unchanged)).map((result) => result.status)).toEqual(
      actions.map(() => "unchanged"),
    );
    expect(await state()).toEqual(initial);
    const releases = actions.map((action) => ({
      ...action,
      previous: action.next,
      next: null,
    }));
    if (count === 33) {
      await runEffect(Effect.scoped(Effect.gen(function* () {
        yield* Effect.acquireRelease(fixtureCommand(`create function omit_unique_delete() returns trigger language plpgsql as $$
          begin if old.row_id = decode('${last.rowId}', 'hex') then return null; end if; return old; end $$`),
          () => fixtureCommand("drop function omit_unique_delete()").pipe(Effect.orDie));
        yield* Effect.acquireRelease(fixtureCommand(
          "create trigger omit_unique_delete before delete on fx_app_unique_key for each row execute function omit_unique_delete()",
        ), () => fixtureCommand("drop trigger omit_unique_delete on fx_app_unique_key").pipe(Effect.orDie));
        yield* Effect.tryPromise({ try: async () => {
          await expect(apply(releases)).rejects.toBeInstanceOf(AppUniqueKeyStorageCorruptionError);
          await caught(releases);
          expect(await state()).toEqual(initial);
        }, catch: cause => new Error("Unique batch release witness", { cause }) }).pipe(Effect.uninterruptible);
      })));
      const beforeHiddenReleasedClaim = await completeState();
      await runEffect(Effect.scoped(Effect.gen(function* () {
        const functionName = qualifiedName("hidden_released_unique_after");
        yield* Effect.acquireRelease(fixtureCommand(`create function ${functionName}() returns trigger language plpgsql as $$
          begin if OLD."${fxAppUniqueKeys.rowId.name}" = decode('${last.rowId}', 'hex') then
            ${hiddenInsert("OLD")}
          end if; return OLD; end $$`), () => fixtureCommand(`drop function ${functionName}()`).pipe(Effect.orDie));
        yield* Effect.acquireRelease(fixtureCommand(`create trigger hidden_released_unique_after after delete on ${uniqueTableName}
          for each row execute function ${functionName}()`),
          () => fixtureCommand(`drop trigger hidden_released_unique_after on ${uniqueTableName}`).pipe(Effect.orDie));
        yield* Effect.tryPromise({ try: async () => {
          await caught(releases, failure => {
            expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({
              kind: Schema.Literal("proof"), releaseOffset: Schema.Literal(32), releaseCount: Schema.Literal(1),
              claimOffset: Schema.Literal(0), claimCount: Schema.Literal(0),
              detail: Schema.fromJsonString(Schema.Struct({
                reason: Schema.Literal("storedCorruption"), phase: Schema.Literal("absentOwner"),
                stage: Schema.Literal("verify"), ordinal: Schema.Literal(0),
                actualTableId: Schema.Null, actualRowIdHex: Schema.Null, actualKeyHex: Schema.Null, actualCodec: Schema.Null,
              })),
            })), { onExcessProperty: "error" })(applicationDomainFailureDetail(failure.cause, "fx_apply_app_unique_mutations"))).toEqual({
              kind: "proof", releaseOffset: 32, releaseCount: 1, claimOffset: 0, claimCount: 0,
              detail: { reason: "storedCorruption", phase: "absentOwner", stage: "verify", ordinal: 0,
                actualTableId: null, actualRowIdHex: null, actualKeyHex: null, actualCodec: null },
            });
          });
          expect(await completeState()).toEqual(beforeHiddenReleasedClaim);
        }, catch: cause => new Error("Unique released owner hidden-claim AFTER witness", { cause }) }).pipe(Effect.uninterruptible);
      })));
    }
    // Swaps use the same release-before-claim contract as shared materialization.
    const swapped = actions.map((action, index) => ({
      ...action,
      next: actions[(index + 1) % count]?.next ?? null,
    }));
    if (count > 1) {
      // Claim-only inputs select no release of the genuine occupied slots.
      await expect(apply(swapped)).rejects.toBeInstanceOf(AppUniqueKeyConflictError);
      expect(await state()).toEqual(initial);
    }
    const combined = await apply(swapped.map((action, index) => ({
      ...action, previous: actions[index]?.next ?? null,
    })));
    const expectedSwapped = initial.map((owner, index) => {
      const next = initial[(index + 1) % count];
      if (next === undefined) throw new Error("Missing exact rotated unique claim");
      return { ...owner, localeKey: next.localeKey, encodedKey: next.encodedKey,
        canonicalKeySha256: next.canonicalKeySha256, keyCodecVersion: next.keyCodecVersion };
    });
    expect(combined).toEqual(expectedSwapped.map(owner => ({
      status: count === 1 ? "unchanged" : "claimed",
      claim: { scopeId, scopeUuid: owner.scopeUuid, constraintId: owner.constraintId, localeKey: owner.localeKey,
        tableId: owner.tableId, rowId: encodeBytesToLowercaseHex(owner.rowId),
        encodedKey: encodeBytesToLowercaseHex(owner.encodedKey), canonicalKeySha256: new Uint8Array(owner.canonicalKeySha256) },
    })));
    expect(await state()).toEqual(expectedSwapped);
    expect(expectedSwapped).toHaveLength(count);
    // The shared materializer can also lower releases and claims as separate
    // operations in one borrowed transaction. Restore the original ownership.
    await db.transaction(async (tx) => {
      await runEffect(lockInstallationForCurrentTransaction(tx));
      try {
        expect((await runEffect(applyAppUniqueKeyMutationsInTransactionEffect(tx,
          swapped.map(action => ({ ...action, previous: action.next, next: null })))))
          .map(result => result.status)).toEqual(actions.map(() => "released"));
        expect((await runEffect(applyAppUniqueKeyMutationsInTransactionEffect(tx, actions)))
          .map(result => result.status)).toEqual(actions.map(() => "claimed"));
      } finally { closeInstallationAdmission(tx); }
    });
    expect(await state()).toEqual(initial);
    expect(
      (
        await apply(releases)
      ).map((result) => result.status),
    ).toEqual(actions.map(() => "released"));
    expect(await state()).toHaveLength(0);
    if (count === 33) {
      // A claim-only recipient may take a slot released by its authentic owner
      // in the same batch. Neither recipient nor donor has a hidden old claim.
      expect((await apply([last])).map(result => result.status)).toEqual(["claimed"]);
      const donorState = await state();
      const donor = donorState[0];
      if (donor === undefined || donorState.length !== 1) throw new Error("Missing exact handoff donor");
      const recipient = { ...first, next: last.next };
      expect(await apply([recipient, { ...last, previous: last.next, next: null }])).toEqual([
        { status: "claimed", claim: { scopeId, scopeUuid: donor.scopeUuid, constraintId, tableId, rowId: first.rowId,
          localeKey: donor.localeKey, encodedKey: encodeBytesToLowercaseHex(donor.encodedKey),
          canonicalKeySha256: new Uint8Array(donor.canonicalKeySha256) } },
        { status: "released", claim: null },
      ]);
      expect((await state()).map(owner => ({ ...owner, rowId: encodeBytesToLowercaseHex(owner.rowId) })))
        .toEqual([{ ...donor, rowId: first.rowId }]);
      expect((await apply([{ ...recipient, previous: recipient.next, next: null }])).map(result => result.status)).toEqual(["released"]);
      expect(await state()).toHaveLength(0);
    }
  }
}
