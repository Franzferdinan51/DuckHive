// @ts-nocheck
/**
 * DuckHive DesktopControl Tool
 * Wraps desktop-control-lobster-edition-skill via Python subprocess.
 *
 * Provides: mouse, keyboard, screenshot, OCR, window management, app control.
 */
import { z } from 'zod/v4'
import { buildTool, type Tool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { resolve } from 'path'
import { spawn } from 'child_process'

const TOOL_NAME = 'desktop_control'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum([
        // ─── Screen ───────────────────────────────────────────────
        'screenshot',
        'get_screen_size',
        'get_pixel_color',
        'get_monitor_info',
        // ─── Mouse ───────────────────────────────────────────────
        'move_mouse',
        'get_mouse_position',
        'click',
        'double_click',
        'right_click',
        'drag',
        'scroll',
        // ─── Keyboard ─────────────────────────────────────────────
        'type_text',
        'press',
        'hotkey',
        // ─── Windows ─────────────────────────────────────────────
        'get_all_windows',
        'get_active_window',
        'window_exists',
        'activate_window',
        // ─── Vision / OCR ─────────────────────────────────────────
        'ocr_text_from_region',
        'find_text_on_screen',
        'find_on_screen_retry',
        'wait_for_image',
        // ─── Clipboard ─────────────────────────────────────────────
        'copy_to_clipboard',
        'get_from_clipboard',
        // ─── Apps / Scripts ────────────────────────────────────────
        'open_app',
        'run_applescript',
        'browser_navigate',
        // ─── Workflow ─────────────────────────────────────────────
        'run_task',
        'preview_task',
        'validate_task',
        'workflow_report',
        'save_task',
        'load_task',
        'workflow_guard',
        // ─── State / Evidence ─────────────────────────────────────
        'get_action_log',
        'export_action_log',
        'checkpoint',
        'capture_evidence',
        'annotate_screenshot',
        'compare_screenshots',
        'diff_report',
        'openclaw_summary',
        'export_openclaw_bundle',
        // ─── Policies / Safety ────────────────────────────────────
        'set_policy',
        'is_safe',
        'verify_action',
        // ─── AI Vision Assist ──────────────────────────────────────
        'vision_assist',
        'set_resource_broker',
      ])
      .describe('Desktop control action'),
    // ─── Screen params ───────────────────────────────────────────────────
    region: z
      .array(z.number())
      .min(4).max(4)
      .optional()
      .describe('Region: [x, y, width, height]'),
    filename: z.string().optional().describe('Output filename for screenshots'),
    x: z.number().optional().describe('X coordinate'),
    y: z.number().optional().describe('Y coordinate'),
    duration: z.number().optional().describe('Animation duration in seconds'),
    smooth: z.boolean().optional().describe('Use smooth mouse movement'),
    // ─── Mouse params ────────────────────────────────────────────────────
    button: z.enum(['left', 'right', 'middle']).optional().describe('Mouse button'),
    clicks: z.number().optional().describe('Number of clicks'),
    direction: z.enum(['vertical', 'horizontal', 'up', 'down', 'left', 'right']).optional().describe('Scroll direction'),
    start_x: z.number().optional().describe('Drag start X'),
    start_y: z.number().optional().describe('Drag start Y'),
    end_x: z.number().optional().describe('Drag end X'),
    end_y: z.number().optional().describe('Drag end Y'),
    // ─── Keyboard params ────────────────────────────────────────────────
    text: z.string().optional().describe('Text to type'),
    interval: z.number().optional().describe('Interval between keystrokes'),
    paste: z.boolean().optional().describe('Use clipboard paste instead of typing'),
    wpm: z.number().optional().describe('Words per minute for typing'),
    key: z.string().optional().describe('Key name (e.g., enter, escape, a, f1)'),
    keys: z.array(z.string()).optional().describe('Keys for hotkey (e.g., [cmd, s])'),
    // ─── Vision params ──────────────────────────────────────────────────
    image_path: z.string().optional().describe('Path to reference image for matching'),
    confidence: z.number().optional().describe('Image match confidence (0-1)'),
    timeout: z.number().optional().describe('Timeout in seconds'),
    max_attempts: z.number().optional().describe('Max retry attempts'),
    search_text: z.string().optional().describe('Text to search for on screen'),
    mode: z.enum(['ocr', 'match']).optional().describe('Search mode for text'),
    // ─── Window params ────────────────────────────────────────────────
    window_title: z.string().optional().describe('Window title substring to match'),
    // ─── Clipboard params ──────────────────────────────────────────────
    clipboard_text: z.string().optional().describe('Text to copy to clipboard'),
    // ─── App / Script params ───────────────────────────────────────────
    app_name: z.string().optional().describe('Application name to open'),
    script: z.string().optional().describe('AppleScript code to run'),
    url: z.string().optional().describe('URL for browser_navigate'),
    // ─── Workflow params ───────────────────────────────────────────────
    task: z.record(z.string(), z.unknown()).optional().describe('Task definition object'),
    task_file: z.string().optional().describe('Path to task file'),
    task_name: z.string().optional().describe('Task name for saving'),
    steps: z.array(z.record(z.string(), z.unknown())).optional().describe('Workflow steps'),
    checkpoint_label: z.string().optional().describe('Checkpoint label'),
    checkpoint_note: z.string().optional().describe('Checkpoint note'),
    evidence_prefix: z.string().optional().describe('Evidence capture prefix'),
    annotation_text: z.string().optional().describe('Text annotation for screenshot'),
    before_file: z.string().optional().describe('Before screenshot path'),
    after_file: z.string().optional().describe('After screenshot path'),
    output_json: z.string().optional().describe('Output JSON file path'),
    bundle_prefix: z.string().optional().describe('OpenClaw bundle prefix'),
    // ─── Policy params ─────────────────────────────────────────────────
    approval_actions: z.array(z.string()).optional().describe('Actions requiring approval'),
    approval_apps: z.array(z.string()).optional().describe('Apps requiring approval'),
    approval_windows: z.array(z.string()).optional().describe('Windows requiring approval'),
    success_condition_code: z.string().optional().describe('JavaScript code for verify_action'),
    // ─── Vision assist params ───────────────────────────────────────────
    vision_prompt: z.string().optional().describe('Prompt for vision assist'),
    use_council: z.boolean().optional().describe('Use AI Council for vision assist'),
    vision_endpoint: z.string().optional().describe('Vision endpoint URL'),
    vision_model: z.string().optional().describe('Vision model name'),
    council_endpoint: z.string().optional().describe('AI Council endpoint URL'),
    settle_ms: z.number().optional().describe('Settle milliseconds before typing'),
    retries: z.number().optional().describe('Number of retry attempts'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.string(),
    // Screen
    result: z.unknown().optional(),
    image: z.string().optional().describe('Base64 screenshot or image path'),
    saved: z.boolean().optional(),
    screen_size: z.array(z.number()).min(2).max(2).optional(),
    pixel_color: z.array(z.number()).min(3).max(3).optional(),
    mouse_position: z.array(z.number()).min(2).max(2).optional(),
    // Windows
    windows: z.array(z.string()).optional(),
    active_window: z.string().nullable().optional(),
    window_found: z.boolean().optional(),
    // Text / OCR
    text: z.string().optional(),
    text_found: z.boolean().optional(),
    match_position: z
      .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
      .optional(),
    // Clipboard
    clipboard_content: z.string().nullable().optional(),
    // Workflow
    task_valid: z.boolean().optional(),
    task_preview: z.string().optional(),
    workflow_summary: z.record(z.string(), z.unknown()).optional(),
    task_id: z.string().optional(),
    checkpoint_id: z.string().optional(),
    // Evidence
    evidence_path: z.string().optional(),
    screenshot_path: z.string().optional(),
    diff: z.record(z.string(), z.unknown()).optional(),
    bundle_path: z.string().optional(),
    action_log: z.array(z.record(z.string(), z.unknown())).optional(),
    // Approval
    approval_required: z.boolean().optional().describe('Whether this action needs user approval'),
    action_description: z.string().optional().describe('Human-readable description of the action that needs approval'),
    // Safety
    is_safe: z.boolean().optional(),
    verification_passed: z.boolean().optional(),
    // Vision assist
    vision_result: z.record(z.string(), z.unknown()).optional(),
    // Monitor
    monitors: z.array(z.record(z.string(), z.unknown())).optional(),
    // Generic
    data: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

// ─── Python daemon ─────────────────────────────────────────────────────────────

const DAEMON_SCRIPT = resolve(import.meta.dirname, 'desktop-control-daemon.py')

// Singleton daemon process
let daemonProc: ReturnType<typeof spawn> | null = null
let daemonReady = false
let pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
let requestId = 0
let daemonKillTimer: ReturnType<typeof setTimeout> | null = null

const DAEMON_IDLE_KILL_MS = 5 * 60 * 1000 // 5 minutes — kill daemon after 5 min idle

function resetIdleTimer() {
  if (daemonKillTimer) clearTimeout(daemonKillTimer)
  daemonKillTimer = setTimeout(() => {
    killDaemon()
  }, DAEMON_IDLE_KILL_MS)
}

function killDaemon() {
  if (daemonProc) {
    daemonProc.kill()
    daemonProc = null
    daemonReady = false
  }
  pendingRequests.forEach(({ reject }) => reject(new Error('Daemon killed')))
  pendingRequests.clear()
}

function daemonCall(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    resetIdleTimer()

    // Spawn daemon if not running
    if (!daemonProc) {
      daemonReady = false
      daemonProc = spawn('python3', [DAEMON_SCRIPT], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      })

      daemonProc.stderr?.on('data', (chunk: Buffer) => {
        console.error('[desktop-control daemon stderr]', chunk.toString())
      })

      daemonProc.on('error', (err) => {
        console.error('[desktop-control daemon error]', err)
        killDaemon()
        reject(err)
      })

      daemonProc.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          console.error(`[desktop-control daemon exited with code ${code}]`)
        }
        killDaemon()
      })

      // Parse response lines as they arrive
      let buffer = ''
      daemonProc.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? '' // keep incomplete line in buffer
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const resp = JSON.parse(line)
            const pending = pendingRequests.get(resp.id)
            if (pending) {
              pendingRequests.delete(resp.id)
              if (resp.error) {
                pending.reject(new Error(String(resp.error)))
              } else {
                pending.resolve(resp.result ?? resp)
              }
            }
          } catch (e) {
            console.error('[desktop-control daemon parse error]', line, e)
          }
        }
      })
    }

    const id = ++requestId
    pendingRequests.set(id, { resolve, reject })

    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params })
    daemonProc.stdin?.write(payload + '\n')

    // Timeout after 30 seconds
    const timeout = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        reject(new Error(`DesktopControl timeout after 30s: ${method}`))
      }
    }, 30_000)
    ; pendingRequests.get(id)?.resolve // keep for cleanup
    // Store cleanup fn
    const originalResolve = resolve
    pendingRequests.set(id, {
      resolve: (v) => { clearTimeout(timeout); originalResolve(v) },
      reject: (e) => { clearTimeout(timeout); reject(e) },
    })
  })
}

// ─── Tool definition ───────────────────────────────────────────────────────────

export const DesktopControlTool: Tool<InputSchema, OutputSchema> = buildTool({
  name: TOOL_NAME,
  description() {
    return `DuckHive desktop automation — mouse, keyboard, screenshot, OCR, window management.
Powered by desktop-control-lobster-edition-skill.
Safe actions (no approval): screenshot, get_screen_size, get_pixel_color, get_all_windows,
get_active_window, get_mouse_position, ocr_text_from_region, find_text_on_screen, etc.
Approval-required actions: move_mouse, click, type_text, hotkey, open_app, run_applescript, etc.
Use vision_assist for AI-powered screen analysis with council fallback.`
  },
  async prompt() {
    return `DuckHive desktop control tool — controls the local macOS desktop.
Use for: automating clicks, typing, screenshots, OCR text extraction, window management.
APPROVAL REQUIRED for: move_mouse, click, type_text, hotkey, open_app, run_applescript, etc.
SAFE (no approval): screenshot, get_screen_size, get_pixel_color, get_all_windows,
get_active_window, ocr_text_from_region, find_text_on_screen, get_mouse_position, etc.`
  },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  isConcurrencySafe() { return false }, // daemon is shared
  isReadOnly(input) {
    const readOnlyActions = [
      'screenshot', 'get_screen_size', 'get_pixel_color', 'get_monitor_info',
      'get_mouse_position', 'get_all_windows', 'get_active_window', 'window_exists',
      'get_from_clipboard', 'ocr_text_from_region', 'find_text_on_screen',
      'find_on_screen_retry', 'wait_for_image', 'get_action_log', 'is_safe',
      'validate_task', 'preview_task', 'workflow_report', 'openclaw_summary',
      'set_resource_broker', 'set_policy', 'should_require_approval',
    ]
    return readOnlyActions.includes(input.action)
  },
  mapToolResultToToolResultBlockParam(data, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    }
  },
  async call(input): Promise<Output> {
    const {
      action,
      region,
      filename,
      x,
      y,
      duration,
      smooth,
      button,
      clicks,
      direction,
      start_x,
      start_y,
      end_x,
      end_y,
      text,
      interval,
      paste,
      wpm,
      key,
      keys,
      image_path,
      confidence,
      timeout: timeoutSec,
      max_attempts,
      search_text,
      mode,
      window_title,
      clipboard_text,
      app_name,
      script,
      url,
      task,
      task_file,
      task_name,
      steps,
      checkpoint_label,
      checkpoint_note,
      evidence_prefix,
      annotation_text,
      before_file,
      after_file,
      output_json,
      bundle_prefix,
      approval_actions,
      approval_apps,
      approval_windows,
      success_condition_code,
      vision_prompt,
      use_council,
      vision_endpoint,
      vision_model,
      council_endpoint,
      settle_ms,
      retries,
    } = input

    // Build params object (omit undefined values)
    const params: Record<string, unknown> = {}
    if (region !== undefined) params.region = region
    if (filename !== undefined) params.filename = filename
    if (x !== undefined) params.x = x
    if (y !== undefined) params.y = y
    if (duration !== undefined) params.duration = duration
    if (smooth !== undefined) params.smooth = smooth
    if (button !== undefined) params.button = button
    if (clicks !== undefined) params.clicks = clicks
    if (direction !== undefined) params.direction = direction
    if (start_x !== undefined) params.start_x = start_x
    if (start_y !== undefined) params.start_y = start_y
    if (end_x !== undefined) params.end_x = end_x
    if (end_y !== undefined) params.end_y = end_y
    if (text !== undefined) params.text = text
    if (interval !== undefined) params.interval = interval
    if (paste !== undefined) params.paste = paste
    if (wpm !== undefined) params.wpm = wpm
    if (key !== undefined) params.key = key
    if (keys !== undefined) params.keys = keys
    if (image_path !== undefined) params.image_path = image_path
    if (confidence !== undefined) params.confidence = confidence
    if (timeoutSec !== undefined) params.timeout = timeoutSec
    if (max_attempts !== undefined) params.max_attempts = max_attempts
    if (search_text !== undefined) params.text = search_text
    if (mode !== undefined) params.mode = mode
    if (window_title !== undefined) params.title_substring = window_title
    if (clipboard_text !== undefined) params.text = clipboard_text
    if (app_name !== undefined) params.app_name = app_name
    if (script !== undefined) params.script = script
    if (url !== undefined) params.url = url
    if (task !== undefined) params.task = task
    if (task_file !== undefined) params.filename = task_file
    if (task_name !== undefined) params.filename = task_name
    if (steps !== undefined) params.steps = steps
    if (checkpoint_label !== undefined) params.label = checkpoint_label
    if (checkpoint_note !== undefined) params.note = checkpoint_note
    if (evidence_prefix !== undefined) params.prefix = evidence_prefix
    if (annotation_text !== undefined) params.text = annotation_text
    if (before_file !== undefined) params.before = before_file
    if (after_file !== undefined) params.after = after_file
    if (output_json !== undefined) params.output_json = output_json
    if (bundle_prefix !== undefined) params.prefix = bundle_prefix
    if (approval_actions !== undefined) params.approval_actions = approval_actions
    if (approval_apps !== undefined) params.approval_apps = approval_apps
    if (approval_windows !== undefined) params.approval_windows = approval_windows
    if (success_condition_code !== undefined) params.success_condition = new Function(success_condition_code)
    if (vision_prompt !== undefined) params.prompt = vision_prompt
    if (use_council !== undefined) params.use_council = use_council
    if (vision_endpoint !== undefined) params.vision_endpoint = vision_endpoint
    if (vision_model !== undefined) params.vision_model = vision_model
    if (council_endpoint !== undefined) params.council_endpoint = council_endpoint
    if (settle_ms !== undefined) params.settle_ms = settle_ms
    if (retries !== undefined) params.retries = retries

    try {
      const result = (await daemonCall(action, params)) as Record<string, unknown>

      // Handle approval-required responses
      if (result && typeof result === 'object' && '_approval_required' in result) {
        return {
          success: false,
          action,
          approval_required: true,
          action_description: result._action_description as string,
          error: `Action '${action}' requires user approval. Configure policy with set_policy or approve via desktop UI.`,
        }
      }

      // Normalize result fields to output schema
      const out: Output = { success: true, action, data: result as Record<string, unknown> }

      if (result?.screen_size) out.screen_size = result.screen_size as [number, number]
      if (result?.pixel_color) out.pixel_color = result.pixel_color as [number, number, number]
      if (result?.mouse_position) out.mouse_position = result.mouse_position as [number, number]
      if (result?.windows) out.windows = result.windows as string[]
      if (result?.active_window) out.active_window = result.active_window as string
      if (result?.window_found !== undefined) out.window_found = result.window_found as boolean
      if (result?.text !== undefined) out.text = result.text as string
      if (result?.text_found !== undefined) out.text_found = result.text_found as boolean
      if (result?.match_position) out.match_position = result.match_position as { x: number; y: number; width: number; height: number }
      if (result?.image) out.image = result.image as string
      if (result?.saved !== undefined) out.saved = result.saved as boolean
      if (result?.clipboard_content) out.clipboard_content = result.clipboard_content as string | null
      if (result?.monitors) out.monitors = result.monitors as Record<string, unknown>[]
      if (result?.task_valid !== undefined) out.task_valid = result.task_valid as boolean
      if (result?.task_preview) out.task_preview = result.task_preview as string
      if (result?.workflow_summary) out.workflow_summary = result.workflow_summary as Record<string, unknown>
      if (result?.task_id) out.task_id = result.task_id as string
      if (result?.checkpoint_id) out.checkpoint_id = result.checkpoint_id as string
      if (result?.evidence_path) out.evidence_path = result.evidence_path as string
      if (result?.screenshot_path) out.screenshot_path = result.screenshot_path as string
      if (result?.diff) out.diff = result.diff as Record<string, unknown>
      if (result?.bundle_path) out.bundle_path = result.bundle_path as string
      if (result?.action_log) out.action_log = result.action_log as Record<string, unknown>[]
      if (result?.is_safe !== undefined) out.is_safe = result.is_safe as boolean
      if (result?.verification_passed !== undefined) out.verification_passed = result.verification_passed as boolean
      if (result?.vision_result) out.vision_result = result.vision_result as Record<string, unknown>

      return out
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      return { success: false, action, error }
    }
  },
})
