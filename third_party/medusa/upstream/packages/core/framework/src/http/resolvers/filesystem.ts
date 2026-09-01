import type { MedusaErrorHandlerFunction } from "../types"
import { MiddlewareFileLoader } from "../middleware-file-loader"
import { RoutesLoader } from "../routes-loader"
import type { HttpResourceResolver, HttpResourceSet } from "./types"

export class FilesystemHttpResourceResolver implements HttpResourceResolver {
  readonly #sourceDirs: string[]

  constructor(sourceDirs: string[]) {
    this.#sourceDirs = sourceDirs
  }

  async resolve(): Promise<HttpResourceSet> {
    const routesLoader = new RoutesLoader()
    const middlewareLoader = new MiddlewareFileLoader()

    for (const dir of this.#sourceDirs) {
      await routesLoader.scanDir(dir)
      await middlewareLoader.scanDir(dir)
    }

    return {
      routes: routesLoader.getRoutes(),
      middlewares: middlewareLoader.getMiddlewares(),
      errorHandler: middlewareLoader.getErrorHandler() as
        | MedusaErrorHandlerFunction
        | undefined,
      bodyParserConfigRoutes: middlewareLoader.getBodyParserConfigRoutes(),
      additionalDataValidatorRoutes:
        middlewareLoader.getAdditionalDataValidatorRoutes(),
    }
  }
}
