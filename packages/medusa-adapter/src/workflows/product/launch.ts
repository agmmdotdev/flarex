import { Effect, Schema } from "effect";
import { createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateProductTagsWorkflow } from "@medusajs/core-flows/product/update-product-tags";
import { useQueryGraphStep } from "@medusajs/core-flows/common/use-query-graph";
import { capturePrivateCanonicalValue, commerceError, commerceLimits, isJsonObject,
  type CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureAtomicCommerceEvents, commerceCommandIdentity, makeBorrowedWorkflowAttempt,
  prepareAtomicCommerceEvents, type AtomicCommerceEvents, type AtomicCommerceParticipant,
  type AtomicCommerceParticipantInput, type BorrowedWorkflowAttemptInput,
  requirePreparedAtomicCommerceLogicalParticipant, type PreparedAtomicCommerceLogicalParticipant,
  type ParticipantEventSelection } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { ProductVariantPricingOutput, productVariantPricingWorkflow } from "./variant-pricing";
import { ProductTagWorkflowResult, type ProductWorkflowModule } from "../../modules/product/workflow";
import { PricingId } from "../../modules/pricing/input";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import type { prepareVariantPricingLink } from "../../links/variant-pricing-service";
import { composedProductTagEvents } from "./tag-events";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { prepareWorkflowResources } from "../../workflow/resources";
import { prepareWorkflowComposition, type InstalledWorkflowModule, captureInstalledWorkflowModules } from "../../workflow/host";
import { productLaunchCommandMs, productLaunchResources } from "../../workflow/policy";

/** One fixed private launch input. Native identities remain provisional per root attempt. */
export const ProductLaunchInput = Schema.Struct({
  product_id: PricingId,
  tag_id: PricingId,
  variant_title: Schema.String,
  usd_amount: Schema.Union([Schema.String, Schema.Number]),
  variant_id: Schema.optionalKey(PricingId),
  price_set_id: Schema.optionalKey(PricingId),
});

const ProductWithLaunchedTag = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  tags: Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Schema.String, value: Schema.String }),
    [Schema.Record(Schema.String, Schema.Json)])),
});
export const ProductLaunchOutput = Schema.Struct({
  pricing: ProductVariantPricingOutput,
  tags: ProductTagWorkflowResult,
  product: ProductWithLaunchedTag,
});

/** The selected Pricing child and exact native Tag child each retain a real
 * SDK child frame. No hook callback or compensating external effect is installed. */
const productLaunchWorkflow = createWorkflow("launch-priced-product", (input: WorkflowData<typeof ProductLaunchInput.Type>) => {
  const pricing = productVariantPricingWorkflow.runAsStep({ input: transform(input, value => ({
    product_id: value.product_id,
    variants: [{ ...(value.variant_id === undefined ? {} : { id: value.variant_id }),
      title: value.variant_title, options: { Size: "0" },
      priceSet: { ...(value.price_set_id === undefined ? {} : { id: value.price_set_id }),
        prices: [{ currency_code: "USD", amount: value.usd_amount }] } }],
  })) }).config({ name: "price-launch-variant" });
  const tags = updateProductTagsWorkflow.runAsStep({ input: transform(input, value => ({
    selector: { id: [value.tag_id] }, update: { value: "launched" },
  })), hooks: {} }).config({ name: "launch-product-tag" });
  const observed = useQueryGraphStep({ entity: "product", fields: ["id", "title", "tags.id", "tags.value"],
    filters: { id: transform(input, value => value.product_id) }, pagination: { take: 1 },
  }).config({ name: "pending-launched-product" });
  const product = transform({ input, tags, observed: observed.data }, ({ input, tags, observed }) => {
    const row = observed.find(candidate => candidate.id === input.product_id);
    if (row === undefined || !Array.isArray(row.tags) ||
      tags.length !== 1 || tags[0]?.id !== input.tag_id || tags[0]?.value !== "launched" ||
      !row.tags.some(tag => tag.id === input.tag_id && tag.value === "launched"))
      throw commerceError("receiptMismatch");
    return { id: row.id, title: row.title, tags: row.tags };
  });
  return new WorkflowResponse({ pricing, tags, product });
});

export type ProductLaunchModules = {
  readonly product: InstalledWorkflowModule<ProductWorkflowModule>;
  readonly pricing: InstalledWorkflowModule<Effect.Success<ReturnType<typeof makeLocalPricingCommands>>["workflow"]>;
  readonly link: InstalledWorkflowModule<Effect.Success<ReturnType<typeof prepareVariantPricingLink>>["workflow"]>;
};

/** Trusted profile preparation is reusable by the borrowed root and the
 * independently settling workflow host without a second business definition. */
export const prepareProductLaunchWorkflow = Effect.fn("MedusaWorkflow.prepareProductLaunch")(function* (
  input: { readonly modules: ProductLaunchModules },
) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registered = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registered).length !== 3) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registered, ["product", "pricing", "link"]));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module,
      methods: ["createProductVariants", "listProductTags", "updateProductTags"], graph: true },
    pricing: { module: modules.pricing.module, methods: ["createPriceSets"], graph: true },
    link: { module: modules.link.module, methods: ["create"], graph: true },
  }, true));
  const prepared = yield* Effect.fromResult(productLaunchWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const workflow = {
    name: "productLaunch", resources, prepared, input: ProductLaunchInput, output: ProductLaunchOutput,
    events: composedProductTagEvents({ update: modules.product.module.methods.updateProductTags }),
  };
  return Object.freeze({ modules, workflow });
});

type BorrowedProductLaunchInput = Pick<BorrowedWorkflowAttemptInput,
  "attempt" | "admissions" | "bundle" | "pendingRows">;
type LogicalWorkflowMember = Extract<AtomicCommerceParticipantInput, { readonly logicalStorage: unknown }>;
const isLogicalWorkflowMember = (member: AtomicCommerceParticipantInput): member is LogicalWorkflowMember =>
  member.logicalStorage !== undefined;
type BorrowedProductLaunchCompletion = Readonly<{ result: Json }> &
  Effect.Success<Effect.Success<ReturnType<typeof makeBorrowedWorkflowAttempt>>["close"]>;
export interface PrivateProductLaunchAttempt {
  readonly profileRevision: string;
  readonly sources: readonly Readonly<{ participant: AtomicCommerceParticipant;
    prepared: PreparedAtomicCommerceLogicalParticipant["prepared"]; methods: readonly string[];
    eventSelection: ParticipantEventSelection | undefined }>[];
  readonly identityAndAccessPolicy: Json;
  readonly eventPolicy: Effect.Success<ReturnType<typeof prepareAtomicCommerceEvents>>;
  readonly operationEventSelection: ParticipantEventSelection;
  readonly borrow: (input: BorrowedProductLaunchInput) => Effect.Effect<Readonly<{
    abort: Effect.Effect<void>;
    currentUsage: () => Readonly<{ workBytes: number; workCalls: number }>;
    invoke: (value: Json) => Effect.Effect<BorrowedProductLaunchCompletion, CommerceTransactionError>;
  }>, CommerceTransactionError>;
}

/** The trusted mixed host admits these exact three independent sources. The
 * adapter owns native method, graph and event meaning; the journal owns the
 * aggregate operation marker, receipt and single settlement. */
export const preparePrivateProductLaunchAttempt = Effect.fn("MedusaWorkflow.preparePrivateProductLaunch")(function* (input: {
  readonly modules: ProductLaunchModules;
  readonly identityAndAccessPolicy: Json;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
  /** The trusted outer owner retains catalog, scope and construction lifetime. */
  readonly prepareSources: (members: readonly LogicalWorkflowMember[]) =>
    Effect.Effect<readonly PreparedAtomicCommerceLogicalParticipant[], CommerceTransactionError>;
}): Effect.fn.Return<PrivateProductLaunchAttempt, CommerceTransactionError> {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const { modules, workflow } = yield* prepareProductLaunchWorkflow({ modules: options.modules });
  const compiled = yield* prepareWorkflowComposition({ modules, workflow,
    revision: options.revision, subscribers: options.subscribers,
    identityAndAccessPolicy: options.identityAndAccessPolicy,
    requestCallLimit: productLaunchResources.calls,
  });
  const events = compiled.composition.events;
  if (events === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const eventPolicy = yield* prepareAtomicCommerceEvents(yield* Effect.fromResult(captureAtomicCommerceEvents(events)));
  const profile = yield* capturePrivateCanonicalValue({ format: "flarex.medusa-workflow-profile",
    identity: compiled.composition.identityAndAccessPolicy, events: eventPolicy.identity,
    execution: { resources: productLaunchResources, commandMs: productLaunchCommandMs } },
  commerceLimits.commandBytes, { invalidInput: () => commerceError("limitExceeded"),
    hashFailure: cause => commerceError("resourceFailure", cause) });
  const profileRevision = profile.sha256Hex;
  const workflowEvent = events.contracts[0];
  if (workflowEvent === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const operationEventSelection: ParticipantEventSelection = Object.freeze({
    contracts: Object.freeze([workflowEvent]),
    select: (message: Json) => isJsonObject(message) && message.name === "product-tag.updated"
      ? Effect.succeed(workflowEvent) : Effect.fail(commerceError("unadmittedEvent")),
  });
  const sources = [];
  const compiledMembers = compiled.composition.participants;
  if (!compiledMembers.every(isLogicalWorkflowMember)) return yield* Effect.fail(commerceError("invalidAuthority"));
  const members = Object.freeze([...(yield* options.prepareSources(compiledMembers))]);
  if (members.length !== compiledMembers.length) return yield* Effect.fail(commerceError("invalidAuthority"));
  for (const [index, member] of members.entries()) {
    const original = compiledMembers[index];
    if (original === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
    yield* Effect.fromResult(requirePreparedAtomicCommerceLogicalParticipant(member, original));
    if (original === undefined || member.participant !== original.participant || member.commands.size !== original.commands.length ||
      original.commands.some(command => !member.commands.has(command)) ||
      member.validateLogicalCall !== original.validateLogicalCall || member.allowSetNull !== original.allowSetNull ||
      member.allowReferenceReplacement !== original.allowReferenceReplacement || member.events?.select !== original.events?.select)
      return yield* Effect.fail(commerceError("invalidAuthority"));
  }
  for (const member of members) {
    const methods = [...member.commands].map(command => commerceCommandIdentity(command)?.name);
    if (methods.some(method => method === undefined)) return yield* Effect.fail(commerceError("invalidAuthority"));
    sources.push(Object.freeze({ participant: member.participant, prepared: member.prepared,
      methods: methods.filter((method): method is string => method !== undefined), eventSelection: member.events }));
  }
  if (sources.length !== 3) return yield* Effect.fail(commerceError("invalidAuthority"));
  return Object.freeze({ profileRevision, sources: Object.freeze(sources), eventPolicy,
    operationEventSelection,
    identityAndAccessPolicy: compiled.composition.identityAndAccessPolicy,
    borrow: Effect.fn("MedusaWorkflow.borrowPrivateProductLaunch")(function* (
      borrowedInput: BorrowedProductLaunchInput,
    ) {
      const borrowed = yield* makeBorrowedWorkflowAttempt({ ...borrowedInput,
        participant: "medusa.workflow", method: "run", profileRevision,
        members, events,
        resources: productLaunchResources, requestCommandMs: productLaunchCommandMs,
      });
      return Object.freeze({ abort: borrowed.abort, currentUsage: borrowed.currentUsage,
        invoke: (value: Json) => borrowed.withinDeadline(compiled.run(borrowed.context, value))
          .pipe(Effect.flatMap(result => borrowed.close.pipe(Effect.map(closed => Object.freeze({ result, ...closed })))),
            Effect.onError(() => borrowed.abort)),
      });
    }),
  });
});
