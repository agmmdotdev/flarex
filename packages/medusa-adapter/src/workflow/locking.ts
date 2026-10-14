import { Result, Schema } from "effect";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { ScalarId } from "../repository/scalar-id-read";
import { commerceDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";
import { captureWorkflowArray } from "./configuration";
import { defineComposedWorkflowResource, type ComposedResourceMethod } from "./composed-resource";
import type { WorkflowMethod } from "./module";

const decodeKeys = commerceDecoder(Schema.Array(ScalarId).check(Schema.isMaxLength(4)), "unsupportedProfile");
/** Native execute borrows authenticated outer scope exclusion. Item keys retain
 * native identity, while this finite profile deliberately serializes the scope. */
export function prepareWorkflowLocking(dependencies: readonly WorkflowMethod[]) {
  const execute: ComposedResourceMethod<readonly [readonly string[], () => Promise<unknown>], Json> = {
      arguments: value => Result.gen(function* () {
        if (!Array.isArray(value)) return yield* Result.fail(commerceError("unsupportedProfile"));
        const args = yield* captureWorkflowArray(value);
        if (args.length !== 2 || typeof args[1] !== "function") return yield* Result.fail(commerceError("unsupportedProfile"));
        const keys = yield* captureCommerceInput(args[0]).pipe(Result.flatMap(decodeKeys));
        // SAFETY: the native trusted step constructs this zero-argument callback;
        // the composed binder authenticates exclusion and bounds its Promise.
        return [keys, args[1] as () => Promise<unknown>] as const;
      }),
      output: commerceDecoder(Schema.Json, "storedCorruption"),
    };
  return defineComposedWorkflowResource({ identity: { profile: "inventory-scope-exclusion" }, scopeExclusive: true,
    dependencies, methods: { execute }, bind: () => ({ execute: (_keys, work) => work() }) });
}
