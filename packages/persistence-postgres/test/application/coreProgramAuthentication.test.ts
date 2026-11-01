import { createHash } from "node:crypto";
import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { canonicalizeTransactionGrantIdentityAccessPolicyV1Effect, TransactionGrantDeploymentIdV1Schema,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1, TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1 } from "flarex-protocol/transaction-grant";
import { TransactionFunctionPathV1Schema, TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { makeCoreApplicationMutationPort } from "../../src/application/coreMutation";
import { readPre09CapturedProgramStore } from "./pre09CapturedProgramStore";
import type { CoreDatabase } from "../../src/core/api";

it("authenticates retained program metadata before claim, recovery, grants or execution", async () => {
  const store = await readPre09CapturedProgramStore();
  const frozen = store.programs.find(program => program.identity.functionPath === "items:mutation");
  if (frozen === undefined) throw new Error("Missing frozen mutation");
  let touched = false;
  const forbidden = () => Effect.sync(() => { touched = true; throw new Error("Unauthenticated request touched authority"); });
  const database: CoreDatabase = {
    selectProgram: () => Effect.succeed({ ...frozen, metadata: { ...frozen.metadata, validatorIdentityEncoding: 3 } }),
    claimRequest: forbidden, recoverRequest: forbidden, assertOpen: forbidden(), close: forbidden,
    beginQuery: forbidden, prepareSchema: forbidden, readApplicationRegistration: forbidden, schemaStatus: forbidden, advanceSchemaWork: forbidden,
    readApplicationCandidate: forbidden, abandonApplicationCandidate: forbidden,
    advanceSchema: forbidden, activateSchema: forbidden, publishPrograms: forbidden, lookupProgram: forbidden,
    bindNative: forbidden, readNativeBinding: forbidden, beginNative: forbidden,
    bindNativeInitialization: forbidden,
    bindNativeRoot: forbidden, readNativeRootBinding: forbidden, beginNativeRoot: forbidden, bindNativeRootRecovery: forbidden,
    readNativeRootRequestEvidence: forbidden, resolveCommittedNativeRootRequest: forbidden,
    resolveRequest: forbidden, abortRequest: forbidden, begin: forbidden, commit: forbidden,
    publishedTimestamp: forbidden(), readAuthorityEpoch: forbidden(), advanceAuthorityEpoch: forbidden,
  };
  const port = makeCoreApplicationMutationPort({ database,
    deploymentId: TransactionGrantDeploymentIdV1Schema.make("pre09-authentication-witness"), maximumAttempts: 1,
    issueGrant: forbidden, execute: forbidden,
    sha256: value => Effect.sync(() => new Uint8Array(createHash("sha256").update(value).digest())),
  });
  await Effect.runPromise(Effect.gen(function* () {
    const policy = yield* canonicalizeTransactionGrantIdentityAccessPolicyV1Effect({
      policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1, auth: { kind: "anonymous" },
      capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
    });
    const refused = yield* Effect.result(port.invoke(TransactionFunctionPathV1Schema.make("items:mutation"),
      { scores: { Ada: 42 } }, TransactionRequestKeyV1Schema.make(store.requestIdentity.key), policy));
    expect(Result.isFailure(refused) && refused.failure).toMatchObject({ reason: "metadataInvalid" });
    expect(touched).toBe(false);
  }));
});
