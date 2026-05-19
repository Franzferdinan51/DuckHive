// @ts-nocheck
/**
 * DuckHive Task Planner
 *
 * Decomposes user tasks into ordered execution steps using either:
 * - SimplePlanner: heuristic keyword-based decomposition (no LLM)
 * - LLMPlanner: model-powered task decomposition
 */

import { analyzeTask, type TaskAnalysis } from '../orchestrator/hybrid/task-complexity.js'
import { selectModel, type RouteResult } from '../orchestrator/hybrid/model-router.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlanStepType = 'local_bash' | 'local_agent' | 'remote_agent' | 'in_process_teammate' | 'local_workflow' | 'monitor_mcp' | 'dream'

export interface PlanStep {
  id: string
  description: string
  taskType: PlanStepType
  dependsOn: string[]   // step IDs this step waits for
  estimatedComplexity: number  // 1-10 per step
  activeForm?: string   // present-continuous for spinners
  notes?: string
}

export interface Plan {
  steps: PlanStep[]
  estimatedComplexity: number  // overall 1-10
  suggestedModel: string
  planningStrategy: 'simple' | 'llm'
  timestamp: number
  taskAnalysis?: TaskAnalysis
}

export interface PlannerOptions {
  /** Force planner type even when both are available */
  forceStrategy?: 'simple' | 'llm'
  /** Model to use for LLMPlanner (defaults to MiniMax M2.7) */
  model?: string
  /** Maximum steps to generate (safety cap) */
  maxSteps?: number
}

// ---------------------------------------------------------------------------
// Keyword patterns for SimplePlanner
// ---------------------------------------------------------------------------

const STEP_PATTERNS: Array<{ keywords: string[]; taskType: PlanStepType; activeForms: string[] }> = [
  {
    keywords: ['build', 'implement', 'create', 'write', 'add', 'make'],
    taskType: 'local_agent',
    activeForms: ['Building', 'Implementing', 'Creating', 'Adding', 'Making'],
  },
  {
    keywords: ['test', 'verify', 'check', 'validate', 'ensure'],
    taskType: 'local_bash',
    activeForms: ['Testing', 'Verifying', 'Checking', 'Validating'],
  },
  {
    keywords: ['deploy', 'release', 'publish', 'ship', 'push to'],
    taskType: 'local_bash',
    activeForms: ['Deploying', 'Releasing', 'Publishing', 'Shipping'],
  },
  {
    keywords: ['research', 'investigate', 'explore', 'find', 'search', 'look up'],
    taskType: 'local_agent',
    activeForms: ['Researching', 'Investigating', 'Exploring', 'Finding', 'Searching'],
  },
  {
    keywords: ['fix', 'debug', 'repair', 'resolve', 'solve'],
    taskType: 'local_agent',
    activeForms: ['Fixing', 'Debugging', 'Repairing', 'Resolving'],
  },
  {
    keywords: ['review', 'refactor', 'optimize', 'improve', 'cleanup', 'clean'],
    taskType: 'local_agent',
    activeForms: ['Reviewing', 'Refactoring', 'Optimizing', 'Improving', 'Cleaning'],
  },
  {
    keywords: ['setup', 'configure', 'install', 'init', 'prepare', 'bootstrap'],
    taskType: 'local_bash',
    activeForms: ['Setting up', 'Configuring', 'Installing', 'Initializing', 'Preparing'],
  },
  {
    keywords: ['document', 'docs', 'readme', 'comment', 'explain'],
    taskType: 'local_agent',
    activeForms: ['Documenting', 'Writing docs', 'Commenting'],
  },
  {
    keywords: ['migrate', 'convert', 'transform', 'update schema'],
    taskType: 'local_agent',
    activeForms: ['Migrating', 'Converting', 'Transforming'],
  },
  {
    keywords: ['monitor', 'watch', 'observe', 'track'],
    taskType: 'monitor_mcp',
    activeForms: ['Monitoring', 'Watching', 'Observing', 'Tracking'],
  },
]

// ---------------------------------------------------------------------------
// SimplePlanner — heuristic keyword-based decomposition
// ---------------------------------------------------------------------------

export class SimplePlanner {
  private maxSteps: number

  constructor(maxSteps = 20) {
    this.maxSteps = maxSteps
  }

  /**
   * Decompose a task string into ordered steps using keyword heuristics.
   * Returns steps in approximate execution order.
   */
  plan(task: string): Plan {
    const taskLower = task.toLowerCase()
    const steps: PlanStep[] = []
    const seen = new Set<string>()
    let stepIndex = 0

    const addStep = (pattern: typeof STEP_PATTERNS[number], baseDescription: string, override?: Partial<PlanStep>) => {
      if (seen.has(baseDescription)) return
      seen.add(baseDescription)

      const dependsOn: string[] = []

      // Setup usually goes first
      if (pattern.keywords.some(k => taskLower.includes('setup') || taskLower.includes('configure') || taskLower.includes('install'))) {
        // no deps
      }

      // Research always before build
      if (pattern.taskType === 'local_agent' && (baseDescription.toLowerCase().includes('build') || baseDescription.toLowerCase().includes('implement'))) {
        const researchStep = steps.find(s => s.description.toLowerCase().includes('research'))
        if (researchStep) dependsOn.push(researchStep.id)
      }

      // Test always after build
      if (pattern.taskType === 'local_bash' && baseDescription.toLowerCase().includes('test')) {
        const buildStep = steps.find(s => s.description.toLowerCase().includes('build') || s.description.toLowerCase().includes('implement'))
        if (buildStep) dependsOn.push(buildStep.id)
      }

      steps.push({
        id: `s${++stepIndex}`,
        description: baseDescription,
        taskType: pattern.taskType,
        dependsOn,
        estimatedComplexity: this.estimateStepComplexity(baseDescription),
        activeForm: pattern.activeForms[0],
        ...override,
      })
    }

    // First, try to split the task into logical sub-tasks if separators exist
    const subTasks = task.split(/\b(?:then|and then|followed by|after that|after which)\b/i)
      .map(s => s.trim())
      .filter(s => s.length > 0)

    // Match patterns for each sub-task
    for (const subTask of subTasks) {
      const subTaskLower = subTask.toLowerCase()
      let matched = false

      for (const pattern of STEP_PATTERNS) {
        for (const keyword of pattern.keywords) {
          if (subTaskLower.includes(keyword)) {
            addStep(pattern, subTask)
            matched = true
            break
          }
        }
        if (matched) break
      }

      // If a sub-task didn't match any pattern, add it as a generic agent step
      if (!matched && subTasks.length > 1) {
        addStep({
          keywords: [],
          taskType: 'local_agent',
          activeForms: ['Processing'],
        }, subTask)
      }
    }

    // Fallback: if nothing matched or split, treat whole task as one step using original matching
    if (steps.length === 0) {
      for (const pattern of STEP_PATTERNS) {
        for (const keyword of pattern.keywords) {
          if (taskLower.includes(keyword)) {
            const regex = new RegExp(`(.{0,40}${keyword}.{0,60})`, 'i')
            const match = task.match(regex)
            const description = match ? match[1].trim() : keyword
            addStep(pattern, description)
            break
          }
        }
      }
    }

    // Double Fallback: treat whole task as one step
    if (steps.length === 0) {
      steps.push({
        id: 's1',
        description: task,
        taskType: 'local_agent',
        dependsOn: [],
        estimatedComplexity: 5,
        activeForm: 'Processing',
      })
    }

    // Cap at maxSteps
    const cappedSteps = steps.slice(0, this.maxSteps)

    // Estimate overall complexity from steps
    const avgComplexity = cappedSteps.length > 0
      ? cappedSteps.reduce((sum, s) => sum + s.estimatedComplexity, 0) / cappedSteps.length
      : 5

    const overallComplexity = Math.min(10, Math.max(1, Math.round(avgComplexity + (cappedSteps.length > 5 ? 1 : 0))))

    return {
      steps: cappedSteps,
      estimatedComplexity: overallComplexity,
      suggestedModel: selectModel(task, overallComplexity).model,
      planningStrategy: 'simple',
      timestamp: Date.now(),
    }
  }

  private estimateStepComplexity(description: string): number {
    const lower = description.toLowerCase()
    if (/build|implement|create|add/i.test(lower)) return 6
    if (/test|verify|check/i.test(lower)) return 4
    if (/research|investigate|explore/i.test(lower)) return 5
    if (/fix|debug|repair/i.test(lower)) return 7  // fixes are often underestimated
    if (/review|refactor|optimize/i.test(lower)) return 7
    if (/deploy|publish|ship/i.test(lower)) return 6
    if (/setup|configure|install/i.test(lower)) return 4
    if (/document|docs/i.test(lower)) return 3
    if (/migrate|convert/i.test(lower)) return 7
    return 5
  }
}

// ---------------------------------------------------------------------------
// LLMPlanner — model-powered decomposition
// ---------------------------------------------------------------------------

export interface LLMPlannerConfig {
  model?: string
  temperature?: number
  maxTokens?: number
}

export class LLMPlanner {
  private model: string
  private temperature: number
  private maxTokens: number

  constructor(config: LLMPlannerConfig = {}) {
    this.model = config.model ?? 'minimax-portal/MiniMax-M2.7'
    this.temperature = config.temperature ?? 0.3
    this.maxTokens = config.maxTokens ?? 4096
  }

  /**
   * Decompose a task using an LLM.
   * Returns a Plan with ordered steps generated by the model.
   *
   * Note: This requires an API call to the configured model provider.
   * The caller is responsible for setting up the model client.
   */
  async plan(
    task: string,
    llmClient: {
      complete: (prompt: string, model: string, temperature: number, maxTokens: number) => Promise<string>
    },
    maxSteps = 20,
  ): Promise<Plan> {
    const prompt = this.buildDecompositionPrompt(task, maxSteps)

    const raw = await llmClient.complete(prompt, this.model, this.temperature, this.maxTokens)

    return this.parsePlan(raw, task, maxSteps)
  }

  private buildDecompositionPrompt(task: string, maxSteps: number): string {
    return `You are a task planner. Decompose the following user request into ordered execution steps.

Task: "${task}"

Rules:
- Break the task into 2-${maxSteps} distinct steps
- Each step should be actionable and have a clear output
- Steps must be in execution order (dependencies first)
- Use these task types: local_bash, local_agent, remote_agent, in_process_teammate, local_workflow, monitor_mcp, dream
- Estimate complexity 1-10 for each step (harder tasks = higher)
- Identify which steps depend on other steps completing first

Output format — return ONLY valid JSON (no markdown, no explanation):
{
  "steps": [
    {
      "description": "Clear action-oriented description of the step",
      "taskType": "local_agent",
      "estimatedComplexity": 6,
      "dependsOn": [],
      "activeForm": "Verb-ing form for spinner"
    }
  ],
  "summary": "One sentence summary of the entire plan"
}

Example:
Task: "Build a REST API for user authentication"
{
  "steps": [
    {"description": "Research auth patterns (JWT, OAuth2)", "taskType": "local_agent", "estimatedComplexity": 4, "dependsOn": [], "activeForm": "Researching auth patterns"},
    {"description": "Design API schema and endpoints", "taskType": "local_agent", "estimatedComplexity": 5, "dependsOn": ["s1"], "activeForm": "Designing API schema"},
    {"description": "Implement auth endpoints", "taskType": "local_agent", "estimatedComplexity": 7, "dependsOn": ["s2"], "activeForm": "Implementing auth endpoints"},
    {"description": "Write tests for auth endpoints", "taskType": "local_bash", "estimatedComplexity": 5, "dependsOn": ["s3"], "activeForm": "Writing auth tests"},
    {"description": "Deploy to staging", "taskType": "local_bash", "estimatedComplexity": 6, "dependsOn": ["s4"], "activeForm": "Deploying to staging"}
  ],
  "summary": "Build a complete user authentication REST API"
}

Return valid JSON only:`
  }

  private parsePlan(raw: string, originalTask: string, maxSteps: number): Plan {
    try {
      // Try to extract JSON from the response
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        // Fall back to simple planner
        return new SimplePlanner(maxSteps).plan(originalTask)
      }

      const parsed = JSON.parse(jsonMatch[0])
      const stepsRaw: unknown[] = parsed.steps ?? []
      const steps: PlanStep[] = []

      let stepIndex = 0
      for (const s of stepsRaw.slice(0, maxSteps)) {
        if (!s || typeof s !== 'object') continue
        const step = s as Record<string, unknown>
        const id = `s${++stepIndex}`
        const dependsOn: string[] = (step.dependsOn as string[] | undefined) ?? []
        // Remap dependsOn from names to IDs if needed
        const remappedDeps = remapDependencies(dependsOn, stepsRaw, stepIndex - 1)

        steps.push({
          id,
          description: String(step.description ?? `Step ${stepIndex}`),
          taskType: normalizeTaskType(String(step.taskType ?? 'local_agent')),
          dependsOn: remappedDeps,
          estimatedComplexity: normalizeComplexity(Number(step.estimatedComplexity ?? 5)),
          activeForm: String(step.activeForm ?? step.description ?? ''),
        })
      }

      if (steps.length === 0) {
        return new SimplePlanner(maxSteps).plan(originalTask)
      }

      const complexity = Math.min(10, Math.max(1, Math.round(
        steps.reduce((sum, s) => sum + s.estimatedComplexity, 0) / steps.length
      )))

      return {
        steps,
        estimatedComplexity: complexity,
        suggestedModel: selectModel(originalTask, complexity).model,
        planningStrategy: 'llm',
        timestamp: Date.now(),
      }
    } catch {
      return new SimplePlanner(maxSteps).plan(originalTask)
    }
  }
}

// ---------------------------------------------------------------------------
// TaskPlanner — facade that delegates to Simple or LLM planner
// ---------------------------------------------------------------------------

export class TaskPlanner {
  private simplePlanner: SimplePlanner
  private llmPlanner: LLMPlanner
  private forceStrategy?: 'simple' | 'llm'

  constructor(options: PlannerOptions = {}) {
    this.simplePlanner = new SimplePlanner(options.maxSteps)
    this.llmPlanner = new LLMPlanner({ model: options.model })
    this.forceStrategy = options.forceStrategy
  }

  /**
   * Create a plan for a task string.
   * Automatically chooses between Simple and LLM planning based on complexity.
   *
   * @param task - The user's task description
   * @param llmClient - Optional LLM client for LLM-based planning
   *                   If omitted, uses SimplePlanner
   */
  async createPlan(
    task: string,
    llmClient?: {
      complete: (prompt: string, model: string, temperature: number, maxTokens: number) => Promise<string>
    },
  ): Promise<Plan> {
    // First analyze the task
    const analysis = analyzeTask(task, { message: task, history: [], tools: [], timestamp: Date.now() })

    // Decide strategy
    let strategy: 'simple' | 'llm'

    if (this.forceStrategy) {
      strategy = this.forceStrategy
    } else if (analysis.category === 'critical' || analysis.category === 'complex' || analysis.complexity >= 7) {
      // Complex tasks benefit from LLM planning
      strategy = 'llm'
    } else {
      // Simple tasks use heuristic planner
      strategy = 'simple'
    }

    let plan: Plan

    if (strategy === 'llm' && llmClient) {
      plan = await this.llmPlanner.plan(task, llmClient)
    } else {
      plan = this.simplePlanner.plan(task)
    }

    // Attach analysis
    plan.taskAnalysis = analysis

    return plan
  }

  /**
   * Sync version — always uses SimplePlanner
   */
  createSimplePlan(task: string): Plan {
    const analysis = analyzeTask(task, { message: task, history: [], tools: [], timestamp: Date.now() })
    const plan = this.simplePlanner.plan(task)
    plan.taskAnalysis = analysis
    return plan
  }

  /**
   * Async version — uses LLMPlanner when available
   */
  async createLLMPlan(
    task: string,
    llmClient: {
      complete: (prompt: string, model: string, temperature: number, maxTokens: number) => Promise<string>
    },
  ): Promise<Plan> {
    const analysis = analyzeTask(task, { message: task, history: [], tools: [], timestamp: Date.now() })
    const plan = await this.llmPlanner.plan(task, llmClient)
    plan.taskAnalysis = analysis
    return plan
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function normalizeTaskType(t: string): PlanStepType {
  const map: Record<string, PlanStepType> = {
    local_bash: 'local_bash',
    local_agent: 'local_agent',
    remote_agent: 'remote_agent',
    in_process_teammate: 'in_process_teammate',
    local_workflow: 'local_workflow',
    monitor_mcp: 'monitor_mcp',
    dream: 'dream',
  }
  return map[t] ?? 'local_agent'
}

function normalizeComplexity(n: number): number {
  if (isNaN(n) || n < 1) return 5
  if (n > 10) return 10
  return Math.round(n)
}

/**
 * Remap dependency references from step labels/descriptions to step IDs.
 * This handles cases where LLM returns step names like "research" instead of "s1".
 */
function remapDependencies(
  deps: string[],
  allSteps: unknown[],
  currentIndex: number,
): string[] {
  if (!deps || deps.length === 0) return []

  const remapped: string[] = []
  for (const dep of deps) {
    const depStr = String(dep).toLowerCase().trim()

    // Already an ID like "s1"
    if (/^s\d+$/.test(depStr)) {
      remapped.push(depStr)
      continue
    }

    // Match by description
    for (let i = 0; i < currentIndex; i++) {
      const step = allSteps[i] as Record<string, unknown> | undefined
      if (!step) continue
      const desc = String(step.description ?? '').toLowerCase()
      if (desc.includes(depStr) || depStr.includes(desc)) {
        remapped.push(`s${i + 1}`)
        break
      }
    }
  }

  return [...new Set(remapped)]  // deduplicate
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export type { Plan, PlanStep, PlannerOptions, LLMPlannerConfig }