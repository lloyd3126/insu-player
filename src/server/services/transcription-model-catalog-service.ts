import { eq } from "drizzle-orm"

import type { AppDatabase } from "@server/db/client"
import { transcriptionSettings } from "@server/db/schema"
import {
  LocalModelOperationError,
  LocalModelRuntimeService,
} from "@server/services/local-model-service"
import {
  ProviderCredentialService,
} from "@server/services/provider-credential-service"
import type {
  CloudTranscriptionModel,
  CloudTranscriptionProvider,
  TranscriptionModel,
  TranscriptionModelCatalogResponse,
  TranscriptionModelDetailResponse,
} from "@shared/contracts/resources"

interface CloudModelDefinition {
  id: string
  provider: CloudTranscriptionProvider
  providerName: string
  service: string
  model: string | null
  displayName: string
  uploadDescription: string
}
const CLOUD_MODELS: CloudModelDefinition[] = [
  {
    id: "cloud.openai.whisper-1",
    provider: "openai",
    providerName: "OpenAI",
    service: "audio/transcriptions",
    model: "whisper-1",
    displayName: "OpenAI whisper-1",
    uploadDescription: "音訊分段會上傳到 OpenAI 語音辨識服務",
  },
  {
    id: "cloud.groq.whisper-large-v3",
    provider: "groq",
    providerName: "Groq",
    service: "audio/transcriptions",
    model: "whisper-large-v3",
    displayName: "Groq whisper-large-v3",
    uploadDescription: "音訊分段會上傳到 Groq 語音辨識服務",
  },
  {
    id: "cloud.groq.whisper-large-v3-turbo",
    provider: "groq",
    providerName: "Groq",
    service: "audio/transcriptions",
    model: "whisper-large-v3-turbo",
    displayName: "Groq whisper-large-v3-turbo",
    uploadDescription: "音訊分段會上傳到 Groq 語音辨識服務",
  },
  {
    id: "cloud.elevenlabs.scribe-v2",
    provider: "elevenlabs",
    providerName: "ElevenLabs",
    service: "speech-to-text",
    model: "scribe_v2",
    displayName: "ElevenLabs Scribe v2",
    uploadDescription: "音訊分段會上傳到 ElevenLabs 語音辨識服務",
  },
  {
    id: "cloud.xai.speech-to-text",
    provider: "xai",
    providerName: "xAI",
    service: "v1/stt",
    model: null,
    displayName: "xAI Speech-to-Text API",
    uploadDescription: "音訊分段會上傳到 xAI 語音辨識服務",
  },
  {
    id: "cloud.openrouter.openai-whisper-large-v3",
    provider: "openrouter",
    providerName: "OpenRouter",
    service: "audio/transcriptions",
    model: "openai/whisper-large-v3",
    displayName: "OpenRouter openai/whisper-large-v3",
    uploadDescription: "音訊分段會上傳到 OpenRouter 語音辨識服務",
  },
]

const ACTIVE_SETTING_ID = "active"

function now() {
  return new Date().toISOString()
}

export class TranscriptionModelCatalogService {
  readonly credentials: ProviderCredentialService
  private readonly localModels: LocalModelRuntimeService

  constructor(workspace: string, private readonly db: AppDatabase) {
    this.credentials = new ProviderCredentialService(workspace)
    this.localModels = new LocalModelRuntimeService(workspace, db)
    this.ensureDefaultSelection()
  }

  private storedSelection() {
    return (
      this.db
        .select()
        .from(transcriptionSettings)
        .where(eq(transcriptionSettings.id, ACTIVE_SETTING_ID))
        .get() ?? null
    )
  }

  private ensureDefaultSelection() {
    if (this.storedSelection()) return
    const defaultModel = this.localModels.model(
      "local.openai-whisper.medium",
      null,
    )
    if (!defaultModel.ready) return
    const updatedAt = now()
    this.db
      .insert(transcriptionSettings)
      .values({
        id: ACTIVE_SETTING_ID,
        modelId: defaultModel.id,
        updatedAt,
      })
      .run()
  }

  private modelIdsByProvider() {
    const modelIds = new Map<CloudTranscriptionProvider, string[]>()
    for (const model of CLOUD_MODELS) {
      const ids = modelIds.get(model.provider) ?? []
      ids.push(model.id)
      modelIds.set(model.provider, ids)
    }
    return modelIds
  }

  private cloudModels(selectedModelId: string | null): CloudTranscriptionModel[] {
    const providers = new Map(
      this.credentials
        .statuses(this.modelIdsByProvider())
        .map((provider) => [provider.id, provider]),
    )
    return CLOUD_MODELS.map((definition) => {
      const provider = providers.get(definition.provider)!
      const status = !provider.sdkInstalled
        ? "sdk-missing"
        : !provider.configured
          ? "credential-missing"
          : "ready"
      return {
        id: definition.id,
        type: "cloud",
        displayName: definition.displayName,
        provider: definition.provider,
        providerName: definition.providerName,
        service: definition.service,
        model: definition.model,
        timingUnitKind: "word",
        selected: selectedModelId === definition.id,
        ready: status === "ready",
        status,
        requiresAudioUpload: true,
        requiresPerRunConsent: true,
        cloud: {
          sdkInstalled: provider.sdkInstalled,
          credentialConfigured: provider.configured,
          credentialName: provider.credentialName,
          uploadDescription: definition.uploadDescription,
        },
      } satisfies CloudTranscriptionModel
    })
  }

  catalog(): TranscriptionModelCatalogResponse {
    this.ensureDefaultSelection()
    const selection = this.storedSelection()
    const selectedModelId = selection?.modelId ?? null
    const models: TranscriptionModel[] = [
      ...this.localModels.models(selectedModelId),
      ...this.cloudModels(selectedModelId),
    ]
    if (selectedModelId && !models.some((model) => model.id === selectedModelId)) {
      throw new Error("stored transcription model is unsupported")
    }
    return {
      models,
      providers: this.credentials.statuses(this.modelIdsByProvider()),
      selectedModelId,
      updatedAt: selection?.updatedAt ?? null,
    }
  }

  detail(modelId: string): TranscriptionModelDetailResponse {
    const catalog = this.catalog()
    const model = catalog.models.find((candidate) => candidate.id === modelId)
    if (!model) {
      throw new LocalModelOperationError(
        "unsupported transcription model",
        "unsupported-model",
        404,
      )
    }
    return {
      model,
      provider:
        model.type === "cloud"
          ? catalog.providers.find((provider) => provider.id === model.provider) ?? null
          : null,
    }
  }

  select(modelId: string) {
    const detail = this.detail(modelId)
    if (!detail.model.ready) {
      throw new LocalModelOperationError(
        "model is not ready",
        "model-not-ready",
        409,
      )
    }
    const updatedAt = now()
    this.db
      .insert(transcriptionSettings)
      .values({ id: ACTIVE_SETTING_ID, modelId, updatedAt })
      .onConflictDoUpdate({
        target: transcriptionSettings.id,
        set: { modelId, updatedAt },
      })
      .run()
    return this.catalog()
  }

  download(modelId: string) {
    const model = this.detail(modelId).model
    if (model.type !== "local" || !model.model) {
      throw new LocalModelOperationError(
        "cloud models cannot be downloaded",
        "invalid-model-operation",
        400,
      )
    }
    this.localModels.download(model.model)
    return this.detail(modelId)
  }

  cancelDownload(modelId: string) {
    const model = this.detail(modelId).model
    if (model.type !== "local" || !model.model) {
      throw new LocalModelOperationError(
        "cloud models do not have downloads",
        "invalid-model-operation",
        400,
      )
    }
    this.localModels.cancel(model.model)
  }

  remove(modelId: string) {
    const model = this.detail(modelId).model
    if (model.type !== "local" || !model.model) {
      throw new LocalModelOperationError(
        "cloud models cannot be removed",
        "invalid-model-operation",
        400,
      )
    }
    this.localModels.remove(model.model, this.storedSelection()?.modelId ?? null)
  }

  setCredential(providerId: CloudTranscriptionProvider, value: string) {
    this.credentials.set(providerId, value)
    return this.catalog()
  }

  clearCredential(providerId: CloudTranscriptionProvider) {
    this.credentials.clear(providerId)
    return this.catalog()
  }
}
