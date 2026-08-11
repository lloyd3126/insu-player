import { timingSafeEqual } from "node:crypto"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import path from "node:path"

import type {
  CloudTranscriptionProvider,
  TranscriptionProviderStatus,
} from "@shared/contracts/resources"

interface ProviderDefinition {
  id: CloudTranscriptionProvider
  displayName: string
  credentialName: string
  packageName: string
}
const PROVIDERS: ProviderDefinition[] = [
  {
    id: "openai",
    displayName: "OpenAI",
    credentialName: "OPENAI_API_KEY",
    packageName: "openai",
  },
  {
    id: "groq",
    displayName: "Groq",
    credentialName: "GROQ_API_KEY",
    packageName: "groq",
  },
  {
    id: "elevenlabs",
    displayName: "ElevenLabs",
    credentialName: "ELEVENLABS_API_KEY",
    packageName: "elevenlabs",
  },
  {
    id: "xai",
    displayName: "xAI",
    credentialName: "XAI_API_KEY",
    packageName: "httpx",
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    credentialName: "OPENROUTER_API_KEY",
    packageName: "openai",
  },
]

const PROVIDERS_BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]))

export class ProviderCredentialError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: 400 | 404,
  ) {
    super(message)
  }
}

export class ProviderCredentialService {
  readonly sessionToken =
    crypto.randomUUID().replaceAll("-", "") +
    crypto.randomUUID().replaceAll("-", "")
  private readonly sources = new Map<
    CloudTranscriptionProvider,
    "startup" | "session"
  >()

  constructor(private readonly workspace: string) {
    for (const provider of PROVIDERS) {
      if (process.env[provider.credentialName]) {
        this.sources.set(provider.id, "startup")
      }
    }
  }

  private definition(providerId: CloudTranscriptionProvider) {
    const provider = PROVIDERS_BY_ID.get(providerId)
    if (!provider) {
      throw new ProviderCredentialError(
        "unsupported transcription provider",
        "unsupported-provider",
        404,
      )
    }
    return provider
  }

  private installedPackages() {
    const lockPath = path.join(
      this.workspace,
      ".agent-tools",
      "insu-player",
      "requirements.lock.txt",
    )
    if (!existsSync(lockPath) || lstatSync(lockPath).isSymbolicLink()) {
      return new Set<string>()
    }
    const packages = new Set<string>()
    for (const source of readFileSync(lockPath, "utf8").split(/\r?\n/)) {
      const requirement = source.trim()
      if (!requirement || requirement.startsWith("#")) continue
      const matched =
        requirement.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)==[^\s;]+/) ??
        requirement.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s+@\s+.+$/)
      if (!matched) continue
      packages.add(matched[1].replace(/[-_.]+/g, "-").toLowerCase())
    }
    return packages
  }

  statuses(modelIdsByProvider: Map<CloudTranscriptionProvider, string[]>) {
    const packages = this.installedPackages()
    return PROVIDERS.map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      credentialName: provider.credentialName,
      configured: Boolean(process.env[provider.credentialName]),
      source: this.sources.get(provider.id) ?? null,
      sdkInstalled: packages.has(provider.packageName),
      modelIds: modelIdsByProvider.get(provider.id) ?? [],
    })) satisfies TranscriptionProviderStatus[]
  }

  status(
    providerId: CloudTranscriptionProvider,
    modelIdsByProvider: Map<CloudTranscriptionProvider, string[]>,
  ) {
    this.definition(providerId)
    return this.statuses(modelIdsByProvider).find(
      (provider) => provider.id === providerId,
    )!
  }

  set(providerId: CloudTranscriptionProvider, value: string) {
    const provider = this.definition(providerId)
    const normalized = value.trim()
    if (
      !normalized ||
      normalized.length > 2048 ||
      [...normalized].some((character) => character.charCodeAt(0) < 32)
    ) {
      throw new ProviderCredentialError(
        "provider credential is invalid",
        "invalid-credential",
        400,
      )
    }
    process.env[provider.credentialName] = normalized
    this.sources.set(providerId, "session")
  }

  clear(providerId: CloudTranscriptionProvider) {
    const provider = this.definition(providerId)
    delete process.env[provider.credentialName]
    this.sources.delete(providerId)
  }

  sessionValue(
    providerId: CloudTranscriptionProvider,
    authorization: string | undefined,
  ) {
    const provider = this.definition(providerId)
    const expected = Buffer.from(`Bearer ${this.sessionToken}`)
    const actual = Buffer.from(authorization ?? "")
    const value = process.env[provider.credentialName]
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected) ||
      !value
    ) {
      throw new ProviderCredentialError(
        "provider credential is unavailable",
        "credential-unavailable",
        404,
      )
    }
    return value
  }
}
