import type { Server } from 'http'
import { BrowserWindow } from 'electron'
import { request as httpRequest, createServer as createHttpServer } from 'http'
import type { ProjectStore } from './project-store'
import type { TranscriptionService } from './transcription-service'
import type { SettingsStore } from './settings-store'
import type { EmbeddingService } from './embedding-service'
import type { ExportService } from './export-service'
import type { FrameExtractionService } from './frame-extraction-service'
import type { ControlStateService } from './control-state-service'
import type { ImageGenerationService } from './image-generation-service'
import type { MediaAssetRecord } from '../../shared/editor'
import { searchSegments, searchSegmentsWithVectors, semanticSearch, semanticSearchWithVectors } from './semantic-index'
import { dirname, join, basename, extname } from 'path'
import { homedir } from 'os'
import { readFile, writeFile as writeFileAsync } from 'fs/promises'
import { existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

const PORT_FILE = join(tmpdir(), 'monet-api-port')
const BASE_PORT = 51847
const MAX_PORT = 51857

type CanvasDesignNode = {
  type?: unknown
  text?: unknown
  children?: unknown
}

type CanvasDesignDocument = {
  background?: unknown
  nodes?: unknown
  page?: unknown
  theme?: unknown
  renderMode?: unknown
  components?: unknown
}

type SemanticCanvasSection = {
  type?: unknown
  id?: unknown
  component?: unknown
  label?: unknown
  title?: unknown
  subtitle?: unknown
  description?: unknown
  eyebrow?: unknown
  badge?: unknown
  price?: unknown
  secondaryPrice?: unknown
  rating?: unknown
  reviewCount?: unknown
  primary?: unknown
  secondary?: unknown
  mediaLabel?: unknown
  items?: unknown
  details?: unknown
  children?: unknown
  columns?: unknown
  stats?: unknown
  links?: unknown
}

type SemanticCanvasPage = {
  padding?: unknown
  gap?: unknown
  sections?: unknown
  renderMode?: unknown
}

type SemanticCanvasComponent = {
  type?: unknown
  title?: unknown
  subtitle?: unknown
  description?: unknown
  eyebrow?: unknown
  badge?: unknown
  price?: unknown
  secondaryPrice?: unknown
  rating?: unknown
  reviewCount?: unknown
  primary?: unknown
  secondary?: unknown
  mediaLabel?: unknown
  items?: unknown
  details?: unknown
  children?: unknown
  columns?: unknown
  stats?: unknown
  links?: unknown
}

type SemanticCanvasTheme = {
  background?: unknown
  surface?: unknown
  surfaceMuted?: unknown
  border?: unknown
  textPrimary?: unknown
  textSecondary?: unknown
  textMuted?: unknown
  accent?: unknown
  accentSoft?: unknown
  danger?: unknown
}

type BasicDesignNode = Record<string, unknown>
type ResolvedCanvasTheme = {
  background: string
  surface: string
  surfaceMuted: string
  border: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  accent: string
  accentSoft: string
  danger: string
}

type SemanticCanvasCompileOptions = {
  components: Record<string, SemanticCanvasComponent>
}

function clampCanvasNumber(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, typeof value === 'number' && Number.isFinite(value) ? value : fallback))
}

function canvasTextNode(text: string, overrides: Record<string, unknown> = {}): BasicDesignNode {
  return {
    type: 'text',
    name: 'Text',
    text,
    width: 320,
    height: 56,
    fontSize: 18,
    fontWeight: 500,
    fill: '#f8fafc',
    align: 'left',
    sizing: 'hug',
    ...overrides
  }
}

function canvasRectNode(name: string, overrides: Record<string, unknown> = {}): BasicDesignNode {
  return {
    type: 'rect',
    name,
    width: 120,
    height: 44,
    radius: 16,
    fill: '#1f2937',
    stroke: '#334155',
    strokeWidth: 0,
    ...overrides
  }
}

function canvasStackNode(name: string, overrides: Record<string, unknown> = {}): BasicDesignNode {
  return {
    type: 'stack',
    name,
    width: 320,
    height: 120,
    direction: 'vertical',
    gap: 16,
    padding: 0,
    alignItems: 'start',
    justifyContent: 'start',
    fill: 'transparent',
    radius: 0,
    stroke: '#334155',
    strokeWidth: 0,
    sizing: 'hug',
    children: [],
    ...overrides
  }
}

function canvasGridNode(name: string, overrides: Record<string, unknown> = {}): BasicDesignNode {
  return {
    type: 'grid',
    name,
    width: 320,
    height: 220,
    columns: 2,
    gap: 16,
    padding: 0,
    alignItems: 'start',
    fill: 'transparent',
    radius: 0,
    stroke: '#334155',
    strokeWidth: 0,
    sizing: 'hug',
    children: [],
    ...overrides
  }
}

function toCanvasString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function toCanvasStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => toCanvasString(entry))
    .filter(Boolean)
}

function escapeCanvasHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function resolveSemanticCanvasComponents(raw: unknown): Record<string, SemanticCanvasComponent> {
  if (!raw || typeof raw !== 'object') return {}
  const entries = Object.entries(raw as Record<string, unknown>)
  const resolved: Record<string, SemanticCanvasComponent> = {}
  for (const [name, value] of entries) {
    if (!value || typeof value !== 'object') continue
    resolved[name] = value as SemanticCanvasComponent
  }
  return resolved
}

function resolveCanvasTheme(theme: unknown, backgroundOverride: unknown): ResolvedCanvasTheme {
  const raw = (theme && typeof theme === 'object' ? theme : {}) as SemanticCanvasTheme
  return {
    background: toCanvasString(backgroundOverride ?? raw.background, '#0a0a0a'),
    surface: toCanvasString(raw.surface, '#0f172a'),
    surfaceMuted: toCanvasString(raw.surfaceMuted, '#111827'),
    border: toCanvasString(raw.border, '#1e293b'),
    textPrimary: toCanvasString(raw.textPrimary, '#f8fafc'),
    textSecondary: toCanvasString(raw.textSecondary, '#cbd5e1'),
    textMuted: toCanvasString(raw.textMuted, '#94a3b8'),
    accent: toCanvasString(raw.accent, '#ef4444'),
    accentSoft: toCanvasString(raw.accentSoft, '#fecaca'),
    danger: toCanvasString(raw.danger, '#f87171')
  }
}

function resolveSemanticCanvasSection(
  section: SemanticCanvasSection,
  options: SemanticCanvasCompileOptions
): SemanticCanvasSection {
  const componentName = toCanvasString(section.component)
  const component = componentName ? options.components[componentName] : undefined
  if (!component) return section
  return {
    ...component,
    ...section,
    component: componentName,
    type: toCanvasString(section.type, toCanvasString(component.type, 'section'))
  }
}

function compileSemanticCanvasSection(
  rawSection: SemanticCanvasSection,
  width: number,
  theme: ResolvedCanvasTheme,
  options: SemanticCanvasCompileOptions
): BasicDesignNode {
  const section = resolveSemanticCanvasSection(rawSection, options)
  const type = toCanvasString(section.type, 'section').toLowerCase()
  if (type === 'nav') {
    return canvasStackNode('Nav', {
      direction: 'horizontal',
      justifyContent: 'space-between',
      alignItems: 'center',
      sizing: 'fixed',
      width,
      height: 56,
      children: [
        canvasTextNode(toCanvasString(section.title, 'Brand'), { name: 'Brand', fontSize: 26, fontWeight: 700, fill: theme.textPrimary }),
        canvasTextNode(toCanvasString(section.secondary, 'Menu'), { name: 'Action', fontSize: 14, fontWeight: 600, fill: theme.textSecondary })
      ]
    })
  }

  if (type === 'hero') {
    const heroChildren: BasicDesignNode[] = []
    const eyebrow = toCanvasString(section.eyebrow)
    const badge = toCanvasString(section.badge)
    if (eyebrow) heroChildren.push(canvasTextNode(eyebrow, { name: 'Eyebrow', fontSize: 12, fontWeight: 700, letterSpacing: 1.2, fill: theme.accent }))
    if (badge) heroChildren.push(canvasTextNode(badge, { name: 'Badge', fontSize: 11, fontWeight: 700, fill: theme.accentSoft }))
    heroChildren.push(canvasTextNode(toCanvasString(section.title, 'Headline'), { name: 'Headline', fontSize: 40, fontWeight: 800, width, sizing: 'fill', fill: theme.textPrimary }))
    const subtitle = toCanvasString(section.subtitle || section.description)
    if (subtitle) heroChildren.push(canvasTextNode(subtitle, { name: 'Subtitle', fontSize: 15, fontWeight: 400, fill: theme.textSecondary, width, sizing: 'fill' }))
    heroChildren.push(canvasRectNode('Media', {
      width,
      height: 220,
      radius: 28,
      fill: theme.surfaceMuted,
      stroke: theme.border,
      strokeWidth: 1
    }))
    const mediaLabel = toCanvasString(section.mediaLabel)
    if (mediaLabel) heroChildren.push(canvasTextNode(mediaLabel, { name: 'Media label', fontSize: 13, fontWeight: 600, fill: theme.textMuted }))
    return canvasStackNode('Hero', {
      width,
      padding: 24,
      gap: 14,
      radius: 28,
      fill: theme.surface,
      stroke: theme.border,
      strokeWidth: 1,
      sizing: 'hug',
      children: heroChildren
    })
  }

  if (type === 'product-info') {
    const infoChildren: BasicDesignNode[] = [
      canvasTextNode(toCanvasString(section.title, 'Product Title'), { name: 'Title', fontSize: 32, fontWeight: 800, width, sizing: 'fill', fill: theme.textPrimary })
    ]
    const subtitle = toCanvasString(section.subtitle)
    if (subtitle) infoChildren.push(canvasTextNode(subtitle, { name: 'Subtitle', fontSize: 15, fontWeight: 500, fill: theme.textMuted, width, sizing: 'fill' }))
    const meta = [toCanvasString(section.rating), toCanvasString(section.reviewCount)].filter(Boolean).join(' · ')
    if (meta) infoChildren.push(canvasTextNode(meta, { name: 'Rating', fontSize: 13, fontWeight: 600, fill: theme.accentSoft }))
    const priceRow = canvasStackNode('Price Row', {
      direction: 'horizontal',
      gap: 10,
      alignItems: 'end',
      children: [
        canvasTextNode(toCanvasString(section.price, '$0'), { name: 'Price', fontSize: 28, fontWeight: 800, fill: theme.textPrimary }),
        ...(toCanvasString(section.secondaryPrice) ? [canvasTextNode(toCanvasString(section.secondaryPrice), { name: 'Secondary Price', fontSize: 14, fontWeight: 500, fill: theme.textMuted })] : [])
      ]
    })
    infoChildren.push(priceRow)
    if (Array.isArray(section.details) && section.details.length > 0) {
      infoChildren.push(canvasStackNode('Details', {
        gap: 8,
        width,
        children: section.details
          .map((item) => toCanvasString(item))
          .filter(Boolean)
          .map((item) => canvasTextNode(item, { name: 'Detail', fontSize: 13, fontWeight: 500, fill: theme.textSecondary, width, sizing: 'fill' }))
      }))
    }
    return canvasStackNode('Product Info', {
      width,
      gap: 12,
      children: infoChildren
    })
  }

  if (type === 'cta-row') {
    return canvasStackNode('CTA Row', {
      direction: 'horizontal',
      gap: 12,
      width,
      children: [
        canvasRectNode('Primary CTA', { width: Math.max(180, Math.round(width * 0.68)), height: 52, radius: 18, fill: '#ef4444' }),
        canvasRectNode('Secondary CTA', { width: Math.max(56, Math.round(width * 0.18)), height: 52, radius: 18, fill: '#1f2937', stroke: '#334155', strokeWidth: 1 }),
        canvasTextNode(toCanvasString(section.primary, 'Primary Action'), { name: 'Primary Label', fontSize: 15, fontWeight: 700, fill: '#ffffff' }),
        ...(toCanvasString(section.secondary) ? [canvasTextNode(toCanvasString(section.secondary), { name: 'Secondary Label', fontSize: 14, fontWeight: 600, fill: '#e2e8f0' })] : [])
      ]
    })
  }

  if (type === 'card-list' || type === 'list') {
    const items = Array.isArray(section.items) ? section.items : []
    return canvasGridNode('List', {
      width,
      columns: clampCanvasNumber(section.columns, width <= 480 ? 1 : 2, 1, 4),
      gap: 12,
      children: items.slice(0, 6).map((item, index) => {
        const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
        return canvasStackNode(`Card ${index + 1}`, {
          width,
          padding: 18,
          gap: 8,
          radius: 22,
          fill: theme.surfaceMuted,
          stroke: theme.border,
          strokeWidth: 1,
          children: [
            canvasTextNode(toCanvasString(record.title, `Item ${index + 1}`), { name: 'Card Title', fontSize: 17, fontWeight: 700, width, sizing: 'fill', fill: theme.textPrimary }),
            ...(toCanvasString(record.subtitle) ? [canvasTextNode(toCanvasString(record.subtitle), { name: 'Card Subtitle', fontSize: 13, fontWeight: 500, fill: theme.textSecondary, width, sizing: 'fill' })] : []),
            ...(toCanvasString(record.meta) ? [canvasTextNode(toCanvasString(record.meta), { name: 'Card Meta', fontSize: 12, fontWeight: 500, fill: theme.textMuted })] : [])
          ]
        })
      })
    })
  }

  if (type === 'metric-row' || type === 'stats') {
    const stats = Array.isArray(section.stats) ? section.stats : []
    return canvasGridNode('Stats', {
      width,
      columns: clampCanvasNumber(section.columns, stats.length >= 4 ? 4 : Math.max(1, stats.length || 3), 1, 4),
      gap: 12,
      children: stats.slice(0, 6).map((item, index) => {
        const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
        return canvasStackNode(`Stat ${index + 1}`, {
          padding: 16,
          gap: 6,
          radius: 18,
          fill: theme.surfaceMuted,
          stroke: theme.border,
          strokeWidth: 1,
          children: [
            canvasTextNode(toCanvasString(record.value, `0${index + 1}`), { name: 'Value', fontSize: 24, fontWeight: 800, fill: theme.textPrimary }),
            canvasTextNode(toCanvasString(record.label, `Metric ${index + 1}`), { name: 'Label', fontSize: 12, fontWeight: 500, fill: theme.textMuted })
          ]
        })
      })
    })
  }

  if (type === 'button-group') {
    const labels = [toCanvasString(section.primary, 'Primary action'), toCanvasString(section.secondary)]
      .filter(Boolean)
    return canvasStackNode('Button Group', {
      direction: width <= 480 ? 'vertical' : 'horizontal',
      width,
      gap: 12,
      children: labels.map((label, index) => canvasStackNode(`Button ${index + 1}`, {
        direction: 'horizontal',
        alignItems: 'center',
        justifyContent: 'center',
        width: width <= 480 ? width : Math.max(180, Math.round(width * 0.3)),
        height: 52,
        padding: 16,
        radius: 18,
        fill: index === 0 ? theme.accent : theme.surfaceMuted,
        stroke: index === 0 ? theme.accent : theme.border,
        strokeWidth: index === 0 ? 0 : 1,
        sizing: width <= 480 ? 'fill' : 'fixed',
        children: [
          canvasTextNode(label, { name: 'Label', fontSize: 15, fontWeight: 700, fill: index === 0 ? '#ffffff' : theme.textPrimary })
        ]
      }))
    })
  }

  if (type === 'feature-grid') {
    const items = Array.isArray(section.items) ? section.items : []
    return canvasGridNode('Feature Grid', {
      width,
      columns: clampCanvasNumber(section.columns, width <= 640 ? 1 : 2, 1, 3),
      gap: 14,
      children: items.slice(0, 6).map((item, index) => {
        const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
        return canvasStackNode(`Feature ${index + 1}`, {
          padding: 18,
          gap: 8,
          radius: 22,
          fill: theme.surfaceMuted,
          stroke: theme.border,
          strokeWidth: 1,
          children: [
            canvasTextNode(toCanvasString(record.title, `Feature ${index + 1}`), { name: 'Feature Title', fontSize: 17, fontWeight: 700, fill: theme.textPrimary, width, sizing: 'fill' }),
            ...(toCanvasString(record.description || record.subtitle) ? [canvasTextNode(toCanvasString(record.description || record.subtitle), { name: 'Feature Copy', fontSize: 13, fontWeight: 400, fill: theme.textSecondary, width, sizing: 'fill' })] : [])
          ]
        })
      })
    })
  }

  if (type === 'footer') {
    const links = toCanvasStringList(section.links)
    return canvasStackNode('Footer', {
      width,
      gap: 12,
      padding: 20,
      radius: 20,
      fill: theme.surface,
      stroke: theme.border,
      strokeWidth: 1,
      children: [
        ...(toCanvasString(section.title) ? [canvasTextNode(toCanvasString(section.title), { name: 'Footer Title', fontSize: 14, fontWeight: 700, fill: theme.textPrimary })] : []),
        ...(links.length > 0 ? [canvasStackNode('Footer Links', {
          direction: width <= 480 ? 'vertical' : 'horizontal',
          gap: 12,
          children: links.map((link) => canvasTextNode(link, { name: 'Footer Link', fontSize: 12, fontWeight: 500, fill: theme.textMuted }))
        })] : [])
      ]
    })
  }

  if (type === 'component-group') {
    const children = Array.isArray(section.children) ? section.children as SemanticCanvasSection[] : []
    return canvasStackNode(toCanvasString(section.label, 'Component Group'), {
      width,
      gap: 16,
      children: children.map((child) => compileSemanticCanvasSection(child, width, theme, options))
    })
  }

  return canvasStackNode('Section', {
    width,
    gap: 10,
    children: [
      ...(toCanvasString(section.title) ? [canvasTextNode(toCanvasString(section.title), { name: 'Section Title', fontSize: 24, fontWeight: 700, width, sizing: 'fill', fill: theme.textPrimary })] : []),
      ...(toCanvasString(section.subtitle || section.description) ? [canvasTextNode(toCanvasString(section.subtitle || section.description), { name: 'Section Copy', fontSize: 14, fontWeight: 400, fill: theme.textSecondary, width, sizing: 'fill' })] : []),
      ...(Array.isArray(section.children)
        ? (section.children as SemanticCanvasSection[]).map((child, index) => ({
            ...compileSemanticCanvasSection(child, width, theme, options),
            name: `Nested ${index + 1}`
          }))
        : [])
    ]
  })
}

function compileSemanticCanvasHtmlSection(
  rawSection: SemanticCanvasSection,
  width: number,
  theme: ResolvedCanvasTheme,
  options: SemanticCanvasCompileOptions
): string {
  const section = resolveSemanticCanvasSection(rawSection, options)
  const type = toCanvasString(section.type, 'section').toLowerCase()
  const wrap = (inner: string, extraStyle = '') => `<section style="display:flex;flex-direction:column;gap:14px;width:100%;${extraStyle}">${inner}</section>`
  if (type === 'nav') {
    return `<section style="display:flex;justify-content:space-between;align-items:center;width:100%;padding:0 0 8px;">
      <div style="font:700 26px/1.1 Inter,sans-serif;color:${theme.textPrimary};">${escapeCanvasHtml(toCanvasString(section.title, 'Brand'))}</div>
      <div style="font:600 14px/1.1 Inter,sans-serif;color:${theme.textSecondary};">${escapeCanvasHtml(toCanvasString(section.secondary, 'Menu'))}</div>
    </section>`
  }
  if (type === 'hero') {
    const eyebrow = toCanvasString(section.eyebrow)
    const badge = toCanvasString(section.badge)
    const subtitle = toCanvasString(section.subtitle || section.description)
    return wrap(`
      ${eyebrow ? `<div style="font:700 12px/1.2 Inter,sans-serif;letter-spacing:0.12em;text-transform:uppercase;color:${theme.accent};">${escapeCanvasHtml(eyebrow)}</div>` : ''}
      ${badge ? `<div style="display:inline-flex;align-self:flex-start;padding:6px 10px;border-radius:999px;background:${theme.accentSoft};color:#111827;font:700 11px/1 Inter,sans-serif;">${escapeCanvasHtml(badge)}</div>` : ''}
      <h1 style="margin:0;font:800 ${width <= 480 ? 44 : 64}px/0.95 Inter,sans-serif;color:${theme.textPrimary};">${escapeCanvasHtml(toCanvasString(section.title, 'Headline'))}</h1>
      ${subtitle ? `<p style="margin:0;max-width:${Math.min(width, 720)}px;font:400 16px/1.5 Inter,sans-serif;color:${theme.textSecondary};">${escapeCanvasHtml(subtitle)}</p>` : ''}
      <div style="width:100%;height:${width <= 480 ? 240 : 320}px;border-radius:28px;background:linear-gradient(135deg, ${theme.surfaceMuted}, ${theme.surface});border:1px solid ${theme.border};display:flex;align-items:flex-end;justify-content:flex-start;padding:20px;">
        <div style="font:600 13px/1.2 Inter,sans-serif;color:${theme.textMuted};">${escapeCanvasHtml(toCanvasString(section.mediaLabel, 'Hero media'))}</div>
      </div>
    `, `padding:24px;border-radius:28px;background:${theme.surface};border:1px solid ${theme.border};`)
  }
  if (type === 'product-info') {
    const details = toCanvasStringList(section.details)
    return wrap(`
      <h2 style="margin:0;font:800 32px/1 Inter,sans-serif;color:${theme.textPrimary};">${escapeCanvasHtml(toCanvasString(section.title, 'Product Title'))}</h2>
      ${toCanvasString(section.subtitle) ? `<div style="font:500 15px/1.4 Inter,sans-serif;color:${theme.textMuted};">${escapeCanvasHtml(toCanvasString(section.subtitle))}</div>` : ''}
      ${(toCanvasString(section.rating) || toCanvasString(section.reviewCount)) ? `<div style="font:600 13px/1.4 Inter,sans-serif;color:${theme.accentSoft};">${escapeCanvasHtml([toCanvasString(section.rating), toCanvasString(section.reviewCount)].filter(Boolean).join(' · '))}</div>` : ''}
      <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
        <div style="font:800 28px/1 Inter,sans-serif;color:${theme.textPrimary};">${escapeCanvasHtml(toCanvasString(section.price, '$0'))}</div>
        ${toCanvasString(section.secondaryPrice) ? `<div style="font:500 14px/1 Inter,sans-serif;color:${theme.textMuted};">${escapeCanvasHtml(toCanvasString(section.secondaryPrice))}</div>` : ''}
      </div>
      ${details.length > 0 ? `<div style="display:flex;flex-direction:column;gap:8px;">${details.map((detail) => `<div style="font:500 13px/1.4 Inter,sans-serif;color:${theme.textSecondary};">${escapeCanvasHtml(detail)}</div>`).join('')}</div>` : ''}
    `)
  }
  if (type === 'cta-row' || type === 'button-group') {
    const labels = [toCanvasString(section.primary, 'Primary action'), toCanvasString(section.secondary)].filter(Boolean)
    return `<section style="display:flex;flex-direction:${width <= 480 ? 'column' : 'row'};gap:12px;width:100%;">${labels.map((label, index) => `
      <button style="appearance:none;border:${index === 0 ? 'none' : `1px solid ${theme.border}`};background:${index === 0 ? theme.accent : theme.surfaceMuted};color:${index === 0 ? '#ffffff' : theme.textPrimary};border-radius:18px;padding:16px 20px;font:700 15px/1 Inter,sans-serif;min-height:52px;flex:${width <= 480 ? '1 1 auto' : '0 0 auto'};">${escapeCanvasHtml(label)}</button>
    `).join('')}</section>`
  }
  if (type === 'card-list' || type === 'list' || type === 'feature-grid') {
    const items = Array.isArray(section.items) ? section.items : []
    const columns = clampCanvasNumber(section.columns, width <= 640 ? 1 : 2, 1, 4)
    return `<section style="display:grid;grid-template-columns:repeat(${columns}, minmax(0, 1fr));gap:14px;width:100%;">${items.slice(0, 6).map((item, index) => {
      const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
      return `<article style="display:flex;flex-direction:column;gap:8px;padding:18px;border-radius:22px;background:${theme.surfaceMuted};border:1px solid ${theme.border};">
        <div style="font:700 17px/1.3 Inter,sans-serif;color:${theme.textPrimary};">${escapeCanvasHtml(toCanvasString(record.title, `Item ${index + 1}`))}</div>
        ${toCanvasString(record.subtitle || record.description) ? `<div style="font:400 13px/1.5 Inter,sans-serif;color:${theme.textSecondary};">${escapeCanvasHtml(toCanvasString(record.subtitle || record.description))}</div>` : ''}
        ${toCanvasString(record.meta) ? `<div style="font:500 12px/1.4 Inter,sans-serif;color:${theme.textMuted};">${escapeCanvasHtml(toCanvasString(record.meta))}</div>` : ''}
      </article>`
    }).join('')}</section>`
  }
  if (type === 'metric-row' || type === 'stats') {
    const stats = Array.isArray(section.stats) ? section.stats : []
    const columns = clampCanvasNumber(section.columns, stats.length >= 4 ? 4 : Math.max(1, stats.length || 3), 1, 4)
    return `<section style="display:grid;grid-template-columns:repeat(${columns}, minmax(0, 1fr));gap:12px;width:100%;">${stats.slice(0, 6).map((item, index) => {
      const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
      return `<div style="display:flex;flex-direction:column;gap:6px;padding:16px;border-radius:18px;background:${theme.surfaceMuted};border:1px solid ${theme.border};">
        <div style="font:800 24px/1 Inter,sans-serif;color:${theme.textPrimary};">${escapeCanvasHtml(toCanvasString(record.value, `0${index + 1}`))}</div>
        <div style="font:500 12px/1.4 Inter,sans-serif;color:${theme.textMuted};">${escapeCanvasHtml(toCanvasString(record.label, `Metric ${index + 1}`))}</div>
      </div>`
    }).join('')}</section>`
  }
  if (type === 'footer') {
    const links = toCanvasStringList(section.links)
    return wrap(`
      ${toCanvasString(section.title) ? `<div style="font:700 14px/1.2 Inter,sans-serif;color:${theme.textPrimary};">${escapeCanvasHtml(toCanvasString(section.title))}</div>` : ''}
      ${links.length > 0 ? `<div style="display:flex;flex-wrap:wrap;gap:12px;">${links.map((link) => `<div style="font:500 12px/1.4 Inter,sans-serif;color:${theme.textMuted};">${escapeCanvasHtml(link)}</div>`).join('')}</div>` : ''}
    `, `padding:20px;border-radius:20px;background:${theme.surface};border:1px solid ${theme.border};`)
  }
  if (type === 'component-group') {
    const children = Array.isArray(section.children) ? section.children as SemanticCanvasSection[] : []
    return wrap(children.map((child) => compileSemanticCanvasHtmlSection(child, width, theme, options)).join(''))
  }
  return wrap(`
    ${toCanvasString(section.title) ? `<h2 style="margin:0;font:700 24px/1.15 Inter,sans-serif;color:${theme.textPrimary};">${escapeCanvasHtml(toCanvasString(section.title))}</h2>` : ''}
    ${toCanvasString(section.subtitle || section.description) ? `<p style="margin:0;font:400 14px/1.5 Inter,sans-serif;color:${theme.textSecondary};">${escapeCanvasHtml(toCanvasString(section.subtitle || section.description))}</p>` : ''}
    ${Array.isArray(section.children) ? (section.children as SemanticCanvasSection[]).map((child) => compileSemanticCanvasHtmlSection(child, width, theme, options)).join('') : ''}
  `)
}

function compileSemanticCanvasHtmlDesign(design: CanvasDesignDocument, width: number, height: number): { background: string; html: string } | null {
  if (!design.page || typeof design.page !== 'object') return null
  const page = design.page as SemanticCanvasPage
  const sections = Array.isArray(page.sections) ? page.sections as SemanticCanvasSection[] : []
  const theme = resolveCanvasTheme(design.theme, design.background)
  const padding = clampCanvasNumber(page.padding, width <= 480 ? 20 : 32, 0, 80)
  const gap = clampCanvasNumber(page.gap, width <= 480 ? 18 : 24, 0, 80)
  const components = resolveSemanticCanvasComponents(design.components)
  const options: SemanticCanvasCompileOptions = { components }
  const content = sections.map((section) => compileSemanticCanvasHtmlSection(section, Math.max(120, width - padding * 2), theme, options)).join('')
  return {
    background: theme.background,
    html: `<div style="width:${width}px;min-height:${height}px;background:${theme.background};padding:${padding}px;display:flex;flex-direction:column;gap:${gap}px;font-family:Inter,sans-serif;color:${theme.textPrimary};">${content}</div>`
  }
}

function compileSemanticCanvasDesign(
  design: unknown,
  width: number,
  height: number,
  options: { forceEditableDesign?: boolean } = {}
): unknown {
  if (!design || typeof design !== 'object') return design
  const document = design as CanvasDesignDocument
  if (!document.page || typeof document.page !== 'object') return design

  const page = document.page as SemanticCanvasPage
  const renderMode = toCanvasString(document.renderMode || page.renderMode, 'design').toLowerCase()
  if (!options.forceEditableDesign && (renderMode === 'html' || renderMode === 'dom')) {
    return compileSemanticCanvasHtmlDesign(document, width, height) ?? design
  }
  const theme = resolveCanvasTheme(document.theme, document.background)
  const padding = clampCanvasNumber(page.padding, width <= 480 ? 20 : 32, 0, 80)
  const gap = clampCanvasNumber(page.gap, width <= 480 ? 18 : 24, 0, 80)
  const innerWidth = Math.max(120, width - padding * 2)
  const sections = Array.isArray(page.sections) ? page.sections as SemanticCanvasSection[] : []
  const components = resolveSemanticCanvasComponents(document.components)
  const compileOptions: SemanticCanvasCompileOptions = { components }

  return {
    background: theme.background,
    nodes: [
      canvasStackNode('Page', {
        x: 0,
        y: 0,
        width,
        height,
        direction: 'vertical',
        gap,
        padding,
        alignItems: 'stretch',
        justifyContent: 'start',
        fill: 'transparent',
        sizing: 'fixed',
        children: sections.map((section) => compileSemanticCanvasSection(section, innerWidth, theme, compileOptions))
      })
    ]
  }
}

function collectCanvasDesignNodes(nodes: unknown): CanvasDesignNode[] {
  if (!Array.isArray(nodes)) return []
  const result: CanvasDesignNode[] = []
  for (const entry of nodes) {
    if (!entry || typeof entry !== 'object') continue
    const node = entry as CanvasDesignNode
    result.push(node)
    if (Array.isArray(node.children)) result.push(...collectCanvasDesignNodes(node.children))
  }
  return result
}

function validateCanvasDesignPayload(design: unknown): void {
  if (!design || typeof design !== 'object') {
    throw new Error('Design payload must be an object with background and nodes.')
  }

  const document = design as CanvasDesignDocument
  if (typeof (document as { html?: unknown }).html === 'string') {
    const html = ((document as { html?: unknown }).html as string).toLowerCase()
    if (html.includes('text layer') || html.includes('edit this text')) {
      throw new Error(
        'Rejected weak design payload: placeholder text leaked into the generated HTML. ' +
        'Use final copy before calling canvas-update-design-frame.'
      )
    }
    return
  }

  if (!Array.isArray(document.nodes)) {
    throw new Error('Design payload must include a nodes array.')
  }

  if (document.nodes.length === 0) {
    throw new Error(
      'Rejected weak design payload: the frame contains no layers. ' +
      'Add real content before calling canvas-update-design-frame.'
    )
  }

  const topLevelNodes = document.nodes
  const allNodes = collectCanvasDesignNodes(document.nodes)
  const containerCount = allNodes.filter((node) => node.type === 'stack' || node.type === 'grid').length
  const textNodes = allNodes.filter((node) => node.type === 'text')
  const rectNodes = allNodes.filter((node) => node.type === 'rect')
  const emptyContainers = allNodes.filter((node) => (node.type === 'stack' || node.type === 'grid') && (!Array.isArray(node.children) || node.children.length === 0))
  const placeholderTexts = textNodes.filter((node) => {
    const text = typeof node.text === 'string' ? node.text.trim().toLowerCase() : ''
    return text === 'text layer' || text === 'edit this text' || text === 'text'
  })

  if (allNodes.length === 0 || (textNodes.length === 0 && rectNodes.length === 0)) {
    throw new Error(
      'Rejected weak design payload: the frame has no visible text or surfaces. ' +
      'Provide actual layout/content instead of an empty container tree.'
    )
  }

  if (emptyContainers.length > 0 && textNodes.length === 0 && rectNodes.length === 0) {
    throw new Error(
      'Rejected weak design payload: only empty containers were provided. ' +
      'Populate the layout with actual text, cards, or surfaces before updating the frame.'
    )
  }

  if (placeholderTexts.length >= 2) {
    throw new Error(
      'Rejected weak design payload: placeholder text leaked into the final design. ' +
      'Replace placeholder copy with real content before calling canvas-update-design-frame.'
    )
  }

  if (containerCount === 0 && textNodes.length >= 4) {
    throw new Error(
      'Rejected weak design payload: too many loose text layers with no stack/container structure. ' +
      'Use nested stack nodes for layout instead of free-positioned text blocks.'
    )
  }

  if (containerCount === 0 && Array.isArray(topLevelNodes) && topLevelNodes.length >= 6) {
    throw new Error(
      'Rejected weak design payload: too many top-level nodes with no grouping. ' +
      'Create section/container stacks and place text/cards inside them.'
    )
  }

  if (containerCount > 0 && textNodes.length >= 8 && placeholderTexts.length >= 1) {
    throw new Error(
      'Rejected weak design payload: layout structure exists, but placeholder text and text spam still dominate the design. ' +
      'Reduce loose text nodes and provide final copy.'
    )
  }
}

function getCanvasErrorTargetId(args: Record<string, unknown>, fallbackId: string | null): string | null {
  if (typeof args.id === 'string' && args.id.trim()) return args.id
  if (typeof args.frameId === 'string' && args.frameId.trim()) return args.frameId
  return fallbackId
}

function writePortFile(port: number): void {
  try { writeFileSync(PORT_FILE, String(port), 'utf8') } catch { /* non-fatal */ }
}

export class APIBridge {
  private server: Server | null = null
  private PORT = BASE_PORT
  private canvasStateProvider: (() => unknown[]) | null = null

  setCanvasStateProvider(fn: () => unknown[]): void {
    this.canvasStateProvider = fn
  }

  private pushCanvasFrameError(message: string, args: Record<string, unknown> = {}): void {
    const frames = this.canvasStateProvider ? this.canvasStateProvider() : []
    const fallback = Array.isArray(frames) && frames.length > 0
      ? (frames[frames.length - 1] as { id?: unknown })?.id
      : null
    const id = getCanvasErrorTargetId(args, typeof fallback === 'string' ? fallback : null)
    this.safeSendToAll('canvas:command', { command: 'set-frame-error', args: { id, message } })
  }

  private resolveCanvasFrameSize(frameId: string | null): { width: number; height: number } {
    const frames = this.canvasStateProvider ? this.canvasStateProvider() : []
    if (Array.isArray(frames) && frameId) {
      const frame = frames.find((entry) => entry && typeof entry === 'object' && (entry as { id?: unknown }).id === frameId) as
        | { width?: unknown; height?: unknown }
        | undefined
      if (frame) {
        return {
          width: typeof frame.width === 'number' ? frame.width : 1280,
          height: typeof frame.height === 'number' ? frame.height : 720
        }
      }
    }
    return { width: 1280, height: 720 }
  }

  private buildStateSnapshot(): {
    playheadTime: number
    selectedClipId: string | null
    selectedAssetId: string | null
    activeSequenceId: string | null
    activeView: 'editor' | 'canvas'
    canvasTerminalOpen: boolean
    projectId: string
    projectName: string
    sequences: Array<{
      id: string
      name: string
      active: boolean
      width: number | null
      height: number | null
      trackCount: number
      clipCount: number
      markerCount: number
    }>
  } {
    const controlState = this.controlStateService.getState()
    const project = this.projectStore.getProject()
    return {
      ...controlState,
      projectId: project.id,
      projectName: project.name,
      sequences: project.sequences.map((sequence) => ({
        id: sequence.id,
        name: sequence.name,
        active: sequence.active,
        width: sequence.width ?? null,
        height: sequence.height ?? null,
        trackCount: sequence.tracks.length,
        clipCount: sequence.tracks.reduce((count, track) => count + track.clips.length, 0),
        markerCount: sequence.markers.length
      }))
    }
  }

  private safeSendToAll(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue
      try {
        win.webContents.send(channel, payload)
      } catch {
        // Window teardown can race with bridge pushes during app shutdown.
      }
    }
  }

  constructor(
    private readonly projectStore: ProjectStore,
    private readonly transcriptionService: TranscriptionService,
    private readonly settingsStore: SettingsStore,
    private readonly controlStateService: ControlStateService,
    private readonly embeddingService?: EmbeddingService,
    private readonly exportService?: ExportService,
    private readonly frameExtractionService?: FrameExtractionService,
    private readonly imageGenerationService?: ImageGenerationService
  ) {}

  start(): void {
    if (this.server) return
    this.server = createHttpServer(async (req: any, res: any) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

      if (req.method === 'GET') {
        try {
          const path = typeof req.url === 'string' ? req.url.split('?')[0] : '/'
          const sequenceMatch = path.match(/^\/sequences\/([^/]+)$/)
          const command =
            path === '/' ? 'help'
            : path === '/state' ? 'get_control_state'
            : path === '/project' ? 'get_project'
            : path === '/settings' ? 'get_settings'
            : path === '/assets' ? 'list_assets'
            : path === '/sequences' ? 'list_sequences'
            : path === '/help' ? 'help'
            : sequenceMatch ? 'get_sequence'
            : null

          if (!command) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: `Unknown endpoint: ${path}` }))
            return
          }

          const args = sequenceMatch ? { sequenceId: decodeURIComponent(sequenceMatch[1] ?? '') } : {}
          const result = await this.handleCommand(command, args)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, result }))
          return
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }))
          return
        }
      }

      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString() })
      req.on('end', async () => {
        try {
          const data = body ? JSON.parse(body) : {}
          const args = data.args && typeof data.args === 'object'
            ? data.args
            : Object.fromEntries(
                Object.entries(data).filter(([key]) => key !== 'command')
              )
          const result = await this.handleCommand(data.command, args)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, result }))
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }))
        }
      })
    })

    this.server!.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        void this.recoverFromPortConflict()
        return
      }
      throw error
    })

    this.server!.listen(this.PORT, 'localhost', () => {
      console.log(`[API Bridge] Listening on http://localhost:${this.PORT}`)
      writePortFile(this.PORT)
    })
  }

  stop(): void {
    if (this.server) { this.server.close(); this.server = null }
  }

  getPort(): number { return this.PORT }

  private async isBridgeReachable(): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      const req = httpRequest(
        {
          hostname: 'localhost',
          port: this.PORT,
          method: 'POST',
          path: '/',
          headers: { 'Content-Type': 'application/json' }
        },
        (res) => {
          res.resume()
          resolve(Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 600))
        }
      )

      req.on('error', () => resolve(false))
      req.setTimeout(600, () => {
        req.destroy()
        resolve(false)
      })
      req.write(JSON.stringify({ command: 'ping', args: {} }))
      req.end()
    })
  }

  private async recoverFromPortConflict(): Promise<void> {
    if (this.server) { this.server.close(); this.server = null }

    // Port is in use — check if it's another Monet instance we can share
    if (await this.isBridgeReachable()) {
      console.warn(`[API Bridge] Port ${this.PORT} already in use by another Monet. Trying next port…`)
    }

    // Scan for a free port rather than giving up
    const next = this.PORT + 1
    if (next > MAX_PORT) {
      console.error('[API Bridge] No free port found in range. API bridge disabled.')
      return
    }

    this.PORT = next
    console.warn(`[API Bridge] Trying port ${this.PORT}…`)
    // Recreate server on new port
    setTimeout(() => this.start(), 100)
  }

  private pushProjectUpdate(): void {
    const project = this.projectStore.getProject()
    this.safeSendToAll('project:updated', project)
  }

  private isTranscribableAsset(asset: MediaAssetRecord): boolean {
    return asset.type === 'video' || asset.type === 'audio'
  }

  private async syncEmbeddingKey(settings?: Awaited<ReturnType<SettingsStore['getSettings']>>): Promise<void> {
    if (!this.embeddingService) return
    const resolved = settings ?? (await this.settingsStore.getSettings())
    const key = resolved.semanticApiKeys.openai || resolved.apiKeys.openai
    if (key) this.embeddingService.setApiKey(key)
  }

  private async maybeEmbedAsset(assetId: string): Promise<void> {
    if (!this.embeddingService) return
    await this.syncEmbeddingKey()
    if (!this.embeddingService.isReady) return

    const asset = this.projectStore.getProject().assets.find((item) => item.id === assetId)
    if (!asset) return

    const [assetVector] = await this.embeddingService.embedAssets([asset])
    if (assetVector) this.projectStore.updateAssetVector(assetId, assetVector.vector)
    const segmentVectors = await this.embeddingService.embedAssetSegments([asset])
    if (segmentVectors.length > 0) {
      this.projectStore.updateAssetSegmentVectors(
        assetId,
        segmentVectors.map((result) => ({ segmentId: result.segmentId, vector: result.vector }))
      )
    }
  }

  private resolveGeneratedAssetsDirectory(): string {
    const projectPath = this.projectStore.getProjectFilePath()
    if (projectPath) return join(dirname(projectPath), 'Generated Assets')
    return join(homedir(), 'Documents', 'Monet', 'Generated Assets')
  }

  private async generateImageAsset(args: {
    prompt?: string
    size?: string
    quality?: string
    background?: string
    format?: string
    moderation?: string
    outputCompression?: number
    partialImages?: number
  }): Promise<{
    asset: MediaAssetRecord
    outputPath: string
    partialImagePaths: string[]
    revisedPrompt?: string
    model: string
    size: string
    quality: string
    background: string
    format: string
    moderation: string
    outputCompression?: number
    partialImages: number
  }> {
    if (!this.imageGenerationService) throw new Error('Image generation service not initialized')
    if (!args.prompt || !String(args.prompt).trim()) throw new Error('prompt required')

    const settings = await this.settingsStore.getSettings()
    const apiKey = settings.apiKeys.openai
    if (!apiKey) throw new Error('OpenAI API key not configured')

    this.imageGenerationService.setApiKey(apiKey)
    const task = this.projectStore.queueTask({
      type: 'generate',
      label: 'Generating image'
    })

    try {
      this.projectStore.updateTask(task.id, {
        status: 'running',
        progress: 0.1,
        label: 'Generating image'
      })
      this.pushProjectUpdate()

      const generated = await this.imageGenerationService.generateImage({
        prompt: String(args.prompt),
        outputDir: this.resolveGeneratedAssetsDirectory(),
        size: args.size as any,
        quality: args.quality as any,
        background: args.background as any,
        format: args.format as any,
        moderation: args.moderation as any,
        outputCompression: typeof args.outputCompression === 'number' ? args.outputCompression : undefined,
        partialImages: typeof args.partialImages === 'number' ? args.partialImages : undefined
      })

      this.projectStore.updateTask(task.id, {
        status: 'running',
        progress: 0.85,
        label: 'Importing generated image'
      })

      const [asset] = this.projectStore.importFiles([generated.outputPath])
      await this.maybeEmbedAsset(asset.id)

      this.projectStore.updateTask(task.id, {
        status: 'done',
        progress: 1,
        label: `Generated ${asset.name}`
      })
      this.pushProjectUpdate()

      return {
        asset,
        outputPath: generated.outputPath,
        partialImagePaths: generated.partialImagePaths,
        revisedPrompt: generated.revisedPrompt,
        model: generated.model,
        size: generated.size,
        quality: generated.quality,
        background: generated.background,
        format: generated.format,
        moderation: generated.moderation,
        outputCompression: generated.outputCompression,
        partialImages: generated.partialImages
      }
    } catch (error) {
      this.projectStore.updateTask(task.id, {
        status: 'error',
        progress: 1,
        label: `Image generation failed: ${error instanceof Error ? error.message : 'unknown error'}`
      })
      this.pushProjectUpdate()
      throw error
    }
  }

  private resolveImageInputPath(value: string): string {
    const asset = this.projectStore.getProject().assets.find((item) => item.id === value)
    if (asset) return asset.path
    return value
  }

  private async editImageAsset(args: {
    prompt?: string
    inputs?: string[]
    size?: string
    quality?: string
    background?: string
    format?: string
    outputCompression?: number
    partialImages?: number
    inputFidelity?: string
    mask?: string
  }): Promise<{
    asset: MediaAssetRecord
    outputPath: string
    partialImagePaths: string[]
    model: string
    size: string
    quality: string
    background: string
    format: string
    outputCompression?: number
    partialImages: number
    inputFidelity?: string
  }> {
    if (!this.imageGenerationService) throw new Error('Image generation service not initialized')
    if (!args.prompt || !String(args.prompt).trim()) throw new Error('prompt required')
    if (!args.inputs || args.inputs.length === 0) throw new Error('at least one input image is required')

    const settings = await this.settingsStore.getSettings()
    const apiKey = settings.apiKeys.openai
    if (!apiKey) throw new Error('OpenAI API key not configured')

    this.imageGenerationService.setApiKey(apiKey)
    const task = this.projectStore.queueTask({
      type: 'generate',
      label: 'Editing image'
    })

    try {
      this.projectStore.updateTask(task.id, {
        status: 'running',
        progress: 0.1,
        label: 'Editing image'
      })
      this.pushProjectUpdate()

      const edited = await this.imageGenerationService.editImage({
        prompt: String(args.prompt),
        inputPaths: args.inputs.map((input) => this.resolveImageInputPath(String(input))),
        outputDir: this.resolveGeneratedAssetsDirectory(),
        size: args.size as any,
        quality: args.quality as any,
        background: args.background as any,
        format: args.format as any,
        outputCompression: typeof args.outputCompression === 'number' ? args.outputCompression : undefined,
        partialImages: typeof args.partialImages === 'number' ? args.partialImages : undefined,
        inputFidelity: args.inputFidelity as any,
        maskPath: args.mask ? this.resolveImageInputPath(String(args.mask)) : undefined
      })

      this.projectStore.updateTask(task.id, {
        status: 'running',
        progress: 0.85,
        label: 'Importing edited image'
      })

      const [asset] = this.projectStore.importFiles([edited.outputPath])
      await this.maybeEmbedAsset(asset.id)

      this.projectStore.updateTask(task.id, {
        status: 'done',
        progress: 1,
        label: `Edited ${asset.name}`
      })
      this.pushProjectUpdate()

      return {
        asset,
        outputPath: edited.outputPath,
        partialImagePaths: edited.partialImagePaths,
        model: edited.model,
        size: edited.size,
        quality: edited.quality,
        background: edited.background,
        format: edited.format,
        outputCompression: edited.outputCompression,
        partialImages: edited.partialImages,
        inputFidelity: edited.inputFidelity
      }
    } catch (error) {
      this.projectStore.updateTask(task.id, {
        status: 'error',
        progress: 1,
        label: `Image edit failed: ${error instanceof Error ? error.message : 'unknown error'}`
      })
      this.pushProjectUpdate()
      throw error
    }
  }

  private async runTranscriptionJob(
    assetId: string,
    options: { language?: string; taskId?: string; requireKey?: boolean } = {}
  ): Promise<{ assetId: string; segments: Awaited<ReturnType<TranscriptionService['transcribeAudio']>> }> {
    const asset = this.projectStore.getProject().assets.find((item) => item.id === assetId)
    if (!asset) throw new Error(`Asset not found: ${assetId}`)
    if (!this.isTranscribableAsset(asset)) throw new Error('Only audio and video assets can be transcribed.')

    const task =
      (options.taskId && this.projectStore.getTask(options.taskId)) ||
      this.projectStore.queueTask({
        type: 'transcribe',
        label: `Transcribing ${asset.name}`,
        assetId
      })

    const settings = await this.settingsStore.getSettings()
    const openAiKey = settings.apiKeys.openai || settings.semanticApiKeys.openai
    const canUseLocal = this.transcriptionService.isLocalAvailable()
    if (!canUseLocal && !openAiKey) {
      this.projectStore.updateTask(task.id, {
        status: 'error',
        progress: 1,
        label: `Transcription unavailable for ${asset.name}: install local transcription or add an OpenAI key`
      })
      this.pushProjectUpdate()
      if (options.requireKey) throw new Error('No transcription backend configured')
      return { assetId, segments: [] }
    }

    try {
      this.projectStore.updateTask(task.id, {
        status: 'running',
        progress: 0.1,
        label: `Transcribing ${asset.name}`
      })
      if (openAiKey) {
        this.transcriptionService.setApiKey(openAiKey)
      }
      const segments = await this.transcriptionService.transcribeAudio(asset.path, options.language)
      this.projectStore.updateTask(task.id, {
        status: 'running',
        progress: 0.75,
        label: `Indexing transcript for ${asset.name}`
      })
      this.projectStore.updateAssetTranscript(assetId, segments)
      try {
        this.projectStore.generateCaptionsForAsset(assetId, { replaceExisting: true })
      } catch {
        // Asset may not be present in the active sequence yet; transcript is still stored.
      }
      await this.maybeEmbedAsset(assetId)
      this.projectStore.updateTask(task.id, {
        status: 'done',
        progress: 1,
        label:
          segments.length > 0
            ? `Transcribed ${asset.name} (${segments.length} segments)`
            : `No speech detected in ${asset.name}`
      })
      this.pushProjectUpdate()
      return { assetId, segments }
    } catch (error) {
      this.projectStore.updateTask(task.id, {
        status: 'error',
        progress: 1,
        label: `Transcription failed for ${asset.name}: ${error instanceof Error ? error.message : 'unknown error'}`
      })
      this.pushProjectUpdate()
      throw error
    }
  }

  private queueAutomaticIngestionJobs(imported: MediaAssetRecord[]): void {
    for (const asset of imported) {
      if (!this.isTranscribableAsset(asset)) continue
      if (asset.semantic.transcript.length > 0) continue
      const task = this.projectStore.queueTask({
        type: 'transcribe',
        label: `Queued transcription for ${asset.name}`,
        assetId: asset.id
      })
      void this.runTranscriptionJob(asset.id, { taskId: task.id, requireKey: false }).catch((error) => {
        console.warn(`[API Bridge] Automatic transcription failed for ${asset.id}:`, error)
      })
    }
  }

  private queueAutomaticEmbeddingJobs(imported: MediaAssetRecord[]): void {
    if (!this.embeddingService) return
    void this.syncEmbeddingKey()
      .then(async () => {
        if (!this.embeddingService?.isReady) return
        const immediateAssets = imported.filter((asset) => !this.isTranscribableAsset(asset))
        if (immediateAssets.length === 0) return
        const assetResults = await this.embeddingService.embedAssets(immediateAssets.filter((asset) => !asset.semantic.vector))
        const segmentResults = await this.embeddingService.embedAssetSegments(immediateAssets)
        for (const { id, vector } of assetResults) {
          this.projectStore.updateAssetVector(id, vector)
        }
        for (const asset of immediateAssets) {
          const vectors = segmentResults
            .filter((result) => result.assetId === asset.id)
            .map((result) => ({ segmentId: result.segmentId, vector: result.vector }))
          if (vectors.length > 0) this.projectStore.updateAssetSegmentVectors(asset.id, vectors)
        }
        this.pushProjectUpdate()
      })
      .catch((err) => console.warn('[API Bridge] Auto-embed failed:', err))
  }

  private enqueueAutomaticImportProcessing(imported: MediaAssetRecord[]): void {
    if (imported.length === 0) return
    this.queueAutomaticIngestionJobs(imported)
    this.queueAutomaticEmbeddingJobs(imported)
  }

  private async handleCommand(command: string, args: any = {}): Promise<any> {
    const normalizedCommand =
      command === 'get-state' || command === 'get_state' ? 'get_control_state'
      : command === 'list-assets' ? 'list_assets'
      : command === 'list-sequences' ? 'list_sequences'
      : command === 'list-tracks' ? 'get_tracks'
      : command === 'list-clips' ? 'list_clips'
      : command === 'list-markers' ? 'list_markers'
      : command === 'add-clip' ? 'add_clip'
      : command === 'split-clip' ? 'split_clip'
      : command === 'move-clip' ? 'move_clip'
      : command === 'trim-clip' ? 'trim_clip'
      : command === 'remove-clip' ? 'remove_clip'
      : command === 'add-track' ? 'add_track'
      : command === 'activate-sequence' ? 'activate_sequence'
      : command === 'set-sequence-size' ? 'set_sequence_size'
      : command === 'add-marker' ? 'add_marker'
      : command === 'remove-marker' ? 'remove_marker'
      : command === 'set-playhead' ? 'set_playhead'
      : command === 'select-clip' ? 'select_clip'
      : command === 'select-asset' ? 'select_asset'
      : command === 'duplicate-clip' ? 'duplicate_clip'
      : command === 'rename-clip' ? 'update_clip_label'
      : command === 'set-transition' ? 'set_transition'
      : command === 'add-effect' ? 'add_effect'
      : command === 'remove-effect' ? 'remove_effect'
      : command === 'list-effects' ? 'list_effects'
      : command === 'set-speed' ? 'set_speed'
      : command === 'set-volume' ? 'set_volume'
      : command === 'set-effect-keyframes' ? 'set_effect_keyframes'
      : command === 'ripple-delete-clip' ? 'ripple_delete_clip'
      : command === 'ripple-insert-gap' ? 'ripple_insert_gap'
      : command === 'import-files' ? 'import_files'
      : command === 'transcribe-asset' ? 'transcribe_asset'
      : command === 'embed-assets' ? 'embed_assets'
      : command === 'search-media' ? 'search_media'
      : command === 'search-spoken' ? 'search_spoken'
      : command === 'get-asset-segments' ? 'get_asset_segments'
      : command === 'search-segments' ? 'search_segments'
      : command === 'extract-frames' ? 'extract_frames'
      : command === 'create-contact-sheet' ? 'create_contact_sheet'
      : command === 'generate-image' ? 'generate_image'
      : command === 'edit-image' ? 'edit_image'
      : command === 'export-sequence' ? 'export_sequence'
      : command

    switch (normalizedCommand) {

      // ── Meta ──────────────────────────────────────────────────────────────
      case 'ping':
        return { status: 'ok', version: '1.0.0', port: this.PORT }

      case 'help': {
        return {
          description: 'Monet HTTP API — POST JSON to http://localhost:51847',
          usage: '{"command": "<name>", "args": {...}}',
          commands: [
            // Project
            'ping', 'help', 'get_project', 'get_settings',
            'get_control_state', 'set_playhead', 'select_clip', 'select_asset',
            // Assets & Search
            'list_assets', 'get_asset', 'import_files', 'transcribe_asset', 'embed_assets', 'generate_image', 'edit_image',
            'search_media', 'search_spoken', 'get_asset_segments', 'search_segments',
            'extract_frames', 'create_contact_sheet',
            // Sequences
            'list_sequences', 'create_sequence', 'activate_sequence', 'set_sequence_size', 'list_markers', 'add_marker', 'remove_marker',
            // Export
            'export_sequence',
            // Tracks
            'get_tracks', 'add_track',
            // Clips
            'list_clips', 'add_clip', 'remove_clip', 'move_clip', 'trim_clip',
            'split_clip', 'duplicate_clip', 'update_clip_label', 'ripple_delete_clip', 'ripple_insert_gap',
            // Effects
            'add_effect', 'remove_effect', 'list_effects',
            // Clip properties
            'set_speed', 'set_volume', 'set_transition', 'generate_captions', 'batch_selects_from_search', 'batch_markers_from_search',
            // History
            'undo', 'redo',
          ]
        }
      }

      // ── Project ───────────────────────────────────────────────────────────
      case 'get_project':
        return this.projectStore.getProject()

      case 'get_settings': {
        const s = await this.settingsStore.getSettings()
        return { selectedModelId: s.selectedModelId, semanticProvider: s.semanticProvider }
      }

      case 'get_control_state':
        return this.buildStateSnapshot()

      case 'set_playhead': {
        if (args.time == null) throw new Error('time required')
        const next = this.controlStateService.update({ playheadTime: Number(args.time) })
        this.safeSendToAll('editor:setPlayhead', next.playheadTime)
        return next
      }

      case 'select_clip': {
        const clipId = args.clipId == null ? null : String(args.clipId)
        const next = this.controlStateService.update({ selectedClipId: clipId })
        this.safeSendToAll('editor:selectClip', clipId)
        return next
      }

      case 'select_asset': {
        const assetId = args.assetId == null ? null : String(args.assetId)
        const next = this.controlStateService.update({ selectedAssetId: assetId })
        this.safeSendToAll('editor:selectAsset', assetId)
        return next
      }

      // ── Assets ────────────────────────────────────────────────────────────
      case 'list_assets':
        return this.projectStore.getProject().assets

      case 'get_asset': {
        const proj = this.projectStore.getProject()
        const asset = proj.assets.find((a) => a.id === args.assetId)
        if (!asset) throw new Error(`Asset not found: ${args.assetId}`)
        return asset
      }

      case 'get_asset_segments': {
        if (!args.assetId) throw new Error('assetId required')
        return this.projectStore.getAssetSegments(String(args.assetId))
      }

      case 'import_files': {
        if (!Array.isArray(args.paths)) throw new Error('paths array required')
        const imported = this.projectStore.importFiles(args.paths)
        this.enqueueAutomaticImportProcessing(imported)
        this.pushProjectUpdate()
        return imported
      }

      case 'transcribe_asset': {
        if (!args.assetId) throw new Error('assetId required')
        const result = await this.runTranscriptionJob(String(args.assetId), {
          language: args.language ? String(args.language) : undefined,
          requireKey: true
        })
        return { assetId: result.assetId, segmentCount: result.segments.length, segments: result.segments }
      }

      case 'search_media': {
        // Semantic search over assets — uses cosine similarity if vectors exist, keyword fallback otherwise
        if (!args.query) throw new Error('query required')
        const assets = this.projectStore.getProject().assets
        const limit = args.limit ?? 8

        if (this.embeddingService?.isReady) {
          try {
            const queryVector = await this.embeddingService.embedText(String(args.query))
            return semanticSearchWithVectors(assets, String(args.query), queryVector, limit)
              .map((r) => ({ assetId: r.asset.id, name: r.asset.name, type: r.asset.type,
                             score: r.score, matchedTerms: r.matchedTerms,
                             duration: r.asset.duration, tags: r.asset.semantic.tags }))
          } catch {
            // fall through to keyword
          }
        }
        return semanticSearch(assets, String(args.query), limit)
          .map((r) => ({ assetId: r.asset.id, name: r.asset.name, type: r.asset.type,
                         score: r.score, matchedTerms: r.matchedTerms,
                         duration: r.asset.duration, tags: r.asset.semantic.tags }))
      }

      case 'search_spoken': {
        // Substring search within transcribed segments
        if (!args.query) throw new Error('query required')
        const query = String(args.query).trim().toLowerCase()
        const limit = args.limit ?? 20
        const proj = this.projectStore.getProject()
        const withTranscripts = proj.assets.filter((a) => a.semantic.transcript.length > 0)
        if (withTranscripts.length === 0)
          return { status: 'unavailable', message: 'No transcripts yet — run transcribe_asset first' }

        const matches = withTranscripts.flatMap((asset) =>
          asset.semantic.transcript
            .filter((seg) => seg.text.toLowerCase().includes(query))
            .map((seg) => ({ assetId: asset.id, assetName: asset.name,
                             start: seg.start, end: seg.end, text: seg.text, speaker: seg.speaker }))
        )
        return { status: matches.length > 0 ? 'ok' : 'no_match', query, matches: matches.slice(0, limit) }
      }

      case 'search_segments': {
        if (!args.query) throw new Error('query required')
        const assets = this.projectStore.getProject().assets
        const limit = args.limit ?? 12

        if (this.embeddingService?.isReady) {
          try {
            const queryVector = await this.embeddingService.embedText(String(args.query))
            return searchSegmentsWithVectors(assets, String(args.query), queryVector, limit)
              .map((result) => ({
                assetId: result.asset.id,
                assetName: result.asset.name,
                segmentId: result.segment.id,
                kind: result.segment.kind,
                start: result.segment.start,
                end: result.segment.end,
                label: result.segment.label,
                text: result.segment.text,
                score: result.score
              }))
          } catch {
            // fall through to keyword
          }
        }

        return searchSegments(assets, String(args.query), limit)
          .map((result) => ({
            assetId: result.asset.id,
            assetName: result.asset.name,
            segmentId: result.segment.id,
            kind: result.segment.kind,
            start: result.segment.start,
            end: result.segment.end,
            label: result.segment.label,
            text: result.segment.text,
            score: result.score
          }))
      }

      case 'extract_frames': {
        if (!this.frameExtractionService) throw new Error('Frame extraction service not initialized')
        if (!args.assetId) throw new Error('assetId required')
        const asset = this.projectStore.getProject().assets.find((item) => item.id === args.assetId)
        if (!asset) throw new Error(`Asset not found: ${args.assetId}`)
        return this.frameExtractionService.extractFrames(asset, {
          count: typeof args.count === 'number' ? args.count : undefined
        })
      }

      case 'create_contact_sheet': {
        if (!this.frameExtractionService) throw new Error('Frame extraction service not initialized')
        if (!args.assetId) throw new Error('assetId required')
        const asset = this.projectStore.getProject().assets.find((item) => item.id === args.assetId)
        if (!asset) throw new Error(`Asset not found: ${args.assetId}`)
        return this.frameExtractionService.createContactSheet(asset, {
          count: typeof args.count === 'number' ? args.count : undefined
        })
      }

      case 'embed_assets': {
        if (!this.embeddingService) throw new Error('Embedding service not initialized')
        const settings = await this.settingsStore.getSettings()
        const key = settings.semanticApiKeys.openai || settings.apiKeys.openai
        if (!key) throw new Error('OpenAI API key not configured')
        this.embeddingService.setApiKey(key)
        const toEmbed = args.all ? this.projectStore.getProject().assets : this.projectStore.getAssetsWithoutVectors()
        const toEmbedSegments = args.all ? this.projectStore.getProject().assets : this.projectStore.getAssetsWithUnembeddedSegments()
        if (toEmbed.length === 0 && toEmbedSegments.length === 0) {
          return { embeddedAssets: 0, embeddedSegments: 0, message: 'All assets already embedded' }
        }
        const assetResults = toEmbed.length > 0 ? await this.embeddingService.embedAssets(toEmbed) : []
        const segmentResults = toEmbedSegments.length > 0 ? await this.embeddingService.embedAssetSegments(toEmbedSegments) : []
        for (const { id, vector } of assetResults) this.projectStore.updateAssetVector(id, vector)
        for (const asset of toEmbedSegments) {
          const vectors = segmentResults
            .filter((result) => result.assetId === asset.id)
            .map((result) => ({ segmentId: result.segmentId, vector: result.vector }))
          if (vectors.length > 0) this.projectStore.updateAssetSegmentVectors(asset.id, vectors)
        }
        this.pushProjectUpdate()
        return {
          embeddedAssets: assetResults.length,
          embeddedSegments: segmentResults.length,
          totalAssets: toEmbed.length,
          totalAssetsWithUnembeddedSegments: toEmbedSegments.length
        }
      }

      case 'generate_image': {
        // If the user is in canvas mode, require explicit confirmation so the agent
        // cannot skip the "draw vs. generate" question.
        const viewState = this.controlStateService.getState()
        if (viewState.activeView === 'canvas' && !args.canvas_confirmed) {
          throw new Error(
            'CANVAS MODE — You must ask the user before generating an image.\n\n' +
            'Ask: "Do you want me to design this directly on the canvas with editable layers, ' +
            'draw it in code on the canvas, or generate it as a photo/image using GPT image generation?"\n\n' +
            'If the user confirms image generation, call generate_image again with canvas_confirmed: true. ' +
            'If they want direct design editing, use a design frame. If they want it drawn, use canvas-run-paperjs or canvas-run-matterjs instead.'
          )
        }
        return this.generateImageAsset({
          prompt: args.prompt ? String(args.prompt) : undefined,
          size: args.size ? String(args.size) : undefined,
          quality: args.quality ? String(args.quality) : undefined,
          background: args.background ? String(args.background) : undefined,
          format: args.format ? String(args.format) : undefined,
          moderation: args.moderation ? String(args.moderation) : undefined,
          outputCompression: typeof args.outputCompression === 'number' ? args.outputCompression : undefined,
          partialImages: typeof args.partialImages === 'number' ? args.partialImages : undefined
        })
      }

      case 'edit_image':
        return this.editImageAsset({
          prompt: args.prompt ? String(args.prompt) : undefined,
          inputs: Array.isArray(args.inputs) ? args.inputs.map((item) => String(item)) : undefined,
          size: args.size ? String(args.size) : undefined,
          quality: args.quality ? String(args.quality) : undefined,
          background: args.background ? String(args.background) : undefined,
          format: args.format ? String(args.format) : undefined,
          outputCompression: typeof args.outputCompression === 'number' ? args.outputCompression : undefined,
          partialImages: typeof args.partialImages === 'number' ? args.partialImages : undefined,
          inputFidelity: args.inputFidelity ? String(args.inputFidelity) : undefined,
          mask: args.mask ? String(args.mask) : undefined
        })

      case 'export_sequence': {
        if (!this.exportService) throw new Error('Export service not initialized')
        if (!args.outputPath) throw new Error('outputPath required')
        return this.exportService.exportActiveSequence(String(args.outputPath), {
          quality: args.quality === 'draft' || args.quality === 'standard' || args.quality === 'high' ? args.quality : 'high',
          resolution: args.resolution === '720p' || args.resolution === '1080p' || args.resolution === '4k' ? args.resolution : '1080p',
          format: args.format === 'mov' ? 'mov' : 'mp4'
        })
      }

      // ── Sequences ─────────────────────────────────────────────────────────
      case 'list_sequences':
        return this.projectStore.getProject().sequences

      case 'get_sequence': {
        if (!args.sequenceId) throw new Error('sequenceId required')
        const sequence = this.projectStore.getProject().sequences.find((item) => item.id === String(args.sequenceId))
        if (!sequence) throw new Error(`Sequence not found: ${args.sequenceId}`)
        return sequence
      }

      case 'create_sequence': {
        if (!args.name) throw new Error('name required')
        const seq = this.projectStore.createSequence(
          args.name,
          typeof args.width === 'number' ? Number(args.width) : undefined,
          typeof args.height === 'number' ? Number(args.height) : undefined
        )
        this.controlStateService.update({ activeSequenceId: seq.id })
        this.pushProjectUpdate()
        return seq
      }

      case 'delete_sequence': {
        if (!args.sequenceId) throw new Error('sequenceId required')
        const result = this.projectStore.deleteSequence(String(args.sequenceId))
        if (result.activeSequenceId) {
          this.controlStateService.update({ activeSequenceId: result.activeSequenceId })
        }
        this.pushProjectUpdate()
        return result
      }

      case 'remove_asset':
      case 'delete_asset': {
        if (!args.assetId) throw new Error('assetId required')
        const assetId = String(args.assetId)
        const asset = this.projectStore.snapshot().assets.find((a) => a.id === assetId)
        if (!asset) throw new Error(`Asset not found: ${assetId}`)
        const deleteFile = args.deleteFile === true || args.deleteFile === 'true'
        const filePath = asset.path
        this.projectStore.removeAsset(assetId)
        let fileDeleted = false
        if (deleteFile && filePath) {
          try {
            const { unlink } = await import('fs/promises')
            await unlink(filePath)
            fileDeleted = true
          } catch (err) {
            console.warn('[api-bridge] Failed to delete asset file:', err)
          }
        }
        this.pushProjectUpdate()
        return { ok: true, assetId, fileDeleted, path: filePath ?? null }
      }

      case 'activate_sequence': {
        if (!args.sequenceId) throw new Error('sequenceId required')
        const seq = this.projectStore.activateSequence(args.sequenceId)
        this.controlStateService.update({ activeSequenceId: seq.id })
        this.pushProjectUpdate()
        return seq
      }

      case 'set_sequence_size': {
        if (args.width == null || args.height == null) {
          throw new Error('width and height required')
        }
        const seq = this.projectStore.setSequenceSize(
          args.sequenceId ? String(args.sequenceId) : undefined,
          Number(args.width),
          Number(args.height)
        )
        this.pushProjectUpdate()
        return seq
      }

      case 'list_markers':
        return this.projectStore.listMarkers(args.sequenceId ? String(args.sequenceId) : undefined)

      case 'add_marker': {
        if (args.time == null || !args.label) throw new Error('time and label required')
        const marker = this.projectStore.addMarker({
          sequenceId: args.sequenceId ? String(args.sequenceId) : undefined,
          time: Number(args.time),
          duration: args.duration != null ? Number(args.duration) : undefined,
          label: String(args.label),
          color: args.color ? String(args.color) : undefined,
          assetId: args.assetId ? String(args.assetId) : undefined,
          segmentId: args.segmentId ? String(args.segmentId) : undefined,
          notes: args.notes ? String(args.notes) : undefined
        })
        this.pushProjectUpdate()
        return marker
      }

      case 'remove_marker': {
        if (!args.markerId) throw new Error('markerId required')
        this.projectStore.removeMarker(String(args.markerId), args.sequenceId ? String(args.sequenceId) : undefined)
        this.pushProjectUpdate()
        return { success: true }
      }

      // ── Tracks ────────────────────────────────────────────────────────────
      case 'get_tracks': {
        const proj = this.projectStore.getProject()
        const seq = args.sequenceId
          ? proj.sequences.find((s) => s.id === args.sequenceId)
          : proj.sequences.find((s) => s.active) ?? proj.sequences[0]
        if (!seq) throw new Error('No active sequence')
        return seq.tracks.map((t) => ({ id: t.id, name: t.name, kind: t.kind, clipCount: t.clips.length }))
      }

      case 'add_track': {
        const kind = args.kind as 'video' | 'audio' | 'caption'
        if (!['video', 'audio', 'caption'].includes(kind)) throw new Error('kind must be video | audio | caption')
        const seq = this.projectStore.addTrack(kind)
        this.pushProjectUpdate()
        return seq
      }

      // ── Clips ─────────────────────────────────────────────────────────────
      case 'list_clips': {
        const proj = this.projectStore.getProject()
        const seq = args.sequenceId
          ? proj.sequences.find((s) => s.id === args.sequenceId)
          : proj.sequences.find((s) => s.active) ?? proj.sequences[0]
        if (!seq) throw new Error('Sequence not found')
        const clips = seq.tracks.flatMap((t) =>
          t.clips.map((c) => ({ ...c, trackKind: t.kind, trackName: t.name }))
        )
        return clips.sort((a, b) => a.startTime - b.startTime)
      }

      case 'add_clip': {
        const { assetId, trackId, startTime, duration, inPoint } = args
        const proj = this.projectStore.getProject()
        const asset = proj.assets.find((a) => a.id === assetId)
        if (!asset) throw new Error(`Asset not found: ${assetId}`)
        const trackExists = proj.sequences.some((s) => s.tracks.some((t) => t.id === trackId))
        if (!trackExists) throw new Error(`Track not found: ${trackId}`)
        const result = this.projectStore.addClip({
          assetId,
          trackId,
          startTime: startTime ?? 0,
          duration: duration ?? asset.duration,
          inPoint: inPoint ?? 0,
          label: asset.name
        })
        this.pushProjectUpdate()
        return result
      }

      case 'remove_clip': {
        if (!args.clipId) throw new Error('clipId required')
        this.projectStore.removeClip(args.clipId)
        this.pushProjectUpdate()
        return { success: true }
      }

      case 'move_clip': {
        if (!args.clipId) throw new Error('clipId required')
        this.projectStore.moveClip(args.clipId, args.startTime)
        this.pushProjectUpdate()
        return { success: true }
      }

      case 'trim_clip': {
        const { clipId, inPoint, duration, startTime } = args
        if (!clipId) throw new Error('clipId required')
        const result = this.projectStore.trimClip(clipId, { inPoint, duration, startTime })
        this.pushProjectUpdate()
        return result
      }

      case 'split_clip': {
        if (!args.clipId || args.time == null) throw new Error('clipId and time required')
        const result = this.projectStore.splitClip(args.clipId, args.time)
        this.pushProjectUpdate()
        return result
      }

      case 'duplicate_clip': {
        if (!args.clipId) throw new Error('clipId required')
        const result = this.projectStore.duplicateClip(args.clipId, args.offsetSeconds ?? 0)
        this.pushProjectUpdate()
        return result
      }

      case 'update_clip_label': {
        if (!args.clipId || !args.label) throw new Error('clipId and label required')
        this.projectStore.updateClipLabel(args.clipId, args.label)
        this.pushProjectUpdate()
        return { success: true }
      }

      case 'ripple_delete_clip': {
        if (!args.clipId) throw new Error('clipId required')
        this.projectStore.rippleDeleteClip(String(args.clipId))
        this.pushProjectUpdate()
        return { success: true }
      }

      case 'ripple_insert_gap': {
        if (args.time == null || args.duration == null) throw new Error('time and duration required')
        const sequence = this.projectStore.rippleInsertGap(
          Number(args.time),
          Number(args.duration),
          args.sequenceId ? String(args.sequenceId) : undefined
        )
        this.pushProjectUpdate()
        return sequence
      }

      // ── Effects ───────────────────────────────────────────────────────────
      case 'list_effects': {
        return {
          available: [
            'fade_in',
            'fade_out',
            'color_grade',
            'blur',
            'sharpen',
            'speed_ramp',
            'transform',
            'opacity',
            'blend_mode',
            'text_overlay',
            'chroma_key',
            'mask_box',
            'drop_shadow',
            'glow',
            'background_fill',
            'gradient_fill',
            'shape_overlay'
          ],
          parameters: {
            fade_in:     { duration: 'number (seconds, default 1)' },
            fade_out:    { duration: 'number (seconds, default 1)' },
            color_grade: { brightness: 'number (-1 to 1)', contrast: 'number (0.5–2)', saturation: 'number (0–3)' },
            blur:        { radius: 'number (pixels, default 5)' },
            sharpen:     { amount: 'number (0–3, default 1)' },
            speed_ramp:  { speed: 'number (0.1–10, use set_speed instead)' },
            transform:   { x: 'number (px)', y: 'number (px)', scaleX: 'number', scaleY: 'number', rotation: 'number (deg)' },
            opacity:     { opacity: 'number (0–1)' },
            blend_mode:  { mode: 'string (normal|screen|multiply|overlay|lighten)' },
            text_overlay:{
              text: 'string',
              x: 'number (px)',
              y: 'number (px)',
              scale: 'number',
              rotation: 'number (deg)',
              opacity: 'number (0–1)',
              fontSize: 'number (px)',
              color: 'string (#ffffff)',
              fontFamily: 'string (family name or absolute font path)',
              fontWeight: 'number|string (400|500|600|700...)',
              letterSpacing: 'number (px)',
              lineHeight: 'number (multiplier, e.g. 1.05)',
              textAlign: 'string (left|center|right)',
              maxWidth: 'number (px)',
              strokeColor: 'string (#000000)',
              strokeWidth: 'number (px)'
            },
            chroma_key:  { color: 'string (#00ff00)', similarity: 'number (0–1)', blend: 'number (0–1)' },
            mask_box:    { x: 'number (px)', y: 'number (px)', width: 'number (px)', height: 'number (px)', feather: 'number (px)' },
            drop_shadow: { color: 'string (#000000)', opacity: 'number (0–1)', blur: 'number (px)', offsetX: 'number (px)', offsetY: 'number (px)' },
            glow:        { color: 'string (#ffffff)', opacity: 'number (0–1)', radius: 'number (px)' },
            background_fill: { color: 'string (#000000)', opacity: 'number (0–1)' },
            gradient_fill: { fromColor: 'string (#ffffff)', toColor: 'string (#ffffff)', angle: 'number (deg)', opacity: 'number (0–1)' },
            shape_overlay: {
              shape: 'string (rect|line)',
              x: 'number (px)',
              y: 'number (px)',
              width: 'number (px)',
              height: 'number (px)',
              color: 'string (#ffffff)',
              opacity: 'number (0–1)',
              strokeWidth: 'number (px)'
            }
          },
          motion: {
            set_effect_keyframes: 'Attach ordered keyframes to an existing effect. Numeric parameters interpolate over time.'
          },
          transitions: ['crossfade', 'dip_to_black', 'wipe', 'slide']
        }
      }

      case 'add_effect': {
        if (!args.clipId || !args.effectType) throw new Error('clipId and effectType required')
        const result = this.projectStore.addClipEffect(args.clipId, args.effectType, args.parameters ?? {})
        this.pushProjectUpdate()
        return result
      }

      case 'remove_effect': {
        if (!args.clipId || !args.effectId) throw new Error('clipId and effectId required')
        const result = this.projectStore.removeClipEffect(args.clipId, args.effectId)
        this.pushProjectUpdate()
        return result
      }

      case 'set_effect_keyframes': {
        if (!args.clipId || !args.effectId || !Array.isArray(args.keyframes)) {
          throw new Error('clipId, effectId, and keyframes[] required')
        }
        const result = this.projectStore.setClipEffectKeyframes(
          String(args.clipId),
          String(args.effectId),
          args.keyframes as Array<{
            id?: string
            time: number
            easing?: 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out'
            parameters: Record<string, unknown>
          }>
        )
        this.pushProjectUpdate()
        return result
      }

      // ── Clip properties ───────────────────────────────────────────────────
      case 'set_speed': {
        if (!args.clipId || args.speed == null) throw new Error('clipId and speed required')
        const result = this.projectStore.setClipSpeed(args.clipId, args.speed)
        this.pushProjectUpdate()
        return result
      }

      case 'set_volume': {
        if (!args.clipId || args.volume == null) throw new Error('clipId and volume required')
        const result = this.projectStore.setClipVolume(args.clipId, args.volume)
        this.pushProjectUpdate()
        return result
      }

      case 'set_transition': {
        // args: { clipId, side: 'in'|'out', type: 'crossfade'|'dip_to_black'|'wipe'|'slide'|null, duration? }
        if (!args.clipId || !args.side) throw new Error('clipId and side (in|out) required')
        this.projectStore.setClipTransition(args.clipId, args.side, args.type ?? null, args.duration ?? 1.0)
        this.pushProjectUpdate()
        return { success: true }
      }

      case 'generate_captions': {
        if (!args.assetId) throw new Error('assetId required')
        const sequence = this.projectStore.generateCaptionsForAsset(String(args.assetId), {
          sequenceId: args.sequenceId ? String(args.sequenceId) : undefined,
          replaceExisting: Boolean(args.replaceExisting),
          minDuration: args.minDuration != null ? Number(args.minDuration) : undefined
        })
        this.pushProjectUpdate()
        return sequence
      }

      case 'batch_selects_from_search': {
        if (!args.query) throw new Error('query required')
        const assets = this.projectStore.getProject().assets
        const limit = args.limit != null ? Number(args.limit) : 12
        const query = String(args.query)
        const matches = this.embeddingService?.isReady
          ? await (async () => {
              try {
                const queryVector = await this.embeddingService.embedText(query)
                return searchSegmentsWithVectors(assets, query, queryVector, limit)
              } catch {
                return searchSegments(assets, query, limit)
              }
            })()
          : searchSegments(assets, query, limit)

        const sequence = this.projectStore.buildSelectsSequenceFromSegments(matches, {
          sequenceName: args.sequenceName ? String(args.sequenceName) : undefined,
          padding: args.padding != null ? Number(args.padding) : undefined,
          limit
        })
        this.pushProjectUpdate()
        return sequence
      }

      case 'batch_markers_from_search': {
        if (!args.query) throw new Error('query required')
        const assets = this.projectStore.getProject().assets
        const limit = args.limit != null ? Number(args.limit) : 12
        const query = String(args.query)
        const matches = this.embeddingService?.isReady
          ? await (async () => {
              try {
                const queryVector = await this.embeddingService.embedText(query)
                return searchSegmentsWithVectors(assets, query, queryVector, limit)
              } catch {
                return searchSegments(assets, query, limit)
              }
            })()
          : searchSegments(assets, query, limit)

        const created = matches.map((match) =>
          this.projectStore.addMarker({
            sequenceId: args.sequenceId ? String(args.sequenceId) : undefined,
            time: match.segment.start,
            duration: Math.max(0, match.segment.end - match.segment.start),
            label: match.segment.label,
            color: match.segment.kind === 'speech' ? 'blue' : match.segment.kind === 'visual' ? 'green' : 'gray',
            assetId: match.asset.id,
            segmentId: match.segment.id,
            notes: match.segment.text
          })
        )
        this.pushProjectUpdate()
        return created
      }

      // ── Canvas ────────────────────────────────────────────────────────────
      case 'canvas-get-state':
      case 'canvas_get_state': {
        const state = this.canvasStateProvider ? this.canvasStateProvider() : []
        return { frames: state, count: (state as unknown[]).length }
      }

      case 'canvas-add-frame':
      case 'canvas_add_frame': {
        this.safeSendToAll('canvas:command', { command: 'add-frame', args })
        return { ok: true }
      }

      case 'canvas-add-design-frame':
      case 'canvas_add_design_frame': {
        const width = typeof args.width === 'number' ? args.width : 1280
        const height = typeof args.height === 'number' ? args.height : 720
        const compiledDesign = args.design !== undefined
          ? compileSemanticCanvasDesign(args.design, width, height, { forceEditableDesign: true })
          : undefined
        if (args.design !== undefined) {
          try {
            validateCanvasDesignPayload(compiledDesign)
          } catch (error) {
            this.pushCanvasFrameError(error instanceof Error ? error.message : String(error), args)
            throw error
          }
        }
        this.safeSendToAll('canvas:command', {
          command: 'add-frame',
          args: {
            ...args,
            mode: 'design',
            ...(compiledDesign !== undefined ? { design: compiledDesign } : {})
          }
        })
        return { ok: true }
      }

      case 'canvas-update-frame':
      case 'canvas_update_frame': {
        this.safeSendToAll('canvas:command', { command: 'update-frame', args })
        return { ok: true }
      }

      case 'canvas-update-design-frame':
      case 'canvas_update_design_frame': {
        const frameId = typeof args.id === 'string' ? args.id : typeof args.frameId === 'string' ? args.frameId : null
        const { width, height } = this.resolveCanvasFrameSize(frameId)
        const compiledDesign = compileSemanticCanvasDesign(args.design, width, height, { forceEditableDesign: true })
        try {
          validateCanvasDesignPayload(compiledDesign)
        } catch (error) {
          this.pushCanvasFrameError(error instanceof Error ? error.message : String(error), args)
          throw error
        }
        this.safeSendToAll('canvas:command', {
          command: 'update-frame',
          args: {
            ...args,
            mode: 'design',
            design: compiledDesign
          }
        })
        return { ok: true }
      }

      case 'canvas-delete-frame':
      case 'canvas_delete_frame': {
        this.safeSendToAll('canvas:command', { command: 'delete-frame', args })
        return { ok: true }
      }

      case 'canvas-select-frame':
      case 'canvas_select_frame': {
        this.safeSendToAll('canvas:command', { command: 'select-frame', args })
        return { ok: true }
      }

      case 'canvas-clear':
      case 'canvas_clear': {
        this.safeSendToAll('canvas:command', { command: 'clear', args: {} })
        return { ok: true }
      }

      case 'canvas_run_paperjs':
      case 'canvas-run-paperjs': {
        const frameId = typeof args.frameId === 'string' ? args.frameId : typeof args.id === 'string' ? args.id : null
        if (!frameId) throw new Error('canvas_run_paperjs requires frameId')
        const script = typeof args.script === 'string' ? args.script : null
        if (!script) throw new Error('canvas_run_paperjs requires script')
        this.safeSendToAll('canvas:command', { command: 'update-frame', args: { id: frameId, script, mode: 'paperjs' } })
        return { ok: true }
      }

      case 'canvas_run_matterjs':
      case 'canvas-run-matterjs': {
        const frameId = typeof args.frameId === 'string' ? args.frameId : typeof args.id === 'string' ? args.id : null
        if (!frameId) throw new Error('canvas_run_matterjs requires frameId')
        const script = typeof args.script === 'string' ? args.script : null
        if (!script) throw new Error('canvas_run_matterjs requires script')
        this.safeSendToAll('canvas:command', { command: 'update-frame', args: { id: frameId, script, mode: 'matterjs' } })
        return { ok: true }
      }

      case 'canvas_get_frames':
      case 'canvas-get-frames': {
        const state = this.canvasStateProvider ? this.canvasStateProvider() : []
        return { frames: state, count: (state as unknown[]).length }
      }

      case 'canvas_loading':
      case 'canvas-loading': {
        const message = typeof args.message === 'string' ? args.message : (Array.isArray(args) ? args[0] : undefined)
        this.safeSendToAll('canvas:command', { command: 'set-loading', args: { message } })
        return { ok: true }
      }

      case 'canvas_done':
      case 'canvas-done': {
        this.safeSendToAll('canvas:command', { command: 'clear-loading', args: {} })
        return { ok: true }
      }

      case 'canvas-set-zoom':
      case 'canvas_set_zoom': {
        this.safeSendToAll('canvas:command', { command: 'set-zoom', args })
        return { ok: true }
      }

      case 'canvas-set-loading':
      case 'canvas_set_loading': {
        this.safeSendToAll('canvas:command', { command: 'set-loading', args })
        return { ok: true }
      }

      case 'canvas-clear-loading':
      case 'canvas_clear_loading': {
        this.safeSendToAll('canvas:command', { command: 'clear-loading', args: {} })
        return { ok: true }
      }

      case 'canvas-render-png':
      case 'canvas_render_png': {
        const frameId = typeof args.frameId === 'string' ? args.frameId
                       : typeof args.id === 'string' ? args.id
                       : null
        const outputPath = typeof args.outputPath === 'string' ? args.outputPath
                          : typeof args.path === 'string' ? args.path
                          : null
        if (!frameId || !outputPath) throw new Error('canvas-render-png requires frameId and outputPath')

        // Ask the renderer to capture the iframe's canvas
        const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
        if (!win) throw new Error('No window available')
        const dataUrl: string | null = await win.webContents.executeJavaScript(`
          (function() {
            try {
              var iframe = document.querySelector('iframe[data-frame-id=${JSON.stringify(frameId)}]');
              if (!iframe || !iframe.contentDocument) return null;
              var canvas = iframe.contentDocument.getElementById('canvas');
              if (!canvas || typeof canvas.toDataURL !== 'function') return null;
              return canvas.toDataURL('image/png');
            } catch (e) { return null; }
          })()
        `)
        if (!dataUrl) throw new Error(`Frame ${frameId} not found, has no canvas, or capture failed`)

        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
        const buffer = Buffer.from(base64, 'base64')
        await writeFileAsync(outputPath, buffer)
        return { ok: true, frameId, outputPath, bytes: buffer.length }
      }

      case 'canvas-export-to-path':
      case 'canvas_export_to_path': {
        const path = typeof args.path === 'string' ? args.path : null
        if (!path) throw new Error('canvas-export-to-path requires args.path')
        const artboards = this.canvasStateProvider ? this.canvasStateProvider() : []
        const payload = { version: 1, exportedAt: new Date().toISOString(), artboards }
        await writeFileAsync(path, JSON.stringify(payload, null, 2), 'utf8')
        return { ok: true, path, frameCount: Array.isArray(artboards) ? artboards.length : 0 }
      }

      case 'canvas-import-from-path':
      case 'canvas_import_from_path': {
        const path = typeof args.path === 'string' ? args.path : null
        if (!path) throw new Error('canvas-import-from-path requires args.path')
        const raw = await readFile(path, 'utf8')
        const parsed = JSON.parse(raw)
        const artboards = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed.artboards) ? parsed.artboards : []
        // Send each artboard as an add-frame command to the renderer.
        // The renderer adds new IDs and positions, preserving any existing frames.
        for (const ab of artboards) {
          this.safeSendToAll('canvas:command', {
            command: 'add-frame',
            args: {
              name: ab.name,
              width: ab.width,
              height: ab.height,
              mode: ab.mode,
              html: ab.html,
              script: ab.script,
            }
          })
        }
        return { ok: true, frameCount: artboards.length, path }
      }

      case 'canvas-add-image':
      case 'canvas_add_image': {
        const imagePath = typeof args.imagePath === 'string' ? args.imagePath : null
        if (!imagePath || !existsSync(imagePath)) {
          throw new Error(`Image file not found: ${imagePath}`)
        }

        // 1. Read image and encode as data URL so the sandboxed iframe can display it
        const ext = extname(imagePath).toLowerCase().replace('.', '')
        const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
        const imageData = await readFile(imagePath)
        const dataUrl = `data:${mime};base64,${imageData.toString('base64')}`

        // 2. Detect natural dimensions if possible (rough heuristic via file size)
        const w = typeof args.width === 'number' ? args.width : 1280
        const h = typeof args.height === 'number' ? args.height : 720

        const html = `<div style="width:${w}px;height:${h}px;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden;"><img src="${dataUrl}" style="max-width:100%;max-height:100%;object-fit:contain;" /></div>`
        const frameName = basename(imagePath, extname(imagePath))

        // 3. Add canvas frame
        this.safeSendToAll('canvas:command', {
          command: 'add-frame',
          args: { name: frameName, width: w, height: h, mode: 'html', html }
        })

        // 4. Also import into video editor media library
        let asset = null
        try {
          const [imported] = this.projectStore.importFiles([imagePath])
          asset = imported
          this.pushProjectUpdate()
        } catch {
          // Non-fatal — canvas frame was added regardless
        }

        return { ok: true, frameName, width: w, height: h, asset }
      }

      // ── History ───────────────────────────────────────────────────────────
      case 'undo': {
        const proj = this.projectStore.undo()
        this.pushProjectUpdate()
        return proj
      }

      case 'redo': {
        const proj = this.projectStore.redo()
        this.pushProjectUpdate()
        return proj
      }

      default:
        throw new Error(`Unknown command: "${command}". Send {"command":"help"} for the full command list.`)
    }
  }
}
