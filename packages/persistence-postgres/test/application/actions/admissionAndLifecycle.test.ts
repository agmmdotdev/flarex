import { webcrypto } from "node:crypto";
import { eq } from "drizzle-orm";
import { copyBytesToArrayBuffer, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import {
  canonicalizeApplicationActionExecutionAuthorityV1,
} from "flarex-protocol/internal/application-action-authority-v1";
import {
  canonicalizeApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";
import {
  encodeApplicationActionInvocationRequestV2,
  makeExecutionEvidenceBodyReferenceV1,
} from "flarex-protocol/internal/execution-evidence-v1";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { beforeAll, describe, expect, it } from "vitest";
import { selectApplicationActionAdmission } from "../../../src/application/applicationActionAdmission";
import {
  admitApplicationAuthorityActionInvocation,
  claimDirectActionExecutionV1,
  claimApplicationAuthorityActionExecution,
  confirmExternalEffectAttemptV1,
  createLocatedApplicationActionAuthorityTargetV1,
  declareExternalEffectDispatchV1,
  inspectApplicationAuthorityActionInvocation,
  prepareExternalEffectAttemptV1,
  recoverExpiredApplicationAuthorityActionExecution,
  requestApplicationAuthorityActionCancellation,
  settleApplicationAuthorityActionInvocation,
} from "../../../src/application/applicationActionAuthorityV1";
import {
  makeApplicationActivationRepository,
} from "../../../src/application/activation/repository";
import { fxSystemApplicationActiveHeads } from "../../../src/application/applicationActivationSchema";
import { runEffect } from "../../support/effectTestRuntime";
import { fxSystemApplicationActionInvocationsV1 } from "../../../src/database/schema";
import { COMPATIBILITY_DATE, LOCATOR } from "../support/readinessArtifacts";
import {
  createReadinessPGlitePersistence,
  readinessFixture,
} from "../support/readinessFixture";
import { prepareReadinessAuthorities } from "../support/readinessPreparation";
import { sha256Hex } from "../support/readinessEvidence";

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describe("Application actions/admissionAndLifecycle", { timeout: 30_000 }, () => {
  it("selects an exact public Application action without legacy revision evidence", async () => {
    const fixture = await readinessFixture(
      ...await Promise.all([
        createReadinessPGlitePersistence(),
        createReadinessPGlitePersistence(),
      ]),
      { functionKind: "action" },
    );
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    await fixture.control.insertScopeMetadata({
      deploymentId: fixture.input.deploymentId,
      scopeId: ScopeIdSchema.make("scope_application_action_admission_peer"),
      physicalLocator: LOCATOR,
    });
    const admitted = await runEffect(selectApplicationActionAdmission(
      active.selection,
      "users:get",
      Object.freeze({
        deploymentId: fixture.input.deploymentId,
        controlDb: fixture.control.drizzle,
        schema: fixture.schema,
        authority: fixture.authorityPorts,
      }),
    ));

    expect(admitted.executionAuthority.authority).toMatchObject({
      format: "flarex.application-action-execution-authority",
      version: 1,
      activationSequence: active.basis.activationSequence.toString(),
      activeHeadSha256: encodeBytesToLowercaseHex(active.basis.headSha256),
      schemaVersionId: active.basis.schemaVersionId,
      runtimeTarget: {
        revisionId: fixture.input.revisionId,
        function: {
          path: "users:get",
          kind: "action",
          visibility: "public",
        },
      },
    });
    expect(admitted.executionAuthority.authority).not.toHaveProperty(
      "applicationRevisionId",
    );
    expect(admitted.executionAuthority.authority).not.toHaveProperty(
      "candidateSha256",
    );

    const argumentReference = Result.getOrThrow(
      makeExecutionEvidenceBodyReferenceV1(
        "action_arguments",
        new Uint8Array(32).fill(0x41),
        19,
      ),
    );
    const makeRequest = (requestKey: string, seed: number) =>
      Result.getOrThrow(encodeApplicationActionInvocationRequestV2({
        scopeId: active.basis.authority.scopeId,
        requestKey,
        executionAuthoritySha256: admitted.executionAuthority.sha256,
        actionFunctionPath: "users:get",
        executionIdentitySha256: new Uint8Array(32).fill(seed),
        compatibilityDate: COMPATIBILITY_DATE,
        hostPolicySha256: new Uint8Array(32).fill(0x43),
        arguments: argumentReference,
      }));
    const request = makeRequest("application-action-request-1", 0x42);
    const actionContext = Object.freeze({
      target: createLocatedApplicationActionAuthorityTargetV1(
        fixture.target.drizzle,
        active.basis.authority.physicalLocator,
      ),
      authority: active.basis.authority,
      sha256: Object.freeze({
        hash: (bytes: Uint8Array) => Effect.promise(async () =>
          new Uint8Array(await globalThis.crypto.subtle.digest(
            "SHA-256",
            copyBytesToArrayBuffer(bytes),
          ))
        ),
      }),
    });
    const inserted = await runEffect(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request,
        executionAuthority: admitted.executionAuthority,
        invocationId: "00000000-0000-4000-8000-000000000401",
      }, actionContext),
    );
    const replayed = await runEffect(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request,
        executionAuthority: admitted.executionAuthority,
        invocationId: "00000000-0000-4000-8000-000000000402",
      }, actionContext),
    );
    expect(inserted.disposition).toBe("inserted");
    expect(replayed.disposition).toBe("replayed");
    const inspected = await runEffect(
      inspectApplicationAuthorityActionInvocation(
        "application-action-request-1",
        actionContext,
      ),
    );
    expect(inspected.executionAuthorityGeneration).toBe("application_v1");
    expect(inspected.executionAuthority.sha256).toEqual(
      admitted.executionAuthority.sha256,
    );
    const conflicting = await runEffect(Effect.result(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request: makeRequest("application-action-request-1", 0x4c),
        executionAuthority: admitted.executionAuthority,
        invocationId: "00000000-0000-4000-8000-000000000406",
      }, actionContext),
    ));
    expect(Result.isFailure(conflicting)).toBe(true);
    if (Result.isFailure(conflicting)) {
      expect(conflicting.failure).toMatchObject({
        _tag: "ApplicationActionRequestKeyConflictV1Error",
      });
    }
    const staleAuthority = await runEffect(
      canonicalizeApplicationActionExecutionAuthorityV1({
        ...admitted.executionAuthority.authority,
        activeHeadSha256: "f".repeat(64),
      }),
    );
    const staleSelectionAdmission = await runEffect(Effect.result(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request: Result.getOrThrow(encodeApplicationActionInvocationRequestV2({
          ...makeRequest("application-action-stale-selection-1", 0x4d).frame,
          executionAuthoritySha256: staleAuthority.sha256,
        })),
        executionAuthority: staleAuthority,
        invocationId: "00000000-0000-4000-8000-000000000414",
      }, actionContext),
    ));
    expect(Result.isFailure(staleSelectionAdmission)).toBe(true);
    if (Result.isFailure(staleSelectionAdmission)) {
      expect(staleSelectionAdmission.failure).toMatchObject({
        _tag: "ApplicationActionAuthorityStaleV1Error",
      });
    }
    const foreignRuntimeTarget = Result.getOrThrow(
      canonicalizeApplicationRuntimeTargetV1({
        ...admitted.executionAuthority.authority.runtimeTarget,
        sourceArtifactRootSha256: "e".repeat(64),
      }),
    );
    const foreignArtifactAuthority = await runEffect(
      canonicalizeApplicationActionExecutionAuthorityV1({
        ...admitted.executionAuthority.authority,
        runtimeTarget: foreignRuntimeTarget.target,
        runtimeTargetSha256: await sha256Hex(
          foreignRuntimeTarget.canonicalBytes,
        ),
      }),
    );
    const foreignArtifactAdmission = await runEffect(Effect.result(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request: Result.getOrThrow(encodeApplicationActionInvocationRequestV2({
          ...makeRequest("application-action-foreign-artifact-1", 0x4d).frame,
          executionAuthoritySha256: foreignArtifactAuthority.sha256,
        })),
        executionAuthority: foreignArtifactAuthority,
        invocationId: "00000000-0000-4000-8000-000000000415",
      }, actionContext),
    ));
    expect(Result.isFailure(foreignArtifactAdmission)).toBe(true);
    if (Result.isFailure(foreignArtifactAdmission)) {
      expect(foreignArtifactAdmission.failure).toMatchObject({
        _tag: "ApplicationActionAuthorityStaleV1Error",
      });
    }
    for (const [index, functionPatch] of [
      { args: { type: "null" as const } },
      { returns: { type: "null" as const } },
      {
        partition: {
          type: "partitionCreateRoot" as const,
          table: "users",
          partitionField: "_id" as const,
        },
      },
    ].entries()) {
      const foreignFunctionTarget = Result.getOrThrow(
        canonicalizeApplicationRuntimeTargetV1({
          ...admitted.executionAuthority.authority.runtimeTarget,
          function: {
            ...admitted.executionAuthority.authority.runtimeTarget.function,
            ...functionPatch,
          },
        }),
      );
      const foreignFunctionAuthority = await runEffect(
        canonicalizeApplicationActionExecutionAuthorityV1({
          ...admitted.executionAuthority.authority,
          runtimeTarget: foreignFunctionTarget.target,
          runtimeTargetSha256: await sha256Hex(
            foreignFunctionTarget.canonicalBytes,
          ),
        }),
      );
      const foreignFunctionAdmission = await runEffect(Effect.result(
        admitApplicationAuthorityActionInvocation({
          selection: active.selection,
          request: Result.getOrThrow(encodeApplicationActionInvocationRequestV2({
            ...makeRequest(
              `application-action-foreign-function-${index}`,
              0x50 + index,
            ).frame,
            executionAuthoritySha256: foreignFunctionAuthority.sha256,
          })),
          executionAuthority: foreignFunctionAuthority,
          invocationId:
            `00000000-0000-4000-8000-${(416 + index).toString().padStart(12, "0")}`,
        }, actionContext),
      ));
      expect(Result.isFailure(foreignFunctionAdmission)).toBe(true);
      if (Result.isFailure(foreignFunctionAdmission)) {
        expect(foreignFunctionAdmission.failure).toMatchObject({
          _tag: "ApplicationActionAuthorityStaleV1Error",
        });
      }
    }
    expect(inserted.invocation).toMatchObject({
      executionAuthorityGeneration: "application_v1",
      actionFunctionPath: "users:get",
      lifecycle: "admitted",
    });
    expect(inserted.invocation).not.toHaveProperty("applicationRevisionId");
    expect(inserted.invocation).not.toHaveProperty("candidateSha256");
    expect(inserted.invocation).not.toHaveProperty("actionBindingSha256");
    const inertClaim = await runEffect(Effect.result(
      claimDirectActionExecutionV1(
        "application-action-request-1",
        1_000,
        new Uint8Array(32).fill(0x44),
        actionContext,
      ),
    ));
    expect(Result.isFailure(inertClaim)).toBe(true);
    if (Result.isFailure(inertClaim)) {
      expect(inertClaim.failure).toMatchObject({
        _tag: "ApplicationActionAuthorityCorruptionV1Error",
      });
    }
    expect((await fixture.target.drizzle.select({
      lifecycle: fxSystemApplicationActionInvocationsV1.lifecycle,
      executionGeneration:
        fxSystemApplicationActionInvocationsV1.executionGeneration,
    }).from(fxSystemApplicationActionInvocationsV1).where(eq(
      fxSystemApplicationActionInvocationsV1.requestKey,
      "application-action-request-1",
    )))[0]).toEqual({ lifecycle: "admitted", executionGeneration: 0n });
    const claimed = await runEffect(
      claimApplicationAuthorityActionExecution(
        "application-action-request-1",
        60_000,
        new Uint8Array(32).fill(0x44),
        actionContext,
      ),
    );
    expect(claimed.invocation).toMatchObject({
      executionAuthorityGeneration: "application_v1",
      lifecycle: "executing",
      executionGeneration: 1n,
    });
    const outboundRequest = Result.getOrThrow(
      makeExecutionEvidenceBodyReferenceV1(
        "outbound_http_request",
        new Uint8Array(32).fill(0x45),
        31,
      ),
    );
    const prepared = await runEffect(prepareExternalEffectAttemptV1(
      claimed.subject,
      {
        effectKind: "outbound_http",
        stableEffectKey: "application-effect-1",
        requestIdentitySha256: new Uint8Array(32).fill(0x46),
        request: outboundRequest,
      },
      actionContext,
    ));
    expect(prepared).toMatchObject({ effectOrdinal: 1n, state: "prepared" });
    await runEffect(declareExternalEffectDispatchV1(
      claimed.subject,
      1n,
      actionContext,
    ));
    const outboundResponse = Result.getOrThrow(
      makeExecutionEvidenceBodyReferenceV1(
        "outbound_http_response",
        new Uint8Array(32).fill(0x47),
        37,
      ),
    );
    await runEffect(confirmExternalEffectAttemptV1(
      claimed.subject,
      1n,
      { effectKind: "outbound_http", response: outboundResponse },
      actionContext,
    ));
    const resultReference = Result.getOrThrow(
      makeExecutionEvidenceBodyReferenceV1(
        "action_result",
        new Uint8Array(32).fill(0x48),
        23,
      ),
    );
    const settled = await runEffect(
      settleApplicationAuthorityActionInvocation(
        claimed.subject,
        { lifecycle: "completed", result: resultReference },
        actionContext,
      ),
    );
    expect(settled).toMatchObject({
      executionAuthorityGeneration: "application_v1",
      lifecycle: "completed",
      lastEffectOrdinal: 1n,
    });

    const cancellationRequest = makeRequest(
      "application-action-cancellation-1",
      0x49,
    );
    await runEffect(admitApplicationAuthorityActionInvocation({
      selection: active.selection,
      request: cancellationRequest,
      executionAuthority: admitted.executionAuthority,
      invocationId: "00000000-0000-4000-8000-000000000404",
    }, actionContext));
    const cancelled = await runEffect(
      requestApplicationAuthorityActionCancellation(
        "application-action-cancellation-1",
        actionContext,
      ),
    );
    expect(cancelled).toMatchObject({
      executionAuthorityGeneration: "application_v1",
      lifecycle: "cancelled",
      terminalCode: "cancelled_before_execution",
    });

    const recoveryRequest = makeRequest(
      "application-action-recovery-1",
      0x4a,
    );
    await runEffect(admitApplicationAuthorityActionInvocation({
      selection: active.selection,
      request: recoveryRequest,
      executionAuthority: admitted.executionAuthority,
      invocationId: "00000000-0000-4000-8000-000000000405",
    }, actionContext));
    const recoveryClaimed = await runEffect(
      claimApplicationAuthorityActionExecution(
      "application-action-recovery-1",
      60_000,
      new Uint8Array(32).fill(0x4b),
      actionContext,
    ));
    await fixture.target.drizzle.update(
      fxSystemApplicationActionInvocationsV1,
    ).set({
      invocationTime: new Date(0),
      executionDeadline: new Date(1),
    }).where(eq(
      fxSystemApplicationActionInvocationsV1.requestKey,
      "application-action-recovery-1",
    ));
    const recovered = await runEffect(
      recoverExpiredApplicationAuthorityActionExecution(
        "application-action-recovery-1",
        actionContext,
      ),
    );
    expect(recovered).toMatchObject({
      executionAuthorityGeneration: "application_v1",
      lifecycle: "admitted",
      executionGeneration: 1n,
      invocationTime: null,
      executionDeadline: null,
      randomSeedSha256: null,
    });
    const recoveryReclaimed = await runEffect(
      claimApplicationAuthorityActionExecution(
        "application-action-recovery-1",
        60_000,
        new Uint8Array(32).fill(0x4c),
        actionContext,
      ),
    );
    expect(recoveryReclaimed.invocation.executionGeneration).toBe(2n);
    const staleSubject = await runEffect(Effect.result(
      prepareExternalEffectAttemptV1(
        recoveryClaimed.subject,
        {
          effectKind: "outbound_http",
          stableEffectKey: "stale-recovered-subject",
          requestIdentitySha256: new Uint8Array(32).fill(0x4d),
          request: outboundRequest,
        },
        actionContext,
      ),
    ));
    expect(Result.isFailure(staleSubject)).toBe(true);
    if (Result.isFailure(staleSubject)) {
      expect(staleSubject.failure).toMatchObject({
        _tag: "ApplicationActionAuthorityCorruptionV1Error",
      });
    }
    await runEffect(settleApplicationAuthorityActionInvocation(
      recoveryReclaimed.subject,
      { lifecycle: "completed", result: resultReference },
      actionContext,
    ));

    const uncertainRequest = makeRequest(
      "application-action-uncertain-1",
      0x4e,
    );
    await runEffect(admitApplicationAuthorityActionInvocation({
      selection: active.selection,
      request: uncertainRequest,
      executionAuthority: admitted.executionAuthority,
      invocationId: "00000000-0000-4000-8000-000000000409",
    }, actionContext));
    const uncertainClaimed = await runEffect(
      claimApplicationAuthorityActionExecution(
        "application-action-uncertain-1",
        60_000,
        new Uint8Array(32).fill(0x4f),
        actionContext,
      ),
    );
    await runEffect(prepareExternalEffectAttemptV1(
      uncertainClaimed.subject,
      {
        effectKind: "outbound_http",
        stableEffectKey: "possibly-dispatched-effect",
        requestIdentitySha256: new Uint8Array(32).fill(0x50),
        request: outboundRequest,
      },
      actionContext,
    ));
    await runEffect(declareExternalEffectDispatchV1(
      uncertainClaimed.subject,
      1n,
      actionContext,
    ));
    await fixture.target.drizzle.update(
      fxSystemApplicationActionInvocationsV1,
    ).set({
      invocationTime: new Date(0),
      executionDeadline: new Date(1),
    }).where(eq(
      fxSystemApplicationActionInvocationsV1.requestKey,
      "application-action-uncertain-1",
    ));
    const uncertain = await runEffect(
      recoverExpiredApplicationAuthorityActionExecution(
        "application-action-uncertain-1",
        actionContext,
      ),
    );
    expect(uncertain).toMatchObject({
      executionAuthorityGeneration: "application_v1",
      lifecycle: "uncertain",
      terminalCode: "execution_expired_after_possible_dispatch",
    });

    const detachedRequest = makeRequest(
      "application-action-detachment-1",
      0x4d,
    );
    const callerOwnedRequestBytes = detachedRequest.canonicalBytes;
    const expectedRequestSha256 = new Uint8Array(
      await globalThis.crypto.subtle.digest(
        "SHA-256",
        copyBytesToArrayBuffer(callerOwnedRequestBytes),
      ),
    );
    const detached = await runEffect(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request: detachedRequest,
        executionAuthority: admitted.executionAuthority,
        invocationId: "00000000-0000-4000-8000-000000000407",
      }, Object.freeze({
        ...actionContext,
        sha256: Object.freeze({
          hash: (bytes: Uint8Array) => Effect.promise(async () => {
            callerOwnedRequestBytes.fill(0);
            return new Uint8Array(await globalThis.crypto.subtle.digest(
              "SHA-256",
              copyBytesToArrayBuffer(bytes),
            ));
          }),
        }),
      })),
    );
    expect(Array.from(callerOwnedRequestBytes).every(byte => byte === 0))
      .toBe(true);
    expect(detached.invocation.requestIdentitySha256)
      .toEqual(expectedRequestSha256);
    await expect(fixture.target.drizzle.execute(
      `update fx_system_application_action_invocation_v1
       set execution_authority_generation = 'unknown'
       where request_key = 'application-action-detachment-1'`,
    )).rejects.toThrow();

    const rollbackRequest = makeRequest(
      "application-action-rollback-1",
      0x4e,
    );
    await expect(runEffect(admitApplicationAuthorityActionInvocation({
      selection: active.selection,
      request: rollbackRequest,
      executionAuthority: admitted.executionAuthority,
      invocationId: "00000000-0000-4000-8000-000000000408",
    }, Object.freeze({
      ...actionContext,
      proofAfterTransactionStep: (step: string) => {
        if (step === "afterAdmissionInsert") {
          throw new Error("injected Application action admission failure");
        }
      },
    })))).rejects.toThrow("injected Application action admission failure");
    expect(await fixture.target.drizzle.select({
      requestKey: fxSystemApplicationActionInvocationsV1.requestKey,
    }).from(fxSystemApplicationActionInvocationsV1).where(eq(
      fxSystemApplicationActionInvocationsV1.requestKey,
      "application-action-rollback-1",
    ))).toHaveLength(0);

    const jsonCorruptRequest = makeRequest(
      "application-action-json-corrupt-1",
      0x51,
    );
    await runEffect(admitApplicationAuthorityActionInvocation({
      selection: active.selection,
      request: jsonCorruptRequest,
      executionAuthority: admitted.executionAuthority,
      invocationId: "00000000-0000-4000-8000-000000000410",
    }, actionContext));
    await fixture.target.drizzle.execute(
      `update fx_system_application_action_invocation_v1
       set application_execution_authority_json = '{"bad":true}'::jsonb
       where request_key = 'application-action-json-corrupt-1'`,
    );
    const jsonCorrupt = await runEffect(Effect.result(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request: jsonCorruptRequest,
        executionAuthority: admitted.executionAuthority,
        invocationId: "00000000-0000-4000-8000-000000000411",
      }, actionContext),
    ));
    expect(Result.isFailure(jsonCorrupt)).toBe(true);
    if (Result.isFailure(jsonCorrupt)) {
      expect(jsonCorrupt.failure).toMatchObject({
        _tag: "ApplicationActionAuthorityCorruptionV1Error",
      });
    }

    const bytesCorruptRequest = makeRequest(
      "application-action-bytes-corrupt-1",
      0x52,
    );
    await runEffect(admitApplicationAuthorityActionInvocation({
      selection: active.selection,
      request: bytesCorruptRequest,
      executionAuthority: admitted.executionAuthority,
      invocationId: "00000000-0000-4000-8000-000000000412",
    }, actionContext));
    await fixture.target.drizzle.update(
      fxSystemApplicationActionInvocationsV1,
    ).set({
      applicationExecutionAuthorityCanonicalBytes: new Uint8Array([0x7b]),
    }).where(eq(
      fxSystemApplicationActionInvocationsV1.requestKey,
      "application-action-bytes-corrupt-1",
    ));
    const bytesCorrupt = await runEffect(Effect.result(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request: bytesCorruptRequest,
        executionAuthority: admitted.executionAuthority,
        invocationId: "00000000-0000-4000-8000-000000000413",
      }, actionContext),
    ));
    expect(Result.isFailure(bytesCorrupt)).toBe(true);
    if (Result.isFailure(bytesCorrupt)) {
      expect(bytesCorrupt.failure).toMatchObject({
        _tag: "ApplicationActionAuthorityCorruptionV1Error",
      });
    }
    await expect(fixture.target.drizzle.update(
      fxSystemApplicationActionInvocationsV1,
    ).set({
      applicationRevisionId: "forbidden-legacy-revision",
    }).where(eq(
      fxSystemApplicationActionInvocationsV1.requestKey,
      "application-action-request-1",
    ))).rejects.toThrow();

    await fixture.target.drizzle.update(
      fxSystemApplicationActionInvocationsV1,
    ).set({
      applicationExecutionAuthoritySha256: new Uint8Array(32).fill(0xff),
    }).where(eq(
      fxSystemApplicationActionInvocationsV1.requestKey,
      "application-action-request-1",
    ));
    const corrupt = await runEffect(Effect.result(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request,
        executionAuthority: admitted.executionAuthority,
        invocationId: "00000000-0000-4000-8000-000000000403",
      }, actionContext),
    ));
    expect(Result.isFailure(corrupt)).toBe(true);
    if (Result.isFailure(corrupt)) {
      expect(corrupt.failure).toMatchObject({
        _tag: "ApplicationActionAuthorityCorruptionV1Error",
      });
    }

    await fixture.target.drizzle.update(fxSystemApplicationActiveHeads).set({
      headSha256: new Uint8Array(32).fill(0xee),
    }).where(eq(
      fxSystemApplicationActiveHeads.scopeId,
      active.basis.authority.scopeId,
    ));
    const corruptHeadAdmission = await runEffect(Effect.result(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request: makeRequest("application-action-corrupt-head-1", 0x60),
        executionAuthority: admitted.executionAuthority,
        invocationId: "00000000-0000-4000-8000-000000000420",
      }, actionContext),
    ));
    expect(Result.isFailure(corruptHeadAdmission)).toBe(true);
    if (Result.isFailure(corruptHeadAdmission)) {
      expect(corruptHeadAdmission.failure).toMatchObject({
        _tag: "ApplicationActionAuthorityCorruptionV1Error",
      });
    }
    const staleSelection = await runEffect(Effect.result(
      selectApplicationActionAdmission(
        active.selection,
        "users:get",
        Object.freeze({
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          schema: fixture.schema,
          authority: fixture.authorityPorts,
        }),
      ),
    ));
    expect(Result.isFailure(staleSelection)).toBe(true);
    if (Result.isFailure(staleSelection)) {
      expect(staleSelection.failure).toMatchObject({
        operation: "validateSelection",
        reason: "storedState",
      });
    }
    await fixture.target.drizzle.execute(
      `drop table fx_system_application_active_head cascade`,
    );
    const unavailableHeadAdmission = await runEffect(Effect.result(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request: makeRequest("application-action-unavailable-head-1", 0x61),
        executionAuthority: admitted.executionAuthority,
        invocationId: "00000000-0000-4000-8000-000000000421",
      }, actionContext),
    ));
    expect(Result.isFailure(unavailableHeadAdmission)).toBe(true);
    if (Result.isFailure(unavailableHeadAdmission)) {
      expect(unavailableHeadAdmission.failure).toMatchObject({
        _tag: "ApplicationActionAuthorityIntegrationV1Error",
        operation: "validateApplicationSelection",
        cause: { reason: "resourceFailure" },
      });
    }
  })
});
