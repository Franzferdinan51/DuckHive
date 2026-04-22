// @ts-nocheck
/**
 * FallbackChain — duck-cli inspired retry + provider fallback system
 * If provider A fails → retry → fallback to B → fallback to C
 * Never just fail. Exponential backoff between retries.
 */

export interface FallbackConfig {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  timeoutMs: number
}

export interface FallbackStep<T = unknown, R = unknown> {
  name: string
  provider: string
  handler: (input: T) => Promise<R>
}

export interface FallbackResult<T> {
  success: boolean
  data?: T
  error?: string
  attempts: number
  provider?: string
  stepsAttempted: string[]
}

const DEFAULT_CONFIG: FallbackConfig = {
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  timeoutMs: 30000,
}

export class FallbackChain<T = unknown, R = unknown> {
  private steps: FallbackStep<T, R>[] = []
  private config: FallbackConfig

  constructor(config: Partial<FallbackConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /** Add a fallback step */
  addStep(name: string, provider: string, handler: (input: T) => Promise<R>): this {
    this.steps.push({ name, provider, handler })
    return this
  }

  /** Execute with fallback chain */
  async execute(input: T): Promise<FallbackResult<R>> {
    const stepsAttempted: string[] = []

    for (const step of this.steps) {
      stepsAttempted.push(step.name)

      for (let retry = 0; retry <= this.config.maxRetries; retry++) {
        try {
          const result = await this.withTimeout(step.handler(input), `step:${step.name} retry:${retry}`)
          return {
            success: true,
            data: result,
            attempts: stepsAttempted.length,
            provider: step.provider,
            stepsAttempted,
          }
        } catch (err) {
          const delay = Math.min(this.config.baseDelayMs * Math.pow(2, retry), this.config.maxDelayMs)
          if (retry < this.config.maxRetries) {
            await this.sleep(delay)
          }
          if (retry === this.config.maxRetries) {
            // Move to next fallback
          }
        }
      }
    }

    return {
      success: false,
      error: 'All fallback steps exhausted',
      attempts: stepsAttempted.length,
      stepsAttempted,
    }
  }

  private withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout: ${label}`)), this.config.timeoutMs)
      promise.then(resolve, reject).finally(() => clearTimeout(timer))
    })
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
  }
}

// Quick helper: create a provider chain with auto-fallback
export async function withFallback<R>(
  providers: Array<{
    name: string
    provider: string
    call: () => Promise<R>
  }>,
  config?: Partial<FallbackConfig>
): Promise<FallbackResult<R>> {
  const chain = new FallbackChain(config)
  for (const p of providers) {
    chain.addStep(p.name, p.provider, () => p.call())
  }
  return chain.execute(null as unknown as undefined)
}
