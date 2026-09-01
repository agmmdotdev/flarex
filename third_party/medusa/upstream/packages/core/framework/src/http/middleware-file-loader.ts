import { dynamicImport, FileSystem } from "@medusajs/utils"
import { join } from "path"

import { logger } from "../logger"
import {
  type AdditionalDataValidatorRoute,
  type BodyParserConfigRoute,
  type MedusaErrorHandlerFunction,
  type MiddlewareDescriptor,
} from "./types"
import { buildStaticMiddlewareResources } from "./utils/static-middleware-resources"

/**
 * File name that is used to indicate that the file is a middleware file
 */
const MIDDLEWARE_FILE_NAME = "middlewares"

/**
 * Exposes the API to scan a directory and load the `middleware.ts` file. This file contains
 * the configuration for certain global middlewares and core routes validators. Also, it may
 * contain custom middlewares.
 */
export class MiddlewareFileLoader {
  /**
   * Global error handler exported from the middleware file loader
   */
  #errorHandler?: MedusaErrorHandlerFunction

  /**
   * Middleware collected manually or by scanning directories
   */
  #middleware: MiddlewareDescriptor[] = []

  /**
   * Route matchers on which a custom additional data validator is
   * defined
   */
  #additionalDataValidatorRoutes: AdditionalDataValidatorRoute[] = []

  /**
   * Route matchers on which a custom body parser config is used
   */
  #bodyParserConfigRoutes: BodyParserConfigRoute[] = []

  /**
   * Processes the middleware file and returns the middleware and the
   * routes config exported by it.
   */
  async #processMiddlewareFile(absolutePath: string): Promise<void> {
    const middlewareExports = await dynamicImport(absolutePath)
    const result = buildStaticMiddlewareResources({
      module: middlewareExports,
      source: absolutePath,
      logger,
    })

    if (result.errorHandler) {
      this.#errorHandler = result.errorHandler
    }
    this.#middleware = this.#middleware.concat(result.middlewares)
    this.#bodyParserConfigRoutes = this.#bodyParserConfigRoutes.concat(
      result.bodyParserConfigRoutes
    )
    this.#additionalDataValidatorRoutes =
      this.#additionalDataValidatorRoutes.concat(
        result.additionalDataValidatorRoutes
      )
  }

  /**
   * Scans a given directory for the "middleware.ts" or "middleware.js" files and
   * imports them for reading the registered middleware and configuration for
   * existing routes/middleware.
   */
  async scanDir(sourceDir: string) {
    const fs = new FileSystem(sourceDir)
    if (await fs.exists(`${MIDDLEWARE_FILE_NAME}.ts`)) {
      await this.#processMiddlewareFile(
        join(sourceDir, `${MIDDLEWARE_FILE_NAME}.ts`)
      )
    } else if (await fs.exists(`${MIDDLEWARE_FILE_NAME}.js`)) {
      await this.#processMiddlewareFile(
        join(sourceDir, `${MIDDLEWARE_FILE_NAME}.js`)
      )
    }
  }

  /**
   * Returns the globally registered error handler (if any)
   */
  getErrorHandler() {
    return this.#errorHandler
  }

  /**
   * Returns a collection of registered middleware
   */
  getMiddlewares() {
    return this.#middleware
  }

  /**
   * Returns routes that have bodyparser config on them
   */
  getBodyParserConfigRoutes() {
    return this.#bodyParserConfigRoutes
  }

  /**
   * Returns routes that have additional validator configured
   * on them
   */
  getAdditionalDataValidatorRoutes() {
    return this.#additionalDataValidatorRoutes
  }
}
