import type { Register } from 'claude-code'

const CODEX_TOOL = /^mcp__codex__codex$/
const CODEX_MODEL = 'gpt-6.1-sol'
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
// The codex tool runs only inside this background agent, so a long Codex run never blocks the main chat.
const RUNNER = 'codex:runner'
const RUNNER_PROMPT =
  'You pass one task to Codex and bring back its answer. Call the codex tool exactly once with the task you were ' +
  'given, word for word, as `task`. If the task names an effort level or says Codex may edit files, set `effort` or ' +
  '`canEdit` to match. Then reply with Codex\'s answer exactly as it came back: add nothing, cut nothing.'

type CodexInput = {
  task: string
  description?: string
  effort?: (typeof EFFORTS)[number]
  canEdit?: boolean
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.tool.register({
      name: 'codex',
      description:
        `Only works inside the ${RUNNER} agent: from the main chat, spawn that agent with the Agent tool instead. ` +
        `Hands a task to Codex (OpenAI's ${CODEX_MODEL}) running as a separate agent in this project, and returns its final answer. ` +
        'Codex is great at code review and bug finding: use it for a second opinion on a diff, a hunt for bugs in a ' +
        'file or feature, or checking a fix. Give it a self-contained task (it does not see this conversation): what to ' +
        'look at, what to check, and how to report. Effort defaults to xhigh, which suits reviews; use max for the ' +
        'hardest bugs and lower levels for quick checks. It runs read-only unless canEdit is true.',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'The full, self-contained instructions for Codex.' },
          description: { type: 'string', description: 'A 3-5 word label for the task.' },
          effort: { type: 'string', enum: EFFORTS, description: 'Reasoning effort; default xhigh.' },
          canEdit: { type: 'boolean', description: 'Let Codex edit files in the project; default false.' },
        },
        required: ['task'],
      },
      isDeferred: false,
    })
    await $.agent.register({
      name: 'runner',
      description:
        `Runs a task on Codex (OpenAI's ${CODEX_MODEL}) in the background and returns its answer; use this, never the ` +
        'codex tool directly. Great for code review, bug hunts and checking a fix. The prompt is the whole task for ' +
        'Codex (it does not see this conversation): what to look at, what to check, how to report. Add "effort: max" ' +
        'for the hardest bugs or a lower level for quick checks (default xhigh), and "canEdit: true" to let it edit files.',
      prompt: RUNNER_PROMPT,
      tools: ['mcp__codex__codex'],
      model: 'haiku',
      effort: 'low',
      background: true,
      omitClaudeMd: true,
    })
    return started
  })

  on('tool.call', { tool: CODEX_TOOL }, async ($, e, next) => {
    if (e.agentId === undefined) {
      return { deny: `Run Codex through the Agent tool with subagent_type "${RUNNER}" so it runs in the background.` }
    }
    const input = e as unknown as CodexInput
    const effort = input.effort ?? 'xhigh'

    const it = $.process
      .spawn({
        argv: [
          'codex', 'exec',
          '-m', CODEX_MODEL,
          '-c', `model_reasoning_effort="${effort}"`,
          '-s', input.canEdit ? 'workspace-write' : 'read-only',
          '--skip-git-repo-check', '--color', 'never',
          input.task,
        ],
      })
      [Symbol.asyncIterator]()
    let answer = ''
    let errors = ''
    for (;;) {
      if (next.signal.aborted) {
        await it.return?.(undefined as never)
        return { result: 'Codex run stopped.' }
      }
      const step = await it.next()
      if (step.done) {
        if (step.value.code !== 0) {
          return { result: `Codex failed (exit ${step.value.code ?? step.value.signal}).\n${errors.slice(-4000)}` }
        }
        break
      }
      if (step.value.stream === 'stdout') answer += step.value.text
      else errors += step.value.text
    }

    return { result: answer.trim() || 'Codex finished without an answer.' }
  })
}
