import type { FileTypes } from "@medusajs/types"

export class WorkerMemoryFileProvider implements FileTypes.IFileProvider {
  static identifier = "worker-memory"

  readonly #storage = new Map<string, string>()

  async upload(
    file: FileTypes.ProviderUploadFileDTO
  ): Promise<FileTypes.ProviderFileResultDTO> {
    this.#storage.set(file.filename, file.content)
    return {
      key: file.filename,
      url: file.filename,
    }
  }

  async delete(
    fileData:
      | FileTypes.ProviderDeleteFileDTO
      | FileTypes.ProviderDeleteFileDTO[]
  ): Promise<void> {
    const files = Array.isArray(fileData) ? fileData : [fileData]
    for (const file of files) {
      this.#storage.delete(file.fileKey)
    }
  }

  async getPresignedDownloadUrl(
    fileData: FileTypes.ProviderGetFileDTO
  ): Promise<string> {
    return this.#storage.get(fileData.fileKey) ?? ""
  }

  async getPresignedUploadUrl(
    fileData: FileTypes.ProviderGetPresignedUploadUrlDTO
  ): Promise<FileTypes.ProviderFileResultDTO> {
    return {
      key: fileData.filename,
      url: `memory-upload://${fileData.filename}`,
    }
  }

  async getDownloadStream(): Promise<never> {
    throw new Error("Worker memory file provider does not support streams")
  }

  async getAsBuffer(): Promise<never> {
    throw new Error("Worker memory file provider does not support buffers")
  }

  async getUploadStream(): Promise<never> {
    throw new Error("Worker memory file provider does not support streams")
  }
}

export const workerMemoryFileProvider = {
  services: [WorkerMemoryFileProvider],
}
