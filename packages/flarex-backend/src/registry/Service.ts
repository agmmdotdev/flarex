import { Context, Effect, Layer } from "effect";
import type {
  CreateDeploymentRequest,
  DeploymentRecord,
  ListDeploymentsResponse,
} from "flarex-protocol/registry";
import { RegistryClock, RegistryIds } from "./Runtime";
import { RegistrySqlError, RegistryStore } from "./Store";

export class RegistryService extends Context.Service<RegistryService, {
  createDeployment(request: CreateDeploymentRequest): Effect.Effect<DeploymentRecord, RegistrySqlError>;
  readonly listDeployments: Effect.Effect<ListDeploymentsResponse, RegistrySqlError>;
}>()("flarex-backend/registry/RegistryService") {
  static readonly layer = Layer.effect(
    RegistryService,
    Effect.gen(function* () {
      const clock = yield* RegistryClock;
      const ids = yield* RegistryIds;
      const store = yield* RegistryStore;

      const createDeployment = Effect.fn("RegistryService.createDeployment")(
        function* (request: CreateDeploymentRequest): Effect.fn.Return<DeploymentRecord, RegistrySqlError> {
          const now = yield* clock.currentTimeMillis;
          const deploymentId = request.deploymentId ?? (yield* ids.deploymentId);
          return yield* store.createDeployment({
            deploymentId,
            ...(request.slug === undefined ? {} : { slug: request.slug }),
            now,
          });
        },
      );

      const listDeployments = Effect.gen(function* () {
        const deployments = yield* store.listDeployments;
        return { deployments };
      }).pipe(Effect.withSpan("RegistryService.listDeployments"));

      return RegistryService.of({
        createDeployment,
        listDeployments,
      });
    }),
  );
}
