import type { ModuleJoinerConfig } from "@medusajs/types"

const joinerConfigs = new Map<string, ModuleJoinerConfig>()

export class MedusaModule {
  static setJoinerConfig(key: string, config: ModuleJoinerConfig): void {
    joinerConfigs.set(key, config)
  }

  static getJoinerConfig(key: string): ModuleJoinerConfig | undefined {
    return joinerConfigs.get(key)
  }

  static getAllJoinerConfigs(): ModuleJoinerConfig[] {
    return Array.from(joinerConfigs.values())
  }
}
