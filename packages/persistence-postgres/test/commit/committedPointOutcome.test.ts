import { createTestPGlite } from "../support/pgliteSearchExtensions";
import {
  createMigratedPGlitePersistence,
  createFileScopedPGliteFixture,
  migratedPGliteDataDir,
  useFileScopedPGliteCommitSchemaPersistence,
} from "../support/pgliteTestFixture";
import { Effect, Exit } from "effect";
import { drizzle } from "drizzle-orm/node-postgres";
import { MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1 } from "flarex-protocol/commit-protocol";
import { isJsonObject } from "flarex-protocol/json";
import {
  TransactionFunctionPathV1Schema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionRequestSha256V1Schema,
} from "flarex-protocol/transaction-session";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import * as persistenceRoot from "../../src";
import { flarexSchema } from "../../src/database/schema";
import {
  CommittedPointOutcomeCorruptionErrorV1,
  CommittedPointOutcomeInputErrorV1,
  CommittedPointOutcomeRequestKeyReuseErrorV1,
  CommittedPointOutcomeSqlErrorV1,
} from "../../src/commit/committedPointOutcomeErrors";
import {
  createCommittedPointOutcomeResolverV1,
  type CommittedPointOutcomeResolverV1,
} from "../../src/commit/committedPointOutcome";
import {
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../src/database/postgres";
import {
  insertCanonicalAvailableOutcome,
  insertCanonicalExpiredOutcome,
  insertOutcomeHeader,
  insertOutcomeScope,
  outcomeLookup,
  OUTCOME_EPOCH_A,
  OUTCOME_EPOCH_B,
  OUTCOME_IDENTITY_BYTE,
  OUTCOME_REQUEST_BYTE,
  OUTCOME_SCOPE_A,
} from "./committedPointOutcomeTestSupport";
import { runEffect } from "../support/effectTestRuntime";
import { useFileScopedPersistence } from "../support/fileScopedPersistenceFixture";

const withPersistence = useFileScopedPGliteCommitSchemaPersistence();

describe("O07-A committed point outcome resolver", { concurrent: false }, () => {
  it("stays source-private and rejects closed-record input failures before I/O", async () => {
    type RootLeak = Extract<
      keyof typeof persistenceRoot,
      "createCommittedPointOutcomeResolverV1" |
        "CommittedPointOutcomeResolverV1"
    >;
    type PGliteQueryLeak = Extract<
      keyof PGliteFlarexPersistence["drizzle"]["query"],
      "fxSystemIdempotency"
    >;
    type PostgresQueryLeak = Extract<
      keyof PostgresFlarexPersistence["drizzle"]["query"],
      "fxSystemIdempotency"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expectTypeOf<PGliteQueryLeak>().toEqualTypeOf<never>();
    expectTypeOf<PostgresQueryLeak>().toEqualTypeOf<never>();
    expect("createCommittedPointOutcomeResolverV1" in persistenceRoot).toBe(
      false,
    );

    const database = drizzle.mock({ schema: flarexSchema });
    const query = vi.spyOn(database, "select").mockImplementation(() => {
      throw new Error("Invalid committed-outcome input must not reach database access.");
    });
    let statementCount = 0;
    const resolver = createCommittedPointOutcomeResolverV1(
      database,
      { observeQuery: () => { statementCount += 1; } },
    );
    const invalid = { ...outcomeLookup("invalid"), extra: true };
    const exit = await Effect.runPromiseExit(
      resolver.resolve(invalid),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "CommittedPointOutcomeInputErrorV1",
      );
    }
    expect(statementCount).toBe(0);

    for (const { malformed, reason } of [
      {
        malformed: {
          ...outcomeLookup("invalid"),
          scopeUuid: "not-a-uuid",
          requestKey: " ",
        },
        reason: "scopeUuidInvalid",
      },
      {
        malformed: {
          ...outcomeLookup("invalid"),
          requestKey: " ",
          expectedIdentityAccessPolicySha256: new Uint8Array(31),
        },
        reason: "requestKeyInvalid",
      },
      {
        malformed: {
          ...outcomeLookup("invalid"),
          expectedIdentityAccessPolicySha256: new Uint8Array(31),
          expectedFunctionPath: " ",
        },
        reason: "identityAccessPolicySha256Invalid",
      },
      {
        malformed: {
          ...outcomeLookup("invalid"),
          expectedFunctionPath: " ",
          expectedRequestSha256: new Uint8Array(31),
        },
        reason: "functionPathInvalid",
      },
      {
        malformed: {
          ...outcomeLookup("invalid"),
          expectedRequestSha256: new Uint8Array(31),
        },
        reason: "requestSha256Invalid",
      },
    ]) {
      await expect(
        runEffect(resolver.resolve(malformed as never)),
      ).rejects.toMatchObject({
        _tag: "CommittedPointOutcomeInputErrorV1",
        reason,
      });
    }
    const accessorInput = { ...outcomeLookup("invalid") };
    Object.defineProperty(accessorInput, "scopeUuid", {
      enumerable: true,
      get: () => { throw new Error("lookup getter must not run"); },
    });
    await expect(
      runEffect(resolver.resolve(accessorInput)),
    ).rejects.toBeInstanceOf(CommittedPointOutcomeInputErrorV1);
    const hiddenExtraInput = { ...outcomeLookup("invalid") };
    Object.defineProperty(hiddenExtraInput, "hiddenExtra", {
      enumerable: false,
      value: true,
    });
    await expect(
      runEffect(resolver.resolve(hiddenExtraInput)),
    ).rejects.toBeInstanceOf(CommittedPointOutcomeInputErrorV1);
    expect(statementCount).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("resolves missing, matching available, and matching expired outcomes", async () => {
    await withPersistence(async (persistence) => {
      await insertOutcomeScope(persistence);
      await insertOutcomeHeader(persistence);
      await insertCanonicalAvailableOutcome(persistence, {
        requestKey: "available",
        value: { nested: [1, true, "ok"] },
      });
      await insertCanonicalExpiredOutcome(persistence, {
        requestKey: "expired",
      });
      const resolver = createCommittedPointOutcomeResolverV1(
        persistence.drizzle,
      );

      await expect(resolve(resolver, "missing")).resolves.toEqual({
        kind: "missing",
      });
      const available = await resolve(resolver, "available");
      expect(available).toMatchObject({
        kind: "available",
        token: {
          scopeUuid: OUTCOME_SCOPE_A,
          epochUuid: OUTCOME_EPOCH_A,
          commitSeq: 1n,
        },
        successfulResult: {
          valueJson: { nested: [1, true, "ok"] },
        },
      });
      expect(Object.isFrozen(available)).toBe(true);
      if (available.kind === "available") {
        expect(Object.isFrozen(available.token)).toBe(true);
        expect(Object.isFrozen(available.successfulResult)).toBe(true);
        expect(Object.isFrozen(available.successfulResult.valueJson)).toBe(true);
        if (isJsonObject(available.successfulResult.valueJson)) {
          expect(
            Object.isFrozen(available.successfulResult.valueJson.nested),
          ).toBe(true);
        }
        const bytes = available.successfulResult.canonicalBytes;
        const digest = available.successfulResult.sha256;
        bytes.fill(0);
        digest.fill(0);
        expect(available.successfulResult.canonicalBytes[0]).not.toBe(0);
        expect(available.successfulResult.sha256.some((byte) => byte !== 0)).toBe(
          true,
        );
      }
      await expect(resolve(resolver, "expired")).resolves.toEqual({
        kind: "expired",
        token: {
          scopeUuid: OUTCOME_SCOPE_A,
          epochUuid: OUTCOME_EPOCH_A,
          commitSeq: 1n,
        },
      });
    });
  });

  it("copies caller hashes before the one bounded query and decodes only after it settles", async () => {
    await withPersistence(async (persistence) => {
      await insertOutcomeScope(persistence);
      await insertOutcomeHeader(persistence);
      await insertCanonicalAvailableOutcome(persistence, {
        requestKey: "owned-input",
      });
      const lookup = outcomeLookup("owned-input");
      const identity = lookup.expectedIdentityAccessPolicySha256;
      const request = lookup.expectedRequestSha256;
      let statementSettled = false;
      let observedSql = "";
      const resolver = createCommittedPointOutcomeResolverV1(
        persistence.drizzle,
        {
          observeQuery: (query) => {
            observedSql = query.sql;
            identity.fill(0);
            request.fill(0);
          },
          afterStatement: () => { statementSettled = true; },
          beforeResultVerification: () => {
            expect(statementSettled).toBe(true);
          },
        },
      );
      await expect(runEffect(resolver.resolve(lookup))).resolves.toMatchObject({
        kind: "available",
      });
      expect(observedSql).toContain("octet_length");
      expect(observedSql).toContain("case when");
      expect(observedSql).toContain("result_bytes");
    });
  });

  it("returns redacted typed conflicts for every exact request-key mismatch", async () => {
    await withPersistence(async (persistence) => {
      await insertOutcomeScope(persistence);
      await insertOutcomeHeader(persistence);
      await insertCanonicalAvailableOutcome(persistence, {
        requestKey: "reuse",
      });
      const resolver = createCommittedPointOutcomeResolverV1(
        persistence.drizzle,
      );
      const cases = [
        outcomeLookup("reuse", {
          expectedIdentityAccessPolicySha256:
            TransactionIdentityAccessPolicySha256V1Schema.make(
              new Uint8Array(32).fill(OUTCOME_IDENTITY_BYTE + 1),
            ),
        }),
        outcomeLookup("reuse", {
          expectedFunctionPath: TransactionFunctionPathV1Schema.make(
            "messages:other",
          ),
        }),
        outcomeLookup("reuse", {
          expectedRequestSha256: TransactionRequestSha256V1Schema.make(
            new Uint8Array(32).fill(OUTCOME_REQUEST_BYTE + 1),
          ),
        }),
      ];
      for (const lookup of cases) {
        await expect(runEffect(resolver.resolve(lookup))).rejects.toBeInstanceOf(
          CommittedPointOutcomeRequestKeyReuseErrorV1,
        );
      }
    });
  });

  it("classifies a constraint-bypassed whitespace-only function path as corruption", async () => {
    const persistence = await createMigratedPGlitePersistence();
    await insertOutcomeScope(persistence);
    await insertOutcomeHeader(persistence);
    await insertCanonicalAvailableOutcome(persistence, {
      requestKey: "blank-function-path",
    });
    await persistence.query(
      `alter table fx_system_idempotency drop constraint fx_system_idempotency_function_path_check`,
    );
    await persistence.query(
      `update fx_system_idempotency set function_path = $1 where request_key = 'blank-function-path'`,
      ["\u00a0"],
    );
    let verificationStarted = false;
    const resolver = createCommittedPointOutcomeResolverV1(
      persistence.drizzle,
      { beforeResultVerification: () => { verificationStarted = true; } },
    );
    const mismatchedLookup = outcomeLookup("blank-function-path", {
      expectedIdentityAccessPolicySha256:
        TransactionIdentityAccessPolicySha256V1Schema.make(
          new Uint8Array(32).fill(OUTCOME_IDENTITY_BYTE + 1),
        ),
    });
    await expectCorruption(
      runEffect(resolver.resolve(mismatchedLookup)),
      "outcomeRowInvalid",
    );
    expect(verificationStarted).toBe(false);
  });

  it("accepts retained and compacted old-epoch tokens without comparing current epoch", async () => {
    await withPersistence(async (persistence) => {
      await insertOutcomeScope(persistence, {
        epochUuid: OUTCOME_EPOCH_B,
        lastCommitSeq: 2n,
      });
      await insertOutcomeHeader(persistence, { epochUuid: OUTCOME_EPOCH_A });
      await insertCanonicalAvailableOutcome(persistence, {
        requestKey: "old-epoch",
        epochUuid: OUTCOME_EPOCH_A,
      });
      const resolver = createCommittedPointOutcomeResolverV1(
        persistence.drizzle,
      );
      await expect(resolve(resolver, "old-epoch")).resolves.toMatchObject({
        kind: "available",
        token: { epochUuid: OUTCOME_EPOCH_A },
      });
      await persistence.query(
        `delete from fx_system_commit where scope_uuid = $1::uuid and commit_seq = 1`,
        [OUTCOME_SCOPE_A],
      );
      await persistence.query(
        `update fx_system_scope_execution_authority set oldest_available_commit_seq = 2 where scope_id = (select scope_id from fx_system_scope_clock where scope_uuid = $1::uuid)`,
        [OUTCOME_SCOPE_A],
      );
      await expect(resolve(resolver, "old-epoch")).resolves.toMatchObject({
        kind: "available",
      });
    });
  });

  it("fails closed for future tokens, inclusive-floor gaps, and retained epoch mismatch", async () => {
    const persistence = await createMigratedPGlitePersistence();
    await insertOutcomeScope(persistence, { lastCommitSeq: 3n });
    await insertCanonicalAvailableOutcome(persistence, {
      requestKey: "floor-zero",
      epochUuid: OUTCOME_EPOCH_A,
      commitSeq: 1n,
    });
    await insertCanonicalAvailableOutcome(persistence, {
      requestKey: "at-floor",
      epochUuid: OUTCOME_EPOCH_A,
      commitSeq: 2n,
    });
    let verificationCount = 0;
    const resolver = createCommittedPointOutcomeResolverV1(
      persistence.drizzle,
      { beforeResultVerification: () => { verificationCount += 1; } },
    );
    await expectCorruption(
      resolve(resolver, "floor-zero"),
      "missingRetainedHeader",
    );
    await persistence.query(
      `update fx_system_scope_execution_authority set oldest_available_commit_seq = 2 where scope_id = (select scope_id from fx_system_scope_clock where scope_uuid = $1::uuid)`,
      [OUTCOME_SCOPE_A],
    );
    await expectCorruption(resolve(resolver, "at-floor"), "missingRetainedHeader");

    await insertCanonicalAvailableOutcome(persistence, {
      requestKey: "above-floor",
      epochUuid: OUTCOME_EPOCH_A,
      commitSeq: 3n,
    });
    await expectCorruption(
      resolve(resolver, "above-floor"),
      "missingRetainedHeader",
    );

    await insertOutcomeHeader(persistence, {
      epochUuid: OUTCOME_EPOCH_B,
      commitSeq: 3n,
    });
    await insertCanonicalAvailableOutcome(persistence, {
      requestKey: "wrong-epoch",
      epochUuid: OUTCOME_EPOCH_A,
      commitSeq: 3n,
    });
    await expectCorruption(
      resolve(resolver, "wrong-epoch"),
      "retainedHeaderEpochMismatch",
    );

    await persistence.query(
      `alter table fx_system_idempotency drop constraint fx_system_idempotency_commit_seq_check`,
    );
    await insertCanonicalAvailableOutcome(persistence, {
      requestKey: "future",
      commitSeq: 4n,
    });
    await expectCorruption(resolve(resolver, "future"), "commitTokenAheadOfClock");
    expect(verificationCount).toBe(0);
  });

  describe("result evidence corruption", { concurrent: false }, () => {
    const withCorruptEvidence = useFileScopedPersistence(() => createFileScopedPGliteFixture(async db => {
      await db.exec("alter table fx_system_idempotency drop constraint fx_system_idempotency_result_evidence_check");
      return () => db.transaction(async transaction => {
        await transaction.exec(`
          delete from fx_system_idempotency;
          delete from fx_system_commit;
          delete from fx_system_scope_execution_authority;
          delete from fx_system_scope_clock;
        `);
      });
    }));

    it("rejects malformed result evidence and semantic-size drift after canonical verification", () => withCorruptEvidence(async persistence => {
      await insertOutcomeScope(persistence);
      await insertOutcomeHeader(persistence);
      await insertCanonicalAvailableOutcome(persistence, {
        requestKey: "bad-digest",
      });
      await insertCanonicalAvailableOutcome(persistence, {
        requestKey: "bad-semantic",
      });
      await insertCanonicalAvailableOutcome(persistence, {
        requestKey: "invalid-codec",
      });
      await insertCanonicalAvailableOutcome(persistence, {
        requestKey: "invalid-digest-length",
      });
      await insertCanonicalAvailableOutcome(persistence, {
        requestKey: "malformed-bytes",
      });
      await persistence.query(
        `update fx_system_idempotency set result_sha256 = decode(repeat('aa', 32), 'hex') where request_key = 'bad-digest'`,
      );
      await persistence.query(
        `update fx_system_idempotency set result_semantic_bytes = result_semantic_bytes + 1 where request_key = 'bad-semantic'`,
      );
      await persistence.query(
        `update fx_system_idempotency set result_value_codec_version = 2 where request_key = 'invalid-codec'`,
      );
      await persistence.query(
        `update fx_system_idempotency set result_sha256 = decode(repeat('aa', 31), 'hex') where request_key = 'invalid-digest-length'`,
      );
      await persistence.query(
        `update fx_system_idempotency set result_bytes = convert_to('not-json', 'UTF8') where request_key = 'malformed-bytes'`,
      );
      let verificationCount = 0;
      const resolver = createCommittedPointOutcomeResolverV1(
        persistence.drizzle,
        { beforeResultVerification: () => { verificationCount += 1; } },
      );
      await expectCorruption(
        resolve(resolver, "invalid-codec"),
        "availableResultEvidenceInvalid",
      );
      await expectCorruption(
        resolve(resolver, "invalid-digest-length"),
        "availableResultEvidenceInvalid",
      );
      expect(verificationCount).toBe(0);
      await expectCorruption(
        resolve(resolver, "bad-digest"),
        "resultCanonicalEvidenceInvalid",
      );
      await expectCorruption(
        resolve(resolver, "malformed-bytes"),
        "resultCanonicalEvidenceInvalid",
      );
      await expectCorruption(
        resolve(resolver, "bad-semantic"),
        "resultSemanticSizeMismatch",
      );
      expect(verificationCount).toBe(3);
    }));

    it("withholds oversized canonical evidence before verification", () => withCorruptEvidence(async persistence => {
      await insertOutcomeScope(persistence);
      await insertOutcomeHeader(persistence);
      await persistence.query(
        `
        insert into fx_system_idempotency
          (scope_uuid, request_key, identity_access_policy_sha256,
           function_path, request_sha256, epoch_uuid, commit_seq,
           result_state, result_value_codec_version, result_semantic_bytes,
           result_bytes, result_sha256)
        values ($1::uuid, 'oversized', decode(repeat('31', 32), 'hex'),
          'messages:create', decode(repeat('42', 32), 'hex'), $2::uuid, 1,
          'available', 1, 1,
          convert_to(repeat('x', $3), 'UTF8'),
          decode(repeat('55', 32), 'hex'))
      `,
        [
          OUTCOME_SCOPE_A,
          OUTCOME_EPOCH_A,
          MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1 + 1,
        ],
      );
      let verificationStarted = false;
      const resolver = createCommittedPointOutcomeResolverV1(
        persistence.drizzle,
        { beforeResultVerification: () => { verificationStarted = true; } },
      );
      await expectCorruption(
        resolve(resolver, "oversized"),
        "availableResultEvidenceInvalid",
      );
      expect(verificationStarted).toBe(false);
    }), 180_000);
  });

  it("maps a foreign SQL rejection once while preserving post-SQL defects", async () => {
    const raw = await createTestPGlite({ loadDataDir: await migratedPGliteDataDir() });
    const persistence = await createPGlitePersistence({ db: raw });
    const sqlResolver = createCommittedPointOutcomeResolverV1(
      persistence.drizzle,
    );
    await raw.close();
    await expect(resolve(sqlResolver, "closed")).rejects.toBeInstanceOf(
      CommittedPointOutcomeSqlErrorV1,
    );

    await withPersistence(async (live) => {
      await insertOutcomeScope(live);
      await insertOutcomeHeader(live);
      await insertCanonicalAvailableOutcome(live, { requestKey: "defect" });
      const defect = new Error("verification hook defect");
      const resolver = createCommittedPointOutcomeResolverV1(live.drizzle, {
        beforeResultVerification: () => { throw defect; },
      });
      const exit = await Effect.runPromiseExit(resolver.resolve(outcomeLookup("defect")));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(exit.cause.toString()).toContain(defect.message);

      const observationDefect = new Error("query observation defect");
      const observationResolver = createCommittedPointOutcomeResolverV1(
        live.drizzle,
        { observeQuery: () => { throw observationDefect; } },
      );
      const observationExit = await Effect.runPromiseExit(
        observationResolver.resolve(outcomeLookup("defect")),
      );
      expect(Exit.isFailure(observationExit)).toBe(true);
      if (Exit.isFailure(observationExit)) {
        expect(observationExit.cause.toString()).toContain(
          observationDefect.message,
        );
        expect(observationExit.cause.toString()).not.toContain(
          "CommittedPointOutcomeSqlErrorV1",
        );
      }
    });
  });
});

function resolve(
  resolver: CommittedPointOutcomeResolverV1,
  requestKey: string,
) {
  return runEffect(resolver.resolve(outcomeLookup(requestKey)));
}

async function expectCorruption(
  promise: Promise<unknown>,
  reason: string,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(
    CommittedPointOutcomeCorruptionErrorV1,
  );
  await expect(promise).rejects.toMatchObject({ reason });
}
