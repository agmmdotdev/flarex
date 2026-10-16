import { createHash } from "node:crypto";
import { Effect } from "effect";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import type { AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareSalesChannelCreationWorkflow } from "../../src/workflows/sales-channel/create";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { prepareLogicalSalesChannelHost } from "./logical-sales-channel-fixture";

/** One genuine Sales Channel source and its existing host owners. The fixture
 * supplies no Product, Link, Task or Notification participant. */
export async function prepareLogicalSalesChannelCreation(
  driver: "pglite" | "postgres", registerCleanup: (close: () => Promise<void>) => void,
  shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>,
) {
  const fixture = shared === undefined
    ? await logicalCurrencyFixture(driver, registerCleanup, { includeSalesChannel: true })
    : await logicalCurrencyFixture(driver, registerCleanup, { includeSalesChannel: true, ...shared });
  const sales = await prepareLogicalSalesChannelHost(fixture);
  try { await Effect.runPromise(sales.host.initialize([])); }
  finally { await Effect.runPromise(sales.host.close); }
  const reads = await Effect.runPromise(makeCommerceHost(sales.hostInput));
  registerCleanup(() => Effect.runPromise(reads.close));
  const execution: AtomicWorkflowExecution = {
    identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }),
  };
  const options: Parameters<typeof prepareSalesChannelCreationWorkflow>[0] = {
    execution,
    modules: { sales_channel: { module: sales.runtime.workflow, logicalStorage: sales.hostInput.logicalStorage } },
    revision: createHash("sha256").update("native-sales-channel-creation-110").digest("hex"),
    subscribers: [{ id: "native-sales-channel-creation", revision: "b".repeat(64) }],
  };
  const prepare = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareSalesChannelCreationWorkflow({ ...options, revision }));
    registerCleanup(() => Effect.runPromise(host.close));
    return host;
  };
  const list = (ids: readonly string[]) => reads.read(sales.runtime.list,
    { filters: { id: [...ids] }, config: { take: 4, order: { id: "ASC" } } });
  return { fixture, sales, execution, prepare, list };
}
