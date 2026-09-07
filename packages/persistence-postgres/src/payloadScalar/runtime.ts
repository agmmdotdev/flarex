import { APIError, ValidationError, BasePayload, buildConfig, type Where, type PayloadRequest, type CollectionAfterChangeHook } from "payload";
import { Effect } from "effect";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { capturePrivateJsonData } from "../privateJsonData";
import { cmsError, CmsTransactionError } from "../cmsTransaction/model";
import { defineCmsCommand, makeCmsHost, type CmsHost, type CmsHostInput, type CmsCommandContext } from "../cmsTransaction/host";
import { makePayloadScalarAdapter, UnsupportedPayloadScalarCapability } from "./adapter";
import { scalarPostsCollection, payloadScalarContentIdentity, payloadRelationContentIdentity } from "./profile";
import type { PayloadContentProfile } from "./contract";

const projectPayloadFailure = (cause: unknown): Effect.Effect<never, CmsTransactionError> => {
  if (cause instanceof CmsTransactionError) return Effect.fail(cause);
  if (cause instanceof ValidationError) return Effect.fail(cmsError("documentInvalid", cause));
  if (cause instanceof UnsupportedPayloadScalarCapability) return Effect.fail(cmsError("unsupportedProfile", cause));
  if (cause instanceof APIError) return Effect.fail(cmsError(cause.status === 404 ? "documentMissing" : "invalidInput", cause));
  return Effect.die(cause);
};

export const makePayloadScalarRuntime = Effect.fn("PayloadScalar.makeRuntime")(function* (profile: PayloadContentProfile = "payload.scalar") {
  const bridge = makePayloadScalarAdapter(profile);
  let hookRuns = 0;
  let executions = 0;
  let pendingReads = 0;
  let live = true;
  const hook: CollectionAfterChangeHook = async ({ doc, req, operation }) => {
    if (operation !== "create") return doc;
    if (["id-pending", "id-foreign", "id-blank", "id-zero", "id-removed", "id-unresolved"].includes(doc.title)) {
      const id = req.transactionID;
      if (typeof id !== "string") throw new UnsupportedPayloadScalarCapability("expected admitted hook ID");
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
  const posts = scalarPostsCollection(profile);
  posts.hooks = { afterChange: [hook], afterDelete: [async ({ doc, req }) => {
    if (doc.title === "delete-unresolved") { pendingReads += 1; await new Promise<void>(() => {}); }
    if (doc.title === "delete-nested-fail") {
      await req.payload.create({ collection: "posts", data: { title: "delete-child", publishedAt: doc.publishedAt }, req, depth: 0, overrideAccess: false });
      await req.payload.create({ collection: "posts", data: {}, req, depth: 0, overrideAccess: false });
    }
    return doc;
  }] };
  const config = yield* Effect.tryPromise({
    try: () => buildConfig({ secret: "private-payload-conformance-only-not-a-deployment-secret", db: bridge.adapter,
        collections: [posts, { slug: "users", auth: true, lockDocuments: false, fields: [] }],
        admin: { user: "users", disable: true }, globals: [], folders: false,
        jobs: { tasks: [], workflows: [] }, telemetry: false, typescript: { autoGenerate: false },
        kv: { init: () => ({ clear: bridge.unsupported, delete: bridge.unsupported, get: bridge.unsupported,
          has: bridge.unsupported, keys: bridge.unsupported, set: bridge.unsupported }) },
        email: () => ({ name: "disabled", defaultFromAddress: "disabled@example.invalid", defaultFromName: "Disabled", sendEmail: () => bridge.unsupported("email") }),
      }), catch: cause => cmsError("unsupportedProfile", cause),
  });
  const slugs = config.collections.map(collection => collection.slug).toSorted();
  if (slugs.join() !== "payload-migrations,payload-preferences,posts,users" || config.globals.length !== 0 ||
    config.collections.some(collection => collection.lockDocuments !== false)) return yield* Effect.fail(cmsError("unsupportedProfile", "sanitized internal inventory"));
  // Acquire before init so partially initialized instances also receive cleanup.
  const payload = yield* Effect.acquireRelease(Effect.sync(() => new BasePayload()), instance =>
    Effect.sync(() => { live = false; }).pipe(Effect.andThen(Effect.tryPromise({ try: () => instance.destroy(), catch: cause => cmsError("resourceFailure", cause) })), Effect.orDie));
  yield* Effect.tryPromise({ try: () => payload.init({ config, disableOnInit: true }), catch: cause => cmsError("unsupportedProfile", cause) });
  const invoke = Effect.fn("PayloadScalar.invoke")(function* (context: CmsCommandContext, operation: string, args: Json) {
    if (!live) return yield* Effect.fail(cmsError("closed"));
    if (!isJsonObject(args)) return yield* Effect.fail(cmsError("invalidInput"));
    const allowed = operation === "create" ? ["data"] : operation === "update" ? ["id", "data"] : operation === "find" ? ["where", "page", "limit", "pagination", "sort"] : operation === "count" ? ["where"] : ["id"];
    if (Object.keys(args).some(key => !allowed.includes(key))) return yield* Effect.fail(cmsError("unsupportedProfile"));
    if (args.where !== undefined && (!isJsonObject(args.where) || Object.entries(args.where).some(([key, value]) =>
      !["id", "title"].includes(key) || !isJsonObject(value) || Object.keys(value).join() !== "equals" || typeof value.equals !== "string"))) {
      return yield* Effect.fail(cmsError("invalidInput", new UnsupportedPayloadScalarCapability("where")));
    }
    const query: Where = {};
    if (isJsonObject(args.where)) for (const [key, value] of Object.entries(args.where)) {
      if (isJsonObject(value) && typeof value.equals === "string") query[key] = { equals: value.equals };
    }
    const req: Partial<PayloadRequest> = ["create", "update", "delete"].includes(operation) ? { transactionID: context.transactionId } : {};
    const common = { collection: "posts", req, depth: 0, overrideAccess: false } as const;
    const data = args.data;
    if ((operation === "create" || operation === "update") && (!isJsonObject(data) || Object.keys(data).some(key =>
      !["title", "score", "enabled", "publishedAt", ...(profile === "payload.content-relations" ? ["relatedPost"] : [])].includes(key)))) {
      return yield* Effect.fail(cmsError("unsupportedProfile", new UnsupportedPayloadScalarCapability("input fields")));
    }
    if (isJsonObject(data) && data.relatedPost !== undefined && data.relatedPost !== null && typeof data.relatedPost !== "string") {
      return yield* Effect.fail(cmsError("relationInvalid", new UnsupportedPayloadScalarCapability("relationship input")));
    }
    let call: () => Promise<unknown>;
    switch (operation) {
      case "create": {
        if (!isJsonObject(data)) return yield* Effect.fail(cmsError("invalidInput"));
        call = () => payload.create({ ...common, data }); break;
      }
      case "update": {
        const id = args.id;
        if (typeof id !== "string" || !isJsonObject(data)) return yield* Effect.fail(cmsError("invalidInput"));
        call = () => payload.update({ ...common, id, data }); break;
      }
      case "delete": case "findByID": {
        const id = args.id;
        if (typeof id !== "string") return yield* Effect.fail(cmsError("invalidInput"));
        call = operation === "delete" ? () => payload.delete({ ...common, id }) : () => payload.findByID({ ...common, id }); break;
      }
      case "find": {
        const { page, limit, pagination, sort } = args;
        if ((page !== undefined && (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1 || page > 257)) ||
          (limit !== undefined && (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 32)) ||
          (pagination !== undefined && typeof pagination !== "boolean") || (sort !== undefined && sort !== "id")) {
          return yield* Effect.fail(cmsError("unsupportedProfile", new UnsupportedPayloadScalarCapability("query options")));
        }
        call = () => payload.find({ ...common, where: query, page, limit: limit ?? 10, pagination, sort: "id" }); break;
      }
      case "count": call = () => payload.count({ ...common, where: query }); break;
      default: return yield* Effect.fail(cmsError("unsupportedProfile"));
    }
    executions += 1;
    const result = yield* Effect.tryPromise({ try: signal => bridge.within(context, req, signal, call), catch: cause => cause }).pipe(
      // oxlint-disable-next-line flarex/prefer-tagged-effect-recovery -- REVIEW: compatibility - This Payload Promise boundary classifies every unknown rejection and preserves unknown causes as defects.
      Effect.catch(projectPayloadFailure));
    return (yield* Effect.fromResult(capturePrivateJsonData(result, 1_048_576, cmsError))).value;
  });
  const commands = {
    create: defineCmsCommand({ name: "payload-create", mode: "write", run: (ctx, args) => invoke(ctx, "create", args) }),
    update: defineCmsCommand({ name: "payload-update", mode: "write", run: (ctx, args) => invoke(ctx, "update", args) }),
    delete: defineCmsCommand({ name: "payload-delete", mode: "write", run: (ctx, args) => invoke(ctx, "delete", args) }),
    find: defineCmsCommand({ name: "payload-find", mode: "read", run: (ctx, args) => invoke(ctx, "find", args) }),
    findByID: defineCmsCommand({ name: "payload-findByID", mode: "read", run: (ctx, args) => invoke(ctx, "findByID", args) }),
    count: defineCmsCommand({ name: "payload-count", mode: "read", run: (ctx, args) => invoke(ctx, "count", args) }),
  };
  const bind = Effect.fn("PayloadScalar.bind")(function* <Failure>(input: Omit<CmsHostInput<Failure>, "commands" | "expectedContentIdentity">): Effect.fn.Return<CmsHost, CmsTransactionError> {
    if (!live) return yield* Effect.fail(cmsError("closed"));
    const host = yield* makeCmsHost({ ...input, commands: Object.values(commands), expectedContentIdentity: profile === "payload.scalar" ? payloadScalarContentIdentity : payloadRelationContentIdentity });
    return {
      newRequestKey: host.newRequestKey,
      run: (key, command, args) => Effect.suspend(() => live ? host.run(key, command, args) : Effect.fail(cmsError("closed"))),
      read: (command, args) => Effect.suspend(() => live ? host.read(command, args) : Effect.fail(cmsError("closed"))),
    };
  });
  return { commands, payload, bind, touched: bridge.touched, hookRuns: () => hookRuns, executions: () => executions, pendingReads: () => pendingReads };
});
