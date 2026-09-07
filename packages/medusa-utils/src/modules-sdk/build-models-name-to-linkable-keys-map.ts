import { MapToConfig } from "../common/map-object-to"

export function buildModelsNameToLinkableKeysMap(
  linkableKeys: Record<string, string>
): MapToConfig {
  const entityLinkableKeysMap: MapToConfig = {}
  Object.entries(linkableKeys).forEach(([key, value]) => {
    entityLinkableKeysMap[value] ??= []
    entityLinkableKeysMap[value].push({
      mapTo: key,
      valueFrom: key.slice(key.lastIndexOf("_") + 1),
    })
  })
  return entityLinkableKeysMap
}
