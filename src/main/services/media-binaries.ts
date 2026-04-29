import { existsSync } from 'fs'
import { join } from 'path'

let resolvedFfmpegBinary: string | null = null
let resolvedFfprobeBinary: string | null = null

export function resetResolvedMediaBinaryCache(): void {
  resolvedFfmpegBinary = null
  resolvedFfprobeBinary = null
}

function resolveBinary(binaryName: 'ffmpeg' | 'ffprobe'): string {
  const pathEntries = (process.env.PATH ?? '')
    .split(':')
    .filter(Boolean)

  const candidates = [
    binaryName,
    ...pathEntries.map((entry) => join(entry, binaryName)),
    `/opt/homebrew/bin/${binaryName}`,
    `/usr/local/bin/${binaryName}`,
    `/usr/bin/${binaryName}`
  ]

  for (const candidate of candidates) {
    if (candidate === binaryName) continue
    if (existsSync(candidate)) return candidate
  }

  return binaryName
}

export function resolveFfmpegBinary(): string {
  if (!resolvedFfmpegBinary) {
    resolvedFfmpegBinary = resolveBinary('ffmpeg')
  }
  return resolvedFfmpegBinary
}

export function resolveFfprobeBinary(): string {
  if (!resolvedFfprobeBinary) {
    resolvedFfprobeBinary = resolveBinary('ffprobe')
  }
  return resolvedFfprobeBinary
}
