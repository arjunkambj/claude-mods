export type Shot = {
  path: string
  // A small preview as an SVG document, or null when it could not be made.
  svg: string | null
  width: number
  height: number
}

declare module 'claude-code' {
  interface PluginState {
    imagegen: { shots: Record<string, Shot[]> }
  }
}
