declare module "flarex:platform" {
  import type {
    PointMutationInternalQueryRuntimeContextV1,
  } from "@flarex/function-runtime/point-mutation-internal-query";

  export function withPointMutationInternalQueryContextV1<A>(
    context: PointMutationInternalQueryRuntimeContextV1,
    operation: () => A | PromiseLike<A>,
  ): Promise<Awaited<A>>;

  export function inspectPointMutationInternalQueryCoreApplicationErrorV1(
    value: unknown,
  ): boolean;

  export function errorCreate(
    code: unknown,
    message: unknown,
    data?: unknown,
  ): Error;
  export function errorCode(error: unknown): string;
  export function errorMessage(error: unknown): string;
  export function errorData(error: unknown): unknown;
}
