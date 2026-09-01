// @ts-check

const { AbstractFileProviderService } = require("@medusajs/framework/utils")

/** @typedef {import("@medusajs/framework/types").FileTypes.ProviderDeleteFileDTO} ProviderDeleteFileDTO */
/** @typedef {import("@medusajs/framework/types").FileTypes.ProviderFileResultDTO} ProviderFileResultDTO */
/** @typedef {import("@medusajs/framework/types").FileTypes.ProviderGetFileDTO} ProviderGetFileDTO */
/** @typedef {import("@medusajs/framework/types").FileTypes.ProviderGetPresignedUploadUrlDTO} ProviderGetPresignedUploadUrlDTO */
/** @typedef {import("@medusajs/framework/types").FileTypes.ProviderUploadFileDTO} ProviderUploadFileDTO */

class FileProviderServiceFixtures extends AbstractFileProviderService {
  static identifier = "fixtures-file-provider"

  constructor() {
    super()
    /** @type {Record<string, string>} */
    this.storage = {}
  }

  /**
   * @param {ProviderUploadFileDTO} file
   * @returns {Promise<ProviderFileResultDTO>}
   */
  async upload(file) {
    this.storage[file.filename] = Buffer.isBuffer(file.content)
      ? file.content.toString()
      : file.content

    return {
      url: file.filename,
      key: file.filename,
    }
  }

  /**
   * @param {ProviderDeleteFileDTO | ProviderDeleteFileDTO[]} files
   * @returns {Promise<void>}
   */
  async delete(files) {
    for (const file of Array.isArray(files) ? files : [files]) {
      delete this.storage[file.fileKey]
    }
  }

  /**
   * @param {ProviderGetFileDTO} fileData
   * @returns {Promise<string>}
   */
  async getPresignedDownloadUrl(fileData) {
    return this.storage[fileData.fileKey] ?? ""
  }

  /**
   * @param {ProviderGetPresignedUploadUrlDTO} fileData
   * @returns {Promise<ProviderFileResultDTO>}
   */
  async getPresignedUploadUrl(fileData) {
    return {
      url: "presigned-url/" + fileData.filename,
      key: fileData.filename,
    }
  }
}

const services = [FileProviderServiceFixtures]

module.exports = { FileProviderServiceFixtures, services }
