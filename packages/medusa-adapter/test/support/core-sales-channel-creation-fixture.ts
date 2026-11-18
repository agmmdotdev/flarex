import { createHash } from "node:crypto";
import { Effect } from "effect";
import { prepareSalesChannelCreationWorkflow } from "../../src/workflows/sales-channel/create";
import { prepareCoreSalesChannel, type CoreSalesChannelOptions } from "./core-sales-channel-fixture";

export async function prepareCoreSalesChannelCreation(driver: "pglite" | "postgres",
  close: (cleanup: () => Promise<void>) => void, shared: CoreSalesChannelOptions = {}) {
  const connected = await prepareCoreSalesChannel(driver, close, shared);
  const { fixture, sales, execution } = connected;
  const options: Parameters<typeof prepareSalesChannelCreationWorkflow>[0] = {
    execution, modules: { sales_channel: { module: sales.runtime.workflow, nativeStorage: sales.source } },
    revision: createHash("sha256").update("native-sales-channel-creation-110").digest("hex"),
    subscribers: [{ id: "native-sales-channel-creation", revision: "b".repeat(64) }],
  };
  const prepare = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareSalesChannelCreationWorkflow({ ...options, revision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const list = (ids: readonly string[]) => sales.reads.read(sales.runtime.list,
    { filters: { id: [...ids] }, config: { take: 4, order: { id: "ASC" } } });
  return { ...connected, fixture, sales, execution, prepare, list };
}
