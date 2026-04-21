import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const MAX_BUFFER_BYTES = 128 * 1024 * 1024
const WAVEFORM_SAMPLE_RATE = 2000

export class WaveformService {
  private readonly cache = new Map<string, Promise<number[]>>()

  getWaveform(filePath: string, sampleCount = 160): Promise<number[]> {
    if (!filePath || filePath === 'undefined') {
      return Promise.resolve([])
    }

    const normalizedSampleCount = Math.max(128, Math.min(16384, Math.floor(sampleCount)))
    const cacheKey = `${filePath}:${normalizedSampleCount}`
    const cached = this.cache.get(cacheKey)
    if (cached) return cached

    const promise = this.generateWaveform(filePath, normalizedSampleCount)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('Output file does not contain any stream')) {
          return []
        }
        console.warn(`[WaveformService] Failed to generate waveform for ${filePath}:`, error)
        return []
      })

    this.cache.set(cacheKey, promise)
    return promise
  }

  private async generateWaveform(filePath: string, sampleCount: number): Promise<number[]> {
    const { stdout } = await execFileAsync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-i',
        filePath,
        '-map',
        '0:a:0?',
        '-ac',
        '1',
        '-ar',
        String(WAVEFORM_SAMPLE_RATE),
        '-f',
        'f32le',
        'pipe:1'
      ],
      {
        encoding: 'buffer',
        maxBuffer: MAX_BUFFER_BYTES
      }
    )

    const output = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
    const sampleLength = Math.floor(output.byteLength / Float32Array.BYTES_PER_ELEMENT)
    if (sampleLength === 0) return []

    const pcm = new Float32Array(output.buffer, output.byteOffset, sampleLength)
    const bucketSize = Math.max(1, Math.floor(pcm.length / sampleCount))
    const peaks: number[] = []

    for (let offset = 0; offset < pcm.length; offset += bucketSize) {
      let peak = 0
      const end = Math.min(offset + bucketSize, pcm.length)
      for (let index = offset; index < end; index += 1) {
        const value = Math.abs(pcm[index] ?? 0)
        if (value > peak) peak = value
      }
      peaks.push(peak)
    }

    const maxPeak = peaks.reduce((max, value) => Math.max(max, value), 0)
    if (maxPeak <= 0) return peaks.map(() => 0)

    return peaks.map((value) => value / maxPeak)
  }
}
