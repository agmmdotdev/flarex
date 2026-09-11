import { afterAll, afterEach, beforeAll, beforeEach, describe, expect } from "vitest";
import { Cause, Effect, Exit, Option } from "effect";
import type { ISalesChannelModuleService } from "@medusajs/framework/types";
import type { CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "../../src/commerce-input";
import { makeLocalSalesChannelCommands } from "../../src/sales-channel-service";
import { prepareLocalSalesChannelProfile } from "../../src/sales-channel-schema";
import { commerceHostFixture, type CommerceHostTestFixture } from "../../../persistence-postgres/test/commerceHostFixture";
import { createRelationalPGliteFixture } from "../../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../../persistence-postgres/test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../../persistence-postgres/test/postgresHelpers";
import { makePostgresRelationalSession } from "../../../persistence-postgres/src/relationalTransaction/session";

type Runtime = Effect.Success<ReturnType<typeof makeLocalSalesChannelCommands>>;
type Methods = "createSalesChannels" | "updateSalesChannels" | "deleteSalesChannels" | "retrieveSalesChannel" | "listSalesChannels" | "listAndCountSalesChannels";

/** Exact original callback, admitting only the six tested native methods. Each
 * call is its own existing commerce transaction, never an inferred atomic batch. */
export function moduleIntegrationTestRunner(options: {
  moduleName: "sales_channel";
  testSuite: (context: { service: Pick<ISalesChannelModuleService, Methods> }) => void;
}): void {
  const cleanup: Array<() => Promise<void>> = [];
  let current = Option.none<{ fixture: CommerceHostTestFixture; runtime: Runtime }>();
  const get = () => Option.getOrThrow(current);
  beforeAll(async () => {
    if (options.moduleName !== "sales_channel") throw new Error("Only Sales Channel is admitted");
    const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
    if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Sales Channel test driver");
    const registerCleanup = (close: () => Promise<void>) => cleanup.push(close);
    const runtime = await Effect.runPromise(makeLocalSalesChannelCommands());
    const resource = driver === "pglite" ? await createRelationalPGliteFixture({ registerCleanup }) : await (async () => {
      const database = await createFileScopedPostgresFixture();
      registerCleanup(database.dispose);
      return { persistence: database.persistence, session: makePostgresRelationalSession(database.persistence) };
    })();
    const control = driver === "pglite" ? await createMigratedPGlitePersistence(registerCleanup) : resource.persistence;
    const fixture = await commerceHostFixture(resource.persistence, resource.session, prepareLocalSalesChannelProfile,
      runtime.commands, control, descriptor => runtime.eventPolicy(descriptor, () => Effect.void));
    current = Option.some({ fixture, runtime });
  }, 120000);
  afterAll(async () => {
    current = Option.none();
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
    if (failures.length) throw new AggregateError(failures, "Sales Channel fixture cleanup failed");
  }, 120000);

  const call = (choose: (runtime: Runtime) => CommerceCommand, write: boolean, input: unknown, context: unknown) =>
    Effect.runPromise(Effect.gen(function* () {
      if (context !== undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
      const { fixture, runtime } = get();
      const args = yield* Effect.fromResult(captureCommerceInput(input));
      return yield* (write ? fixture.host.run(fixture.host.newRequestKey(), choose(runtime), args) : fixture.host.read(choose(runtime), args));
    }).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause,
      error => error.reason === "adapterFailure" && error.cause !== undefined ? error.cause : error)))));
  const methods = {
    createSalesChannels: (data: unknown, context?: unknown) => call(runtime => runtime.create, true, data, context),
    updateSalesChannels: (id: unknown, data: unknown, context?: unknown) => call(runtime => runtime.update, true, { id, data }, context),
    deleteSalesChannels: (ids: unknown, context?: unknown) => call(runtime => runtime.delete, true, ids, context).then(() => undefined),
    retrieveSalesChannel: (id: unknown, config?: unknown, context?: unknown) => call(runtime => runtime.retrieve, false, { id, config }, context),
    listSalesChannels: (filters?: unknown, config?: unknown, context?: unknown) => call(runtime => runtime.list, false, { filters, config }, context),
    listAndCountSalesChannels: (filters?: unknown, config?: unknown, context?: unknown) => call(runtime => runtime.count, false, { filters, config }, context),
  };
  // SAFETY: source-test-only boundary for native overloaded DTO signatures.
  // Results are the actual service's host-captured projections, checked by the
  // preserved upstream assertions. No other module method is admitted.
  const service = new Proxy<object>(methods, { get(target, key, receiver) {
    if (!Object.hasOwn(target, key)) throw new Error("Unadmitted Sales Channel method: " + String(key));
    return Reflect.get(target, key, receiver);
  } }) as Pick<ISalesChannelModuleService, Methods>;
  describe("Sales Channel native compatibility", () => {
    beforeEach(async () => {
      // The bounded suite has at most four rows. Reset through the admitted
      // native deletion path, keeping installation and commit authority intact.
      const rows = await service.listSalesChannels({}, { select: ["id"], take: 256 });
      if (rows.length) await service.deleteSalesChannels(rows.map(row => row.id));
      get().fixture.takeDeliveries();
    });
    afterEach(() => {
      for (const delivery of get().fixture.takeDeliveries()) expect(Exit.isSuccess(delivery.outcome)).toBe(true);
    });
    options.testSuite({ service });
  });
}
