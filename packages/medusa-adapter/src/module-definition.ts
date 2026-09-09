import { Data, Effect, Result } from "effect";
import type { DAL, ModulePersistenceAdapter, ModulePersistenceModel } from "@medusajs/framework/types";
import { lowerCaseFirst } from "@medusajs/utils/common/lower-case-first";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceInternalService, prepareCommerceModule, type CommerceModuleEvents } from "./commerce-module";
import type { CommercePromiseOwner } from "./commerce-promise-owner";
import { withCommerceService } from "./commerce-service-bridge";

/** Integration configuration failures, before a command owns any repositories. */
export class CommerceModuleDefinitionError extends Data.TaggedError("CommerceModuleDefinitionError")<{
  readonly module: string;
  readonly reason: "invalidName" | "duplicateModel" | "serviceConflict" | "unknownReplacement" | "missingCapability";
  readonly detail: string;
}> {
  override get message(): string { return `${this.module}: ${this.detail}`; }
}

export interface CommerceModuleDescription {
  readonly name: string;
  readonly profile: string;
  readonly capabilities: readonly string[];
  readonly models: readonly { readonly name: string; readonly repository: string; readonly service: string }[];
  readonly extensions: readonly { readonly name: string; readonly mode: "add" | "replace"; readonly requires: readonly string[] }[];
}

export interface PreparedCommerceModule<Service> {
  readonly description: CommerceModuleDescription;
  readonly use: (ctx: CommerceCommandContext, work: (service: Service) => Promise<unknown>) => ReturnType<typeof withCommerceService>;
}

export type CommerceModuleScope<Module> = Module extends PreparedCommerceModule<infer Service> ? Service : never;

export interface CommerceModuleRepositories<Model extends ModulePersistenceModel> {
  readonly baseRepository: DAL.RepositoryService;
  readonly repository: (model: Model) => DAL.RepositoryService;
  readonly events?: CommerceModuleEvents;
}

export interface CommerceModuleExtension<Binding> {
  readonly mode: "add" | "replace";
  readonly requires?: readonly string[];
  readonly create: (input: {
    readonly binding: Binding;
    readonly persistence: ModulePersistenceAdapter;
    readonly owner: CommercePromiseOwner;
  }) => object;
}

type PossibleServices<Models extends readonly ModulePersistenceModel[]> = {
  readonly [Model in Models[number] as `${Uncapitalize<Model["name"]>}Service`]: ReturnType<typeof commerceInternalService<Model>>;
};
type ServiceName<Name extends string> = Name extends string
  ? { readonly [Key in `${Uncapitalize<Name>}Service`]: never }
  : never;
// keyof a union contains only shared keys. A union-selected tuple member does
// not guarantee either model, and an ordinary array guarantees no member at all.
type GuaranteedServiceKeys<Models extends readonly ModulePersistenceModel[]> =
  [Models] extends [readonly [infer First extends ModulePersistenceModel, ...infer Rest extends readonly ModulePersistenceModel[]]]
    ? (string extends First["name"] ? never : keyof ServiceName<First["name"]>) | GuaranteedServiceKeys<Rest>
    : never;
type GeneratedServices<Models extends readonly ModulePersistenceModel[]> =
  Pick<PossibleServices<Models>, Extract<GuaranteedServiceKeys<Models>, keyof PossibleServices<Models>>> &
  Partial<Omit<PossibleServices<Models>, GuaranteedServiceKeys<Models>>>;
type ModuleServices<Models extends readonly ModulePersistenceModel[], Extensions extends Record<string, CommerceModuleExtension<never>>> =
  Extensions extends Record<string, CommerceModuleExtension<never>>
    ? Omit<GeneratedServices<Models>, keyof Extensions> & { readonly [Key in keyof Extensions]: ReturnType<Extensions[Key]["create"]> }
    : never;
/** A definition has no manager, SQL connection, event subscriber or live service.
 * Explicit instances support several independently prepared module profiles.
 * Default names/selection follow the pinned Medusa container loader, without
 * its container lifetime, connection bootstrap or custom-repository fallback. */
export function defineCommerceModule<
  const Models extends readonly ModulePersistenceModel[],
  Binding extends CommerceModuleRepositories<Models[number]>,
  const Extensions extends Record<string, CommerceModuleExtension<NoInfer<Binding>>>,
  Service,
>(definition: {
  readonly name: string;
  readonly models: Models;
  readonly profile: {
    readonly name: string;
    /** Implemented adapter features, not table or transaction authority. */
    readonly capabilities: readonly string[];
    readonly bind: (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => Binding;
  };
  readonly extensions: Extensions;
  readonly service: (input: {
    readonly binding: Binding;
    readonly baseRepository: DAL.RepositoryService;
    readonly services: ModuleServices<Models, Extensions>;
    readonly context: { readonly manager: CommerceCommandContext["manager"]; readonly transactionManager: CommerceCommandContext["manager"] };
  }) => Service;
}): Result.Result<PreparedCommerceModule<Service>, CommerceModuleDefinitionError> {
  return Result.gen(function* () {
    const name = definition.name;
    const fail = (reason: CommerceModuleDefinitionError["reason"], detail: string) =>
      Result.fail(new CommerceModuleDefinitionError({ module: name, reason, detail }));
    if (!name.trim() || !definition.profile.name.trim()) return yield* fail("invalidName", "Module and profile names must be nonblank");
    const seenModels = new Set<ModulePersistenceModel>();
    const generated = new Set<string>();
    const models = definition.models.map(model => ({ model, name: model.name, service: lowerCaseFirst(model.name) + "Service" }));
    for (const entry of models) {
      if (!entry.name.trim()) return yield* fail("invalidName", "Model names must be nonblank");
      if (seenModels.has(entry.model) || generated.has(entry.service)) return yield* fail("duplicateModel", entry.name);
      seenModels.add(entry.model);
      generated.add(entry.service);
    }
    const capabilities = new Set(definition.profile.capabilities);
    const extensionPrototype = Object.getPrototypeOf(definition.extensions);
    if (extensionPrototype !== Object.prototype && extensionPrototype !== null) {
      return yield* fail("invalidName", "Service extensions must be an own-property record");
    }
    for (const key of Reflect.ownKeys(definition.extensions)) {
      const descriptor = Object.getOwnPropertyDescriptor(definition.extensions, key);
      if (typeof key !== "string" || descriptor?.enumerable !== true || !("value" in descriptor)) {
        return yield* fail("invalidName", "Service extensions must use own enumerable string data properties");
      }
    }
    const extensions = Object.entries(definition.extensions).map(([key, extension]) => ({
      key, mode: extension.mode, requires: [...(extension.requires ?? [])], create: extension.create.bind(extension),
    }));
    for (const extension of extensions) {
      if (!extension.key.trim()) return yield* fail("invalidName", "Extension names must be nonblank");
      if (extension.mode === "add" && generated.has(extension.key)) return yield* fail("serviceConflict", extension.key);
      if (extension.mode === "replace" && !generated.has(extension.key)) return yield* fail("unknownReplacement", extension.key);
      for (const requirement of extension.requires) {
        if (!capabilities.has(requirement)) return yield* fail("missingCapability", `${extension.key} requires ${requirement}`);
      }
    }
    const replacements = new Set(extensions.filter(extension => extension.mode === "replace").map(extension => extension.key));
    const bind = definition.profile.bind.bind(definition.profile);
    const createService = definition.service.bind(definition);
    const description = Object.freeze({
      name, profile: definition.profile.name,
      capabilities: Object.freeze([...capabilities]),
      models: Object.freeze(models.map(entry => Object.freeze({ name: entry.name, repository: lowerCaseFirst(entry.name) + "Repository", service: entry.service }))),
      extensions: Object.freeze(extensions.map(extension => Object.freeze({ name: extension.key, mode: extension.mode, requires: Object.freeze([...extension.requires]) }))),
    });
    const use = Effect.fn("CommerceModule.use")((ctx: CommerceCommandContext, work: (service: Service) => Promise<unknown>) =>
      withCommerceService(ctx, owner => {
        // DML identities stay with their compiler. Detect renaming before binding
        // and repository construction, rather than silently accepting new names.
        if (models.some(entry => entry.model.name !== entry.name)) return owner.reject(commerceError("unsupportedProfile"));
        const binding = bind(ctx, owner);
        const module = prepareCommerceModule(owner, { name, baseRepository: binding.baseRepository,
          ...(binding.events === undefined ? {} : { events: binding.events }),
          models: models.map(entry => ({ model: entry.model, repository: binding.repository(entry.model) })),
        });
        const entries: [string, object][] = models.filter(entry => !replacements.has(entry.service))
          .map(entry => [entry.service, module.internalService(entry.model)]);
        for (const extension of extensions) entries.push([extension.key, extension.create({ binding, persistence: module.persistence, owner })]);
        // SAFETY: the closed model set creates exactly its conventional keys;
        // checked explicit replacements/additions are each installed once.
        // Object.fromEntries defines own data properties, including __proto__.
        const services = Object.freeze(Object.fromEntries(entries)) as ModuleServices<Models, Extensions>;
        return createService({ binding, baseRepository: module.baseRepository, services,
          context: { manager: ctx.manager, transactionManager: ctx.manager },
        });
      }, work));
    return Object.freeze({ description, use });
  });
}
