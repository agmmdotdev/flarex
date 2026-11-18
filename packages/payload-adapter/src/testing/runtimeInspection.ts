import type { CmsHost, CmsReadHost } from "@flarex/persistence-postgres/internal/cms-adapter";
import type { PayloadHost, PayloadReadHost } from "../api";
import type { PayloadNative } from "../runtime/native";
import { readPayloadRuntime, readPayloadHost, type PayloadBoundRuntime } from "../runtime/registry";
import { Scope, type Effect } from "effect";

/** Privileged test roots only: exact tokens for nested and fault witnesses. */
export function inspectPayloadRuntimeForTest(runtime: PayloadBoundRuntime) {
  const native = readPayloadRuntime(runtime);
  if (native === undefined) throw new TypeError("Expected an issued Payload runtime");
  return { commands: native.commands };
}
/** Existing phased Promise fixtures explicitly borrow their native owner's
 * Scope for trusted construction; there is no additional runtime bridge. */
export function withPayloadRuntimeScopeForTest<A, E>(runtime: PayloadBoundRuntime, work: Effect.Effect<A, E, Scope.Scope>): Effect.Effect<A, E> {
  const native = readPayloadRuntime(runtime);
  if (native === undefined) throw new TypeError("Expected an issued Payload runtime");
  return Scope.provide(native.scope)(work);
}
export function inspectPayloadHostForTest(host: PayloadHost): { readonly host: CmsHost; readonly commands: PayloadNative["commands"] };
export function inspectPayloadHostForTest(host: PayloadReadHost): { readonly host: CmsReadHost; readonly commands: PayloadNative["commands"] };
export function inspectPayloadHostForTest(host: PayloadReadHost) {
  const state = readPayloadHost(host);
  if (state === undefined) throw new TypeError("Expected an issued Payload host");
  return { host: state.host, commands: state.native.commands };
}
