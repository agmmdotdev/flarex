import type {
  HttpResourceResolver,
  HttpResourceSet,
  StaticHttpResourceSetInput,
} from "./types"

export class StaticHttpResourceResolver implements HttpResourceResolver {
  readonly #resources: StaticHttpResourceSetInput

  constructor(resources: StaticHttpResourceSetInput) {
    this.#resources = resources
  }

  async resolve(): Promise<HttpResourceSet> {
    return {
      routes: [...(this.#resources.routes ?? [])],
      middlewares: [...(this.#resources.middlewares ?? [])],
      errorHandler: this.#resources.errorHandler,
      bodyParserConfigRoutes: [
        ...(this.#resources.bodyParserConfigRoutes ?? []),
      ],
      additionalDataValidatorRoutes: [
        ...(this.#resources.additionalDataValidatorRoutes ?? []),
      ],
    }
  }
}
