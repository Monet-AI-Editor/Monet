import { createReadStream } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import OpenAI from 'openai'
import type { ImageGenCompletedEvent, ImageGenPartialImageEvent, ImageEditCompletedEvent, ImageEditPartialImageEvent } from 'openai/resources/images'

export type GeneratedImageSize = '1024x1024' | '1536x1024' | '1024x1536' | 'auto'
export type GeneratedImageQuality = 'low' | 'medium' | 'high' | 'auto'
export type GeneratedImageBackground = 'transparent' | 'opaque' | 'auto'
export type GeneratedImageFormat = 'png' | 'jpeg' | 'webp'
export type GeneratedImageModeration = 'low' | 'auto'
export type GeneratedImageInputFidelity = 'high' | 'low'

export interface GenerateImageParams {
  prompt: string
  outputDir: string
  fileNameBase?: string
  size?: GeneratedImageSize
  quality?: GeneratedImageQuality
  background?: GeneratedImageBackground
  format?: GeneratedImageFormat
  moderation?: GeneratedImageModeration
  outputCompression?: number
  partialImages?: number
}

export interface GeneratedImageResult {
  outputPath: string
  partialImagePaths: string[]
  revisedPrompt?: string
  model: string
  size: GeneratedImageSize
  quality: GeneratedImageQuality
  background: GeneratedImageBackground
  format: GeneratedImageFormat
  moderation: GeneratedImageModeration
  outputCompression?: number
  partialImages: number
}

export interface EditImageParams {
  prompt: string
  inputPaths: string[]
  outputDir: string
  fileNameBase?: string
  size?: GeneratedImageSize
  quality?: GeneratedImageQuality
  background?: GeneratedImageBackground
  format?: GeneratedImageFormat
  outputCompression?: number
  partialImages?: number
  inputFidelity?: GeneratedImageInputFidelity
  maskPath?: string
}

export interface EditedImageResult {
  outputPath: string
  partialImagePaths: string[]
  model: string
  size: GeneratedImageSize
  quality: GeneratedImageQuality
  background: GeneratedImageBackground
  format: GeneratedImageFormat
  outputCompression?: number
  partialImages: number
  inputFidelity?: GeneratedImageInputFidelity
}

function slugifyFileBase(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'generated-image'
}

function buildFileName(base: string, format: GeneratedImageFormat): string {
  const extension = format === 'jpeg' ? 'jpg' : format
  return `${slugifyFileBase(base)}-${Date.now()}.${extension}`
}

function validateOutputSettings(format: GeneratedImageFormat, background: GeneratedImageBackground, outputCompression?: number): void {
  if (background === 'transparent' && format === 'jpeg') {
    throw new Error('transparent background requires png or webp output')
  }

  if (outputCompression != null) {
    if (!Number.isFinite(outputCompression) || outputCompression < 0 || outputCompression > 100) {
      throw new Error('outputCompression must be between 0 and 100')
    }
    if (format !== 'jpeg' && format !== 'webp') {
      throw new Error('outputCompression is only supported for jpeg or webp output')
    }
  }
}

function validatePartialImages(partialImages?: number): number {
  if (partialImages == null) return 0
  if (!Number.isInteger(partialImages) || partialImages < 0 || partialImages > 3) {
    throw new Error('partialImages must be an integer between 0 and 3')
  }
  return partialImages
}

async function writeGeneratedImage(
  outputDir: string,
  fileNameBase: string,
  format: GeneratedImageFormat,
  b64: string,
  suffix?: string
): Promise<string> {
  await mkdir(outputDir, { recursive: true })
  const base = suffix ? `${fileNameBase}-${suffix}` : fileNameBase
  const outputPath = join(outputDir, buildFileName(base, format))
  await writeFile(outputPath, Buffer.from(b64, 'base64'))
  return outputPath
}

export class ImageGenerationService {
  private openai: OpenAI | null = null
  private currentKey = ''
  private readonly model = 'gpt-image-2'

  setApiKey(apiKey: string): void {
    if (apiKey === this.currentKey) return
    this.currentKey = apiKey
    this.openai = apiKey ? new OpenAI({ apiKey }) : null
  }

  get isReady(): boolean {
    return this.openai !== null
  }

  async generateImage(params: GenerateImageParams): Promise<GeneratedImageResult> {
    if (!this.openai) throw new Error('OpenAI API key not configured')

    const prompt = params.prompt.trim()
    if (!prompt) throw new Error('A prompt is required')

    const format = params.format ?? 'png'
    const size = params.size ?? '1024x1024'
    const quality = params.quality ?? 'auto'
    const background = params.background ?? 'auto'
    const moderation = params.moderation ?? 'auto'
    const outputCompression = params.outputCompression
    const partialImages = validatePartialImages(params.partialImages)
    validateOutputSettings(format, background, outputCompression)

    const fileNameBase = params.fileNameBase || prompt
    const partialImagePaths: string[] = []

    if (partialImages > 0) {
      const stream = await this.openai.images.generate({
        model: this.model,
        prompt,
        size,
        quality,
        background,
        moderation,
        output_format: format,
        output_compression: outputCompression,
        partial_images: partialImages,
        stream: true
      })

      let completed: ImageGenCompletedEvent | null = null
      for await (const event of stream) {
        if (event.type === 'image_generation.partial_image') {
          partialImagePaths.push(
            await writeGeneratedImage(
              params.outputDir,
              fileNameBase,
              format,
              (event as ImageGenPartialImageEvent).b64_json,
              `partial-${event.partial_image_index}`
            )
          )
        } else if (event.type === 'image_generation.completed') {
          completed = event as ImageGenCompletedEvent
        }
      }

      if (!completed?.b64_json) throw new Error('Image generation returned no final image data')

      return {
        outputPath: await writeGeneratedImage(params.outputDir, fileNameBase, format, completed.b64_json),
        partialImagePaths,
        model: this.model,
        size,
        quality,
        background,
        format,
        moderation,
        outputCompression,
        partialImages
      }
    }

    const response = await this.openai.images.generate({
      model: this.model,
      prompt,
      size,
      quality,
      background,
      moderation,
      output_format: format,
      output_compression: outputCompression
    })

    const image = response.data?.[0]
    if (!image?.b64_json) throw new Error('Image generation returned no image data')

    return {
      outputPath: await writeGeneratedImage(params.outputDir, fileNameBase, format, image.b64_json),
      partialImagePaths,
      revisedPrompt: image.revised_prompt,
      model: this.model,
      size,
      quality,
      background,
      format,
      moderation,
      outputCompression,
      partialImages
    }
  }

  async editImage(params: EditImageParams): Promise<EditedImageResult> {
    if (!this.openai) throw new Error('OpenAI API key not configured')

    const prompt = params.prompt.trim()
    if (!prompt) throw new Error('A prompt is required')
    if (params.inputPaths.length === 0) throw new Error('At least one input image is required')

    const format = params.format ?? 'png'
    const size = params.size ?? '1024x1024'
    const quality = params.quality ?? 'auto'
    const background = params.background ?? 'auto'
    const outputCompression = params.outputCompression
    const partialImages = validatePartialImages(params.partialImages)
    const inputFidelity = params.inputFidelity
    validateOutputSettings(format, background, outputCompression)

    const fileNameBase = params.fileNameBase || prompt
    const partialImagePaths: string[] = []
    const images = params.inputPaths.map((path) => createReadStream(path))
    const mask = params.maskPath ? createReadStream(params.maskPath) : undefined

    if (partialImages > 0) {
      const stream = await this.openai.images.edit({
        model: this.model,
        image: images,
        mask,
        prompt,
        size,
        quality,
        background,
        output_format: format,
        output_compression: outputCompression,
        partial_images: partialImages,
        input_fidelity: inputFidelity,
        stream: true
      })

      let completed: ImageEditCompletedEvent | null = null
      for await (const event of stream) {
        if (event.type === 'image_edit.partial_image') {
          partialImagePaths.push(
            await writeGeneratedImage(
              params.outputDir,
              fileNameBase,
              format,
              (event as ImageEditPartialImageEvent).b64_json,
              `partial-${event.partial_image_index}`
            )
          )
        } else if (event.type === 'image_edit.completed') {
          completed = event as ImageEditCompletedEvent
        }
      }

      if (!completed?.b64_json) throw new Error('Image edit returned no final image data')

      return {
        outputPath: await writeGeneratedImage(params.outputDir, fileNameBase, format, completed.b64_json),
        partialImagePaths,
        model: this.model,
        size,
        quality,
        background,
        format,
        outputCompression,
        partialImages,
        inputFidelity
      }
    }

    const response = await this.openai.images.edit({
      model: this.model,
      image: images,
      mask,
      prompt,
      size,
      quality,
      background,
      output_format: format,
      output_compression: outputCompression,
      input_fidelity: inputFidelity
    })

    const image = response.data?.[0]
    if (!image?.b64_json) throw new Error('Image edit returned no image data')

    return {
      outputPath: await writeGeneratedImage(params.outputDir, fileNameBase, format, image.b64_json),
      partialImagePaths,
      model: this.model,
      size,
      quality,
      background,
      format,
      outputCompression,
      partialImages,
      inputFidelity
    }
  }
}
