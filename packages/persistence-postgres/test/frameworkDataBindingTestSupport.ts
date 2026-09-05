import { Effect, Result } from "effect";
import { and, eq, sql } from "drizzle-orm";
import { expect } from "vitest";
import {
  makeDataBindingHost,
  dataBindingActivationRequest,
  type DataBindingHostInput,
} from "../src/frameworkSchema/binding/host";
import { bindingError } from "../src/frameworkSchema/binding/errors";
import {
  readAdmittedDataBinding,
  claimAdmittedDataBindingInTransaction,
  type AdmittedDataBinding,
} from "../src/frameworkSchema/binding/selection";
import {
  fxSystemDataBindingActivations,
  fxSystemDataBindingHeads,
  fxSystemDataBindingCandidates,
} from "../src/frameworkSchema/binding/schema";
import type {
  ApplicationNativeMutationFixture,
  ApplicationNativeMutationPersistence,
} from "./fixtures/applicationNativeMutationTestFixture";
import type { FrameworkMigrationTarget } from "../src/migrationCoordination/targetSession";
import type { DataBindingSetFrame } from "../src/frameworkSchema/binding/model";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  isApplicationBindingReference,
  isDataBindingSetFrame,
} from "../src/frameworkSchema/binding/canonical";

export function bindingInput<
  Persistence extends ApplicationNativeMutationPersistence,
>(
  fixture: ApplicationNativeMutationFixture<Persistence>,
  target: FrameworkMigrationTarget,
) {
  return {
    database: fixture.target.drizzle,
    deploymentId: fixture.deploymentId,
    target,
    authority: fixture.authorityPorts,
    application: fixture.activation,
  } satisfies DataBindingHostInput<
    Effect.Error<ReturnType<typeof fixture.activation.readActive>>
  >;
}

/** Same deterministic contract on both drivers; native races are separate. One Application setup per scenario group. */
export async function exerciseBindingLifecycle<
  Persistence extends ApplicationNativeMutationPersistence,
>(
  fixture: ApplicationNativeMutationFixture<Persistence>,
  target: FrameworkMigrationTarget,
  competeFirst = false,
) {
  const input = bindingInput(fixture, target);
  const host = await runEffect(makeDataBindingHost(input));
  expect(
    await runEffectFailure(
      makeDataBindingHost({ ...input, database: fixture.control.drizzle }),
    ),
  ).toMatchObject({ reason: "invalidAuthority" });
  expect(
    await runEffectFailure(
      makeDataBindingHost({
        ...input,
        application: { readActive: input.application.readActive },
      }),
    ),
  ).toMatchObject({ reason: "invalidAuthority" });
  const reference = await runEffect(host.readApplicationReference());
  expect(reference).toMatchObject({
    revisionId: fixture.active.basis.revisionId,
    storageGeneration: "flarexdb_v1",
    authorizationRevocationEpoch: "0",
    readiness: { kind: "legacy" },
  });
  const frame: DataBindingSetFrame = {
    format: "flarex.data-binding-set",
    version: 1,
    application: reference,
    payloadContent: null,
    payloadLifecycle: null,
    commerce: null,
    crossDomainReferences: [],
  };
  expect(
    isApplicationBindingReference(reference),
    JSON.stringify(reference),
  ).toBe(true);
  expect(isDataBindingSetFrame(frame)).toBe(true);
  const candidate = await runEffect(host.prepare(frame));
  expect(await runEffect(host.prepare(frame))).toEqual(candidate);
  let request = dataBindingActivationRequest(
    reference.scopeId,
    reference.storageGeneration,
    "activate-first",
    candidate.sha256,
    null,
  );
  const activated = await (async () => {
    if (!competeFirst) return runEffect(host.activate(request));
    const competitor = { ...request, requestId: "competing-first" };
    const outcomes = await Promise.all(
      [request, competitor].map(async (input) => ({
        input,
        result: await runEffect(host.activate(input).pipe(Effect.result)),
      })),
    );
    const winner = outcomes.find((value) => Result.isSuccess(value.result));
    const loser = outcomes.find((value) => Result.isFailure(value.result));
    if (winner === undefined || loser === undefined)
      throw new Error("First activation did not have exactly one winner");
    expect(loser.result).toMatchObject({
      _tag: "Failure",
      failure: { reason: "concurrentHead" },
    });
    request = winner.input;
    return Result.getOrThrow(winner.result);
  })();
  expect(Result.getOrThrow(activated.current).selected).toBe(true);
  expect(await runEffect(host.activate(request))).toEqual(activated);
  const token = await runEffect(
    host.withCurrent((selection) =>
      Effect.gen(function* () {
        expect((yield* readAdmittedDataBinding(selection)).frame).toEqual(
          frame,
        );
        // SAFETY: deliberate forgery checks WeakMap authority, not TypeScript assignability.
        expect(
          yield* readAdmittedDataBinding(
            Object.freeze({ ...selection }) as AdmittedDataBinding,
          ).pipe(Effect.result),
        ).toMatchObject({
          _tag: "Failure",
          failure: { reason: "invalidAuthority" },
        });
        return selection;
      }),
    ),
  );
  expect(await runEffectFailure(readAdmittedDataBinding(token))).toMatchObject({
    reason: "invalidAuthority",
  });
  const restarted = await runEffect(makeDataBindingHost(input));
  const foreignTransaction = await runEffect(
    host.withCurrent((selection) =>
      Effect.promise(() =>
        fixture.control.drizzle.transaction((tx) =>
          runEffectFailure(
            claimAdmittedDataBindingInTransaction(selection, tx, target),
          ),
        ),
      ),
    ),
  );
  expect(foreignTransaction).toMatchObject({ reason: "invalidAuthority" });
  expect(
    await runEffect(restarted.withCurrent(readAdmittedDataBinding)),
  ).toEqual(await runEffect(host.withCurrent(readAdmittedDataBinding)));
  await fixture.seedUserDocument("binding-regression");
  expect(await runEffect(host.readApplicationReference())).toEqual(reference);
  expect(
    (await runEffect(host.withCurrent(readAdmittedDataBinding))).frame,
  ).toEqual(frame);

  await fixture.moveHead();
  expect(
    await runEffectFailure(host.withCurrent(readAdmittedDataBinding)),
  ).toMatchObject({ reason: "staleApplication" });
  const interrupted = await runEffect(host.recover(request));
  expect(interrupted.receipt).toEqual(activated.receipt);
  expect(interrupted.current).toMatchObject({
    _tag: "Failure",
    failure: { reason: "staleApplication" },
  });
  const nextFrame: DataBindingSetFrame = {
    ...frame,
    application: await runEffect(host.readApplicationReference()),
  };
  const next = await runEffect(host.prepare(nextFrame));
  const firstHead = Result.getOrThrow(activated.current).head;
  const secondRequest = dataBindingActivationRequest(
    reference.scopeId,
    reference.storageGeneration,
    "activate-second",
    next.sha256,
    firstHead,
  );
  const second = await runEffect(host.activate(secondRequest));
  expect(second.receipt.frame.sequence).toBe("2");
  expect(
    Result.getOrThrow((await runEffect(host.recover(request))).current)
      .selected,
  ).toBe(false);
  expect(
    await runEffectFailure(
      host.activate({ ...request, candidateSha256: next.sha256 }),
    ),
  ).toMatchObject({ reason: "requestConflict" });
  expect(
    await runEffectFailure(
      host.activate({ ...secondRequest, requestId: "stale-prior" }),
    ),
  ).toMatchObject({ reason: "concurrentHead" });

  const rollback = await runEffect(
    makeDataBindingHost({
      ...input,
      testOnly: {
        afterAcceptance: () => Effect.fail(bindingError("resourceFailure")),
      },
    }),
  );
  expect(
    await runEffectFailure(
      rollback.activate({
        ...secondRequest,
        requestId: "rollback",
        expectedHead: Result.getOrThrow(second.current).head,
      }),
    ),
  ).toMatchObject({ reason: "resourceFailure" });
  const records = await fixture.target.drizzle
    .select({ count: sql<number>`count(*)::int` })
    .from(fxSystemDataBindingActivations);
  expect(records[0]?.count).toBe(2);
  expect(
    (await fixture.target.drizzle.select().from(fxSystemDataBindingHeads))[0]
      ?.sequence,
  ).toBe(2n);
  expect(
    await runEffectFailure(
      host.prepare({
        ...nextFrame,
        payloadContent: {
          configSha256: "a".repeat(64),
          provenanceSha256: "b".repeat(64),
          application: nextFrame.application,
          tables: [],
        },
      }),
    ),
  ).toMatchObject({ reason: "unsupportedProfile" });
  expect(
    await runEffectFailure(host.prepare({ ...nextFrame, system: {} })),
  ).toMatchObject({ reason: "invalidInput" });
  expect(
    await runEffectFailure(
      host.prepare({ ...nextFrame, crossDomainReferences: [{}] }),
    ),
  ).toMatchObject({ reason: "invalidInput" });
  const rows = await fixture.target.drizzle
    .select()
    .from(fxSystemDataBindingCandidates)
    .where(eq(fxSystemDataBindingCandidates.sha256, next.sha256));
  const row = rows[0];
  if (row === undefined) throw new Error("Binding corruption fixture missing");
  const corrupt = new Uint8Array(row.canonicalBytes);
  corrupt[0] = 32;
  const condition = and(
    eq(fxSystemDataBindingCandidates.scopeId, reference.scopeId),
    eq(fxSystemDataBindingCandidates.sha256, next.sha256),
  );
  await fixture.target.drizzle
    .update(fxSystemDataBindingCandidates)
    .set({ canonicalBytes: corrupt })
    .where(condition);
  expect(
    await runEffectFailure(host.withCurrent(readAdmittedDataBinding)),
  ).toMatchObject({ reason: "storedCorruption" });
  await fixture.target.drizzle
    .update(fxSystemDataBindingCandidates)
    .set({ canonicalBytes: row.canonicalBytes })
    .where(condition);
  expect(
    Result.getOrThrow((await runEffect(host.recover(secondRequest))).current)
      .selected,
  ).toBe(true);
  return {
    host,
    input,
    candidate: next,
    frame: nextFrame,
    head: Result.getOrThrow(second.current).head,
    request: secondRequest,
  };
}
