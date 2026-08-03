declare module "flarex:platform" {
  import type {
    PointQueryInternalCallRuntimeContextV1,
  } from "@flarex/function-runtime/point-query-internal-call";

  export function withPointQueryInternalCallContextV1<A>(
    context: PointQueryInternalCallRuntimeContextV1,
    operation: () => A | PromiseLike<A>,
  ): Promise<Awaited<A>>;
}
