/**
 * Hardware-aware GPU Detection & Model Tier Mapping
 *
 * Detects available GPU hardware on the host system and maps capabilities
 * to recommended model/provider tiers. Inspired by DreamServer's hardware
 * auto-detection, adapted for DuckHive's TypeScript codebase.
 *
 * Detection strategy:
 *   - Windows: nvidia-smi, wmic, PowerShell Get-CimInstance
 *   - Linux: nvidia-smi, lspci, /sys/class/drm, rocminfo
 *   - macOS: system_profiler (Apple Silicon / Metal)
 *
 * GPU Tier → Model recommendation:
 *   - TIER_4 (>=24GB VRAM): Large local models (DeepSeek V3, Qwen 72B, Llama 3.3 70B)
 *   - TIER_3 (>=12GB VRAM): Mid-size local models (Qwen 32B, Llama 3.3 8B-13B)
 *   - TIER_2 (>=6GB VRAM): Small local models (Phi-4, Gemma 2, CodeGemma)
 *   - TIER_1 (>=2GB VRAM): Tiny local models (Qwen2.5-Coder 1.5B, TinyLlama)
 *   - TIER_0 (CPU only): Cloud-only providers recommended
 */

import { spawnSync } from 'node:child_process'
import { platform } from 'node:os'

// ─── Tier definitions ──────────────────────────────────────────────────────

export type GpuTier = 0 | 1 | 2 | 3 | 4

export interface GpuInfo {
  name: string
  vendor: 'nvidia' | 'amd' | 'intel' | 'apple' | 'unknown'
  vramMB: number
  computeCapability?: string
  isIntegrated: boolean
}

export interface HardwareProfile {
  tier: GpuTier
  gpus: GpuInfo[]
  totalVRAMMB: number
  platform: NodeJS.Platform
  /** Recommended provider type based on available hardware */
  recommendedProvider: 'local' | 'cloud' | 'hybrid'
  /** Recommended local model ID if hardware supports it */
  recommendedLocalModel?: string
  /** Minimum cost-tier provider to use from cloud when local isn't viable */
  recommendedCloudTier: 'budget' | 'standard' | 'premium'
}

// ─── Tier thresholds (VRAM MB) ─────────────────────────────────────────────

const TIER_4_VRAM_MB = 24576 // 24 GB
const TIER_3_VRAM_MB = 12288 // 12 GB
const TIER_2_VRAM_MB = 6144  // 6 GB
const TIER_1_VRAM_MB = 2048  // 2 GB

// ─── Recommended models by tier ────────────────────────────────────────────

const TIER_MODELS: Record<GpuTier, string[]> = {
  4: ['qwen2.5:72b', 'deepseek-r1:70b', 'llama3.3:70b', 'mixtral:8x22b'],
  3: ['qwen2.5:32b', 'llama3.3:13b', 'deepseek-coder-v2:16b', 'codestral:22b'],
  2: ['qwen2.5-coder:7b', 'llama3.3:8b', 'phi-4:14b', 'gemma2:9b', 'deepseek-coder:6.7b'],
  1: ['qwen2.5-coder:3b', 'phi-4-mini:3.8b', 'tinyllama:1.1b', 'deepseek-coder:1.3b'],
  0: [], // No local model recommended
}

// ─── VRAM required per model (oversimplified heuristic: params * 1.2 bytes
//     for 4-bit quantized, plus 20% KV-cache overhead) ─────────────────────

function estimateVramForModel(modelId: string): number {
  const lower = modelId.toLowerCase()
  // Parameter estimates extracted from model family + size hints
  if (/72b|70b|8x22b/i.test(lower)) return 45000
  if (/32b|33b|22b/i.test(lower)) return 22000
  if (/16b|20b/i.test(lower)) return 12000
  if (/13b|14b/i.test(lower)) return 10000
  if (/8b|9b|7b|6\.7b/i.test(lower)) return 6000
  if (/3b|3\.8b|4b/i.test(lower)) return 3000
  if (/1\.5b|1\.1b|1b/i.test(lower)) return 1500
  // Unknown — assume small
  return 4000
}

// ─── NVIDIA detection (Windows + Linux) ────────────────────────────────────

function parseNvidiaSmiOutput(stdout: string): GpuInfo[] {
  const gpus: GpuInfo[] = []
  const lines = stdout.split('\n').map(l => l.trim())

  // nvidia-smi --query-gpu=name,memory.total,compute_cap --format=csv,noheader
  for (const line of lines) {
    if (!line) continue
    const parts = line.split(',').map(p => p.trim())
    if (parts.length < 2) continue

    const name = parts[0] ?? 'NVIDIA GPU'
    const vramStr = (parts[1] ?? '0').replace(/[^0-9]/g, '')
    const vramMB = parseInt(vramStr, 10) || 0
    const computeCap = parts[2]

    gpus.push({
      name,
      vendor: 'nvidia',
      vramMB,
      computeCapability: computeCap || undefined,
      isIntegrated: name.toLowerCase().includes('mx') || vramMB <= 2048,
    })
  }
  return gpus
}

function detectNvidiaGpus(): GpuInfo[] {
  // Try query mode first (more reliable parsing)
  const queryResult = spawnSync('nvidia-smi', [
    '--query-gpu=name,memory.total,compute_cap',
    '--format=csv,noheader',
  ], {
    encoding: 'utf8',
    timeout: 5000,
  })

  if (queryResult.status === 0 && queryResult.stdout?.trim()) {
    return parseNvidiaSmiOutput(queryResult.stdout)
  }

  // Fallback: standard nvidia-smi
  const smiResult = spawnSync('nvidia-smi', [], {
    encoding: 'utf8',
    timeout: 5000,
  })

  if (smiResult.status !== 0 || !smiResult.stdout) return []

  const output = smiResult.stdout
  const gpus: GpuInfo[] = []

  // Parse lines like "|   0  NVIDIA GeForce RTX 4090        Off |"
  const nameRegex = /\|\s+\d+\s+([^|]+?)\s+(?:On|Off)\s+\|/g
  // Parse lines like "|    0   N/A  N/A      1111Mi   /  24564Mi |"
  const vramRegex = /(\d+)MiB?\s+\/\s+(\d+)MiB?/g

  let nameMatch
  const names: string[] = []
  while ((nameMatch = nameRegex.exec(output)) !== null) {
    names.push(nameMatch[1]?.trim() ?? 'NVIDIA GPU')
  }

  let vramMatch
  const vrams: number[] = []
  while ((vramMatch = vramRegex.exec(output)) !== null) {
    const total = parseInt(vramMatch[2] ?? '0', 10)
    vrams.push(total)
  }

  for (let i = 0; i < Math.max(names.length, vrams.length); i++) {
    gpus.push({
      name: names[i] ?? 'NVIDIA GPU',
      vendor: 'nvidia',
      vramMB: vrams[i] ?? 0,
      isIntegrated: (names[i] ?? '').toLowerCase().includes('mx'),
    })
  }

  return gpus
}

// ─── AMD detection (Windows + Linux) ───────────────────────────────────────

function detectAmdGpus(): GpuInfo[] {
  const gpus: GpuInfo[] = []

  if (platform() === 'win32') {
    // Windows: use wmic to detect AMD GPUs
    const wmicResult = spawnSync('wmic', [
      'path', 'win32_videocontroller',
      'get', 'name,AdapterRAM',
      '/format:csv',
    ], {
      encoding: 'utf8',
      timeout: 5000,
    })

    if (wmicResult.status === 0 && wmicResult.stdout) {
      const lines = wmicResult.stdout.split('\n').slice(1) // Skip header
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        // CSV: Node,Name,AdapterRAM
        const parts = trimmed.split(',').map(p => p.trim())
        const name = parts[1] ?? ''
        if (!name.toLowerCase().includes('radeon') && !name.toLowerCase().includes('amd')) continue
        const ramBytes = parseInt(parts[2] ?? '0', 10)
        gpus.push({
          name,
          vendor: 'amd',
          vramMB: Math.round(ramBytes / (1024 * 1024)),
          isIntegrated: name.toLowerCase().includes('integrated'),
        })
      }
    }

    // Also try PowerShell for more detail
    const psResult = spawnSync('powershell', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_VideoController | Where-Object { $_.Name -like "*AMD*" -or $_.Name -like "*Radeon*" } | Select-Object Name, AdapterRAM | ConvertTo-Json -Compress',
    ], {
      encoding: 'utf8',
      timeout: 5000,
    })

    if (psResult.status === 0 && psResult.stdout) {
      try {
        const data = JSON.parse(psResult.stdout)
        const items = Array.isArray(data) ? data : [data]
        for (const item of items) {
          const name = item.Name || 'AMD GPU'
          const ramBytes = parseInt(item.AdapterRAM ?? '0', 10)
          // Avoid duplicates with wmic result
          if (!gpus.some(g => g.name === name)) {
            gpus.push({
              name,
              vendor: 'amd',
              vramMB: Math.round(ramBytes / (1024 * 1024)),
              isIntegrated: name.toLowerCase().includes('integrated'),
            })
          }
        }
      } catch {
        // Fall through
      }
    }
  } else {
    // Linux: use lspci + rocminfo
    const lspciResult = spawnSync('lspci', [], {
      encoding: 'utf8',
      timeout: 5000,
    })

    if (lspciResult.status === 0 && lspciResult.stdout) {
      const amdLines = lspciResult.stdout
        .split('\n')
        .filter(l => /vga|3d|display/i.test(l) && /amd|ati|radeon/i.test(l))

      for (const line of amdLines) {
        // Try rocminfo for VRAM
        const rocmResult = spawnSync('rocminfo', [], {
          encoding: 'utf8',
          timeout: 3000,
        })
        let vramMB = 0
        if (rocmResult.status === 0 && rocmResult.stdout) {
          const vramMatch = rocmResult.stdout.match(/VRAM.*?(\d+)\s*MB/i)
          if (vramMatch) vramMB = parseInt(vramMatch[1]!, 10)
        }

        gpus.push({
          name: line.split(':').pop()?.trim() ?? 'AMD GPU',
          vendor: 'amd',
          vramMB,
          isIntegrated: line.toLowerCase().includes('integrated'),
        })
      }
    }
  }

  return gpus
}

// ─── Intel detection (Windows + Linux) ─────────────────────────────────────

function detectIntelGpus(): GpuInfo[] {
  const gpus: GpuInfo[] = []

  if (platform() === 'win32') {
    const psResult = spawnSync('powershell', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_VideoController | Where-Object { $_.Name -like "*Intel*" -or $_.Name -like "*Arc*" -or $_.Name -like "*UHD*" -or $_.Name -like "*Iris*" } | Select-Object Name, AdapterRAM | ConvertTo-Json -Compress',
    ], {
      encoding: 'utf8',
      timeout: 5000,
    })

    if (psResult.status === 0 && psResult.stdout) {
      try {
        const data = JSON.parse(psResult.stdout)
        const items = Array.isArray(data) ? data : [data]
        for (const item of items) {
          const name = item.Name || 'Intel GPU'
          const ramBytes = parseInt(item.AdapterRAM ?? '0', 10)
          gpus.push({
            name,
            vendor: 'intel',
            vramMB: name.toLowerCase().includes('arc')
              ? Math.max(Math.round(ramBytes / (1024 * 1024)), 4096) // Arc GPUs have dedicated VRAM
              : 0, // Integrated = shared system memory
            isIntegrated: !name.toLowerCase().includes('arc'),
          })
        }
      } catch {
        // Fall through
      }
    }
  } else {
    // Linux: /sys/class/drm + lspci
    const lspciResult = spawnSync('lspci', [], {
      encoding: 'utf8',
      timeout: 5000,
    })

    if (lspciResult.status === 0 && lspciResult.stdout) {
      const intelLines = lspciResult.stdout
        .split('\n')
        .filter(l => /vga|3d|display/i.test(l) && /intel/i.test(l))

      for (const line of intelLines) {
        const isArc = /arc/i.test(line)
        gpus.push({
          name: line.split(':').pop()?.trim() ?? 'Intel GPU',
          vendor: 'intel',
          vramMB: isArc ? 8192 : 0, // Default Arc A770 has 8GB; integrated = shared
          isIntegrated: !isArc,
        })
      }
    }
  }

  return gpus
}

// ─── Apple Silicon / macOS detection ────────────────────────────────────────

function detectAppleGpus(): GpuInfo[] {
  if (platform() !== 'darwin') return []

  const result = spawnSync('system_profiler', [
    'SPDisplaysDataType',
    '-json',
  ], {
    encoding: 'utf8',
    timeout: 5000,
  })

  if (result.status !== 0 || !result.stdout) return []

  try {
    const data = JSON.parse(result.stdout)
    const displays = data?.SPDisplaysDataType ?? []

    return displays.map((d: { spdisplays_ndrvs?: Array<{ _name?: string; spdisplays_vram?: string }> }) => {
      const gpu = d?.spdisplays_ndrvs?.[0]
      const name = gpu?._name ?? 'Apple GPU'
      const vramStr = gpu?.spdisplays_vram ?? '0'
      const vramMatch = vramStr.match(/(\d+)\s*(GB|MB)/i)
      let vramMB = 0
      if (vramMatch) {
        const value = parseInt(vramMatch[1]!, 10)
        vramMB = vramMatch[2]!.toUpperCase() === 'GB' ? value * 1024 : value
      }

      // Apple Silicon uses unified memory — the figure from system_profiler
      // typically reports what's allocated to the GPU, not total available.
      // For real-world model loading we should look at total system RAM later.
      return {
        name,
        vendor: 'apple' as const,
        vramMB,
        isIntegrated: true, // Unified memory architecture
      }
    })
  } catch {
    return []
  }
}

// ─── System RAM detection (important for Apple Silicon unified memory) ─────

function detectSystemRAMMB(): number {
  if (platform() === 'win32') {
    const result = spawnSync('wmic', [
      'computersystem',
      'get', 'totalphysicalmemory',
      '/format:value',
    ], {
      encoding: 'utf8',
      timeout: 3000,
    })
    if (result.status === 0 && result.stdout) {
      const match = result.stdout.match(/TotalPhysicalMemory=(\d+)/)
      if (match) {
        return Math.round(parseInt(match[1]!, 10) / (1024 * 1024))
      }
    }
  } else if (platform() === 'linux') {
    const result = spawnSync('free', ['-b'], {
      encoding: 'utf8',
      timeout: 3000,
    })
    if (result.status === 0 && result.stdout) {
      const memLine = result.stdout.split('\n')[1]
      if (memLine) {
        const parts = memLine.split(/\s+/)
        const total = parseInt(parts[1] ?? '0', 10)
        if (total > 0) return Math.round(total / (1024 * 1024))
      }
    }
  } else if (platform() === 'darwin') {
    const result = spawnSync('sysctl', ['hw.memsize'], {
      encoding: 'utf8',
      timeout: 3000,
    })
    if (result.status === 0 && result.stdout) {
      const match = result.stdout.match(/hw\.memsize:\s*(\d+)/)
      if (match) {
        return Math.round(parseInt(match[1]!, 10) / (1024 * 1024))
      }
    }
  }
  return 0
}

// ─── Tier classification ───────────────────────────────────────────────────

function classifyTier(totalVRAMMB: number, hasDedicatedGpu: boolean): GpuTier {
  if (totalVRAMMB >= TIER_4_VRAM_MB) return 4
  if (totalVRAMMB >= TIER_3_VRAM_MB) return 3
  if (totalVRAMMB >= TIER_2_VRAM_MB) return 2
  if (totalVRAMMB >= TIER_1_VRAM_MB && hasDedicatedGpu) return 1
  return 0
}

function pickRecommendedModel(tier: GpuTier, totalVRAMMB: number): string | undefined {
  const candidates = TIER_MODELS[tier]
  if (!candidates || candidates.length === 0) return undefined

  // Pick the largest model that fits in available VRAM
  for (const model of candidates) {
    if (estimateVramForModel(model) <= totalVRAMMB * 0.85) {
      return model
    }
  }

  // If none fit perfectly, return the smallest one from the next tier down
  const lowerCandidates = TIER_MODELS[(Math.max(0, tier - 1)) as GpuTier]
  if (lowerCandidates && lowerCandidates.length > 0) {
    return lowerCandidates[lowerCandidates.length - 1]
  }

  return undefined
}

// ─── Public API ─────────────────────────────────────────────────────────────

let cachedProfile: HardwareProfile | null = null

/**
 * Detect available GPU hardware and produce a tiered profile.
 * Results are cached after the first call; use `refreshHardwareProfile()`
 * to force a re-detection.
 */
export function detectHardware(): HardwareProfile {
  if (cachedProfile) return cachedProfile

  const pf = platform()
  const gpus: GpuInfo[] = []
  const systemRAMMB = detectSystemRAMMB()

  // Detect GPUs by vendor (stop after first vendor with results for speed,
  // but collect all for comprehensive profiling)
  gpus.push(...detectNvidiaGpus())
  gpus.push(...detectAmdGpus())
  gpus.push(...detectIntelGpus())

  // Apple Silicon: GPU VRAM is a subset of unified memory — use system RAM
  // as a more accurate measure of what's available for model loading.
  if (pf === 'darwin') {
    const appleGpus = detectAppleGpus()
    if (appleGpus.length > 0 && systemRAMMB > 0) {
      // Replace VRAM with system RAM figure for Apple Silicon
      for (const gpu of appleGpus) {
        gpu.vramMB = systemRAMMB // Unified memory — all system RAM is available
      }
      gpus.push(...appleGpus)
    }
  }

  // Deduplicate by name
  const seen = new Set<string>()
  const uniqueGpus = gpus.filter(g => {
    const key = `${g.vendor}:${g.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // For Intel integrated GPUs that share system memory, use system RAM as VRAM proxy
  for (const gpu of uniqueGpus) {
    if (gpu.isIntegrated && gpu.vendor !== 'apple' && gpu.vramMB === 0 && systemRAMMB > 0) {
      // Assume ~50% of system RAM is available for GPU (conservative)
      gpu.vramMB = Math.round(systemRAMMB * 0.5)
    }
  }

  const totalVRAMMB = uniqueGpus.reduce((sum, g) => sum + g.vramMB, 0)
  const hasDedicatedGpu = uniqueGpus.some(g => !g.isIntegrated)
  const tier = classifyTier(totalVRAMMB, hasDedicatedGpu)
  const recommendedLocalModel = pickRecommendedModel(tier, totalVRAMMB)

  // Provider recommendation based on tier
  let recommendedProvider: 'local' | 'cloud' | 'hybrid'
  let recommendedCloudTier: 'budget' | 'standard' | 'premium'

  if (tier >= 3) {
    recommendedProvider = 'local'
    recommendedCloudTier = 'budget'
  } else if (tier >= 1) {
    recommendedProvider = 'hybrid'
    recommendedCloudTier = 'standard'
  } else {
    recommendedProvider = 'cloud'
    recommendedCloudTier = 'premium'
  }

  cachedProfile = {
    tier,
    gpus: uniqueGpus,
    totalVRAMMB,
    platform: pf,
    recommendedProvider,
    recommendedLocalModel,
    recommendedCloudTier,
  }

  return cachedProfile
}

/**
 * Force a re-detection of hardware. Clears the cached profile.
 */
export function refreshHardwareProfile(): HardwareProfile {
  cachedProfile = null
  return detectHardware()
}

/**
 * Returns true if a local LLM is viable given detected hardware.
 */
export function isLocalModelViable(): boolean {
  return detectHardware().tier >= 1
}

/**
 * Returns the best Ollama model to pull for available hardware, or undefined
 * if no local model is recommended.
 */
export function getRecommendedOllamaModel(): string | undefined {
  return detectHardware().recommendedLocalModel
}

/**
 * Returns a human-readable summary of detected hardware.
 */
export function getHardwareSummary(): string {
  const profile = detectHardware()
  if (profile.gpus.length === 0) {
    return `No dedicated GPU detected. ${profile.platform} platform, CPU-only. Tier: 0 — cloud providers recommended.`
  }

  const gpuList = profile.gpus
    .map(g => `${g.name} (${g.vendor}${g.isIntegrated ? ', integrated' : ''}, ${g.vramMB}MB)`)
    .join('; ')

  const modelSuggestion = profile.recommendedLocalModel
    ? ` Recommended local model: ${profile.recommendedLocalModel}.`
    : ''

  return `GPU(s): ${gpuList} | Total VRAM: ${profile.totalVRAMMB}MB | Tier: ${profile.tier} | Provider: ${profile.recommendedProvider}.${modelSuggestion}`
}

/**
 * Map hardware tier to recommended provider IDs for budget-aware routing.
 * Lower tiers should prefer cheaper cloud providers.
 */
export function getHardwareAwareProviderPreference(): {
  preferLocal: boolean
  preferredProviders: string[]
} {
  const profile = detectHardware()

  if (profile.tier >= 3) {
    return {
      preferLocal: true,
      preferredProviders: ['ollama', 'lmstudio', 'atomic-chat', 'groq', 'deepseek', 'minimax'],
    }
  }

  if (profile.tier >= 1) {
    return {
      preferLocal: true,
      preferredProviders: ['ollama', 'lmstudio', 'groq', 'deepseek', 'minimax', 'openrouter'],
    }
  }

  return {
    preferLocal: false,
    preferredProviders: ['groq', 'deepseek', 'minimax', 'openrouter', 'gemini', 'mistral'],
  }
}
