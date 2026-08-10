export const PROCESSOR_PROVIDERS = ["local", "openai", "agent"] as const

export type ProcessorProvider = (typeof PROCESSOR_PROVIDERS)[number]

export interface ProcessorIdentity {
  provider: ProcessorProvider
  service?: string | null
  model?: string | null
}

export const TIMING_PROCESSOR_PROVIDERS = ["local", "openai"] as const

export type TimingProcessorProvider =
  (typeof TIMING_PROCESSOR_PROVIDERS)[number]

export interface TimingProcessorIdentity extends ProcessorIdentity {
  provider: TimingProcessorProvider
  model: string
}
