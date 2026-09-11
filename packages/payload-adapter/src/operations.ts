import { Effect, type Result } from "effect";
import type { BasePayload, PayloadRequest } from "payload";
import { cmsError, defineCmsCommand, type CmsCommandContext, type CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";
import type { Json } from "flarex-protocol/json";
import { makePayloadDatabaseAdapter } from "./adapter";
import { type PayloadContentProfile } from "./contract";
import { projectPayloadFailure } from "./errors";
import { makePayloadInputs, type PayloadCreateInput, type PayloadUpdateInput, type PayloadDeleteInput,
  type PayloadFindInput, type PayloadFindByIdInput, type PayloadCountInput } from "./inputs";
import type { PayloadJoinQuery } from "./joins";
import { payloadResults } from "./results";

type Bridge = ReturnType<typeof makePayloadDatabaseAdapter>;
type ReadOptions = Pick<PayloadFindByIdInput, "depth" | "joins" | "joinRead">;
const noJoins: PayloadJoinQuery = { referencedBy: false, referencedByMany: false };
const noPopulation: ReadOptions = { depth: 0, joins: noJoins, joinRead: false };

/** These handlers belong to one Payload instance; no request state is retained. */
export function makePayloadOperations(payload: BasePayload, bridge: Bridge, profile: PayloadContentProfile,
  isLive: () => boolean, onExecute?: () => void) {
  const inputs = makePayloadInputs(profile);
  const options = (req: Partial<PayloadRequest>, read: ReadOptions) => ({
    collection: "posts", req, depth: read.depth, overrideAccess: false,
    ...(profile === "payload.content-joins" ? { joins: read.joinRead ? {
      referencedBy: read.joins.referencedBy === false ? false as const : { ...read.joins.referencedBy },
      referencedByMany: read.joins.referencedByMany === false ? false as const : { ...read.joins.referencedByMany },
    } : false as const } : {}),
  } as const);

  const call = Effect.fn("PayloadAdapter.call")(function* <A extends Json>(
    context: CmsCommandContext, write: boolean, read: ReadOptions,
    invoke: (common: ReturnType<typeof options>) => Promise<unknown>,
    decode: (value: unknown) => Result.Result<A, CmsTransactionError>,
  ) {
    const req: Partial<PayloadRequest> = write ? { transactionID: context.transactionId } : {};
    const common = options(req, read);
    onExecute?.();
    const result = yield* Effect.tryPromise({
      try: signal => bridge.within(context, req, signal, () => invoke(common), read.depth === 1, read.joins),
      catch: cause => cause,
    }).pipe(
      // oxlint-disable-next-line flarex/prefer-tagged-effect-recovery -- REVIEW: compatibility - Payload rejects with its own errors or a CMS failure; unknown rejection remains a defect.
      Effect.catch(projectPayloadFailure));
    return yield* Effect.fromResult(decode(result));
  });

  const handlers = {
    create: (ctx: CmsCommandContext, args: PayloadCreateInput) =>
      call(ctx, true, noPopulation, common => payload.create({ ...common, data: args.data }), payloadResults.document),
    update: (ctx: CmsCommandContext, args: PayloadUpdateInput) =>
      call(ctx, true, noPopulation, common => payload.update({ ...common, id: args.id, data: args.data }), payloadResults.document),
    delete: (ctx: CmsCommandContext, args: PayloadDeleteInput) =>
      call(ctx, true, noPopulation, common => payload.delete({ ...common, id: args.id }), payloadResults.document),
    findByID: (ctx: CmsCommandContext, args: PayloadFindByIdInput) =>
      call(ctx, false, args, common => payload.findByID({ ...common, id: args.id }), payloadResults.document),
    find: (ctx: CmsCommandContext, args: PayloadFindInput) =>
      call(ctx, false, args, common => payload.find({ ...common, where: args.where,
        ...(args.page === undefined ? {} : { page: args.page }),
        ...(args.pagination === undefined ? {} : { pagination: args.pagination }),
        limit: args.limit ?? 10, sort: "id" }), payloadResults.page),
    count: (ctx: CmsCommandContext, args: PayloadCountInput) =>
      call(ctx, false, noPopulation, common => payload.count({ ...common, where: args.where }), payloadResults.count),
  };

  // The registry's JSON boundary stays inside existing host admission/replay.
  // A pair is inferred from its decoder; the handler cannot select a wider input.
  const command = <A, Output extends Json>(name: string, mode: "read" | "write",
    decode: (ctx: CmsCommandContext, input: Json) => Effect.Effect<A, CmsTransactionError>,
    handle: (ctx: CmsCommandContext, args: NoInfer<A>) => Effect.Effect<Output, CmsTransactionError>,
  ) => defineCmsCommand({ name, mode, run: Effect.fn("PayloadAdapter.invoke")(function* (ctx, args) {
    if (!isLive()) return yield* Effect.fail(cmsError("closed"));
    return yield* handle(ctx, yield* decode(ctx, args));
  }) });

  return {
    create: command("payload-create", "write", inputs.create, handlers.create),
    update: command("payload-update", "write", inputs.update, handlers.update),
    delete: command("payload-delete", "write", inputs.delete, handlers.delete),
    find: command("payload-find", "read", inputs.find, handlers.find),
    findByID: command("payload-findByID", "read", inputs.findByID, handlers.findByID),
    count: command("payload-count", "read", inputs.count, handlers.count),
  };
}
