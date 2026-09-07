import { afterAll, beforeAll, beforeEach, afterEach, describe } from "vitest";
import { Cause, Effect, Exit, Option } from "effect";
import type { IProductModuleService, IEventBusModuleService } from "@medusajs/framework/types";
import { makeLocalProductCommands } from "../../src/product-service";
import { prepareLocalProductProfile } from "../../src/product-profile";
import { captureProductSchema } from "../../src/product-schema";
import { productRuntimeMetadata } from "../../src/product-runtime-metadata";
import { productLocalEventPolicy } from "../../src/product-local-events";
import { captureCommerceInput } from "../../src/commerce-input";
import { commerceError, type Json, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceHostFixture, type CommerceHostTestFixture } from "../../../persistence-postgres/test/commerceHostFixture";
import { createRelationalPGliteFixture } from "../../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../../persistence-postgres/test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../../persistence-postgres/test/postgresHelpers";
import { makePostgresRelationalSession } from "../../../persistence-postgres/src/relationalTransaction/session";
import type { ProductRunnerOptions } from "./runner-contract";

// One lifecycle for the two imported suites in one serial Vitest entry file.
// Per-case row cleanup leaves installed schema/readiness and authenticated history intact.
let registered = false;
let current = Option.none<{ fixture: CommerceHostTestFixture; runtime: Effect.Success<ReturnType<typeof makeLocalProductCommands>> }>();
let destination = Option.none<IEventBusModuleService>();
const cleanup: Array<() => Promise<void>> = [];
const get = () => Option.getOrThrow(current);

// Narrow the already authenticated local message without changing its bytes or fields.
function isCapturedMessage(event: Json): event is Json & { name: string; data: Json; metadata: { source: string; object: string; action: string } } {
  return isJsonObject(event) && typeof event.name === "string" && event.data !== undefined && event.metadata !== undefined && isJsonObject(event.metadata)
    && typeof event.metadata.source === "string" && typeof event.metadata.object === "string" && typeof event.metadata.action === "string";
}

function registerFixture() {
  if (registered) return;
  registered = true;
  beforeAll(async () => {
    const runtime = await Effect.runPromise(makeLocalProductCommands());
    const metadata = await Effect.runPromise(captureProductSchema("product-upstream-tests").pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
    if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product test driver");
    const registerCleanup = (close: () => Promise<void>) => cleanup.push(close);
    const resource = driver === "pglite" ? await createRelationalPGliteFixture({ registerCleanup }) : await (async () => {
      const fixture = await createFileScopedPostgresFixture();
      registerCleanup(fixture.dispose);
      return { persistence: fixture.persistence, session: makePostgresRelationalSession(fixture.persistence) };
    })();
    const control = driver === "pglite" ? await createMigratedPGlitePersistence(registerCleanup) : resource.persistence;
    const fixture = await commerceHostFixture(resource.persistence, resource.session, prepareLocalProductProfile,
      Object.values(runtime.commands), control, descriptor => productLocalEventPolicy(descriptor, metadata,
        Effect.fn("ProductUpstream.deliver")(function* (events) {
          if (Option.isSome(destination)) {
            const bus = destination.value;
            const messages = events.map(event => {
              if (!isCapturedMessage(event)) throw new Error("Invalid captured Product message");
              return event;
            });
            yield* Effect.tryPromise({ try: () => bus.emit(messages, { internal: true }), catch: cause => commerceError("adapterFailure", cause) });
          }
        })));
    current = Option.some({ fixture, runtime });
  }, 120000);
  afterAll(async () => {
    current = Option.none(); destination = Option.none();
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
    if (failures.length) throw new AggregateError(failures, "Product test fixture cleanup failed");
  });
}

const execute = Effect.fn("ProductUpstream.call")(function* (method: string, args: readonly unknown[]) {
  const { fixture, runtime } = get();
  const createCommands = { createProducts: runtime.commands.create, createProductTags: runtime.commands.createTags,
    createProductTypes: runtime.commands.createTypes, createProductCollections: runtime.commands.createCollections, createProductImages: runtime.commands.createImages };
  const createCommand = Object.entries(createCommands).find(([name]) => name === method)?.[1];
  const contextIndex = createCommand === undefined ? 2 : 1;
  if (args.length > contextIndex + 1 || args[contextIndex] !== undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const input = yield* Effect.fromResult(captureCommerceInput(createCommand !== undefined ? args[0]
    : method === "retrieveProduct" ? { id: args[0], config: args[1] } : { filters: args[0], config: args[1] }));
  if (createCommand !== undefined) return yield* fixture.host.run(fixture.host.newRequestKey(), createCommand, input);
  return yield* fixture.host.read(method === "retrieveProduct" ? runtime.commands.retrieve
    : method === "listProducts" ? runtime.commands.list : runtime.commands.count, input);
});

/** Original test callback contract, backed only by admitted host commands. The
 * proxy admits eight methods and refuses every other property access.
 * Results are the unchanged service's host-captured DTOs, inspected by upstream
 * assertions. This test proxy is not a production DTO adapter or public service. */
const service = new Proxy<object>({}, {
  get(_target, property) {
    if (typeof property !== "string" || !["createProducts", "createProductTags", "createProductTypes", "createProductCollections", "createProductImages", "retrieveProduct", "listProducts", "listAndCountProducts"].includes(property)) {
      throw new Error("Unadmitted Product test service method: " + String(property));
    }
    return (...args: readonly unknown[]): Promise<Json> => Effect.runPromise(execute(property, args).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause, error => error.reason === "adapterFailure" && error.cause !== undefined ? error.cause : error))),
    ));
  },
}) as IProductModuleService; // Test-only compatibility boundary for the original full-service callback.

export function productIntegrationTestRunner(options: ProductRunnerOptions) {
  registerFixture();
  describe(options.injectedDependencies ? "Product injected event bus" : "Product service", () => {
    beforeEach(async () => {
      destination = Option.fromUndefinedOr(options.injectedDependencies?.event_bus);
      const { fixture } = get();
      const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
      const layout = fixture.descriptor.layout.frame;
      // Dynamic fixture DDL uses only compiler-owned physical identities.
      const tables = layout.tables.map(table => quote(layout.targetNamespace.schemaName) + "." + quote(table.name));
      await fixture.persistence.query("truncate table " + tables.join(", ") + " cascade");
      fixture.takeDeliveries();
    });
    afterEach(() => {
      destination = Option.none();
      const deliveries = get().fixture.takeDeliveries();
      if (deliveries.some(delivery => Exit.isFailure(delivery.outcome))) throw new Error("Product local test delivery failed");
    });
    options.testSuite({ service });
  });
}
