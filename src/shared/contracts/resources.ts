export interface PromptItem {
  id: string
  title: string
  scenario: string
  prompt: string
  updatedAt: string
}

export interface PromptLibraryResponse {
  available: boolean
  version?: number
  prompts: PromptItem[]
  message?: string
}

export interface SupportedSitesResponse {
  provider: string
  available: boolean
  version: string | null
  count: number
  extractors: string[]
  message: string
}

export interface LocalModel {
  name: string
  displayName: string
  sizeBytes: number
  ready: boolean
}

export interface ModelInventoryResponse {
  local: {
    providerInstalled: boolean
    packageVersion: string | null
    modelCount: number
    totalSizeBytes: number
    models: LocalModel[]
  }
  api: {
    providerInstalled: boolean
    packageVersion: string | null
    keyConfigured: boolean
    models: Array<{
      name: string
      displayName: string
      installed: boolean
      apiKeyName: string
      apiKeyConfigured: boolean
    }>
  }
}

export interface EnvironmentVariableStatus {
  name: string
  label: string
  description: string
  configured: boolean
  source: string | null
  providerInstalled: boolean
}

export interface EnvironmentStatusResponse {
  scope: "process"
  variables: EnvironmentVariableStatus[]
}
