// @ts-nocheck
import { analyzeTask, type TaskAnalysis } from './task-complexity.js'
import { selectModel, type RouteResult } from './model-router.js'

export interface HybridOrchestratorConfig {
  enableCouncil?: boolean
  enableCheckpoint?: boolean
  enableMetrics?: boolean
  councilTimeout?: number
  defaultModel?: string
}

const DEFAULT_CONFIG: HybridOrchestratorConfig = {
  enableCouncil: true,
  enableCheckpoint: true,
  enableMetrics: true,
  councilTimeout: 30000,
  defaultModel: 'minimax-portal/MiniMax-M2.7',
}

export class HybridOrchestrator {
  private config: HybridOrchestratorConfig
  
  constructor(config: Partial<HybridOrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }
  
  /**
   * Analyze a task and determine routing strategy
   */
  analyze(message: string, history: Array<{role: string; content: string}>, tools: string[] = []): TaskRouting {
    const analysis = analyzeTask(message, { message, history, tools, timestamp: Date.now() })
    const routing = selectModel(message, analysis.complexity)
    
    return {
      analysis,
      routing,
      councilVerdict: analysis.needsCouncil ? 'pending' : null,
      checkpointId: analysis.needsCheckpoint ? `auto_${Date.now()}` : null,
      executionPlan: this.buildExecutionPlan(analysis),
    }
  }
  
  /**
   * Build an execution plan from complexity analysis
   */
  private buildExecutionPlan(analysis: TaskAnalysis): string[] {
    const plan: string[] = []
    
    // Always: analyze → route
    plan.push('analyze')
    plan.push('route_model')
    
    // Council for complex/critical
    if (analysis.category === 'critical') {
      plan.push('council_deliberate')
      plan.push('council_approve')
    } else if (analysis.category === 'complex' || analysis.needsCouncil) {
      plan.push('council_deliberate')
    }
    
    // Checkpoint for complex+
    if (analysis.needsCheckpoint) {
      plan.push('checkpoint_save')
    }
    
    // Execute based on complexity
    const stepCount = Math.min(analysis.estimatedSteps, 10)
    for (let i = 0; i < stepCount; i++) {
      plan.push(`execute_step_${i + 1}`)
    }
    
    // Verify for complex+
    if (analysis.category === 'complex' || analysis.category === 'critical') {
      plan.push('verify_result')
    }
    
    // Checkpoint restore on error
    plan.push('handle_errors')
    
    return plan
  }
  
  /**
   * Get execution hint for OpenClaude's internal routing
   */
  getExecutionHint(routing: RouteResult): string {
    return `model=${routing.model} provider=${routing.provider} reason=${routing.reason}`
  }
}

export interface TaskRouting {
  analysis: TaskAnalysis
  routing: RouteResult
  councilVerdict: 'approve' | 'reject' | 'conditional' | 'pending' | null
  checkpointId: string | null
  executionPlan: string[]
}

export const createHybridOrchestrator = (config?: Partial<HybridOrchestratorConfig>) => new HybridOrchestrator(config)
export const getHybridOrchestrator = () => createHybridOrchestrator()
