import type {
  Context,
  ModuleJoinerConfig,
} from "@medusajs/framework/types"
import { isDefined, MedusaError } from "@medusajs/framework/utils/portable"
import LinkModuleService from "./link-module-service"
import type { LinkOperationStore } from "../operations/store"

export function getModuleService(
  joinerConfig: ModuleJoinerConfig
): typeof LinkModuleService {
  const joinerConfig_ = JSON.parse(JSON.stringify(joinerConfig))
  const databaseConfig = joinerConfig_.databaseConfig

  delete joinerConfig_.databaseConfig

  // If extraDataFields is not defined, pick the fields to populate and validate from the
  // database config if any fields are provided.
  if (!isDefined(joinerConfig_.extraDataFields)) {
    joinerConfig_.extraDataFields = Object.keys(
      databaseConfig?.extraFields || {}
    )
  }

  return class LinkService extends LinkModuleService {
    readonly #operationStore: LinkOperationStore | undefined

    constructor(...args: ConstructorParameters<typeof LinkModuleService>) {
      super(...args)
      const store = args[0].linkService.linkOperationStore
      if (databaseConfig?.workflowOperations === true) {
        const [primary, foreign] = joinerConfig.relationships ?? []
        if (store === undefined || primary === undefined || foreign === undefined ||
          joinerConfig.relationships?.length !== 2 ||
          Object.keys(databaseConfig.extraFields ?? {}).length !== 0 ||
          args[0].extraFields.length !== 0 || args[0].serviceName !== joinerConfig.serviceName ||
          store.serviceName !== joinerConfig.serviceName ||
          store.primaryKey !== primary.foreignKey || store.foreignKey !== foreign.foreignKey ||
          args[0].primaryKey !== primary.foreignKey || args[0].foreignKey !== foreign.foreignKey) {
          throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Durable Link metadata requires its matching native operation store")
        }
      } else if (store !== undefined) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Native Link operation storage requires explicit metadata admission")
      }
      this.#operationStore = store
    }

    private runMutation<T>(context: Context, work: (context: Context) => Promise<T>): Promise<T> {
      return this.#operationStore === undefined ? work(context) : this.#operationStore.withTransaction(context, work)
    }

    override create(...args: Parameters<LinkModuleService["create"]>) {
      return this.runMutation(args[3] ?? {}, context => super.create(args[0], args[1], args[2], context))
    }

    override dismiss(...args: Parameters<LinkModuleService["dismiss"]>) {
      return this.runMutation(args[2] ?? {}, context => super.dismiss(args[0], args[1], context))
    }

    override delete(...args: Parameters<LinkModuleService["delete"]>) {
      return this.runMutation(args[1] ?? {}, context => super.delete(args[0], context))
    }

    override softDelete(...args: Parameters<LinkModuleService["softDelete"]>) {
      return this.runMutation(args[2] ?? {}, context => super.softDelete(args[0], args[1], context))
    }

    override restore(...args: Parameters<LinkModuleService["restore"]>) {
      return this.runMutation(args[2] ?? {}, context => super.restore(args[0], args[1], context))
    }

    override restore_(...args: Parameters<LinkModuleService["restore_"]>) {
      return this.runMutation(args[1] ?? {}, context => super.restore_(args[0], context))
    }

    override __joinerConfig(): ModuleJoinerConfig {
      return joinerConfig_ as ModuleJoinerConfig
    }
  }
}
