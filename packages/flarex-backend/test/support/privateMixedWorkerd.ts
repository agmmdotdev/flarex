import { Cause, Effect, Exit, Schema } from "effect";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import type { PointMutationOccBoundJournalV1 } from "../../../executor/src/mutation/authentication/storedAttemptAuthentication";
import { makePointMutationJournalRpcSessionV1 } from "../../../executor/src/mutation/journal/pointMutationJournalRpc";
import { ApplicationPointMutationRunnerHostV1Error,
  type PointMutationOccRuntimeNeutralRunnerInputV1 } from "../../../executor/src/mutation/authentication/storedAttemptAuthentication";
import { runMixedMutationWorkerd } from "./mixedMutationWorkerdAdapter";
import { successfulValue } from "./payloadCommerceReferenceFixture";
import { projectApplicationAuth } from "../../src/artifactRuntime/ApplicationPointMutationRunner";

const decodeMessage = Schema.decodeUnknownSync(Schema.Union([
  Schema.Struct({ kind: Schema.Literal("point"), tableName: Schema.String,
    operation: Schema.Record(Schema.String, Schema.Unknown) }),
  Schema.Struct({ kind: Schema.Literal("admitted"), sequence: Schema.String, frame: Schema.Unknown }),
]));

/** Transport only: actual RPC owns decoding, failure latching and drain.
 * Application modules see neither the confirmed root nor native read/write capabilities. */
export const runPrivateMixedWorkerd = Effect.fn("PrivateMixedFixture.workerd")(function* (
  input: PointMutationOccRuntimeNeutralRunnerInputV1, consumer: Readonly<{ journal: PointMutationOccBoundJournalV1; initialSyscallSequence: bigint }>,
  source: string, onResponse: (response: unknown) => void,
  observations: Readonly<{ onReceipt?: () => void; afterReceipt?: () => Promise<void>; onDisposed?: () => void }> = {},
) {
  if (input.executionAuthorityGeneration !== "application_v1")
    return yield* Effect.die(new Error("Expected genuine Application execution"));
  const rpc = makePointMutationJournalRpcSessionV1(consumer.journal);
  const tables = new Map<string, Awaited<ReturnType<typeof rpc.target.resolvePointTable>>>();
  const target = input.application.runtimeTarget;
  const request = JSON.stringify({ format: "flarex.point-mutation-exact-runtime", version: 1,
    artifact: { runtime: "dynamic-worker", artifactId: "artifact_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sourcePackageHash: "a".repeat(64), executionModule: target.executionModulePath },
    function: { path: target.function.path, executionModule: target.executionModulePath, kind: target.function.kind,
      visibility: target.function.visibility, argsValidator: target.function.args, returnsValidator: target.function.returns },
    auth: projectApplicationAuth(input.verifiedGrant.evidence.payload.auth), arguments: input.argumentsJson, argumentArraySemanticBytes: input.argumentArraySemanticBytes,
    tables: input.stableBindings.map(binding => ({ tableId: binding.tableId, logicalName: binding.logicalName })),
    context: { executionId: input.context.executionId, logScopeId: input.context.logScopeId,
      randomSeed: [...input.context.randomSeed], executionTime: input.context.executionTime,
      initialCreationTimeCursor: input.context.initialCreationTimeCursor } });
  const hostFailure = (cause: unknown) => new ApplicationPointMutationRunnerHostV1Error({ reason: "terminalFailed", cause });
  let pending: Promise<unknown> | undefined;
  const work = Effect.tryPromise({ try: signal => {
    pending = runMixedMutationWorkerd({ source, request, signal,
    ...(observations.onDisposed === undefined ? {} : { onDisposed: observations.onDisposed }),
    executionModule: target.executionModulePath, executionTime: input.context.executionTime,
    initialSyscallSequence: consumer.initialSyscallSequence,
    bridge: async candidate => {
      const message = decodeMessage(candidate);
      if (message.kind === "admitted") {
        const value = await rpc.target.runAdmittedFrameworkOperation(
          CommitSyscallSequenceV1Schema.make(BigInt(message.sequence)), message.frame);
        observations.onReceipt?.();
        await observations.afterReceipt?.();
        return value;
      }
      let table = tables.get(message.tableName);
      if (table === undefined) { table = await rpc.target.resolvePointTable(message.tableName); tables.set(message.tableName, table); }
      return table.runPointOperation({ ...message.operation, syscallSequence: typeof message.operation.syscallSequence === "string"
        ? CommitSyscallSequenceV1Schema.make(BigInt(message.operation.syscallSequence)) : message.operation.syscallSequence });
    },
    }).then(value => { onResponse(value); return value; });
    return pending;
  }, catch: hostFailure });
  const response = yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
    const host = yield* Effect.exit(restore(work));
    // tryPromise signals interruption, but only the host's settled Promise
    // proves Workerd's cached disposal finished. Join it before RPC/native drain.
    const task = pending;
    const drained = Exit.isFailure(host) && host.cause.reasons.some(Cause.isInterruptReason) && task !== undefined
      ? yield* Effect.exit(Effect.tryPromise({ try: () => task, catch: hostFailure })) : Exit.void;
    const journal = yield* Effect.exit(rpc.closeAndDrain.pipe(Effect.mapError(hostFailure)));
    if (Exit.isFailure(host)) {
      const failure = Exit.isFailure(drained) ? Cause.combine(host.cause, drained.cause) : host.cause;
      return yield* Effect.failCause(Exit.isFailure(journal) ? Cause.combine(failure, journal.cause) : failure);
    }
    yield* journal;
    return yield* host;
  }));
  return yield* Effect.tryPromise({ try: () => successfulValue(response), catch: hostFailure });
});
