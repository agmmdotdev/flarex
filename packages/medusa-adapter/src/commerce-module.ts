import type { DAL, ModulePersistenceAdapter, ModulePersistenceModel } from "@medusajs/framework/types";
import { Result } from "effect";
import { lowerCaseFirst } from "@medusajs/utils/common/lower-case-first";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils/portable";
import { MedusaInternalService } from "@medusajs/utils/modules-sdk/medusa-internal-service";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "./commerce-promise-owner";

export type CommerceModuleEvents = Pick<ModulePersistenceAdapter,
  "createEventSubscriber" | "registerEventSubscriber" | "dispatchMutationEvent">;

/** The registration is trusted module composition, never a request-selected
 * model or an authority to install its schema. Repositories already own their
 * checked metadata, admitted operations and request-local manager bridge. */
interface ModuleRegistration<Model extends ModulePersistenceModel> {
  readonly name: string;
  readonly models: readonly Model[];
}

interface ModuleBinding<Model extends ModulePersistenceModel> {
  readonly baseRepository: DAL.RepositoryService;
  readonly repository: (model: Model) => DAL.RepositoryService;
  readonly events?: CommerceModuleEvents;
}

interface BoundCommerceModulePersistence extends ModulePersistenceAdapter {
  createBaseRepository(): new () => DAL.RepositoryService;
  createRepository(model: ModulePersistenceModel): new () => DAL.RepositoryService;
}

interface CommerceModulePreparation<Model extends ModulePersistenceModel> {
  readonly bind: (owner: CommercePromiseOwner, binding: ModuleBinding<Model>) => {
    readonly persistence: BoundCommerceModulePersistence;
    readonly baseRepository: DAL.RepositoryService;
  };
}

/** Medusa requires constructors, but these repositories are already constructed
 * by the request owner. A bound constructor returns that exact repository so
 * native method calls retain its receiver without another mutable wrapper. The
 * class has no request state; only each request's bound constructor retains it. */
class AdmittedRepository implements DAL.RepositoryService {
  declare getFreshManager: DAL.RepositoryService["getFreshManager"];
  declare getActiveManager: DAL.RepositoryService["getActiveManager"];
  declare transaction: DAL.RepositoryService["transaction"];
  declare serialize: DAL.RepositoryService["serialize"];
  declare find: DAL.RepositoryService["find"];
  declare findAndCount: DAL.RepositoryService["findAndCount"];
  declare create: DAL.RepositoryService["create"];
  declare update: DAL.RepositoryService["update"];
  declare delete: DAL.RepositoryService["delete"];
  declare softDelete: DAL.RepositoryService["softDelete"];
  declare restore: DAL.RepositoryService["restore"];
  declare upsert: DAL.RepositoryService["upsert"];
  declare upsertWithReplace: DAL.RepositoryService["upsertWithReplace"];

  constructor(repository: DAL.RepositoryService) { return repository; }
}

/** Prepare the immutable native class with its module definition. Each binder
 * call creates a fresh service for the supplied request-owned repository and
 * persistence adapter, including explicit restricted aliases. */
export function prepareCommerceInternalService<Model extends ModulePersistenceModel>(model: Model) {
  const Service = MedusaInternalService(model);
  const repositoryKey = lowerCaseFirst(model.name) + "Repository";
  return (repository: DAL.RepositoryService, persistence: ModulePersistenceAdapter) => new Service<object, Model>({
    [repositoryKey]: repository,
    [ContainerRegistrationKeys.MODULE_PERSISTENCE_ADAPTER]: persistence,
  });
}

export type CommerceInternalService<Model extends ModulePersistenceModel> =
  ReturnType<ReturnType<typeof prepareCommerceInternalService<Model>>>;

/** Capture native model layout once with the module definition. No repository,
 * manager, event subscriber, Promise owner or live service is retained here.
 * DML remains DML: schema lowering and installation are separate owners. */
export function prepareCommerceModule<Model extends ModulePersistenceModel>(
  registration: ModuleRegistration<Model>,
): Result.Result<CommerceModulePreparation<Model>, CommerceTransactionError> {
  const models = new Map<ModulePersistenceModel, { readonly name: string; readonly index: number }>();
  const keys = new Set<string>();
  for (const model of registration.models) {
    const name = model.name;
    const key = lowerCaseFirst(name) + "Repository";
    if (name.length === 0 || keys.has(key) || models.has(model)) return Result.fail(commerceError("unsupportedProfile"));
    keys.add(key);
    models.set(model, { name, index: models.size });
  }
  const name = registration.name;
  const admitted = [...registration.models];
  return Result.succeed(Object.freeze({
    bind: (owner: CommercePromiseOwner, binding: ModuleBinding<Model>) => {
      const refuse = () => owner.reject(commerceError("unsupportedProfile"));
      const select = (model: ModulePersistenceModel) => {
        const selected = models.get(model);
        if (selected === undefined || selected.name !== model.name) return refuse();
        return selected;
      };
      // Refuse changed identities before constructing even the first repository.
      for (const model of admitted) select(model);
      const repositories = admitted.map(model => AdmittedRepository.bind(undefined, binding.repository(model)));
      const base = AdmittedRepository.bind(undefined, binding.baseRepository);
      const persistence = {
        name,
        ...binding.events,
        prepareModels: input => {
          if (input.length !== models.size || new Set(input).size !== models.size) return refuse();
          for (const model of input) select(model);
          return [...input];
        },
        createBaseRepository: () => base,
        createRepository: model => {
          const repository = repositories[select(model).index];
          return repository ?? refuse();
        },
        createConnectionLoader: refuse,
        createCustomRepository: refuse,
      } satisfies ModulePersistenceAdapter;
      return { persistence, baseRepository: binding.baseRepository };
    },
  }));
}
