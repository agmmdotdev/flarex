declare module "flarex:platform" {
  import type {
    PointQueryRuntimeContextV1,
  } from "@flarex/function-runtime/point-query";

  export function withPointQueryContextV1<A>(
    context: PointQueryRuntimeContextV1,
    operation: () => A | PromiseLike<A>,
  ): Promise<Awaited<A>>;
}
