import type { Register } from 'claude-code'

// Only turns long enough that you may have looked away.
const MIN_MS = 60_000
// macOS's own Glass sound, read from the system so the mod ships no audio file.
const SOUND = '/System/Library/Sounds/Glass.aiff'

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (!e.agentId && !e.isAborted && e.durationMs >= MIN_MS) {
      void $.fs
        .read(SOUND, { as: 'bytes' })
        .then(({ base64 }) => $.audio.play({ base64, mime: 'audio/aiff' }))
        .catch(() => undefined)
    }

    return result
  })
}
