import type { EngineInterface, Register } from 'claude-code'

const LIMIT = 2
const STARTS = [
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview)\b/,
  /\b(next|astro|nuxt|remix|wrangler)\s+dev\b/,
  /\bvite\b(?!\s+build)/,
  /\bpython3?\s+-m\s+http\.server\b/,
  /\b(uvicorn|flask\s+run|rails\s+s(erver)?)\b/,
]
const SERVER_PROCESSES = /^(node|bun|deno|python\S*|Python|ruby|php|workerd)$/

type Server = { cwd: string; ports: string[] }

// Listening dev processes, grouped by the folder they run in, so one server
// that opens several ports (wrangler's node + workerd) counts once.
async function runningServers($: EngineInterface): Promise<Server[]> {
  const { stdout } = await $.process.run(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-Fcpn'], { timeoutMs: 5000 })
  const ports = new Map<string, string[]>()
  let pid = ''
  let isServer = false
  for (const line of stdout.split('\n')) {
    if (line.startsWith('p')) pid = line.slice(1)
    else if (line.startsWith('c')) isServer = SERVER_PROCESSES.test(line.slice(1))
    else if (line.startsWith('n') && isServer) ports.set(pid, [...(ports.get(pid) ?? []), line.slice(1).replace(/^.*:/, '')])
  }

  const byCwd = new Map<string, string[]>()
  for (const [id, list] of ports) {
    const { stdout: out } = await $.process.run(['lsof', '-a', '-p', id, '-d', 'cwd', '-Fn'], { timeoutMs: 5000 })
    const cwd = out.split('\n').find(l => l.startsWith('n'))?.slice(1) ?? `pid ${id}`
    byCwd.set(cwd, [...new Set([...(byCwd.get(cwd) ?? []), ...list])])
  }

  return [...byCwd].map(([cwd, list]) => ({ cwd, ports: list }))
}

function describe(servers: Server[]): string {
  return servers.map(s => `${s.cwd.split('/').pop()} (port ${s.ports.join(', ')})`).join('; ')
}

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    const input = e as { tool: string; command?: string; name?: string; run_in_background?: boolean }
    const isStart =
      (input.tool === 'Bash' && STARTS.some(re => re.test(input.command ?? ''))) ||
      (input.tool.endsWith('preview_start') && typeof input.name === 'string')

    if (!isStart) {
      return next(e)
    }

    const servers = await runningServers($)
    if (servers.length >= LIMIT) {
      $.ui.toast(`Blocked a dev server: ${servers.length} already running`)
      return {
        deny:
          `Dev server limit: ${servers.length} dev servers are already running (${describe(servers)}). ` +
          `The limit is ${LIMIT}. Reuse one of them, or stop one you started before starting another.`,
      }
    }

    return next(e)
  }).catch(($, e, next) => next(e)) // if the check itself fails, let the server start
}
