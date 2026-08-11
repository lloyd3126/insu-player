export const TIMING_PROCESSOR_PROVIDERS = [
  "local",
  "openai",
  "groq",
  "elevenlabs",
  "xai",
  "openrouter",
] as const

export type TimingProcessorProvider =
  (typeof TIMING_PROCESSOR_PROVIDERS)[number]

export const PROCESSOR_PROVIDERS = [
  ...TIMING_PROCESSOR_PROVIDERS,
  "agent",
] as const

export type ProcessorProvider = (typeof PROCESSOR_PROVIDERS)[number]

export interface ProcessorIdentity {
  provider: ProcessorProvider
  service?: string | null
  model?: string | null
}

export interface TimingProcessorIdentity extends ProcessorIdentity {
  provider: TimingProcessorProvider
  service: string
  model: string | null
}

export interface AgentProcessorIdentity extends ProcessorIdentity {
  provider: "agent"
  service: "codex"
  model?: never
}
