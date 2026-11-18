import type { CmsHost, CmsReadHost } from "@flarex/persistence-postgres/internal/cms-adapter";
import type { PayloadHost, PayloadReadHost } from "../api";
import type { PayloadNative } from "./native";
import type { PayloadRuntime } from "../runtime";

export type PayloadBoundRuntime = Pick<PayloadRuntime, "bind" | "bindRead">;

/** Issuer state stays private; inspection grants no new execution authority. */
const runtimes = new WeakMap<object, PayloadNative>();
const hosts = new WeakMap<object, { readonly host: CmsHost | CmsReadHost; readonly native: PayloadNative }>();
export const registerPayloadRuntime = (runtime: PayloadBoundRuntime, native: PayloadNative): void => { runtimes.set(runtime, native); };
export const registerPayloadHost = (host: PayloadHost | PayloadReadHost, execution: CmsHost | CmsReadHost, native: PayloadNative): void => {
  hosts.set(host, { host: execution, native });
};
export const readPayloadRuntime = (runtime: PayloadBoundRuntime): PayloadNative | undefined => runtimes.get(runtime);
export const readPayloadHost = (host: PayloadHost | PayloadReadHost) => hosts.get(host);
