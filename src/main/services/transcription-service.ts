import { createReadStream, existsSync } from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import { dirname, join } from 'path'
import { execFile, execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'
import { app } from 'electron'
import OpenAI from 'openai'
import type { TranscriptSegment } from '../../shared/editor.js'
import { resolveFfmpegBinary } from './media-binaries.js'

const SERVICE_DIR = dirname(fileURLToPath(import.meta.url))
const CWD_ROOT = process.cwd()
function resolveAppRoot(): string {
  if (existsSync(join(CWD_ROOT, 'package.json'))) return CWD_ROOT
  try {
    const electronAppPath = app.getAppPath()
    if (electronAppPath) return electronAppPath
  } catch {
    // app not ready yet
  }
  for (let depth = 1; depth <= 5; depth++) {
    const candidate = join(SERVICE_DIR, ...Array(depth).fill('..'))
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return join(SERVICE_DIR, '..', '..', '..')
}
const APP_ROOT = resolveAppRoot()
const LOCAL_VENV_PYTHON_DEV = join(APP_ROOT, '.python-runtime', 'bin', 'python')
function getUserDataVenvPython(): string {
  try {
    return join(app.getPath('userData'), 'python-runtime', 'bin', 'python')
  } catch {
    return ''
  }
}

const PYTHON_SYSTEM_CANDIDATES = [
  '/opt/homebrew/bin/python3',
  '/usr/local/bin/python3',
  '/usr/bin/python3'
]

function resolveSystemPython3(): string | null {
  for (const candidate of PYTHON_SYSTEM_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  // Fallback: rely on PATH (only works if env was inherited correctly)
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' })
    return 'python3'
  } catch {
    return null
  }
}
const LOCAL_TRANSCRIBE_SCRIPT = join(APP_ROOT, 'scripts', 'local_transcribe.py').replace(
  '/app.asar/',
  '/app.asar.unpacked/'
)

type LocalTranscriptionResult = {
  language?: string | null
  duration?: number | null
  segments: Array<{
    id?: string
    start: number
    end: number
    text: string
    speaker?: string
    confidence?: number
  }>
}

export class TranscriptionService {
  private openai: OpenAI | null = null

  setApiKey(apiKey: string): void {
    this.openai = new OpenAI({ apiKey })
  }

  isLocalAvailable(): boolean {
    if (!existsSync(LOCAL_TRANSCRIBE_SCRIPT)) return false
    const python = this.resolvePythonBinary()
    if (!python) return false

    try {
      execFileSync(python, ['-c', 'import faster_whisper'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }

  async transcribeAudio(filePath: string, language?: string): Promise<TranscriptSegment[]> {
    if (this.isLocalAvailable()) {
      return this.transcribeLocally(filePath, language)
    }

    if (this.openai) {
      return this.transcribeWithOpenAI(filePath, language)
    }

    throw new Error(
      'No transcription backend available. Install the local runtime with `npm run setup:local-transcription` or add an OpenAI API key.'
    )
  }

  async transcribeWithDiarization(filePath: string, language?: string): Promise<TranscriptSegment[]> {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured for diarized transcription.')
    }

    const response = await this.openai.audio.transcriptions.create({
      file: createReadStream(filePath),
      model: 'gpt-4o-transcribe-diarize',
      language: language || undefined
    })

    if ('segments' in response && Array.isArray(response.segments)) {
      return response.segments.map((segment, index) => ({
        id: `seg_${index}_${Date.now()}`,
        start: segment.start,
        end: segment.end,
        text: segment.text.trim(),
        speaker: 'speaker' in segment && typeof segment.speaker === 'string' ? segment.speaker : undefined
      }))
    }

    return []
  }

  isConfigured(): boolean {
    return this.isLocalAvailable() || this.openai !== null
  }

  private resolvePythonBinary(): string | null {
    const userDataPython = getUserDataVenvPython()
    if (userDataPython && existsSync(userDataPython)) return userDataPython
    if (existsSync(LOCAL_VENV_PYTHON_DEV)) return LOCAL_VENV_PYTHON_DEV
    return resolveSystemPython3()
  }

  async ensureLocalRuntime(
    onProgress?: (line: string) => void
  ): Promise<{ ok: boolean; pythonPath?: string; error?: string }> {
    if (this.isLocalAvailable()) {
      return { ok: true, pythonPath: this.resolvePythonBinary() ?? undefined }
    }

    let venvDir: string
    try {
      venvDir = join(app.getPath('userData'), 'python-runtime')
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    const pythonBin = join(venvDir, 'bin', 'python')

    const runStreaming = (cmd: string, args: string[]): Promise<void> =>
      new Promise((resolve, reject) => {
        const child = execFile(cmd, args, { maxBuffer: 1024 * 1024 * 64 }, (error, _stdout, stderr) => {
          if (error) {
            reject(new Error(stderr?.trim() || error.message))
            return
          }
          resolve()
        })
        child.stdout?.on('data', (chunk) => onProgress?.(chunk.toString()))
        child.stderr?.on('data', (chunk) => onProgress?.(chunk.toString()))
      })

    try {
      if (!existsSync(pythonBin)) {
        const systemPython = resolveSystemPython3()
        if (!systemPython) {
          return {
            ok: false,
            error: 'python3 not found on this system. Install Python 3 (e.g. from python.org) and restart Monet, or add an OpenAI API key in Settings.'
          }
        }
        onProgress?.(`Creating venv at ${venvDir} using ${systemPython}\n`)
        await runStreaming(systemPython, ['-m', 'venv', venvDir])
      }
      onProgress?.('Upgrading pip\n')
      await runStreaming(pythonBin, ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel'])
      onProgress?.('Installing faster-whisper\n')
      await runStreaming(pythonBin, ['-m', 'pip', 'install', 'faster-whisper'])
      return { ok: true, pythonPath: pythonBin }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async transcribeLocally(filePath: string, language?: string): Promise<TranscriptSegment[]> {
    const python = this.resolvePythonBinary()
    if (!python) {
      throw new Error('Python runtime not available for local transcription.')
    }

    const tempDir = await mkdtemp(join(tmpdir(), 'ai-video-editor-stt-'))
    const extractedAudioPath = join(tempDir, 'transcription-input.wav')

    try {
      await this.extractAudioForLocalTranscription(filePath, extractedAudioPath)

      const args = [LOCAL_TRANSCRIBE_SCRIPT, extractedAudioPath]
      if (language) args.push(language)

      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(
          python,
          args,
          {
            cwd: APP_ROOT,
            env: {
              ...process.env,
              AI_VIDEO_EDITOR_LOCAL_STT_MODEL: process.env.AI_VIDEO_EDITOR_LOCAL_STT_MODEL || 'tiny',
              AI_VIDEO_EDITOR_LOCAL_STT_DEVICE: process.env.AI_VIDEO_EDITOR_LOCAL_STT_DEVICE || 'cpu',
              AI_VIDEO_EDITOR_LOCAL_STT_COMPUTE: process.env.AI_VIDEO_EDITOR_LOCAL_STT_COMPUTE || 'int8'
            },
            maxBuffer: 1024 * 1024 * 16
          },
          (error, localStdout, stderr) => {
            if (error) {
              reject(new Error(stderr?.trim() || error.message))
              return
            }
            resolve(localStdout)
          }
        )
      })

      const parsed = JSON.parse(stdout) as LocalTranscriptionResult
      return parsed.segments
        .filter((segment) => segment.text.trim().length > 0)
        .map((segment, index) => ({
          id: segment.id || `local_${index}_${Date.now()}`,
          start: segment.start,
          end: segment.end,
          text: segment.text.trim(),
          speaker: segment.speaker,
          confidence: segment.confidence
        }))
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async extractAudioForLocalTranscription(inputPath: string, outputPath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      execFile(
        resolveFfmpegBinary(),
        [
          '-y',
          '-i', inputPath,
          '-vn',
          '-ac', '1',
          '-ar', '16000',
          '-c:a', 'pcm_s16le',
          outputPath
        ],
        {
          cwd: APP_ROOT,
          maxBuffer: 1024 * 1024 * 16
        },
        (error, _stdout, stderr) => {
          if (error) {
            reject(new Error(stderr?.trim() || `Failed to extract audio from ${inputPath}`))
            return
          }
          resolve()
        }
      )
    })
  }

  private async transcribeWithOpenAI(filePath: string, language?: string): Promise<TranscriptSegment[]> {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured. Set it in settings.')
    }

    try {
      const response = await this.openai.audio.transcriptions.create({
        file: createReadStream(filePath),
        model: 'gpt-4o-mini-transcribe',
        language: language || undefined,
        response_format: 'verbose_json',
        timestamp_granularities: ['segment']
      })

      if ('segments' in response && Array.isArray(response.segments)) {
        return response.segments.map((segment, index) => ({
          id: `seg_${index}_${Date.now()}`,
          start: segment.start,
          end: segment.end,
          text: segment.text.trim(),
          confidence: segment.avg_logprob ? Math.exp(segment.avg_logprob) : undefined
        }))
      }

      if ('text' in response && typeof response.text === 'string') {
        return [
          {
            id: `seg_0_${Date.now()}`,
            start: 0,
            end: 0,
            text: response.text.trim()
          }
        ]
      }

      return []
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Cloud transcription failed: ${error.message}`)
      }
      throw new Error('Cloud transcription failed with unknown error')
    }
  }
}
