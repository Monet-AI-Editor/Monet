import { createHash } from 'crypto'
import { mkdir, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export class PreviewProxyService {
  private readonly inFlight = new Map<string, Promise<string>>()

  constructor(private readonly cacheDir: string) {}

  async getPreviewPath(filePath: string): Promise<string> {
    const cacheKey = await this.buildCacheKey(filePath)
    const targetPath = join(this.cacheDir, `${cacheKey}.mp4`)
    if (existsSync(targetPath)) return targetPath

    const existing = this.inFlight.get(cacheKey)
    if (existing) return existing

    const task = this.generatePreview(filePath, targetPath)
      .then(() => targetPath)
      .catch((error) => {
        console.warn(`[PreviewProxy] Falling back to original media for ${filePath}:`, error)
        return filePath
      })
      .finally(() => {
        this.inFlight.delete(cacheKey)
      })

    this.inFlight.set(cacheKey, task)
    return task
  }

  private async buildCacheKey(filePath: string): Promise<string> {
    const info = await stat(filePath)
    return createHash('sha1')
      .update(filePath)
      .update(String(info.size))
      .update(String(info.mtimeMs))
      .digest('hex')
  }

  private async generatePreview(filePath: string, targetPath: string): Promise<void> {
    await mkdir(dirname(targetPath), { recursive: true })

    await execFileAsync('ffmpeg', [
      '-y',
      '-i', filePath,
      '-map', '0:v:0',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-vf', 'scale=1280:-2:flags=lanczos',
      '-c:a', 'aac',
      '-b:a', '128k',
      targetPath
    ])
  }
}
