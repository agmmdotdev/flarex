// Awilix 8.0.1 declaration reuse; see awilix-portable.mjs for MIT notice/provenance.
export {
  AwilixError, AwilixResolutionError, AwilixTypeError, ExtendableError,
  InjectionMode, Lifetime, RESOLVER, aliasTo, asClass, asFunction, asValue,
  createBuildResolver, createContainer, createDisposableResolver,
} from "awilix";
export type {
  AwilixContainer, ResolveOptions, CacheEntry, NameAndRegistrationPair,
  FunctionReturning, ClassOrFunctionReturning, ContainerOptions,
  RegistrationHash, ResolutionStack, InjectorFunction, Resolver,
  BuildResolver, DisposableResolverOptions, DisposableResolver, Disposer,
  ResolverOptions, BuildResolverOptions, Constructor, InjectionModeType,
  LifetimeType, ListModulesOptions, ModuleDescriptor, GlobWithOptions,
} from "awilix";
