import { webcrypto } from "node:crypto";

import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  encodeDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import {
  DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2CandidateFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";

import {
  createPostgresClientDeclarativeV2VerifierProgressRepositoryV2,
} from
  "@flarex/persistence-postgres/internal/system-test/postgres-client-declarative-v2-verifier-progress-v2";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresClientPersistence,
} from "./postgresHelpers";
import {
  SESSION_TEST_EPOCH_UUID,
  SESSION_TEST_SCOPE_UUID,
  insertSessionTestScope,
} from "./sessionAuthorityTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const scopeId = `scope_${SESSION_TEST_SCOPE_UUID}`;
const epoch = `epoch_${SESSION_TEST_EPOCH_UUID}`;
const operationBudget = {
  maximumCalls: 200,
  maximumRows: 200,
  maximumFrameBytes: 4_000_000,
  maximumCanonicalBytes: 4_000_000,
  maximumHashBytes: 4_000_000,
  maximumElapsedMilliseconds: 60_000,
} as const;

describePostgres(
  "real Postgres connected Client Declarative V2 progress adapter",
  () => {
    it("creates, observes, acquires, and reserves through one request Client", async () => {
      await withTemporaryPostgresClientPersistence(
        async (persistence, client) => {
          if (globalThis.crypto === undefined) {
            Object.defineProperty(globalThis, "crypto", {
              configurable: true,
              value: webcrypto,
            });
          }
          await insertSessionTestScope(persistence);
          const candidate = candidateFixture();
          const encoded = Result.getOrThrow(
            encodeDeclarativeV2PhysicalFrameV1(candidate, {
              maximumFrameBytes: 1_000_000,
              maximumCanonicalBytes: 1_000_000,
            }),
          );
          const candidateSha256 = await sha256(encoded.canonicalBytes);
          await persistence.query(
            `insert into fx_system_declarative_v2_candidate (
               scope_id, candidate_sha256, storage_generation,
               storage_generation_fence, epoch, frame_codec_version,
               frame_byte_length, frame_sha256, frame_bytes
             ) values ($1, $2, 'flarexdb_v1', 1, $3, $4, $5, $2, $6)`,
            [
              scopeId,
              candidateSha256,
              epoch,
              DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
              BigInt(encoded.canonicalBytes.byteLength),
              encoded.canonicalBytes,
            ],
          );

          const quarantined: Error[] = [];
          const repository =
            createPostgresClientDeclarativeV2VerifierProgressRepositoryV2(
              client,
              {
                kind: "shared_database",
                databaseKey: "primary",
                schemaName: "public",
              },
              {
                repository: {
                  claimDurationMilliseconds: 60_000,
                  randomUuid: () =>
                    "11111111-1111-4111-8111-111111111111",
                },
                quarantine: cause => {
                  quarantined.push(cause);
                },
              },
            );
          expect(typeof repository.readSettledEvidencePageBatch)
            .toBe("function");
          const created = await runEffect(repository.createAttempt({
            scopeId,
            candidateSha256,
            ceilings: semanticBudget("attempt_ceilings", 1_000n),
          }, operationBudget));
          const concurrent = await observeTransactionDepth(
            client,
            () => Promise.all([
              runEffect(repository.observeAttempt(
                scopeId,
                created.attemptSha256,
                operationBudget,
              )),
              runEffect(repository.observeAttempt(
                scopeId,
                created.attemptSha256,
                operationBudget,
              )),
            ]),
          );
          expect(concurrent.maximumDepth).toBe(1);
          const observed = concurrent.value[0]!;
          expect(observed).toMatchObject({
            kind: "present",
            attempt: {
              scopeId,
              candidateSha256,
              settledSequence: 0n,
            },
          });
          if (observed.kind !== "present") {
            throw new Error("Expected the created attempt.");
          }
          const acquired = await runEffect(repository.acquire(
            scopeId,
            created.attemptSha256,
            operationBudget,
          ));
          const reservation = await reservationInput(acquired.attempt);
          const reserved = await runEffect(repository.reserveCommand(
            acquired.run,
            reservation,
            operationBudget,
          ));
          expect(reserved).toMatchObject({
            kind: "reserved",
            reservation: {
              kind: "command_reservation",
              commandKind: "source_page",
              sequence: 1n,
            },
          });
          expect(quarantined).toEqual([]);
          const backendPid = await client.query<{ pid: number }>(
            "select pg_backend_pid()::integer as pid",
          );
          expect(backendPid.rows).toHaveLength(1);
        },
      );
    });
  },
);

async function reservationInput(
  attempt: Readonly<{
    readonly attemptSha256: Uint8Array;
    readonly candidateSha256: Uint8Array;
    readonly progressSha256: Uint8Array;
    readonly lastReceiptSha256: Uint8Array | null;
  }>,
) {
  const commandBudget = semanticBudget("command_budget", 1n);
  const encoded = Result.getOrThrow(
    encodeDeclarativeV2VerifierProgressFrameV2(commandBudget, {
      maximumFrameBytes: 1_000_000,
      maximumCanonicalBytes: 1_000_000,
    }),
  );
  return Object.freeze({
    reservation: {
      kind: "command_reservation" as const,
      attemptSha256: attempt.attemptSha256,
      candidateSha256: attempt.candidateSha256,
      commandKind: "source_page" as const,
      sequence: 1n,
      currentProgressSha256: attempt.progressSha256,
      predecessorReceiptSha256: attempt.lastReceiptSha256,
      commandBudgetSha256: await sha256(encoded.canonicalBytes),
      commandInputSha256: digest(0x31),
      freshAuthenticatedInputSha256: digest(0x32),
      analyzerIdentitySha256: digest(0x33),
      verifierIdentitySha256: digest(0x34),
      rangeAndPredecessorTailsSha256: digest(0x35),
    },
    commandBudget,
  });
}

function semanticBudget(
  kind: DeclarativeV2VerifierBudgetFrameV2["kind"],
  value: bigint,
): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze({
    kind,
    ...Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
        dimension,
        value,
      ]),
    ),
  }) as DeclarativeV2VerifierBudgetFrameV2;
}

function candidateFixture(): DeclarativeV2CandidateFrameV1 {
  return {
    kind: "candidate",
    projectId: "project",
    deploymentId: "deployment",
    deploymentCreatedAt: "2026-07-23T00:00:00.000Z",
    scopeId,
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: 1n,
    scopeEpoch: epoch,
    sourceRootSha256: digest(1),
    sourceSelectorSha256: digest(2),
    sourceCodecIdentity: "source-v2",
    semanticRootSha256: digest(3),
    semanticSelectorSha256: digest(4),
    semanticModelIdentity: "declarative-v2",
    semanticCodecIdentity: "ndjson-v1",
    semanticPolicyIdentity: "policy-v1",
    packageSha256: digest(5),
    artifactSha256: digest(6),
    artifactRuntimeIdentity: "runtime-v1",
    schemaArtifactSha256: digest(7),
    schemaBindingSha256: digest(8),
    validatorRootSha256: digest(9),
    coreLanguageIdentity: "core-v1",
    abiIdentity: "abi-v1",
    grammarIdentity: "grammar-v1",
    unicodeIdentity: "unicode-14",
    parserTableIdentity: "parser-v1",
    analyzerIdentity: "analyzer-v2",
    verifierIdentity: "verifier-v1",
    declaredHandlerSetSha256: digest(10),
    deploymentAnalysisCodecIdentity: "analysis-v1",
    deploymentAnalysisByteLength: 20n,
    deploymentAnalysisSha256: digest(11),
    deploymentCodegenAnalysisCodecIdentity: "codegen-v1",
    deploymentCodegenAnalysisByteLength: 21n,
    deploymentCodegenAnalysisSha256: digest(12),
    runtimeProjectionSetSha256: digest(13),
    functionGroupManifestSha256: digest(14),
    readinessPolicyIdentity:
      "flarex.readiness/runtime-projection-cold-materialization/v1",
  };
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await webcrypto.subtle.digest("SHA-256", bytes));
}

function digest(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

async function observeTransactionDepth<Value>(
  client: import("pg").Client,
  run: () => Promise<Value>,
): Promise<Readonly<{ readonly maximumDepth: number; readonly value: Value }>> {
  const originalQuery = client.query;
  let depth = 0;
  let maximumDepth = 0;
  Object.defineProperty(client, "query", {
    configurable: true,
    value: async function (this: unknown, ...args: readonly unknown[]) {
      expect(this).toBe(client);
      const text = queryText(args[0]);
      if (text === "begin") {
        depth += 1;
        maximumDepth = Math.max(maximumDepth, depth);
      }
      try {
        return await Reflect.apply(originalQuery, client, args);
      } finally {
        if (text === "commit" || text === "rollback") depth -= 1;
      }
    },
  });
  try {
    const value = await run();
    return Object.freeze({ maximumDepth, value });
  } finally {
    Object.defineProperty(client, "query", {
      configurable: true,
      value: originalQuery,
    });
  }
}

function queryText(query: unknown): string {
  if (typeof query === "string") return normalizeSql(query);
  if (typeof query !== "object" || query === null) return "";
  const descriptor = Object.getOwnPropertyDescriptor(query, "text");
  return descriptor !== undefined && "value" in descriptor &&
      typeof descriptor.value === "string"
    ? normalizeSql(descriptor.value)
    : "";
}

function normalizeSql(sql: string): string {
  return sql.trim().replaceAll(/\s+/g, " ").toLowerCase();
}
