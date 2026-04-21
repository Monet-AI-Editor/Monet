import type { MediaAssetRecord, SearchResult, SegmentSearchResult, SemanticSegment } from '../../shared/editor'
import { cosineSimilarity } from './embedding-service.js'

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)
}

function keywordScoreText(texts: string[], terms: string[]): { score: number; matchedTerms: string[] } {
  const haystack = new Set(texts.flatMap((text) => tokenize(text)))
  let score = 0
  const matchedTerms: string[] = []

  for (const term of terms) {
    if (haystack.has(term)) {
      score += 3
      matchedTerms.push(term)
      continue
    }
    const fuzzyMatch = [...haystack].some((token) => token.includes(term) || term.includes(token))
    if (fuzzyMatch) {
      score += 1
      matchedTerms.push(term)
    }
  }

  return { score, matchedTerms }
}

function keywordScoreSegment(asset: MediaAssetRecord, segment: SemanticSegment, terms: string[]): SegmentSearchResult {
  const texts = [
    asset.name,
    ...asset.semantic.tags,
    ...asset.semantic.keywords,
    asset.semantic.summary,
    segment.label,
    segment.text
  ]

  const { score, matchedTerms } = keywordScoreText(texts, terms)
  return {
    asset,
    segment,
    score: score + (segment.kind === 'speech' ? 0.5 : 0),
    matchedTerms
  }
}

export function searchSegments(assets: MediaAssetRecord[], query: string, limit = 12): SegmentSearchResult[] {
  const terms = tokenize(query)
  if (terms.length === 0) return []

  return assets
    .flatMap((asset) => asset.semantic.segments.map((segment) => keywordScoreSegment(asset, segment, terms)))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
}

export function searchSegmentsWithVectors(
  assets: MediaAssetRecord[],
  query: string,
  queryVector: number[] | null,
  limit = 12
): SegmentSearchResult[] {
  const segmentsWithVectors = assets.flatMap((asset) =>
    asset.semantic.segments
      .filter((segment) => segment.vector && segment.vector.length > 0)
      .map((segment) => ({ asset, segment }))
  )

  if (queryVector && segmentsWithVectors.length > 0) {
    const vectorResults = segmentsWithVectors.map(({ asset, segment }) => ({
      asset,
      segment,
      score: cosineSimilarity(queryVector, segment.vector!),
      matchedTerms: [] as string[]
    }))

    const fallbackResults = searchSegments(
      assets.filter((asset) => asset.semantic.segments.some((segment) => !segment.vector)),
      query,
      limit
    ).map((result) => ({
      ...result,
      score: result.score / 20
    }))

    return [...vectorResults, ...fallbackResults]
      .filter((result) => result.score > 0.1)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
  }

  return searchSegments(assets, query, limit)
}

export function semanticSearch(assets: MediaAssetRecord[], query: string, limit = 8): SearchResult[] {
  const grouped = new Map<string, SearchResult>()

  for (const result of searchSegments(assets, query, limit * 4)) {
    const existing = grouped.get(result.asset.id)
    if (!existing || result.score > existing.score) {
      grouped.set(result.asset.id, {
        asset: result.asset,
        score: result.score,
        matchedTerms: result.matchedTerms
      })
    }
  }

  return [...grouped.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
}

export function semanticSearchWithVectors(
  assets: MediaAssetRecord[],
  query: string,
  queryVector: number[] | null,
  limit = 8
): SearchResult[] {
  const grouped = new Map<string, SearchResult>()

  for (const result of searchSegmentsWithVectors(assets, query, queryVector, limit * 4)) {
    const existing = grouped.get(result.asset.id)
    if (!existing || result.score > existing.score) {
      grouped.set(result.asset.id, {
        asset: result.asset,
        score: result.score,
        matchedTerms: result.matchedTerms
      })
    }
  }

  return [...grouped.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
}
