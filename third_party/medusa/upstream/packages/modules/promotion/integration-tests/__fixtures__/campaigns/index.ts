import {
  CampaignDTO,
  CreateCampaignDTO,
  IPromotionModuleService,
} from "@medusajs/framework/types"
import { toMikroORMEntity } from "@medusajs/framework/utils"
import { SqlEntityManager } from "@medusajs/framework/mikro-orm/postgresql"
import { Campaign } from "@models"
import { defaultCampaignsData } from "./data"

export * from "./data"

const TODAY = new Date()

function resolveCampaignsData(
  campaignsData?: CreateCampaignDTO[]
): CreateCampaignDTO[] {
  if (campaignsData) {
    return campaignsData
  }

  const cp = structuredClone(defaultCampaignsData)

  const starts_at = new Date(TODAY)
  starts_at.setDate(starts_at.getDate() - 1)
  starts_at.setMonth(starts_at.getMonth() - 1)

  const ends_at = new Date(TODAY)
  ends_at.setDate(ends_at.getDate() - 1)
  ends_at.setMonth(ends_at.getMonth() - 1)
  ends_at.setFullYear(ends_at.getFullYear() + 1)

  for (const data of cp) {
    data.starts_at = starts_at
    data.ends_at = ends_at
  }

  return cp
}

export async function createCampaigns(
  manager: SqlEntityManager,
  campaignsData?: CreateCampaignDTO[]
): Promise<Campaign[]> {
  campaignsData = resolveCampaignsData(campaignsData)

  const campaigns: Campaign[] = []

  for (let campaignData of campaignsData) {
    let campaign = manager.create(toMikroORMEntity(Campaign), campaignData)

    manager.persist(campaign)

    await manager.flush()
  }

  return campaigns
}

export async function createDefaultCampaigns(
  service: IPromotionModuleService,
  campaignsData?: CreateCampaignDTO[]
): Promise<CampaignDTO[]> {
  const campaigns = await service.createCampaigns(
    resolveCampaignsData(campaignsData)
  )

  return Array.isArray(campaigns) ? campaigns : [campaigns]
}
