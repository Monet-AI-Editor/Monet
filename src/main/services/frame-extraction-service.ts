import { mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ExtractedFrame, MediaAssetRecord } from '../../shared/editor.js'
import { resolveFfmpegBinary } from './media-binaries'

const execFileAsync = promisify(execFile)
const MAX_FRAMES = 16

function sanitizeBaseName(value: string): string {
  return value.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset'
}

function buildSampleTimes(duration: number, count: number): number[] {
  if (duration <= 0) return [0]
  if (count <= 1) return [0]
  const step = duration / count
  return Array.from({ length: count }, (_, index) => Math.min(duration, index * step))
}

export class FrameExtractionService {
  async extractFrames(
    asset: MediaAssetRecord,
    options: { count?: number; outputDir?: string } = {}
  ): Promise<ExtractedFrame[]> {
    if (asset.type !== 'video') return []

    const count = Math.max(1, Math.min(MAX_FRAMES, Math.floor(options.count ?? 6)))
    const sampleTimes = buildSampleTimes(asset.duration, count)
    const outputDir = options.outputDir ?? join(tmpdir(), 'ai-video-editor-frames', asset.id)
    await mkdir(outputDir, { recursive: true })

    const baseName = sanitizeBaseName(basename(asset.name).replace(/\.[^.]+$/, ''))
    const frames: ExtractedFrame[] = []

    for (let index = 0; index < sampleTimes.length; index += 1) {
      const time = sampleTimes[index]
      const framePath = join(outputDir, `${baseName}-${index + 1}.jpg`)
      await execFileAsync(resolveFfmpegBinary(), [
        '-y',
        '-ss', `${time}`,
        '-i', asset.path,
        '-frames:v', '1',
        '-vf', "scale='min(1280,iw)':-2",
        framePath
      ], { maxBuffer: 20 * 1024 * 1024 })
      frames.push({ time, path: framePath })
    }

    return frames
  }

  async createContactSheet(
    asset: MediaAssetRecord,
    options: { count?: number; outputDir?: string } = {}
  ): Promise<{ path: string; frames: ExtractedFrame[] }> {
    const frames = await this.extractFrames(asset, options)
    if (frames.length === 0) {
      throw new Error('No frames available for this asset.')
    }

    const outputDir = options.outputDir ?? join(tmpdir(), 'ai-video-editor-frames', asset.id)
    const contactSheetPath = join(outputDir, `${sanitizeBaseName(asset.name)}-contact-sheet.jpg`)
    const columns = Math.min(4, frames.length)
    const rows = Math.ceil(frames.length / columns)
    const cellWidth = 320
    const cellHeight = 180
    const inputs = frames.flatMap((frame) => ['-i', frame.path])
    const frameFilters = frames.map(
      (_frame, index) =>
        `[${index}:v]scale=${cellWidth}:${cellHeight}:force_original_aspect_ratio=decrease,pad=${cellWidth}:${cellHeight}:(ow-iw)/2:(oh-ih)/2:color=0x111111,setsar=1[p${index}]`
    )
    const layout = frames
      .map((_frame, index) => `${(index % columns) * cellWidth}_${Math.floor(index / columns) * cellHeight}`)
      .join('|')
    const stackInputs = frames.map((_frame, index) => `[p${index}]`).join('')
    const filterComplex = `${frameFilters.join(';')};${stackInputs}xstack=inputs=${frames.length}:layout=${layout}:fill=0x111111[sheet]`

    await execFileAsync(
      resolveFfmpegBinary(),
      [
        '-y',
        ...inputs,
        '-filter_complex',
        filterComplex,
        '-map',
        '[sheet]',
        '-frames:v',
        '1',
        contactSheetPath
      ],
      { maxBuffer: 20 * 1024 * 1024 }
    )

    return { path: contactSheetPath, frames }
  }
}
