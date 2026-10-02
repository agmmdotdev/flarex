import { Effect, type Scope } from "effect";
import type { BasePayload, CollectionAfterChangeHook, CollectionConfig } from "payload";
import type { CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";
import type { PayloadContentProfile } from "../contract";
import { UnsupportedPayloadCapability } from "../errors";
import { makePayloadNative } from "../runtime/native";
import { bindPayloadDirect } from "../direct/binding";
import type { PayloadRuntime } from "../runtime";
import { payloadConformanceConfiguration } from "./profiles";
import type { CompiledPayloadCollections } from "../collections";

export interface PayloadConformanceRuntime {
  readonly runtime: Omit<PayloadRuntime, "borrowParticipant">;
  readonly payload: BasePayload;
  readonly observations: {
    readonly touched: () => string[];
    readonly hookRuns: () => number;
    readonly executions: () => number;
    readonly pendingReads: () => number;
  };
}

/** Fixed test scenarios only; the ordinary runtime never imports this module. */
export const makePayloadConformanceRuntime: (
  profile?: PayloadContentProfile,
) => Effect.Effect<PayloadConformanceRuntime, CmsTransactionError, Scope.Scope> =
  Effect.fn("PayloadConformance.makeRuntime")(function* (profile: PayloadContentProfile = "payload.scalar") {
  let hookRuns = 0;
  let executions = 0;
  let pendingReads = 0;
  const touched = new Set<string>();
  const hook: CollectionAfterChangeHook = async ({ doc, req, operation }) => {
    if (operation !== "create") return doc;
    if (["id-pending", "id-foreign", "id-blank", "id-zero", "id-removed", "id-unresolved"].includes(doc.title)) {
      const id = req.transactionID;
      if (typeof id !== "string") throw new UnsupportedPayloadCapability("expected admitted hook ID");
      switch (doc.title) {
        case "id-pending": req.transactionID = Promise.resolve(id); break;
        case "id-foreign": req.transactionID = "foreign"; break;
        case "id-blank": req.transactionID = ""; break;
        case "id-zero": req.transactionID = 0; break;
        case "id-removed": delete req.transactionID; break;
        case "id-unresolved": pendingReads += 1; req.transactionID = new Promise<string>(() => {}); break;
      }
      if (doc.title === "id-removed") await req.payload.create({ collection: "posts", data: { title: "removed-child", publishedAt: doc.publishedAt }, req, depth: 0, overrideAccess: false });
      else await req.payload.findByID({ collection: "posts", id: doc.id, req, depth: 0, overrideAccess: false });
      return doc;
    }
    if (!["nested-ok", "nested-fail", "nested-caught"].includes(doc.title)) return doc;
    hookRuns += 1;
    const before = await req.payload.findByID({ collection: "posts", id: doc.id, req, depth: 0, overrideAccess: false });
    if (before.title !== doc.title) throw new Error("Nested Payload read lost pending document");
    await req.payload.create({ collection: "posts", data: { title: `${doc.title}-child`, publishedAt: doc.publishedAt }, req, depth: 0, overrideAccess: false });
    if (doc.title !== "nested-ok") {
      const failing = req.payload.create({ collection: "posts", data: { publishedAt: doc.publishedAt }, req, depth: 0, overrideAccess: false });
      if (doc.title === "nested-caught") await failing.catch(() => undefined);
      else await failing;
    }
    return doc;
  };
  const hooks: NonNullable<CollectionConfig["hooks"]> = { afterChange: [hook], afterDelete: [async ({ doc, req }) => {
    if (doc.title === "delete-unresolved") { pendingReads += 1; await new Promise<void>(() => {}); }
    if (doc.title === "delete-nested-fail") {
      await req.payload.create({ collection: "posts", data: { title: "delete-child", publishedAt: doc.publishedAt }, req, depth: 0, overrideAccess: false });
      await req.payload.create({ collection: "posts", data: {}, req, depth: 0, overrideAccess: false });
    }
    return doc;
  }] };

  const native = yield* makePayloadNative(payloadConformanceConfiguration(profile), {
    hooks, onExecute: () => { executions += 1; },
    onCollection: collection => { touched.add(collection); },
  });
  return { runtime: { commands: native.commands, ...bindPayloadDirect(native) }, payload: native.payload, observations: {
    touched: () => [...touched], hookRuns: () => hookRuns,
    executions: () => executions, pendingReads: () => pendingReads,
  } };
});

/** Fixed native-access witness for equivalent direct and managed read behavior. */
export const makePayloadManagedReadAccessRuntime = Effect.fn("PayloadManagedReadAccess.make")(function* (
  compiled: CompiledPayloadCollections,
) {
  let visibility: "all" | "selected" | "denied" = "all";
  let accessCalls = 0;
  const native = yield* makePayloadNative(compiled, {
    hooks: {}, onExecute: () => {}, onCollection: () => {},
    access: { create: () => true, update: () => true, delete: () => true,
      read: () => {
        accessCalls++;
        return visibility === "all" ? true : visibility === "denied" ? false :
          { title: { equals: "Managed Local API" } };
      } },
  });
  return { runtime: { commands: native.commands, ...bindPayloadDirect(native) },
    selectVisibility: (selected: typeof visibility) => { visibility = selected; },
    observations: { accessCalls: () => accessCalls } };
});
