import { createHash } from "node:crypto";
import { Effect } from "effect";
import { ValidationError, type CollectionAfterChangeHook, type CollectionConfig, type PayloadRequest } from "payload";
import { makePayloadNative } from "../runtime/native";
import { makePayloadAttempt } from "../runtime/attempt";
import type { SessionJournalAttempt } from "@flarex/persistence-postgres/session-journal-store";
import type { CompiledPayloadCollections } from "../collections";
import { payloadPostsCollectionDefinition } from "./profiles";
import { UnsupportedPayloadCapability } from "../errors";

/** Exact native compiler input used by every fixed mixed Payload runtime. */
export const mixedPayloadPostsCollections = () =>
  [payloadPostsCollectionDefinition("payload.scalar")];

/** These revision strings are reviewed code contracts. A hook/access change
 * requires a new revision before its participant can be admitted or replayed. */
const revision = (contract: string) => {
  const revisionSha256 = createHash("sha256").update(contract).digest("hex");
  return Object.freeze({ revisionSha256, participant: `payload.posts.${revisionSha256}` });
};

export const mixedPayloadSuccessProfile = revision(
  "payload@3.88.0/posts.scalar/local-create-updateByID-findByID/allow-context-v1/create-afterChange-nested-score-update-read-v1",
);
export const mixedPayloadCaughtFailureProfile = revision(
  "payload@3.88.0/posts.scalar/local-create-updateByID-findByID/allow-context-v1/create-afterChange-nested-score-update-read-caught-missing-title-v1",
);
export const mixedPayloadDeniedProfile = revision(
  "payload@3.88.0/posts.scalar/local-create-updateByID-findByID/deny-context-v1/no-hook-v1",
);
export const mixedPayloadPromisedIdProfile = revision(
  "payload@3.88.0/posts.scalar/local-create-findByID/allow-context-v1/create-afterChange-owned-promised-id-v1",
);
export const mixedPayloadForeignIdProfile = revision(
  "payload@3.88.0/posts.scalar/local-create-findByID/allow-context-v1/create-afterChange-foreign-id-v1",
);
export const mixedPayloadRemovedIdProfile = revision(
  "payload@3.88.0/posts.scalar/local-create-findByID/allow-context-v1/create-afterChange-removed-id-nested-read-v2",
);
export const mixedPayloadUnresolvedIdProfile = revision(
  "payload@3.88.0/posts.scalar/local-create-findByID/allow-context-v1/create-afterChange-unresolved-id-release-held-hook-and-revocation-v3",
);
export const mixedPayloadInspectionProfile = revision(
  "payload@3.88.0/posts.scalar/local-create-updateByID-findByID/allow-context-v1/create-afterChange-nested-score-update-read-fixed-entry-and-result-latches-v1",
);

type FixedProfile = "success" | "caughtFailure" | "denied" | "promisedId" | "foreignId" | "removedId" | "unresolvedId" | "inspection";
const principalContextKey = "flarexFixedPayloadPrincipal";

/** Fixed hook state belongs to an attempt facade, including every late continuation. */
const makeFixedAttemptState = (selected: FixedProfile) => {
  const requests = new Set<PayloadRequest>();
  const dataLoaders = new Set<PayloadRequest["payloadDataLoader"]>();
  let hookRuns = 0;
  let nestedReads = 0;
  let executions = 0;
  let caughtValidationErrors = 0;
  let collectionAdmissions = 0;
  let releaseHeldId: (() => void) | undefined;
  let postCancellationRefusals = 0;
  let releasePostCancelProbe: (() => void) | undefined;
  let releaseHookEntry: (() => void) | undefined;
  let releaseNestedResult: (() => void) | undefined;
  const afterChange: CollectionAfterChangeHook = async ({ doc, operation, req }) => {
    if (operation !== "create") return doc;
    hookRuns += 1;
    if (doc.score !== 0 || doc.enabled !== false) throw new Error("Payload defaults were not applied before the fixed hook");
    if (selected === "inspection") await new Promise<void>(resolve => { releaseHookEntry = resolve; });
    if (selected === "promisedId" || selected === "foreignId" || selected === "removedId" || selected === "unresolvedId") {
      const owned = req.transactionID;
      if (typeof owned !== "string") throw new Error("Fixed Payload hook did not receive the owned transaction ID");
      if (selected === "promisedId") req.transactionID = Promise.resolve(owned);
      if (selected === "foreignId") req.transactionID = "foreign";
      if (selected === "removedId") delete req.transactionID;
      if (selected === "unresolvedId") req.transactionID = new Promise<string>(resolve => {
        releaseHeldId = () => resolve(owned);
      });
      {
        if (selected === "unresolvedId") {
          try {
            await req.payload.findByID({ collection: "posts", id: doc.id, req, depth: 0, overrideAccess: false });
            throw new Error("Held Payload transaction ID unexpectedly completed");
          } catch (cause) {
            // Retain the native first failure. The second read is solely a
            // witness that a continued hook cannot re-enter after revocation.
            await new Promise<void>(resolve => { releasePostCancelProbe = resolve; });
            try {
              await req.payload.findByID({ collection: "posts", id: doc.id, req, depth: 0, overrideAccess: false });
            } catch (probe) {
              if (probe instanceof UnsupportedPayloadCapability && probe.capability === "unadmitted request")
                postCancellationRefusals += 1;
            }
            throw cause;
          }
        } else {
          await req.payload.findByID({ collection: "posts", id: doc.id, req, depth: 0, overrideAccess: false });
          nestedReads += 1;
        }
      }
      return doc;
    }
    const updated = await req.payload.update({ collection: "posts", id: doc.id, data: { score: 1 },
      req, depth: 0, overrideAccess: false });
    if (updated.score !== 1) throw new Error("Nested Payload update lost the pending document");
    const observed = await req.payload.findByID({ collection: "posts", id: doc.id, req, depth: 0,
      overrideAccess: false });
    nestedReads += 1;
    if (observed.score !== 1) throw new Error("Nested Payload read lost the pending update");
    if (selected === "inspection") await new Promise<void>(resolve => { releaseNestedResult = resolve; });
    if (selected === "caughtFailure") {
      try {
        await req.payload.create({ collection: "posts", data: { publishedAt: doc.publishedAt }, req,
          depth: 0, overrideAccess: false });
        throw new Error("Missing-title Payload create unexpectedly succeeded");
      } catch (cause) {
        if (!(cause instanceof ValidationError)) throw cause;
        caughtValidationErrors += 1;
      }
    }
    // The outer create result is not a substitute for a later pending read.
    return doc;
  };
  return Object.freeze({ afterChange, observeRequest: (req: PayloadRequest) => {
    requests.add(req);
    dataLoaders.add(req.payloadDataLoader);
  }, onExecute: () => { executions += 1; },
    onCollection: () => { collectionAdmissions += 1; }, observations: Object.freeze({
    hookRuns: () => hookRuns, nestedReads: () => nestedReads, executions: () => executions,
    requests: () => requests.size, dataLoaders: () => dataLoaders.size,
    caughtValidationErrors: () => caughtValidationErrors,
    heldIdPending: () => releaseHeldId !== undefined,
    heldIdReadEntered: () => selected === "unresolvedId" && releaseHeldId !== undefined && collectionAdmissions >= 2,
    releaseHeldId: () => { releaseHeldId?.(); releaseHeldId = undefined; },
    postCancellationRefusals: () => postCancellationRefusals,
    postCancelProbeHeld: () => releasePostCancelProbe !== undefined,
    releasePostCancelProbe: () => { releasePostCancelProbe?.(); releasePostCancelProbe = undefined; },
    hookEntryHeld: () => releaseHookEntry !== undefined,
    releaseHookEntry: () => { releaseHookEntry?.(); releaseHookEntry = undefined; },
    nestedResultHeld: () => releaseNestedResult !== undefined,
    releaseNestedResult: () => { releaseNestedResult?.(); releaseNestedResult = undefined; },
  }) });
};

/** Test-only native profile. Scope retains configuration; each facade owns fresh observations. */
const makeFixedRuntime = Effect.fn("PayloadMixedConformance.make")(function* (
  compiled: CompiledPayloadCollections, selected: FixedProfile,
) {
  const states = new WeakMap<object, ReturnType<typeof makeFixedAttemptState>>();
  const stateContextKey = "flarexFixedPayloadAttempt";
  const allowed = selected !== "denied";
  const stateForRequest = (req: PayloadRequest) => {
    const token = req.context[stateContextKey];
    return typeof token === "object" && token !== null ? states.get(token) : undefined;
  };
  const allow = ({ req }: { req: PayloadRequest }) => {
    stateForRequest(req)?.observeRequest(req);
    return req.context[principalContextKey] === "allowed";
  };
  const access: NonNullable<CollectionConfig["access"]> = {
    read: allow, create: allow, update: allow, delete: allow,
  };
  const afterChange: CollectionAfterChangeHook = input => {
    const state = stateForRequest(input.req);
    if (state === undefined) throw new UnsupportedPayloadCapability("unadmitted request");
    return state.afterChange(input);
  };
  const native = yield* makePayloadNative(compiled, {
    hooks: selected === "denied" ? { afterChange: [] } : { afterChange: [afterChange] }, access,
  });
  const profile = selected === "success" ? mixedPayloadSuccessProfile :
    selected === "caughtFailure" ? mixedPayloadCaughtFailureProfile :
      selected === "denied" ? mixedPayloadDeniedProfile :
        selected === "promisedId" ? mixedPayloadPromisedIdProfile :
          selected === "foreignId" ? mixedPayloadForeignIdProfile :
            selected === "removedId" ? mixedPayloadRemovedIdProfile :
              selected === "unresolvedId" ? mixedPayloadUnresolvedIdProfile : mixedPayloadInspectionProfile;
  const makeAttempt = Effect.fn("PayloadMixedConformance.makeAttempt")(function* (attempt: SessionJournalAttempt) {
    const state = makeFixedAttemptState(selected);
    const token = Object.freeze({});
    states.set(token, state);
    const runtime = yield* makePayloadAttempt(native, compiled.sourceContract.sourceKey, attempt, {
      requestContext: { [principalContextKey]: allowed ? "allowed" : "denied", [stateContextKey]: token },
      onExecute: state.onExecute, onCollection: state.onCollection,
    });
    return Object.freeze({ runtime, payload: native.payload, profile, observations: state.observations });
  });
  return Object.freeze({ makeAttempt, payload: native.payload, profile });
});

export const makeMixedPayloadSuccessRuntime = (compiled: CompiledPayloadCollections) => makeFixedRuntime(compiled, "success");
export const makeMixedPayloadCaughtFailureRuntime = (compiled: CompiledPayloadCollections) => makeFixedRuntime(compiled, "caughtFailure");
export const makeMixedPayloadDeniedRuntime = (compiled: CompiledPayloadCollections) => makeFixedRuntime(compiled, "denied");
export const makeMixedPayloadPromisedIdRuntime = (compiled: CompiledPayloadCollections) => makeFixedRuntime(compiled, "promisedId");
export const makeMixedPayloadForeignIdRuntime = (compiled: CompiledPayloadCollections) => makeFixedRuntime(compiled, "foreignId");
export const makeMixedPayloadRemovedIdRuntime = (compiled: CompiledPayloadCollections) => makeFixedRuntime(compiled, "removedId");
export const makeMixedPayloadUnresolvedIdRuntime = (compiled: CompiledPayloadCollections) => makeFixedRuntime(compiled, "unresolvedId");
export const makeMixedPayloadInspectionRuntime = (compiled: CompiledPayloadCollections) => makeFixedRuntime(compiled, "inspection");
