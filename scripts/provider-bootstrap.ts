// @ts-nocheck
import { resolveCodexApiCredentials } from '../src/services/api/providerConfig.js'
import {
  getGoalDefaultOpenAIModel,
  normalizeRecommendationGoal,
  recommendOllamaModel,
} from '../src/utils/providerRecommendation.ts'
import {
  buildAtomicChatProfileEnv,
  buildBedrockProfileEnv,
  buildCodexProfileEnv,
  buildGeminiProfileEnv,
  buildGithubProfileEnv,
  buildMiniMaxProfileEnv,
  buildMistralProfileEnv,
  buildNvidiaNimProfileEnv,
  buildOllamaProfileEnv,
  buildOpenAIProfileEnv,
  buildOpenRouterProfileEnv,
  buildVertexProfileEnv,
  buildXaiProfileEnv,
  createProfileFile,
  saveProfileFile,
  selectAutoProfile,
  type ProfileFile,
  type ProviderProfile,
} from '../src/utils/providerProfile.ts'
import {
  getAtomicChatChatBaseUrl,
  getOllamaChatBaseUrl,
  hasLocalAtomicChat,
  hasLocalOllama,
  listAtomicChatModels,
  listOllamaModels,
} from '../src/utils/providerDiscovery.ts'

function parseArg(name: string): string | null {
  const args = process.argv.slice(2)
  const idx = args.indexOf(name)
  if (idx === -1) return null
  return args[idx + 1] ?? null
}

type ProviderSelection = ProviderProfile | 'auto' | 'unsupported'

function parseProviderArg(): ProviderSelection {
  const provider = parseArg('--provider')?.toLowerCase()
  if (!provider || provider === 'auto') {
    return 'auto'
  }
  if (
    provider === 'anthropic' ||
    provider === 'openai' ||
    provider === 'openrouter' ||
    provider === 'nvidia-nim' ||
    provider === 'ollama' ||
    provider === 'codex' ||
    provider === 'gemini' ||
    provider === 'mistral' ||
    provider === 'atomic-chat' ||
    provider === 'github' ||
    provider === 'bedrock' ||
    provider === 'vertex' ||
    provider === 'minimax' ||
    provider === 'xai'
  ) {
    return provider
  }
  return 'unsupported'
}

async function resolveOllamaModel(
  argModel: string | null,
  argBaseUrl: string | null,
  goal: ReturnType<typeof normalizeRecommendationGoal>,
): Promise<string | null> {
  if (argModel) return argModel

  const discovered = await listOllamaModels(argBaseUrl || undefined)
  const recommended = recommendOllamaModel(discovered, goal)
  return recommended?.name ?? null
}

function printUsageError(message: string): never {
  console.error(message)
  process.exit(1)
}

async function main(): Promise<void> {
  const provider = parseProviderArg()
  const argModel = parseArg('--model')
  const argBaseUrl = parseArg('--base-url')
  const argApiKey = parseArg('--api-key')
  const goal = normalizeRecommendationGoal(
    parseArg('--goal') || process.env.OPENCLAUDE_PROFILE_GOAL,
  )

  let selected: ProviderProfile
  let resolvedOllamaModel: string | null = null
  if (provider === 'unsupported') {
    printUsageError(`Unsupported provider for bootstrap: ${parseArg('--provider')}`)
  } else if (provider === 'auto') {
    if (await hasLocalOllama(argBaseUrl || undefined)) {
      resolvedOllamaModel = await resolveOllamaModel(
        argModel,
        argBaseUrl,
        goal,
      )
      selected = selectAutoProfile(resolvedOllamaModel)
    } else {
      selected = 'openai'
    }
  } else {
    selected = provider
  }

  let env: ProfileFile['env']
  if (selected === 'anthropic') {
    const apiKey = argApiKey || process.env.ANTHROPIC_API_KEY || null
    if (!apiKey) {
      printUsageError(
        'Anthropic profile requires ANTHROPIC_API_KEY. Use --api-key or set ANTHROPIC_API_KEY.',
      )
    }

    env = {
      ANTHROPIC_BASE_URL:
        argBaseUrl ||
        process.env.ANTHROPIC_BASE_URL ||
        'https://api.anthropic.com',
      ANTHROPIC_MODEL:
        argModel || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      ANTHROPIC_API_KEY: apiKey,
    }
  } else if (selected === 'gemini') {
    const builtEnv = buildGeminiProfileEnv({
      model: argModel || null,
      baseUrl: argBaseUrl || null,
      apiKey: argApiKey || null,
      processEnv: process.env,
    })

    if (!builtEnv) {
      printUsageError(
        'Gemini profile requires an API key. Use --api-key or set GEMINI_API_KEY.',
      )
    }

    env = builtEnv
  } else if (selected === 'github') {
    env = buildGithubProfileEnv({
      model: argModel || null,
      baseUrl: argBaseUrl || null,
    })
  } else if (selected === 'bedrock') {
    env = buildBedrockProfileEnv({
      model: argModel || null,
      baseUrl: argBaseUrl || null,
    })
  } else if (selected === 'vertex') {
    env = buildVertexProfileEnv({
      model: argModel || null,
      baseUrl: argBaseUrl || null,
    })
  } else if (selected === 'minimax') {
    const builtEnv = buildMiniMaxProfileEnv({
      model: argModel || null,
      baseUrl: argBaseUrl || null,
      apiKey:
        argApiKey ||
        process.env.MINIMAX_API_KEY ||
        process.env.MMX_API_KEY ||
        null,
      processEnv: process.env,
    })
    if (!builtEnv) {
      printUsageError(
        'MiniMax profile requires MINIMAX_API_KEY or MMX_API_KEY. Use --api-key or set one of those env vars.',
      )
    }
    env = builtEnv
  } else if (selected === 'xai') {
    const builtEnv = buildXaiProfileEnv({
      model: argModel || null,
      baseUrl: argBaseUrl || null,
      apiKey: argApiKey || process.env.XAI_API_KEY || null,
      processEnv: process.env,
    })
    if (!builtEnv.OPENAI_API_KEY) {
      printUsageError(
        'xAI profile requires XAI_API_KEY. Use --api-key or set XAI_API_KEY.',
      )
    }
    env = builtEnv
  } else if (selected === 'mistral') {
    const builtEnv = buildMistralProfileEnv({
      model: argModel || null,
      baseUrl: argBaseUrl || null,
      apiKey: argApiKey || null,
      processEnv: process.env,
    })

    if (!builtEnv) {
      printUsageError(
        'Mistral profile requires an API key. Use --api-key or set MISTRAL_API_KEY.',
      )
    }

    env = builtEnv
  } else if (selected === 'openrouter') {
    const builtEnv = buildOpenRouterProfileEnv({
      model: argModel || null,
      baseUrl: argBaseUrl || null,
      apiKey: argApiKey || process.env.OPENROUTER_API_KEY || null,
      processEnv: process.env,
    })

    if (!builtEnv) {
      printUsageError(
        'OpenRouter profile requires an API key. Use --api-key or set OPENROUTER_API_KEY.',
      )
    }

    env = builtEnv
  } else if (selected === 'nvidia-nim') {
    const builtEnv = buildNvidiaNimProfileEnv({
      model: argModel || null,
      baseUrl: argBaseUrl || null,
      apiKey: argApiKey || process.env.NVIDIA_API_KEY || null,
      processEnv: process.env,
    })

    if (!builtEnv) {
      printUsageError(
        'NVIDIA NIM profile requires an API key. Use --api-key or set NVIDIA_API_KEY.',
      )
    }

    env = builtEnv
  } else if (selected === 'ollama') {
    resolvedOllamaModel ??= await resolveOllamaModel(
      argModel,
      argBaseUrl,
      goal,
    )
    if (!resolvedOllamaModel) {
      printUsageError(
        'No viable Ollama chat model was discovered. Pull a chat model first or pass --model explicitly.',
      )
    }

    env = buildOllamaProfileEnv(resolvedOllamaModel, {
      baseUrl: argBaseUrl,
      getOllamaChatBaseUrl,
    })
  } else if (selected === 'atomic-chat') {
    const model =
      argModel || (await listAtomicChatModels(argBaseUrl || undefined))[0]
    if (!model) {
      if (!(await hasLocalAtomicChat(argBaseUrl || undefined))) {
        printUsageError(
          'Atomic Chat is not running (could not connect to 127.0.0.1:1337).\n  Download from https://atomic.chat/ and launch the application.',
        )
      } else {
        printUsageError(
          'Atomic Chat is running but no model is loaded. Open Atomic Chat and download or start a model first.',
        )
      }
    }

    env = buildAtomicChatProfileEnv(model, {
      baseUrl: argBaseUrl,
      getAtomicChatChatBaseUrl,
    })
  } else if (selected === 'codex') {
    const builtEnv = buildCodexProfileEnv({
      model: argModel,
      baseUrl: argBaseUrl,
      apiKey: argApiKey || process.env.CODEX_API_KEY || null,
      processEnv: process.env,
    })

    if (!builtEnv) {
      const credentials = resolveCodexApiCredentials(
        argApiKey ? { ...process.env, CODEX_API_KEY: argApiKey } : process.env,
      )
      const authHint = credentials.authPath
        ? ` or make sure ${credentials.authPath} exists`
        : ''
      if (!credentials.apiKey) {
        printUsageError(`Codex profile requires CODEX_API_KEY${authHint}.`)
      } else {
        printUsageError(
          'Codex profile requires CHATGPT_ACCOUNT_ID or an auth.json that includes it.',
        )
      }
    }

    env = builtEnv
  } else if (selected === 'openai') {
    const builtEnv = buildOpenAIProfileEnv({
      goal,
      model: argModel || null,
      baseUrl: argBaseUrl || null,
      apiKey: argApiKey || process.env.OPENAI_API_KEY || null,
      processEnv: process.env,
    })

    if (!builtEnv) {
      printUsageError(
        'OpenAI profile requires a real API key. Use --api-key or set OPENAI_API_KEY.',
      )
    }

    env = builtEnv
  } else {
    printUsageError(`Unsupported provider for bootstrap: ${selected}`)
  }

  const profile = createProfileFile(selected, env)
  const outputPath = saveProfileFile(profile)

  console.log(`Saved profile: ${selected}`)
  console.log(`Goal: ${goal}`)
  console.log(
    `Model: ${profile.env.GEMINI_MODEL || profile.env.MISTRAL_MODEL || profile.env.ANTHROPIC_MODEL || profile.env.OPENAI_MODEL || getGoalDefaultOpenAIModel(goal)}`,
  )
  console.log(`Path: ${outputPath}`)
  console.log('Next: bun run dev:profile')
}

if (import.meta.main) {
  await main()
}

export {}
