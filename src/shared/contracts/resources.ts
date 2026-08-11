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

export type TranscriptionProvider =
  | "local"
  | "openai"
  | "groq"
  | "elevenlabs"
  | "xai"
  | "openrouter"

export type CloudTranscriptionProvider = Exclude<TranscriptionProvider, "local">

export type TranscriptionModelStatus =
  | "ready"
  | "not-downloaded"
  | "downloading"
  | "validating"
  | "redownload-required"
  | "download-failed"
  | "sdk-missing"
  | "credential-missing"

interface TranscriptionModelBase {
  id: string
  displayName: string
  provider: TranscriptionProvider
  providerName: string
  service: string
  model: string | null
  timingUnitKind: "word"
  selected: boolean
  ready: boolean
  status: TranscriptionModelStatus
  requiresAudioUpload: boolean
  requiresPerRunConsent: boolean
}

export interface LocalTranscriptionModel extends TranscriptionModelBase {
  type: "local"
  provider: "local"
  local: {
    runtimeInstalled: boolean
    languageSupport: "multilingual" | "english-only"
    approximateBytes: number
    memoryLabel: string
    installed: boolean
    valid: boolean
    sizeBytes: number | null
    download: {
      state: "idle" | "downloading" | "validating" | "failed"
      progress: number
      downloadedBytes: number
      totalBytes: number
      message: string
      errorCode: string | null
    }
  }
}

export interface CloudTranscriptionModel extends TranscriptionModelBase {
  type: "cloud"
  provider: CloudTranscriptionProvider
  cloud: {
    sdkInstalled: boolean
    credentialConfigured: boolean
    credentialName: string
    uploadDescription: string
  }
}

export type TranscriptionModel =
  | LocalTranscriptionModel
  | CloudTranscriptionModel

export interface TranscriptionProviderStatus {
  id: CloudTranscriptionProvider
  displayName: string
  credentialName: string
  configured: boolean
  source: "startup" | "session" | null
  sdkInstalled: boolean
  modelIds: string[]
}

export interface TranscriptionModelCatalogResponse {
  models: TranscriptionModel[]
  providers: TranscriptionProviderStatus[]
  selectedModelId: string | null
  updatedAt: string | null
}

export interface TranscriptionModelDetailResponse {
  model: TranscriptionModel
  provider: TranscriptionProviderStatus | null
}

export interface RuntimeCapability {
  key: string
  label: string
  state: "ready" | "missing" | "checking"
  detail: string
  version: string | null
  checkedAt: string
}

export interface RuntimeStatusResponse {
  initialized: boolean
  capabilities: RuntimeCapability[]
  activeSetup: {
    id: string
    state: string
    stage: string
    progress: number
    message: string
    updatedAt: string
  } | null
}

export interface AgentIntentResponse {
  id: string
  kind: string
  state: "copied"
  createdAt: string
  expiresAt: string
}
