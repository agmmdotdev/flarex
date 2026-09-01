import {
  buildStaticHttpResources,
  type StaticHttpResourceBuildOptions,
  type StaticHttpResourceManifest,
} from "../utils/static-http-resources"
import type { HttpResourceResolver, HttpResourceSet } from "./types"

export class StaticHttpManifestResolver implements HttpResourceResolver {
  readonly #manifest: StaticHttpResourceManifest
  readonly #options: StaticHttpResourceBuildOptions

  constructor(
    manifest: StaticHttpResourceManifest,
    options: StaticHttpResourceBuildOptions = {}
  ) {
    this.#manifest = manifest
    this.#options = options
  }

  async resolve(): Promise<HttpResourceSet> {
    return buildStaticHttpResources(this.#manifest, this.#options)
  }
}
