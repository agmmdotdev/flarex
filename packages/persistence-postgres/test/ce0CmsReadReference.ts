import { Cause, Effect, Schema } from "effect";
import { chargeHostPreparation, retainPreparedHost } from "../src/preparedHostRuntime";
import { sql } from "drizzle-orm";
import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import { canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import {
  appDocumentIdV1FromRowIdentity,
  decodeAppDocumentIdentityV1Result,
  type AppDocumentIdV1,
} from "flarex-protocol/app-document-id";
import { isJsonObject, type Json } from "flarex-protocol/json";
import type { CmsHostInput } from "../src/cmsTransaction/host";
import type { CmsHostTestHooks } from "../src/cmsTransaction/testSupport";
import { cmsError, cmsLimits } from "../src/cmsTransaction/model";
import {
  prepareCmsApplication,
  withCmsAdmission,
  requireCmsAdmission,
} from "../src/cmsTransaction/admission";
import { makeCmsRequestLifetime } from "../src/cmsTransaction/lifetime";
import { capturePrivateJsonData } from "../src/privateJsonData";
import {
  captureExactTrustedScopeAuthorityResolutionPorts,
  resolveLocatedTrustedScopeAuthorityByIdEffect,
} from "../src/scopeAuthorityResolution";
import { hasLocatedReadCommittedTargetDatabaseV1 } from "../src/transactionSessionAttemptKernel";
import {
  hasRelationalSessionDatabase,
  runRelationalSession,
} from "../src/relationalTransaction/session";
import { runWithRequestRecovery } from "../src/relationalTransaction/requestRecovery";
import { lockScopeClockForSnapshotReadInTransactionEffect } from "../src/scopeClock";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";
import {
  readBoundedCurrentAppRowsInTransactionEffect,
  InvalidAppRowReadInputError,
  AppRowReadPersistenceError,
  type AppRowRevisionV1,
} from "../src/appRows";
import { projectCe0CmsRequestFailure } from "./ce0CmsReferencePersistence";

const decodeIds = Schema.decodeUnknownEffect(Schema.Array(Schema.String));
const hash = makeLivePrivateSha256V1({
  invalidBudget: () => cmsError("limitExceeded"),
  invalidBytes: () => cmsError("invalidInput"),
  inputBytesExceeded: () => cmsError("limitExceeded"),
  unavailable: () => cmsError("resourceFailure"),
  nativeRejected: (cause) => cmsError("resourceFailure", cause),
  invalidDigestOutput: () => new Error("Invalid read reference digest"),
});
const digest = (bytes: Uint8Array) =>
  hash(bytes, { maximumInputBytes: cmsLimits.commandBytes });

/** Test-only fixed point-read request. Admission, storage decoding and lifetime
 * remain common; invocation/accounting and result collection are independent. */
type ReferenceInput<Failure> = Pick<CmsHostInput<Failure>,
  "hostRuntime" | "database" | "controlDatabase" | "session" | "deploymentId" | "scopeId" |
  "authority" | "application" | "identityAndAccessPolicy">;

export const makeCe0CmsReadReference = Effect.fn("Ce0ReadReference.make")(function* <Failure>(
  input: ReferenceInput<Failure>, hooks?: Pick<CmsHostTestHooks, "afterAdmission" | "documentReads">,
) {
  const measurement = { executions: 0 };
  const retained = yield* retainPreparedHost(input.hostRuntime, composeCe0CmsReadReference(input, measurement, hooks))
    .pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCe0CmsRequestFailure))));
  return Object.freeze({ close: retained.close, executionCount: () => measurement.executions,
    read: (args: Json) => retained.use(host => host.read(args))
      .pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCe0CmsRequestFailure)))),
  });
});

const composeCe0CmsReadReference = Effect.fn("Ce0ReadReference.compose")(
  function* <Failure>(
    input: ReferenceInput<Failure>,
    measurement: { executions: number },
    hooks?: Pick<CmsHostTestHooks, "afterAdmission" | "documentReads">,
  ) {
    const { database, controlDatabase, session, deploymentId, scopeId, application } =
      input;
    if (!hasRelationalSessionDatabase(session, database))
      return yield* Effect.fail(cmsError("invalidAuthority"));
    const compositionAuthority = input.authority;
    const authority =
      captureExactTrustedScopeAuthorityResolutionPorts(compositionAuthority);
    const identity = yield* Effect.fromResult(
      capturePrivateJsonData(
        input.identityAndAccessPolicy,
        cmsLimits.documentBytes,
        cmsError,
      ),
    );
    // Keep the host-construction identity checks even though a read has no outcome key.
    const canonicalIdentity = yield* canonicalizeSuccessfulResultV1Effect(
      identity.value,
    ).pipe(Effect.mapError(projectCe0CmsRequestFailure));
    yield* digest(canonicalIdentity.canonicalBytes);
    yield* chargeHostPreparation({ deploymentId, commands: ["measuredReadback"] })
      .pipe(Effect.mapError(projectCe0CmsRequestFailure));
    const owner = Object.freeze({ hostId: Symbol("ce0.read.reference") });
    const prepared = yield* prepareCmsApplication(
      application, compositionAuthority, controlDatabase, deploymentId, scopeId,
    ).pipe(Effect.mapError(projectCe0CmsRequestFailure));
    const read = Effect.fn("Ce0ReadReference.read")(function* (args: Json) {
      const captured = yield* Effect.fromResult(
        capturePrivateJsonData(args, cmsLimits.commandBytes, cmsError),
      );
      const transactionId = crypto.randomUUID();
      const requestIdentity = Object.freeze({
        requestId: Symbol("ce0.read.request"),
      });
      const attempt = Effect.gen(function* () {
        const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
          { deploymentId, scopeId },
          authority,
        );
        if (!hasLocatedReadCommittedTargetDatabaseV1(located.target, database))
          return yield* Effect.fail(cmsError("invalidAuthority"));
        if (prepared.schema.relations.length !== 0)
          return yield* Effect.fail(cmsError("unsupportedProfile"));
        return yield* runRelationalSession(session, "snapshotRead", (tx) =>
          Effect.scoped(
            Effect.gen(function* () {
              yield* runDrizzleStatementEffect(
                tx.execute(
                  sql`select set_config('statement_timeout', '1000ms', true), set_config('lock_timeout', '500ms', true)`,
                ),
                (cause) => cmsError("statementFailure", cause),
              );
              const clock =
                yield* lockScopeClockForSnapshotReadInTransactionEffect(
                  tx,
                  located.authority.scopeId,
                );
              return yield* withCmsAdmission(
                prepared,
                tx,
                located.authority,
                clock,
                (admission) =>
                  Effect.gen(function* () {
                    const state = yield* requireCmsAdmission(admission);
                    if (
                      state.frame.payloadLifecycle !== null ||
                      state.frame.commerce.length !== 0 ||
                      state.frame.crossDomainReferences.length !== 0 ||
                      state.configuration.profile === "payload.content-joins"
                    )
                      return yield* Effect.fail(cmsError("unsupportedProfile"));
                    if (hooks?.afterAdmission !== undefined)
                      yield* hooks.afterAdmission(tx);
                    const evidence =
                      yield* canonicalizeSuccessfulResultV1Effect({
                        domain: "flarex.private.cms-command",
                        version: 1,
                        deploymentId,
                        scopeId: located.authority.scopeId,
                        epoch: clock.epoch,
                        storageGeneration: clock.storageGeneration,
                        fence: clock.storageGenerationFence.toString(),
                        binding: state.frame,
                        head: {
                          sequence: state.head.sequence.toString(),
                          sha256: state.head.sha256,
                        },
                        operation: "measuredReadback",
                        args: captured.value,
                      });
                    const lifetime = yield* makeCmsRequestLifetime(
                      owner,
                      requestIdentity,
                      transactionId,
                      "read",
                    );
                    return yield* Effect.gen(function* () {
                      yield* Effect.fromResult(
                        lifetime.charge(
                          captured.bytes + evidence.canonicalBytes.byteLength,
                        ),
                      );
                      const child = yield* Effect.fromResult(
                        capturePrivateJsonData(
                          captured.value,
                          lifetime.remainingBytes(),
                          cmsError,
                        ),
                      );
                      yield* Effect.fromResult(lifetime.charge(child.bytes));
                      const ids = yield* decodeIds(child.value).pipe(
                        Effect.mapError((cause) =>
                          cmsError("invalidInput", cause),
                        ),
                      );
                      if (ids.length > 32)
                        return yield* Effect.fail(
                          cmsError("unsupportedProfile"),
                        );
                      measurement.executions++;
                      const managed = new Set(
                        state.frame.payloadContent?.tables.map(
                          (table) => table.tableId,
                        ),
                      );
                      const rows = new Map<AppDocumentIdV1, AppRowRevisionV1 | null>();
                      const values: Json[] = [];
                      for (const id of ids) {
                        values.push(
                          yield* lifetime.operation(
                            lifetime.context,
                            undefined,
                            "read",
                            Effect.gen(function* () {
                              const identity = yield* Effect.fromResult(
                                decodeAppDocumentIdentityV1Result(id),
                              ).pipe(
                                Effect.mapError((cause) =>
                                  cmsError("invalidInput", cause),
                                ),
                              );
                              if (
                                !state.schema.tables.some(
                                  (table) =>
                                    table.tableId === identity.tableId &&
                                    managed.has(table.tableId.toString()),
                                )
                              )
                                return yield* Effect.fail(
                                  cmsError("invalidAuthority"),
                                );
                              if (!rows.has(identity.id)) {
                                yield* requireCmsAdmission(admission, tx);
                                if (
                                  hooks?.documentReads?.beforeRead !== undefined
                                )
                                  yield* hooks.documentReads.beforeRead(
                                    "point",
                                  );
                                const found =
                                  yield* readBoundedCurrentAppRowsInTransactionEffect(
                                    tx,
                                    {
                                      scopeId: located.authority.scopeId,
                                      tableId: identity.tableId,
                                      minimumCommitSeq: clock.lastCommitSeq,
                                      maximumIdentities: cmsLimits.identities,
                                      maximumDocumentBytes:
                                        cmsLimits.documentBytes,
                                      maximumTotalValueBytes:
                                        lifetime.remainingBytes(),
                                      rowId: identity.rowId,
                                    },
                                    hooks?.documentReads?.observeQuery,
                                  ).pipe(
                                    Effect.mapError((cause) =>
                                      cmsError(
                                        cause instanceof
                                          InvalidAppRowReadInputError &&
                                          cause.issue.reason ===
                                            "rowLimitExceeded"
                                          ? "limitExceeded"
                                          : cause instanceof
                                              AppRowReadPersistenceError
                                            ? "statementFailure"
                                            : "storedCorruption",
                                        cause,
                                      ),
                                    ),
                                  );
                                yield* Effect.fromResult(lifetime.charge(128));
                                if (found.rows.length === 0) rows.set(identity.id, null);
                                for (const row of found.rows) {
                                  if (rows.size >= cmsLimits.identities)
                                    return yield* Effect.fail(
                                      cmsError("limitExceeded"),
                                    );
                                  yield* Effect.fromResult(
                                    lifetime.charge(
                                      128 +
                                        (row.kind === "live"
                                          ? row.document.canonicalBytes
                                              .byteLength
                                          : 0),
                                    ),
                                  );
                                  rows.set(
                                    appDocumentIdV1FromRowIdentity(row),
                                    row,
                                  );
                                }
                              }
                              const row = rows.get(identity.id);
                              if (row?.kind !== "live") return null;
                              const output = yield* Effect.fromResult(
                                capturePrivateJsonData(
                                  row.document.value,
                                  cmsLimits.documentBytes,
                                  cmsError,
                                ),
                              );
                              if (!isJsonObject(output.value))
                                return yield* Effect.fail(
                                  cmsError("storedCorruption"),
                                );
                              yield* Effect.fromResult(
                                lifetime.charge(output.bytes),
                              );
                              return output.value;
                            }),
                          ),
                        );
                      }
                      const output = yield* Effect.fromResult(
                        capturePrivateJsonData(
                          values,
                          lifetime.remainingBytes(),
                          cmsError,
                        ),
                      );
                      yield* Effect.fromResult(lifetime.charge(output.bytes));
                      const result =
                        yield* canonicalizeSuccessfulResultV1Effect(
                          output.value,
                        );
                      yield* Effect.fromResult(
                        lifetime.charge(result.canonicalBytes.byteLength),
                      );
                      yield* digest(result.canonicalBytes);
                      yield* lifetime.seal;
                      return result.valueJson;
                    }).pipe(Effect.ensuring(lifetime.close));
                  }),
              );
            }),
          ),
        );
      });
      return yield* runWithRequestRecovery(() => attempt, {
        hasRequestKey: false,
        projectFailure: projectCe0CmsRequestFailure,
        isDecisionUncertain: (error) => error.reason === "decisionUncertain",
      });
    });
    return Object.freeze({ read });
  },
);
