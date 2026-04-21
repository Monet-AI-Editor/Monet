import OpenAI from 'openai'
import type { MediaAssetRecord, SemanticSegment } from '../../shared/editor.js'

/**
 * Build the text blob that gets embedded for an asset.
 * Concatenates every semantic field so the vector represents
 * the full meaning of the clip — name, tags, summary, transcript.
 */
export function buildEmbedText(asset: MediaAssetRecord): string {
  const parts: string[] = [
    asset.name,
    ...asset.semantic.tags,
    asset.semantic.summary,
    ...asset.semantic.transcript.map((s) => s.text)
  ]
  return parts.filter(Boolean).join(' ').slice(0, 8000) // API input limit guard
}

export function buildSegmentEmbedText(asset: MediaAssetRecord, segment: SemanticSegment): string {
  const parts: string[] = [
    asset.name,
    segment.label,
    ...asset.semantic.tags,
    segment.text
  ]
  return parts.filter(Boolean).join(' ').slice(0, 8000)
}

/** Cosine similarity between two equal-length vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export class EmbeddingService {
  private openai: OpenAI | null = null
  private currentKey = ''

  setApiKey(apiKey: string): void {
    if (apiKey === this.currentKey) return
    this.currentKey = apiKey
    this.openai = apiKey ? new OpenAI({ apiKey }) : null
  }

  get isReady(): boolean {
    return this.openai !== null
  }

  /** Embed a single text string (used for query-time embedding) */
  async embedText(text: string): Promise<number[]> {
    if (!this.openai) throw new Error('OpenAI API key not configured')
    const res = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000)
    })
    return res.data[0].embedding
  }

  /**
   * Embed a batch of assets. Returns only assets whose embedding
   * succeeded; failures are logged and skipped.
   */
  async embedAssets(
    assets: MediaAssetRecord[]
  ): Promise<Array<{ id: string; vector: number[] }>> {
    if (!this.openai) throw new Error('OpenAI API key not configured')

    // Batch up to 100 inputs per request (API limit is 2048 but keep it sane)
    const BATCH = 50
    const results: Array<{ id: string; vector: number[] }> = []

    for (let i = 0; i < assets.length; i += BATCH) {
      const chunk = assets.slice(i, i + BATCH)
      const texts = chunk.map(buildEmbedText)

      try {
        const res = await this.openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: texts
        })
        for (let j = 0; j < chunk.length; j++) {
          results.push({ id: chunk[j].id, vector: res.data[j].embedding })
        }
      } catch (err) {
        console.error('[EmbeddingService] batch embed error:', err)
        // Continue with remaining batches
      }
    }

    return results
  }

  async embedAssetSegments(
    assets: MediaAssetRecord[]
  ): Promise<Array<{ assetId: string; segmentId: string; vector: number[] }>> {
    if (!this.openai) throw new Error('OpenAI API key not configured')

    const items = assets.flatMap((asset) =>
      asset.semantic.segments
        .filter((segment) => !segment.vector)
        .map((segment) => ({
          assetId: asset.id,
          segmentId: segment.id,
          text: buildSegmentEmbedText(asset, segment)
        }))
    )

    if (items.length === 0) return []

    const BATCH = 50
    const results: Array<{ assetId: string; segmentId: string; vector: number[] }> = []

    for (let i = 0; i < items.length; i += BATCH) {
      const chunk = items.slice(i, i + BATCH)
      try {
        const res = await this.openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: chunk.map((item) => item.text)
        })
        for (let j = 0; j < chunk.length; j += 1) {
          results.push({
            assetId: chunk[j].assetId,
            segmentId: chunk[j].segmentId,
            vector: res.data[j].embedding
          })
        }
      } catch (err) {
        console.error('[EmbeddingService] segment embed error:', err)
      }
    }

    return results
  }
}
