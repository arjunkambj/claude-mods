import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Shot } from '../types'

const TOOL = /^mcp__imagegen__image$/
const SCRIPT = 'skills/imagegen/scripts/codex_image.sh'
const PREVIEW_PX = 480
const SVG_LIMIT = 131072

const shots = atom({ plugin: 'imagegen', key: 'shots' } as const, {})

type ImageInput = {
  spec: string
  output?: string
  outputDir?: string
  inputs?: string[]
  count?: number
  overwrite?: boolean
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.tool.register({
      name: 'image',
      description:
        "Generates or edits raster images through Codex's built-in image tool (the user's Codex subscription, no API key). " +
        'Write the spec as the imagegen skill describes, then call this instead of running codex_image.sh. Each image takes ' +
        'about a minute; the finished images are shown to the user in the chat. Returns one saved path per line: open each ' +
        'with Read and check it before reporting success. Never overwrite an existing asset unless the user asked for it.',
      inputSchema: {
        type: 'object',
        properties: {
          spec: { type: 'string', description: 'The full image spec, passed verbatim to the image tool.' },
          output: { type: 'string', description: 'Destination file. With count > 1, -1, -2 … are added before the extension.' },
          outputDir: { type: 'string', description: 'Destination directory instead of output (files named image_1.png …).' },
          inputs: {
            type: 'array',
            items: { type: 'string' },
            description: 'Input images on disk (edit target or references, in order). The spec must say each one’s role by index.',
          },
          count: { type: 'integer', minimum: 1, maximum: 8, description: 'Variants of the same spec; default 1.' },
          overwrite: { type: 'boolean', description: 'Replace existing destination files; default false.' },
        },
        required: ['spec'],
      },
      isDeferred: false,
    })
    return started
  })

  on('tool.call', { tool: TOOL }, async ($, e, next) => {
    const input = e as unknown as ImageInput
    const count = input.count ?? 1

    const argv = [`${$.plugin.root}/${SCRIPT}`, '-p', input.spec, '-n', String(count)]
    for (const image of input.inputs ?? []) argv.push('-i', image)
    if (input.output) argv.push('-o', input.output)
    else if (input.outputDir) argv.push('-d', input.outputDir)
    if (input.overwrite) argv.push('--force')

    $.ui.status(count === 1 ? 'Making an image…' : `Making ${count} images…`)
    try {
      const it = $.process.spawn({ argv })[Symbol.asyncIterator]()
      let out = ''
      let errors = ''
      for (;;) {
        if (next.signal.aborted) {
          await it.return?.(undefined as never)
          return { result: 'Image run stopped.' }
        }
        const step = await it.next()
        if (step.done) {
          if (step.value.code !== 0) {
            $.ui.toast('Image failed')
            return { result: `Image run failed (exit ${step.value.code ?? step.value.signal}).\n${errors.slice(-4000)}` }
          }
          break
        }
        if (step.value.stream === 'stdout') out += step.value.text
        else errors += step.value.text
      }

      const paths = out.split('\n').map(line => line.trim()).filter(Boolean)
      if (paths.length === 0) return { result: `Codex finished without saving an image.\n${errors.slice(-4000)}` }

      const made = await Promise.all(paths.map(path => preview($, path)))
      if (e.tool_use_id) await update($, shots, all => ({ ...all, [e.tool_use_id as string]: made }))

      const done = paths.length === 1 ? `Image ready: ${basename(paths[0] ?? "")}` : `${paths.length} images ready`
      $.ui.toast(done)
      void $.ui.notify(done, { title: 'Images' }).catch(() => undefined)

      return { result: paths.join('\n') }
    } finally {
      $.ui.status(undefined)
    }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `${$.plugin.name}: the image run failed to start.` }))

  // Shows the finished images in the chat, with buttons to open them.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!TOOL.test(e.props.tool) || e.props.isErrored) return next(e)
    const list = (await read($, shots))[e.props.tool_use_id]
    if (!list?.length) return next(e)

    if (e.surface === 'desktop' || e.surface === 'vscode') {
      const { Box, Button, Svg, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {list.map(shot => (
            <Box key={shot.path} flexDirection="column" marginBottom={1}>
              {shot.svg && (
                <Svg source={shot.svg} alt={basename(shot.path)} width={Math.min(shot.width, 360)} />
              )}
              <Box>
                <Text dimColor>{basename(shot.path)} </Text>
                <Button key={`open-${shot.path}`} plain label="Open" onPress={() => openFile($, shot.path)} />
                <Button key={`show-${shot.path}`} plain label="Show in Finder" onPress={() => openFile($, shot.path, true)} />
              </Box>
            </Box>
          ))}
        </Box>
      )
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {list.map(shot => (
          <Box key={shot.path}>
            <Text>{shot.path} </Text>
            <Button key={`open-${shot.path}`} plain label="Open" onPress={() => openFile($, shot.path)} />
          </Box>
        ))}
      </Box>
    )
  })
}

// A small JPEG copy wrapped in an SVG, since the app draws SVG and not PNG files.
async function preview($: EngineInterface, path: string): Promise<Shot> {
  const tmp = (await $.process.run(['mktemp', '-t', 'imagegen'])).stdout.trim()
  const jpg = `${tmp}.jpg`
  try {
    const made = await $.process.run([
      'sips', '-Z', String(PREVIEW_PX), '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', path, '--out', jpg,
    ])
    if (made.exitCode !== 0) return { path, svg: null, width: 0, height: 0 }

    const size = (await $.process.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', jpg])).stdout
    const width = Number(/pixelWidth: (\d+)/.exec(size)?.[1] ?? 0)
    const height = Number(/pixelHeight: (\d+)/.exec(size)?.[1] ?? 0)
    const { base64 } = await $.fs.read(jpg, { as: 'bytes' })

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<image href="data:image/jpeg;base64,${base64}" width="${width}" height="${height}"/></svg>`
    return { path, svg: svg.length <= SVG_LIMIT ? svg : null, width, height }
  } catch {
    return { path, svg: null, width: 0, height: 0 }
  } finally {
    await $.process.run(['rm', '-f', tmp, jpg])
  }
}

async function openFile($: EngineInterface, path: string, reveal = false) {
  await $.process.run(reveal ? ['open', '-R', path] : ['open', path])
}

function basename(path: string): string {
  return path.split('/').pop() ?? path
}
