import type { DAL, ModulePersistenceAdapter, ModulePersistenceModel } from "@medusajs/framework/types";
import { lowerCaseFirst } from "@medusajs/utils/common/lower-case-first";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils/portable";
import { MedusaInternalService } from "@medusajs/utils/modules-sdk/medusa-internal-service";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "./commerce-promise-owner";

export type CommerceModuleEvents = Pick<ModulePersistenceAdapter,
  "createEventSubscriber" | "registerEventSubscriber" | "dispatchMutationEvent">;

/** The registration is trusted module composition, never a request-selected
 * model or an authority to install its schema. Repositories already own their
 * checked metadata, admitted operations and request-local manager bridge. */
interface ModuleRegistration {
  readonly name: string;
  readonly models: readonly { readonly model: ModulePersistenceModel; readonly repository: DAL.RepositoryService }[];
  readonly baseRepository: DAL.RepositoryService;
  readonly events?: CommerceModuleEvents;
}

/** Medusa asks for constructors. Each construction binds the same admitted
 * request-owned repository; it cannot acquire a connection or new lifetime.
 * Explicit binding preserves receivers even for a method-based repository. */
function repositoryConstructor(repository: DAL.RepositoryService): new () => DAL.RepositoryService {
  return class implements DAL.RepositoryService {
    getFreshManager = repository.getFreshManager.bind(repository);
    getActiveManager = repository.getActiveManager.bind(repository);
    transaction = repository.transaction.bind(repository);
    serialize = repository.serialize.bind(repository);
    find = repository.find.bind(repository);
    findAndCount = repository.findAndCount.bind(repository);
    create = repository.create.bind(repository);
    update = repository.update.bind(repository);
    delete = repository.delete.bind(repository);
    softDelete = repository.softDelete.bind(repository);
    restore = repository.restore.bind(repository);
    upsert = repository.upsert.bind(repository);
    upsertWithReplace = repository.upsertWithReplace.bind(repository);
  };
}

/** Also used by explicit module-owned aliases with a deliberately restricted
 * repository. Specialized services retain their own constructor and contract. */
export function commerceInternalService<Model extends ModulePersistenceModel>(
  model: Model, repository: DAL.RepositoryService, persistence: ModulePersistenceAdapter,
) {
  return new (MedusaInternalService(model))<object, Model>({
    [lowerCaseFirst(model.name) + "Repository"]: repository,
    [ContainerRegistrationKeys.MODULE_PERSISTENCE_ADAPTER]: persistence,
  });
}

/** Synchronous Medusa preparation/constructor boundary. Its refusals latch on
 * the existing Promise owner even if framework code catches the exception.
 * DML remains DML: schema lowering and installation are separate owners. */
export function prepareCommerceModule(owner: CommercePromiseOwner, registration: ModuleRegistration) {
  const refuse = () => owner.reject(commerceError("unsupportedProfile"));
  const models = new Map<ModulePersistenceModel, { readonly name: string; readonly constructor: ReturnType<typeof repositoryConstructor> }>();
  const keys = new Set<string>();
  for (const { model, repository } of registration.models) {
    const name = model.name;
    const key = lowerCaseFirst(name) + "Repository";
    if (name.length === 0 || keys.has(key) || models.has(model)) return refuse();
    keys.add(key);
    models.set(model, { name, constructor: repositoryConstructor(repository) });
  }
  const select = (model: ModulePersistenceModel) => {
    const selected = models.get(model);
    if (selected === undefined || selected.name !== model.name) return refuse();
    return selected;
  };
  const base = repositoryConstructor(registration.baseRepository);
  const persistence = {
    name: registration.name,
    ...registration.events,
    prepareModels: input => {
      if (input.length !== models.size || new Set(input).size !== models.size) return refuse();
      for (const model of input) select(model);
      return [...input];
    },
    createBaseRepository: () => base,
    createRepository: model => select(model).constructor,
    createConnectionLoader: refuse,
    createCustomRepository: refuse,
  } satisfies ModulePersistenceAdapter;
  persistence.prepareModels([...models.keys()]);
  return {
    persistence,
    baseRepository: new (persistence.createBaseRepository())(),
    internalService: <Model extends ModulePersistenceModel>(model: Model) =>
      commerceInternalService(model, new (persistence.createRepository(model))(), persistence),
  };
}
