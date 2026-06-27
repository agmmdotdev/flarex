import { Layer } from "effect";
import { RegistryClock, RegistryIds } from "./Runtime";
import { RegistryService } from "./Service";
import { RegistryStore, type RegistrySqlStorage } from "./Store";

export function makeRegistryLayer(sql: RegistrySqlStorage) {
  return RegistryService.layer.pipe(
    Layer.provide(RegistryStore.layer(sql)),
    Layer.provide(RegistryClock.layer),
    Layer.provide(RegistryIds.layer),
  );
}
