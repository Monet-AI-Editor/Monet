import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
// Inline library content so iframes work in any environment (no CDN, no file:// path issues)
// @ts-ignore — vite ?raw import
import paperRaw from '../libs/paper-full.min.js?raw'
// @ts-ignore
import matterRaw from '../libs/matter.min.js?raw'
import {
  Plus, ZoomIn, ZoomOut, Maximize2, Code2, X, Check,
  Palette, Trash2, ChevronDown, LayoutGrid, Download, Upload
} from 'lucide-react'
import clsx from 'clsx'
import type { MediaAsset } from '../types'

type ArtboardMode = 'design' | 'html' | 'paperjs' | 'matterjs'
type DesignTextAlign = 'left' | 'center' | 'right'
type DesignStackDirection = 'vertical' | 'horizontal'
type DesignStackAlign = 'start' | 'center' | 'end' | 'stretch'
type DesignStackJustify = 'start' | 'center' | 'end' | 'space-between'
type DesignStackSizing = 'fixed' | 'fill' | 'hug'
type DesignGridAlign = 'start' | 'center' | 'end' | 'stretch'

type DesignNode =
  | {
      id: string
      name: string
      type: 'rect'
      x: number
      y: number
      width: number
      height: number
      rotation: number
      opacity: number
      radius: number
      fill: string
      stroke: string
      strokeWidth: number
    }
  | {
      id: string
      name: string
      type: 'text'
      x: number
      y: number
      width: number
      height: number
      rotation: number
      opacity: number
      text: string
      fill: string
      fontSize: number
      fontWeight: number
      letterSpacing: number
      align: DesignTextAlign
      sizing?: DesignStackSizing
    }
  | {
      id: string
      name: string
      type: 'stack'
      x: number
      y: number
      width: number
      height: number
      rotation: number
      opacity: number
      direction: DesignStackDirection
      gap: number
      padding: number
      alignItems: DesignStackAlign
      justifyContent: DesignStackJustify
      fill: string
      radius: number
      stroke: string
      strokeWidth: number
      sizing: DesignStackSizing
      children: DesignNode[]
    }
  | {
      id: string
      name: string
      type: 'grid'
      x: number
      y: number
      width: number
      height: number
      rotation: number
      opacity: number
      columns: number
      gap: number
      padding: number
      alignItems: DesignGridAlign
      fill: string
      radius: number
      stroke: string
      strokeWidth: number
      sizing: DesignStackSizing
      children: DesignNode[]
    }

type DesignDocument = {
  background: string
  nodes: DesignNode[]
}

interface Artboard {
  id: string
  name: string
  width: number
  height: number
  html: string
  script: string
  mode: ArtboardMode
  design?: DesignDocument
  x: number
  y: number
}

type HtmlInspectorNode = {
  id: string
  tagName: string
  label: string
  textContent: string
  color: string
  backgroundColor: string
  width: string
  height: string
  minHeight: string
  fontSize: string
  fontWeight: string
  borderRadius: string
  padding: string
  margin: string
  display: string
  flexDirection: string
  justifyContent: string
  alignItems: string
  flexWrap: string
  gap: string
  border: string
  boxShadow: string
  opacity: string
}

type HtmlInspectorTreeNode = {
  id: string
  tagName: string
  label: string
  children: HtmlInspectorTreeNode[]
}

type HtmlOverlayRect = {
  left: number
  top: number
  width: number
  height: number
}

type HtmlGuideLines = {
  left: number
  right: number
  top: number
  bottom: number
  centerX: number
  centerY: number
  snappedVertical?: 'left' | 'right' | 'center'
  snappedHorizontal?: 'top' | 'bottom' | 'center'
}

type HtmlSpacingGuide = {
  orientation: 'horizontal' | 'vertical'
  start: number
  end: number
  cross: number
  distance: number
}

type HtmlDragState = {
  artboardId: string
  nodeId: string
  mode: 'move' | 'resize'
  handle?: 'nw' | 'ne' | 'sw' | 'se'
  startMouseX: number
  startMouseY: number
  originLeft: number
  originTop: number
  originWidth: number
  originHeight: number
}

type DesignNodeLocation = {
  node: DesignNode
  siblings: DesignNode[]
  index: number
  parent: Extract<DesignNode, { type: 'stack' | 'grid' }> | null
}

const GRID = 40
const GAP = 80
const DESIGN_HANDLE_SIZE = 10
const HTML_SNAP_THRESHOLD = 8

type DesignDragState = {
  artboardId: string
  nodeId: string
  mode: 'move' | 'resize'
  handle?: 'nw' | 'ne' | 'sw' | 'se'
  startMouseX: number
  startMouseY: number
  originX: number
  originY: number
  originWidth: number
  originHeight: number
}

let _id = 0
const uid = () => `ab-${++_id}-${Date.now()}`
const isContainerNode = (node: DesignNode): node is Extract<DesignNode, { type: 'stack' | 'grid' }> =>
  node.type === 'stack' || node.type === 'grid'

function cloneDesignDocument(document: DesignDocument): DesignDocument {
  return JSON.parse(JSON.stringify(document)) as DesignDocument
}

function createDefaultDesignDocument(_width: number, _height: number): DesignDocument {
  return {
    background: '#111111',
    nodes: []
  }
}

function normalizeDesignDocument(document: DesignDocument | undefined, width: number, height: number): DesignDocument {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
  const normalizeBox = (x: number, y: number, nodeWidth: number, nodeHeight: number, minWidth: number, minHeight: number) => {
    const safeWidth = clamp(Math.round(nodeWidth), minWidth, Math.max(minWidth, width))
    const safeHeight = clamp(Math.round(nodeHeight), minHeight, Math.max(minHeight, height))
    return {
      width: safeWidth,
      height: safeHeight,
      x: clamp(Math.round(x), 0, Math.max(0, width - safeWidth)),
      y: clamp(Math.round(y), 0, Math.max(0, height - safeHeight))
    }
  }

  if (!document || !Array.isArray(document.nodes)) {
    return createDefaultDesignDocument(width, height)
  }

  const normalizeNodes = (nodes: unknown[], containerWidth: number, containerHeight: number): DesignNode[] => (
    nodes
      .map((node): DesignNode | null => {
        if (!node || typeof node !== 'object') return null
        const candidate = node as Partial<DesignNode>
        if (candidate.type === 'stack') {
          const stack = candidate as Extract<DesignNode, { type: 'stack' }>
          const box = normalizeBox(
            typeof stack.x === 'number' ? stack.x : 0,
            typeof stack.y === 'number' ? stack.y : 0,
            typeof stack.width === 'number' ? stack.width : Math.min(560, containerWidth),
            typeof stack.height === 'number' ? stack.height : Math.min(320, containerHeight),
            80,
            80
          )
          return {
            id: typeof stack.id === 'string' ? stack.id : uid(),
            name: typeof stack.name === 'string' ? stack.name : 'Stack',
            type: 'stack',
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            rotation: typeof stack.rotation === 'number' ? stack.rotation : 0,
            opacity: typeof stack.opacity === 'number' ? stack.opacity : 1,
            direction: stack.direction === 'horizontal' ? 'horizontal' : 'vertical',
            gap: clamp(typeof stack.gap === 'number' ? stack.gap : 16, 0, 200),
            padding: clamp(typeof stack.padding === 'number' ? stack.padding : 24, 0, 200),
            alignItems: stack.alignItems === 'center' || stack.alignItems === 'end' || stack.alignItems === 'stretch' ? stack.alignItems : 'start',
            justifyContent: stack.justifyContent === 'center' || stack.justifyContent === 'end' || stack.justifyContent === 'space-between' ? stack.justifyContent : 'start',
            fill: typeof stack.fill === 'string' ? stack.fill : '#111827',
            radius: clamp(typeof stack.radius === 'number' ? stack.radius : 24, 0, Math.min(box.width, box.height) / 2),
            stroke: typeof stack.stroke === 'string' ? stack.stroke : '#334155',
            strokeWidth: clamp(typeof stack.strokeWidth === 'number' ? stack.strokeWidth : 0, 0, 24),
            sizing: stack.sizing === 'fill' ? 'fill' : stack.sizing === 'hug' ? 'hug' : 'fixed',
            children: normalizeNodes(Array.isArray(stack.children) ? stack.children : [], box.width, box.height)
          }
        }

        if (candidate.type === 'grid') {
          const grid = candidate as Extract<DesignNode, { type: 'grid' }>
          const box = normalizeBox(
            typeof grid.x === 'number' ? grid.x : 0,
            typeof grid.y === 'number' ? grid.y : 0,
            typeof grid.width === 'number' ? grid.width : Math.min(640, containerWidth),
            typeof grid.height === 'number' ? grid.height : Math.min(360, containerHeight),
            120,
            120
          )
          return {
            id: typeof grid.id === 'string' ? grid.id : uid(),
            name: typeof grid.name === 'string' ? grid.name : 'Grid',
            type: 'grid',
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            rotation: typeof grid.rotation === 'number' ? grid.rotation : 0,
            opacity: typeof grid.opacity === 'number' ? grid.opacity : 1,
            columns: clamp(typeof grid.columns === 'number' ? grid.columns : 2, 1, 6),
            gap: clamp(typeof grid.gap === 'number' ? grid.gap : 16, 0, 200),
            padding: clamp(typeof grid.padding === 'number' ? grid.padding : 24, 0, 200),
            alignItems: grid.alignItems === 'center' || grid.alignItems === 'end' || grid.alignItems === 'stretch' ? grid.alignItems : 'start',
            fill: typeof grid.fill === 'string' ? grid.fill : '#111827',
            radius: clamp(typeof grid.radius === 'number' ? grid.radius : 24, 0, Math.min(box.width, box.height) / 2),
            stroke: typeof grid.stroke === 'string' ? grid.stroke : '#334155',
            strokeWidth: clamp(typeof grid.strokeWidth === 'number' ? grid.strokeWidth : 0, 0, 24),
            sizing: grid.sizing === 'fill' ? 'fill' : grid.sizing === 'hug' ? 'hug' : 'fixed',
            children: normalizeNodes(Array.isArray(grid.children) ? grid.children : [], box.width, box.height)
          }
        }

        if (candidate.type === 'rect') {
          const rect = candidate as Extract<DesignNode, { type: 'rect' }>
          const box = normalizeBox(
            typeof rect.x === 'number' ? rect.x : 0,
            typeof rect.y === 'number' ? rect.y : 0,
            typeof rect.width === 'number' ? rect.width : 240,
            typeof rect.height === 'number' ? rect.height : 180,
            24,
            24
          )
          return {
            id: typeof rect.id === 'string' ? rect.id : uid(),
            name: typeof rect.name === 'string' ? rect.name : 'Rectangle',
            type: 'rect',
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            rotation: typeof rect.rotation === 'number' ? rect.rotation : 0,
            opacity: typeof rect.opacity === 'number' ? rect.opacity : 1,
            radius: clamp(typeof rect.radius === 'number' ? rect.radius : 0, 0, Math.min(box.width, box.height) / 2),
            fill: typeof rect.fill === 'string' ? rect.fill : '#1f2937',
            stroke: typeof rect.stroke === 'string' ? rect.stroke : '#334155',
            strokeWidth: clamp(typeof rect.strokeWidth === 'number' ? rect.strokeWidth : 0, 0, 24)
          }
        }

        const text = candidate as Extract<DesignNode, { type: 'text' }>
        const fontSize = clamp(typeof text.fontSize === 'number' ? text.fontSize : 32, 10, Math.max(10, Math.round(containerHeight * 0.25)))
        const content = typeof text.text === 'string' && text.text.trim().length > 0 ? text.text : 'Text layer'
        const estimatedCharsPerLine = Math.max(10, Math.floor((typeof text.width === 'number' ? text.width : 320) / Math.max(8, fontSize * 0.55)))
        const estimatedLineCount = Math.max(1, Math.ceil(content.length / estimatedCharsPerLine))
        const estimatedHeight = Math.ceil(fontSize * 1.25 * estimatedLineCount)
        const box = normalizeBox(
          typeof text.x === 'number' ? text.x : 0,
          typeof text.y === 'number' ? text.y : 0,
          typeof text.width === 'number' ? text.width : 320,
          typeof text.height === 'number' ? text.height : estimatedHeight,
          48,
          Math.max(fontSize + 8, estimatedHeight)
        )
        return {
          id: typeof text.id === 'string' ? text.id : uid(),
          name: typeof text.name === 'string' ? text.name : 'Text',
          type: 'text',
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          rotation: typeof text.rotation === 'number' ? text.rotation : 0,
          opacity: typeof text.opacity === 'number' ? text.opacity : 1,
          text: content,
          fill: typeof text.fill === 'string' ? text.fill : '#f8fafc',
          fontSize,
          fontWeight: clamp(typeof text.fontWeight === 'number' ? text.fontWeight : 600, 100, 900),
          letterSpacing: typeof text.letterSpacing === 'number' ? text.letterSpacing : 0,
          align: text.align === 'center' || text.align === 'right' ? text.align : 'left',
          sizing: text.sizing === 'fill' ? 'fill' : text.sizing === 'hug' ? 'hug' : 'fixed'
        }
      })
      .filter((node): node is DesignNode => Boolean(node))
  )

  return {
    background: typeof document.background === 'string' ? document.background : '#111111',
    nodes: normalizeNodes(document.nodes, width, height)
  }
}

function findDesignNodeLocation(nodes: DesignNode[], id: string, parent: Extract<DesignNode, { type: 'stack' | 'grid' }> | null = null): DesignNodeLocation | null {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (!node) continue
    if (node.id === id) return { node, siblings: nodes, index, parent }
    if (isContainerNode(node)) {
      const found = findDesignNodeLocation(node.children, id, node)
      if (found) return found
    }
  }
  return null
}

function mapDesignNodes(nodes: DesignNode[], targetId: string, updater: (node: DesignNode) => DesignNode): DesignNode[] {
  return nodes.map((node) => {
    if (node.id === targetId) return updater(node)
    if (!isContainerNode(node)) return node
    return {
      ...node,
      children: mapDesignNodes(node.children, targetId, updater)
    }
  })
}

function removeDesignNode(nodes: DesignNode[], targetId: string): DesignNode[] {
  return nodes
    .filter((node) => node.id !== targetId)
    .map((node) => isContainerNode(node) ? { ...node, children: removeDesignNode(node.children, targetId) } : node)
}

function insertDesignNode(nodes: DesignNode[], parentId: string | null, nextNode: DesignNode): DesignNode[] {
  if (!parentId) return [...nodes, nextNode]
  return nodes.map((node) => {
    if (!isContainerNode(node)) return node
    if (node.id === parentId) return { ...node, children: [...node.children, nextNode] }
    return { ...node, children: insertDesignNode(node.children, parentId, nextNode) }
  })
}

function moveDesignNodeInStack(nodes: DesignNode[], targetId: string, direction: 'forward' | 'backward' | 'front' | 'back'): DesignNode[] {
  const moveWithin = (siblings: DesignNode[]) => {
    const index = siblings.findIndex((node) => node.id === targetId)
    if (index < 0) return siblings
    const nextNodes = [...siblings]
    const [node] = nextNodes.splice(index, 1)
    if (!node) return siblings
    if (direction === 'front') nextNodes.push(node)
    else if (direction === 'back') nextNodes.unshift(node)
    else if (direction === 'forward') nextNodes.splice(Math.min(nextNodes.length, index + 1), 0, node)
    else nextNodes.splice(Math.max(0, index - 1), 0, node)
    return nextNodes
  }

  const directIndex = nodes.findIndex((node) => node.id === targetId)
  if (directIndex >= 0) return moveWithin(nodes)

  return nodes.map((node) => {
    if (!isContainerNode(node)) return node
    return { ...node, children: moveDesignNodeInStack(node.children, targetId, direction) }
  })
}

function flattenDesignNodes(nodes: DesignNode[], depth = 0): Array<{ node: DesignNode; depth: number }> {
  return nodes.flatMap((node) => [
    { node, depth },
    ...(isContainerNode(node) ? flattenDesignNodes(node.children, depth + 1) : [])
  ])
}

function cloneDesignNodeIds(node: DesignNode): DesignNode {
  const nextId = uid()
  if (!isContainerNode(node)) return { ...node, id: nextId }
  return {
    ...node,
    id: nextId,
    children: node.children.map((child) => cloneDesignNodeIds(child))
  }
}

function buildHtmlInspectorTree(doc: Document): HtmlInspectorTreeNode[] {
  const toNode = (element: Element): HtmlInspectorTreeNode | null => {
    if (!(element instanceof HTMLElement)) return null
    if (element.tagName === 'SCRIPT') return null
    const id = element.dataset.monetNodeId
    if (!id) return null
    const customLabel = element.dataset.monetLabel?.trim()
    const text = (element.innerText || '').trim().replace(/\s+/g, ' ')
    const label = customLabel || (text ? `${element.tagName.toLowerCase()} · ${text.slice(0, 28)}` : element.tagName.toLowerCase())
    return {
      id,
      tagName: element.tagName.toLowerCase(),
      label,
      children: Array.from(element.children)
        .map((child) => toNode(child))
        .filter((child): child is HtmlInspectorTreeNode => Boolean(child))
    }
  }

  return Array.from(doc.body.children)
    .map((child) => toNode(child))
    .filter((child): child is HtmlInspectorTreeNode => Boolean(child))
}

function clearMonetDomIds(element: HTMLElement): void {
  element.removeAttribute('data-monet-node-id')
  element.removeAttribute('data-monet-selected')
  Array.from(element.querySelectorAll('[data-monet-node-id], [data-monet-selected]')).forEach((node) => {
    if (!(node instanceof HTMLElement)) return
    node.removeAttribute('data-monet-node-id')
    node.removeAttribute('data-monet-selected')
  })
}

function assignMonetDomIds(element: HTMLElement): void {
  element.dataset.monetNodeId = `html-node-${uid()}`
  Array.from(element.querySelectorAll('*')).forEach((node) => {
    if (!(node instanceof HTMLElement)) return
    node.dataset.monetNodeId = `html-node-${uid()}`
  })
}

function getHtmlElementRect(element: HTMLElement, doc: Document): HtmlOverlayRect {
  const elementRect = element.getBoundingClientRect()
  const bodyRect = doc.body.getBoundingClientRect()
  return {
    left: elementRect.left - bodyRect.left,
    top: elementRect.top - bodyRect.top,
    width: elementRect.width,
    height: elementRect.height
  }
}

function collectHtmlSelectionRects(doc: Document, ids: string[]): Record<string, HtmlOverlayRect> {
  const entries = ids.flatMap((id) => {
    const node = doc.querySelector(`[data-monet-node-id="${id}"]`)
    return node instanceof HTMLElement ? [[id, getHtmlElementRect(node, doc)] as const] : []
  })
  return Object.fromEntries(entries)
}

function snapValue(value: number, candidates: number[], threshold: number): { value: number; guide: number | null } {
  let bestValue = value
  let bestGuide: number | null = null
  let bestDistance = threshold + 1
  for (const candidate of candidates) {
    const distance = Math.abs(value - candidate)
    if (distance <= threshold && distance < bestDistance) {
      bestDistance = distance
      bestValue = candidate
      bestGuide = candidate
    }
  }
  return { value: bestValue, guide: bestGuide }
}

async function resolveMediaUrls(html: string): Promise<string> {
  const matches = [...html.matchAll(/media:\/\/[^"'\s>]+/g)]
  const unique = [...new Set(matches.map(m => m[0]))]
  if (unique.length === 0) return html
  let result = html
  await Promise.all(unique.map(async url => {
    try {
      const resp = await fetch(url)
      const blob = await resp.blob()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      result = result.replaceAll(url, dataUrl)
    } catch { /* leave as-is */ }
  }))
  return result
}

function makeDoc(html: string, w: number, h: number) {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=JetBrains+Mono:ital,wght@0,400;0,500;0,700;1,400&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0;padding:0;}body{width:${w}px;height:${h}px;overflow:hidden;}</style>
</head><body>${html}</body></html>`
}

function makeInspectableHtmlDoc(html: string, w: number, h: number, artboardId: string) {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=JetBrains+Mono:ital,wght@0,400;0,500;0,700;1,400&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{width:${w}px;height:${h}px;overflow:hidden;}
[data-monet-selected="true"]{outline:2px solid rgba(250,204,21,0.95)!important;outline-offset:2px;}
</style>
</head><body>${html}
<script>
(function(){
  var ARTBOARD_ID = ${JSON.stringify(artboardId)};
  var selectedId = null;
  function stampTree() {
    var all = Array.from(document.body.querySelectorAll('*'));
    var idx = 0;
    all.forEach(function(el){
      if (!(el instanceof HTMLElement)) return;
      if (el.tagName === 'SCRIPT') return;
      if (!el.dataset.monetNodeId) {
        el.dataset.monetNodeId = 'html-node-' + (++idx) + '-' + Date.now();
      }
    });
  }
  function clearSelection() {
    document.querySelectorAll('[data-monet-selected="true"]').forEach(function(el){ el.removeAttribute('data-monet-selected'); });
  }
  function payloadFor(el) {
    var computed = window.getComputedStyle(el);
    return {
      type: 'monet-html-selection',
      artboardId: ARTBOARD_ID,
      additive: false,
      node: {
        id: el.dataset.monetNodeId || '',
        tagName: el.tagName.toLowerCase(),
        label: el.dataset.monetLabel || '',
        textContent: (el.innerText || '').trim(),
        color: computed.color || '',
        backgroundColor: computed.backgroundColor || '',
        width: computed.width || '',
        height: computed.height || '',
        minHeight: computed.minHeight || '',
        fontSize: computed.fontSize || '',
        fontWeight: computed.fontWeight || '',
        borderRadius: computed.borderRadius || '',
        padding: computed.padding || '',
        margin: computed.margin || '',
        display: computed.display || '',
        flexDirection: computed.flexDirection || '',
        justifyContent: computed.justifyContent || '',
        alignItems: computed.alignItems || '',
        flexWrap: computed.flexWrap || '',
        gap: computed.gap || ''
        ,
        border: computed.border || '',
        boxShadow: computed.boxShadow || '',
        opacity: computed.opacity || ''
      }
    };
  }
  function selectNodeById(id, notify) {
    clearSelection();
    selectedId = id || null;
    if (!id) return;
    var el = document.querySelector('[data-monet-node-id="' + CSS.escape(id) + '"]');
    if (!(el instanceof HTMLElement)) return;
    el.dataset.monetSelected = 'true';
    if (notify) window.parent.postMessage(payloadFor(el), '*');
  }
  stampTree();
  document.addEventListener('click', function(event){
    var target = event.target;
    if (!(target instanceof HTMLElement)) return;
    var el = target.closest('[data-monet-node-id]');
    if (!(el instanceof HTMLElement)) return;
    if (el === document.body) return;
    event.preventDefault();
    event.stopPropagation();
    var payload = payloadFor(el);
    payload.additive = !!event.shiftKey;
    clearSelection();
    el.dataset.monetSelected = 'true';
    selectedId = el.dataset.monetNodeId || null;
    window.parent.postMessage(payload, '*');
  }, true);
  window.addEventListener('message', function(event){
    var data = event.data || {};
    if (data.type === 'monet-select-html-node' && data.artboardId === ARTBOARD_ID) {
      selectNodeById(data.nodeId || '', false);
    }
  });
})();
</script>
</body></html>`
}

function makeDocPaperJS(script: string, w: number, h: number) {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box;}body{width:${w}px;height:${h}px;overflow:hidden;background:#111;}canvas{display:block;}</style>
</head><body>
<canvas id="canvas" width="${w}" height="${h}"></canvas>
<script>${paperRaw}</script>
<script>
try {
paper.setup(document.getElementById('canvas'));
var width = ${w}, height = ${h};
(function() {
  with(paper) {
    var width = ${w}, height = ${h};
    ${script || 'new Path.Circle({ center: view.center, radius: 80, fillColor: "#5b82f7" });'}
  }
})();
paper.view.draw();
} catch(e) {
  var c = document.getElementById('canvas').getContext('2d');
  c.fillStyle='#111'; c.fillRect(0,0,${w},${h});
  c.fillStyle='#f07178'; c.font='14px monospace';
  c.fillText('Script error: '+e.message, 16, 40);
}
</script>
</body></html>`
}

function makeDocMatterJS(script: string, w: number, h: number) {
  // Detect scripts that manage their own engine/render/runner lifecycle.
  // Covers: scripts using Render.create/run, Runner.run, direct Engine.update loops,
  // requestAnimationFrame-based loops, or const/let declarations that would conflict
  // with the template's pre-declared var engine/render.
  const isFullScript = script
    ? /Render\.create|Render\.run|Runner\.run|Engine\.update|requestAnimationFrame|const\s+engine\b|let\s+engine\b|const\s+\{[^}]*Engine/.test(script)
    : false
  // Only patch Render.create if the script actually uses it (to prevent a second canvas).
  const needsRenderPatch = script ? /Render\.create/.test(script) : false

  const defaultScene = `// Default physics scene
var ground = Bodies.rectangle(width/2, height + 25, width, 50, { isStatic: true, render: { fillStyle: '#334155' } });
var wall1 = Bodies.rectangle(-25, height/2, 50, height, { isStatic: true, render: { fillStyle: '#1e293b' } });
var wall2 = Bodies.rectangle(width+25, height/2, 50, height, { isStatic: true, render: { fillStyle: '#1e293b' } });
var ball1 = Bodies.circle(width/3, 50, 30, { restitution: 0.8, render: { fillStyle: '#5b82f7' } });
var ball2 = Bodies.circle(width/2, 80, 20, { restitution: 0.9, render: { fillStyle: '#f07178' } });
var box = Bodies.rectangle(2*width/3, 100, 60, 60, { render: { fillStyle: '#8bd49c' } });
Composite.add(engine.world, [ground, wall1, wall2, ball1, ball2, box]);
engine.gravity.y = 1;
var runner = Runner.create(); Runner.run(runner, engine); Render.run(render);`

  // For full scripts: optionally patch Render.create so any element/canvas option is
  // redirected to the pre-existing <canvas id="canvas">, preventing a second canvas.
  // Scripts that use direct canvas 2D API (Engine.update + rAF) don't need the patch.
  const renderPatch = needsRenderPatch ? `(function() {
  var _c = document.getElementById('canvas');
  var _orig = Matter.Render.create;
  Matter.Render.create = function(opts) {
    if (opts) { delete opts.element; opts.canvas = _c; }
    return _orig.call(this, opts);
  };
})();` : ''
  const fullScriptSetup = `${renderPatch}`

  // For simple scripts: pre-create engine/render and start them after the script runs.
  const simpleSetup = `
var { Engine, Render, Runner, Bodies, Composite, World, Body, Events, Constraint, Mouse, MouseConstraint } = Matter;
var width = ${w}, height = ${h};
var engine = Engine.create();
var render = Render.create({ canvas: document.getElementById('canvas'), engine: engine, options: { width: ${w}, height: ${h}, wireframes: false, background: '#111318' } });`

  const simpleTeardown = `
var runner = Runner.create();
Runner.run(runner, engine);
Render.run(render);`

  const setup = isFullScript ? fullScriptSetup : simpleSetup
  const teardown = isFullScript ? '' : simpleTeardown
  const body = script || defaultScene

  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box;}body{width:${w}px;height:${h}px;overflow:hidden;background:#111;}canvas{display:block;}</style>
</head><body>
<canvas id="canvas" width="${w}" height="${h}"></canvas>
<script>${matterRaw}</script>
<script>
try {
${setup}
${body}
${teardown}
} catch(e) {
  var c = document.getElementById('canvas').getContext('2d');
  c.fillStyle='#111318'; c.fillRect(0,0,${w},${h});
  c.fillStyle='#f07178'; c.font='14px monospace';
  c.fillText('Script error: '+e.message, 16, 40);
}
</script>
</body></html>`
}

function getArtboardSrcDoc(ab: Artboard, liveHtml: string, editHtml: string, editScript: string, editingId: string | null) {
  if (ab.mode === 'design') return ''
  const isEditing = editingId === ab.id
  if (ab.mode === 'paperjs') {
    return makeDocPaperJS(isEditing ? editScript : ab.script, ab.width, ab.height)
  }
  if (ab.mode === 'matterjs') {
    return makeDocMatterJS(isEditing ? editScript : ab.script, ab.width, ab.height)
  }
  // html mode
  return isEditing
    ? makeInspectableHtmlDoc(liveHtml, ab.width, ab.height, ab.id)
    : makeDoc(ab.html, ab.width, ab.height)
}

function hasContent(ab: Artboard) {
  if (ab.mode === 'design') return (ab.design?.nodes.length ?? 0) > 0
  if (ab.mode === 'paperjs' || ab.mode === 'matterjs') return Boolean(ab.script)
  return Boolean(ab.html)
}

const PRESETS = [
  { label: 'Presentation', w: 1440, h: 900 },
  { label: '16:9 Video', w: 1280, h: 720 },
  { label: '4K', w: 3840, h: 2160 },
  { label: 'Desktop', w: 1440, h: 900 },
  { label: 'Mobile', w: 390, h: 844 },
  { label: 'Square', w: 1080, h: 1080 },
]

const MODE_BADGE: Record<ArtboardMode, { label: string; classes: string }> = {
  design:   { label: 'dsg',   classes: 'bg-amber-900/50 text-amber-200' },
  html:     { label: 'html',  classes: 'bg-surface-3 text-text-dim' },
  paperjs:  { label: 'pjs',   classes: 'bg-blue-900/50 text-blue-300' },
  matterjs: { label: 'mjs',   classes: 'bg-green-900/50 text-green-300' },
}

const GRID_COLS = 26
const GRID_ROWS = 7

// Per-artboard loading overlay — compact 16×5 grid scaled to fit inside the frame
function ArtboardLoadingOverlay({ message = 'Rendering…' }: { message?: string }) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 100)
    return () => clearInterval(id)
  }, [])

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 12, zIndex: 10,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(16, 8px)', gridTemplateRows: 'repeat(5, 8px)', gap: '2px' }}>
        {Array.from({ length: 80 }, (_, i) => {
          const col = i % 16
          const row = Math.floor(i / 16)
          const wave = (col + row * 2 + tick) % 14
          const alpha = wave < 3 ? 0.08 : wave < 6 ? 0.3 : wave < 8 ? 0.75 : wave < 10 ? 0.4 : 0.12
          return (
            <div
              key={i}
              style={{
                width: 8, height: 8, borderRadius: 2,
                backgroundColor: `rgba(99,179,237,${alpha})`,
                transition: 'background-color 0.1s',
              }}
            />
          )
        })}
      </div>
      <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 11, fontFamily: 'monospace', textAlign: 'center', maxWidth: '70%' }}>
        {message}
      </div>
    </div>
  )
}

function ArtboardErrorOverlay({ message }: { message: string }) {
  return (
    <div style={{
      position: 'absolute',
      left: 12,
      right: 12,
      bottom: 12,
      zIndex: 11,
      borderRadius: 12,
      border: '1px solid rgba(248,113,113,0.45)',
      background: 'rgba(69,10,10,0.92)',
      boxShadow: '0 14px 40px rgba(0,0,0,0.45)',
      padding: '10px 12px',
      color: '#fecaca',
      fontFamily: 'Inter, sans-serif'
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#fca5a5', marginBottom: 4 }}>
        Invalid Design Payload
      </div>
      <div style={{ fontSize: 11, lineHeight: 1.45 }}>
        {message}
      </div>
    </div>
  )
}

export function CanvasPanel({ projectStorageKey }: { projectStorageKey: string; assets?: MediaAsset[] }) {
  const normalizeArtboards = useCallback((input: Artboard[]) => (
    input.map(ab => ({
      script: '',
      mode: 'design' as ArtboardMode,
      ...ab,
      design: normalizeDesignDocument(ab.design, ab.width ?? 1280, ab.height ?? 720),
    }))
  ), [])

  const storageKey = useMemo(() => `monet-canvas-artboards:${projectStorageKey}`, [projectStorageKey])
  const [artboards, setArtboards] = useState<Artboard[]>([])

  // Load canvas state for the active project whenever the project identity changes.
  // Strictly per-project: no legacy/global fallbacks (those leaked artboards between new drafts).
  useEffect(() => {
    let cancelled = false

    // Reset to empty immediately so the previous project's artboards don't linger
    // visually while async loads are in flight.
    setArtboards([])

    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as Artboard[]
        if (!cancelled) {
          setArtboards(normalizeArtboards(parsed))
        }
        return () => {
          cancelled = true
        }
      }
    } catch {
      // Fall back to backend load below.
    }

    if (typeof window !== 'undefined' && window.api?.loadCanvasState) {
      void window.api.loadCanvasState(projectStorageKey).then((result) => {
        if (cancelled || !result.ok || !Array.isArray(result.artboards) || result.artboards.length === 0) return
        const normalized = normalizeArtboards(result.artboards as Artboard[])
        if (!cancelled) setArtboards(normalized)
        localStorage.setItem(storageKey, JSON.stringify(normalized))
      }).catch(() => undefined)
    }

    return () => {
      cancelled = true
    }
  }, [normalizeArtboards, projectStorageKey, storageKey])

  const [resolvedHtmlMap, setResolvedHtmlMap] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    const needsResolution = artboards.filter(
      ab => ab.mode === 'html' && ab.html && ab.html.includes('media://')
    )
    if (needsResolution.length === 0) return
    let cancelled = false
    Promise.all(
      needsResolution.map(async ab => {
        const resolved = await resolveMediaUrls(ab.html!)
        return [ab.id, resolved] as [string, string]
      })
    ).then(entries => {
      if (cancelled) return
      setResolvedHtmlMap(prev => {
        const next = new Map(prev)
        for (const [id, html] of entries) next.set(id, html)
        return next
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [artboards])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editHtml, setEditHtml] = useState('')
  const [editScript, setEditScript] = useState('')
  const [editDesign, setEditDesign] = useState<DesignDocument>(createDefaultDesignDocument(1280, 720))
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedHtmlNode, setSelectedHtmlNode] = useState<HtmlInspectorNode | null>(null)
  const [selectedHtmlNodeIds, setSelectedHtmlNodeIds] = useState<string[]>([])
  const [htmlDomTree, setHtmlDomTree] = useState<HtmlInspectorTreeNode[]>([])
  const [htmlOverlayRect, setHtmlOverlayRect] = useState<HtmlOverlayRect | null>(null)
  const [htmlSelectionRects, setHtmlSelectionRects] = useState<Record<string, HtmlOverlayRect>>({})
  const [htmlGuideLines, setHtmlGuideLines] = useState<HtmlGuideLines | null>(null)
  const [htmlSpacingGuide, setHtmlSpacingGuide] = useState<HtmlSpacingGuide | null>(null)
  const [editMode, setEditMode] = useState<ArtboardMode>('paperjs')
  const [editName, setEditName] = useState('')
  const [editW, setEditW] = useState(1280)
  const [editH, setEditH] = useState(720)
  const [zoom, setZoom] = useState(0.7)
  const [pan, setPan] = useState({ x: 120, y: 80 })
  const [showLayers, setShowLayers] = useState(true)
  const [showPresets, setShowPresets] = useState(false)
  const [liveHtml, setLiveHtml] = useState('')
  // Per-artboard loading: set of artboard IDs currently showing a loading overlay
  const [loadingFrameIds, setLoadingFrameIds] = useState<Set<string>>(new Set())
  const [loadingFrameMessages, setLoadingFrameMessages] = useState<Record<string, string>>({})
  const [frameErrors, setFrameErrors] = useState<Record<string, string>>({})
  const viewportRef = useRef<HTMLDivElement>(null)
  const isSpaceRef = useRef(false)
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ mx: 0, my: 0, px: 0, py: 0 })
  const designDragRef = useRef<DesignDragState | null>(null)
  const htmlDragRef = useRef<HtmlDragState | null>(null)
  // Figma-style: track a pending pan that activates once drag threshold is crossed
  const pendingPanRef = useRef<{ mx: number; my: number; px: number; py: number } | null>(null)
  // Track iframes by artboard ID so we can capture canvas snapshots
  const iframeRefs = useRef<Map<string, HTMLIFrameElement>>(new Map())

  const selectedAb = artboards.find(a => a.id === selectedId) ?? null
  const editingAb = artboards.find(a => a.id === editingId) ?? null

  // Persist artboards across HMR/reloads
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(artboards))
  }, [artboards, storageKey])

  // Save canvas state to main process whenever artboards change
  useEffect(() => {
    if (typeof window !== 'undefined' && window.api?.saveCanvasState) {
      void window.api.saveCanvasState(artboards, projectStorageKey)
    }
  }, [artboards, projectStorageKey])

  // Live preview: update iframe while typing (html mode only)
  useEffect(() => {
    const timer = setTimeout(() => setLiveHtml(editHtml), 150)
    return () => clearTimeout(timer)
  }, [editHtml])

  // Per-artboard auto-clear timers; global timer keyed by '__global__'
  const loadingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const persistentLoadingFrameIdsRef = useRef<Set<string>>(new Set())
  const pendingPersistentLoadingRef = useRef(false)
  const persistentLoadingMessagesRef = useRef<Map<string, string>>(new Map())
  const pendingPersistentLoadingMessageRef = useRef<string>('Rendering…')

  // Capture the canvas element inside an artboard iframe and save it as a project media asset
  const captureFrameToMedia = useCallback((abId: string, name: string) => {
    const iframe = iframeRefs.current.get(abId)
    if (!iframe) return
    try {
      const canvas = iframe.contentDocument?.getElementById('canvas') as HTMLCanvasElement | null
      if (!canvas) return
      const dataUrl = canvas.toDataURL('image/png')
      void window.api.saveFrameAsMedia(dataUrl, name).catch(() => undefined)
    } catch { /* sandboxed iframe — cross-origin access blocked */ }
  }, [])

  // Helper: start per-artboard loading and schedule auto-clear + capture
  const startFrameLoading = useCallback((abId: string, abName: string, persistent = false, message?: string) => {
    // Cancel any existing timer for this artboard
    const existing = loadingTimersRef.current.get(abId)
    if (existing) clearTimeout(existing)
    const resolvedMessage = message?.trim() || `Rendering ${abName}…`

    setLoadingFrameIds(prev => {
      const next = new Set(prev)
      next.add(abId)
      return next
    })
    setLoadingFrameMessages(prev => ({ ...prev, [abId]: resolvedMessage }))

    if (persistent) {
      persistentLoadingFrameIdsRef.current.add(abId)
      persistentLoadingMessagesRef.current.set(abId, resolvedMessage)
      return
    }

    persistentLoadingFrameIdsRef.current.delete(abId)
    persistentLoadingMessagesRef.current.delete(abId)

    const timer = setTimeout(() => {
      setLoadingFrameIds(prev => {
        const next = new Set(prev)
        next.delete(abId)
        return next
      })
      setLoadingFrameMessages(prev => {
        const next = { ...prev }
        delete next[abId]
        return next
      })
      loadingTimersRef.current.delete(abId)
      captureFrameToMedia(abId, abName)
    }, 1200)

    loadingTimersRef.current.set(abId, timer)
  }, [captureFrameToMedia])

  // IPC command listener from API bridge
  useEffect(() => {
    if (!window.api?.onCanvasCommand) return
    const unsub = window.api.onCanvasCommand(({ command, args }) => {
      if (command === 'add-frame') {
        const name = typeof args.name === 'string' ? args.name : 'Frame'
        const w = typeof args.width === 'number' ? args.width : typeof args.w === 'number' ? args.w : 1280
        const h = typeof args.height === 'number' ? args.height : typeof args.h === 'number' ? args.h : 720
        const mode: ArtboardMode = (args.mode === 'design' || args.mode === 'paperjs' || args.mode === 'matterjs' || args.mode === 'html') ? args.mode : 'paperjs'
        const html = typeof args.html === 'string' ? args.html : ''
        const script = typeof args.script === 'string' ? args.script : ''
        const design = typeof args.design === 'object' && args.design !== null
          ? normalizeDesignDocument(args.design as DesignDocument, w, h)
          : normalizeDesignDocument(undefined, w, h)
        const newId = uid()
        setArtboards(prev => {
          const last = prev[prev.length - 1]
          const x = last ? last.x + last.width + GAP : 80
          const y = last ? last.y : 80
          return [...prev, { id: newId, name, width: w, height: h, html, script, mode, design, x, y }]
        })
        setFrameErrors(prev => {
          const next = { ...prev }
          delete next[newId]
          return next
        })
        if (pendingPersistentLoadingRef.current) {
          const pendingMessage = pendingPersistentLoadingMessageRef.current
          pendingPersistentLoadingRef.current = false
          pendingPersistentLoadingMessageRef.current = 'Rendering…'
          startFrameLoading(newId, name, true, pendingMessage)
        } else {
          startFrameLoading(newId, name)
        }
      } else if (command === 'update-frame') {
        const id = typeof args.id === 'string' ? args.id : null
        if (!id) return
        setArtboards(prev => prev.map(a => {
          if (a.id !== id) return a
          const nextWidth = typeof args.width === 'number' ? args.width : a.width
          const nextHeight = typeof args.height === 'number' ? args.height : a.height
          const hasDesignPayload = typeof args.design === 'object' && args.design !== null
          const nextDesign = hasDesignPayload
            ? normalizeDesignDocument(args.design as DesignDocument, nextWidth, nextHeight)
            : normalizeDesignDocument(a.design, nextWidth, nextHeight)
          const nextMode = (args.mode === 'design' || args.mode === 'html' || args.mode === 'paperjs' || args.mode === 'matterjs')
            ? args.mode
            : hasDesignPayload
            ? 'paperjs'
            : a.mode
          return {
            ...a,
            name: typeof args.name === 'string' ? args.name : a.name,
            width: nextWidth,
            height: nextHeight,
            html: typeof args.html === 'string' ? args.html : a.html,
            script: typeof args.script === 'string' ? args.script : a.script,
            mode: nextMode,
            design: nextDesign,
          }
        }))
        setFrameErrors(prev => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        // Find the current name for the frame (used for the capture filename)
        setArtboards(prev => {
          const ab = prev.find(a => a.id === id)
          if (ab) startFrameLoading(id, ab.name, persistentLoadingFrameIdsRef.current.has(id), persistentLoadingMessagesRef.current.get(id))
          return prev
        })
      } else if (command === 'delete-frame') {
        const id = typeof args.id === 'string' ? args.id : null
        if (!id) return
        const t = loadingTimersRef.current.get(id)
        if (t) { clearTimeout(t); loadingTimersRef.current.delete(id) }
        setLoadingFrameIds(prev => { const n = new Set(prev); n.delete(id); return n })
        setFrameErrors(prev => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        setLoadingFrameMessages(prev => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        persistentLoadingFrameIdsRef.current.delete(id)
        persistentLoadingMessagesRef.current.delete(id)
        iframeRefs.current.delete(id)
        setArtboards(prev => prev.filter(a => a.id !== id))
        setSelectedId(s => s === id ? null : s)
        setEditingId(e => e === id ? null : e)
      } else if (command === 'select-frame') {
        const id = typeof args.id === 'string' ? args.id : null
        setSelectedId(id)
      } else if (command === 'clear') {
        loadingTimersRef.current.forEach(t => clearTimeout(t))
        loadingTimersRef.current.clear()
        persistentLoadingFrameIdsRef.current.clear()
        persistentLoadingMessagesRef.current.clear()
        pendingPersistentLoadingRef.current = false
        pendingPersistentLoadingMessageRef.current = 'Rendering…'
        iframeRefs.current.clear()
        setLoadingFrameIds(new Set())
        setLoadingFrameMessages({})
        setFrameErrors({})
        setArtboards([])
        setSelectedId(null)
        setEditingId(null)
      } else if (command === 'set-zoom') {
        const z = typeof args.zoom === 'number' ? args.zoom : null
        if (z !== null) setZoom(z)
      } else if (command === 'set-loading') {
        const targetId = typeof args.id === 'string' ? args.id : null
        const message = typeof args.message === 'string' && args.message.trim() ? args.message.trim() : 'Rendering…'
        const fallbackId = targetId ?? editingId ?? selectedId ?? artboards[artboards.length - 1]?.id ?? null
        if (!fallbackId) {
          pendingPersistentLoadingRef.current = true
          pendingPersistentLoadingMessageRef.current = message
          return
        }
        setArtboards(prev => {
          const ab = prev.find(a => a.id === fallbackId)
          if (ab) startFrameLoading(fallbackId, ab.name, true, message)
          return prev
        })
      } else if (command === 'clear-loading') {
        loadingTimersRef.current.forEach(t => clearTimeout(t))
        loadingTimersRef.current.clear()
        persistentLoadingFrameIdsRef.current.clear()
        persistentLoadingMessagesRef.current.clear()
        pendingPersistentLoadingRef.current = false
        pendingPersistentLoadingMessageRef.current = 'Rendering…'
        setLoadingFrameIds(new Set())
        setLoadingFrameMessages({})
      } else if (command === 'set-frame-error') {
        const id = typeof args.id === 'string' ? args.id : null
        const message = typeof args.message === 'string' ? args.message.trim() : ''
        if (!id || !message) return
        setFrameErrors(prev => ({ ...prev, [id]: message }))
      }
    })
    return () => {
      unsub()
      loadingTimersRef.current.forEach(t => clearTimeout(t))
    }
  }, [startFrameLoading])

  // File queue polling — picks up canvas commands written by editorctl or any other process.
  // Works regardless of which app owns port 51847.
  useEffect(() => {
    if (!window.api?.drainCanvasQueue) return
    const processCommand = (command: string, args: Record<string, unknown>) => {
      if (command === 'add-frame') {
        const name = typeof args.name === 'string' ? args.name : 'Frame'
        const w = typeof args.width === 'number' ? args.width : 1280
        const h = typeof args.height === 'number' ? args.height : 720
        const mode: ArtboardMode = (args.mode === 'design' || args.mode === 'paperjs' || args.mode === 'matterjs' || args.mode === 'html') ? args.mode : 'paperjs'
        const html = typeof args.html === 'string' ? args.html : ''
        const script = typeof args.script === 'string' ? args.script : ''
        const design = typeof args.design === 'object' && args.design !== null
          ? normalizeDesignDocument(args.design as DesignDocument, w, h)
          : normalizeDesignDocument(undefined, w, h)
        const newId = uid()
        setArtboards(prev => {
          const last = prev[prev.length - 1]
          const x = last ? last.x + last.width + GAP : 80
          const y = last ? last.y : 80
          return [...prev, { id: newId, name, width: w, height: h, html, script, mode, design, x, y }]
        })
        setFrameErrors(prev => {
          const next = { ...prev }
          delete next[newId]
          return next
        })
        if (pendingPersistentLoadingRef.current) {
          const pendingMessage = pendingPersistentLoadingMessageRef.current
          pendingPersistentLoadingRef.current = false
          pendingPersistentLoadingMessageRef.current = 'Rendering…'
          startFrameLoading(newId, name, true, pendingMessage)
        } else {
          startFrameLoading(newId, name)
        }
      } else if (command === 'update-frame') {
        const id = typeof args.id === 'string' ? args.id : null
        if (!id) return
        setArtboards(prev => prev.map(a => {
          if (a.id !== id) return a
          const nextWidth = typeof args.width === 'number' ? args.width : a.width
          const nextHeight = typeof args.height === 'number' ? args.height : a.height
          const hasDesignPayload = typeof args.design === 'object' && args.design !== null
          const nextDesign = hasDesignPayload
            ? normalizeDesignDocument(args.design as DesignDocument, nextWidth, nextHeight)
            : normalizeDesignDocument(a.design, nextWidth, nextHeight)
          const nextMode = (args.mode === 'design' || args.mode === 'html' || args.mode === 'paperjs' || args.mode === 'matterjs')
            ? args.mode
            : hasDesignPayload
            ? 'paperjs'
            : a.mode
          return {
            ...a,
            name: typeof args.name === 'string' ? args.name : a.name,
            width: nextWidth,
            height: nextHeight,
            html: typeof args.html === 'string' ? args.html : a.html,
            script: typeof args.script === 'string' ? args.script : a.script,
            mode: nextMode,
            design: nextDesign,
          }
        }))
        setFrameErrors(prev => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        setArtboards(prev => {
          const ab = prev.find(a => a.id === id)
          if (ab) startFrameLoading(id, ab.name, persistentLoadingFrameIdsRef.current.has(id), persistentLoadingMessagesRef.current.get(id))
          return prev
        })
      } else if (command === 'delete-frame') {
        const id = typeof args.id === 'string' ? args.id : null
        if (!id) return
        const t = loadingTimersRef.current.get(id)
        if (t) { clearTimeout(t); loadingTimersRef.current.delete(id) }
        setLoadingFrameIds(prev => { const n = new Set(prev); n.delete(id); return n })
        setFrameErrors(prev => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        setLoadingFrameMessages(prev => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        persistentLoadingFrameIdsRef.current.delete(id)
        persistentLoadingMessagesRef.current.delete(id)
        iframeRefs.current.delete(id)
        setArtboards(prev => prev.filter(a => a.id !== id))
        setSelectedId(s => s === id ? null : s)
      } else if (command === 'clear') {
        loadingTimersRef.current.forEach(t => clearTimeout(t))
        loadingTimersRef.current.clear()
        persistentLoadingFrameIdsRef.current.clear()
        persistentLoadingMessagesRef.current.clear()
        pendingPersistentLoadingRef.current = false
        pendingPersistentLoadingMessageRef.current = 'Rendering…'
        iframeRefs.current.clear()
        setLoadingFrameIds(new Set())
        setLoadingFrameMessages({})
        setFrameErrors({})
        setArtboards([])
        setSelectedId(null)
        setEditingId(null)
      } else if (command === 'set-zoom') {
        const z = typeof args.zoom === 'number' ? args.zoom : null
        if (z !== null) setZoom(z)
      } else if (command === 'set-loading') {
        const targetId = typeof args.id === 'string' ? args.id : null
        const message = typeof args.message === 'string' && args.message.trim() ? args.message.trim() : 'Rendering…'
        const fallbackId = targetId ?? editingId ?? selectedId ?? artboards[artboards.length - 1]?.id ?? null
        if (!fallbackId) {
          pendingPersistentLoadingRef.current = true
          pendingPersistentLoadingMessageRef.current = message
          return
        }
        setArtboards(prev => {
          const ab = prev.find(a => a.id === fallbackId)
          if (ab) startFrameLoading(fallbackId, ab.name, true, message)
          return prev
        })
      } else if (command === 'clear-loading') {
        loadingTimersRef.current.forEach(t => clearTimeout(t))
        loadingTimersRef.current.clear()
        persistentLoadingFrameIdsRef.current.clear()
        persistentLoadingMessagesRef.current.clear()
        pendingPersistentLoadingRef.current = false
        pendingPersistentLoadingMessageRef.current = 'Rendering…'
        setLoadingFrameIds(new Set())
        setLoadingFrameMessages({})
      } else if (command === 'set-frame-error') {
        const id = typeof args.id === 'string' ? args.id : null
        const message = typeof args.message === 'string' ? args.message.trim() : ''
        if (!id || !message) return
        setFrameErrors(prev => ({ ...prev, [id]: message }))
      }
    }

    const id = setInterval(async () => {
      try {
        const commands = await window.api.drainCanvasQueue()
        for (const { command, args } of commands) processCommand(command, args)
      } catch { /* ignore */ }
    }, 500)
    return () => clearInterval(id)
  }, [artboards, editingId, selectedId, startFrameLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Pan & zoom via keyboard/mouse ---
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        const t = e.target as HTMLElement
        if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') return
        e.preventDefault()
        isSpaceRef.current = true
        if (viewportRef.current) viewportRef.current.style.cursor = 'grab'
      }
      if (editMode === 'html' && editingId && selectedHtmlNodeIds.length > 0 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        const t = e.target as HTMLElement
        if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') return
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        if (e.key === 'ArrowLeft') nudgeSelectedHtmlNodes(-step, 0)
        else if (e.key === 'ArrowRight') nudgeSelectedHtmlNodes(step, 0)
        else if (e.key === 'ArrowUp') nudgeSelectedHtmlNodes(0, -step)
        else if (e.key === 'ArrowDown') nudgeSelectedHtmlNodes(0, step)
      }
      if (e.code === 'Escape' && editingId) {
        setEditingId(null)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpaceRef.current = false
        if (viewportRef.current) viewportRef.current.style.cursor = ''
      }
    }
    const onMouseMove = (e: MouseEvent) => {
      if (designDragRef.current && editingId === designDragRef.current.artboardId) {
        const drag = designDragRef.current
        const dx = (e.clientX - drag.startMouseX) / zoom
        const dy = (e.clientY - drag.startMouseY) / zoom
        setEditDesign((prev) => ({
          ...prev,
          nodes: prev.nodes.map((node) => {
            if (node.id !== drag.nodeId) return node
            if (drag.mode === 'move') {
              return {
                ...node,
                x: Math.round(drag.originX + dx),
                y: Math.round(drag.originY + dy)
              }
            }

            let nextX = drag.originX
            let nextY = drag.originY
            let nextWidth = drag.originWidth
            let nextHeight = drag.originHeight

            if (drag.handle === 'se') {
              nextWidth = drag.originWidth + dx
              nextHeight = drag.originHeight + dy
            } else if (drag.handle === 'sw') {
              nextX = drag.originX + dx
              nextWidth = drag.originWidth - dx
              nextHeight = drag.originHeight + dy
            } else if (drag.handle === 'ne') {
              nextY = drag.originY + dy
              nextWidth = drag.originWidth + dx
              nextHeight = drag.originHeight - dy
            } else if (drag.handle === 'nw') {
              nextX = drag.originX + dx
              nextY = drag.originY + dy
              nextWidth = drag.originWidth - dx
              nextHeight = drag.originHeight - dy
            }

            const minWidth = node.type === 'text' ? 80 : 24
            const minHeight = node.type === 'text' ? 32 : 24
            if (nextWidth < minWidth) {
              if (drag.handle === 'nw' || drag.handle === 'sw') nextX -= (minWidth - nextWidth)
              nextWidth = minWidth
            }
            if (nextHeight < minHeight) {
              if (drag.handle === 'nw' || drag.handle === 'ne') nextY -= (minHeight - nextHeight)
              nextHeight = minHeight
            }

            return {
              ...node,
              x: Math.round(nextX),
              y: Math.round(nextY),
              width: Math.round(nextWidth),
              height: Math.round(nextHeight)
            }
          })
        }))
      } else if (htmlDragRef.current && editingId === htmlDragRef.current.artboardId) {
        const drag = htmlDragRef.current
        const dx = (e.clientX - drag.startMouseX) / zoom
        const dy = (e.clientY - drag.startMouseY) / zoom
        const iframe = iframeRefs.current.get(drag.artboardId)
        const doc = iframe?.contentDocument
        const target = doc?.querySelector(`[data-monet-node-id="${drag.nodeId}"]`)
        if (!(target instanceof HTMLElement) || !doc) return

        let nextLeft = drag.originLeft
        let nextTop = drag.originTop
        let nextWidth = drag.originWidth
        let nextHeight = drag.originHeight

        if (drag.mode === 'move') {
          nextLeft = drag.originLeft + dx
          nextTop = drag.originTop + dy
        } else {
          if (drag.handle === 'se') {
            nextWidth = drag.originWidth + dx
            nextHeight = drag.originHeight + dy
          } else if (drag.handle === 'sw') {
            nextLeft = drag.originLeft + dx
            nextWidth = drag.originWidth - dx
            nextHeight = drag.originHeight + dy
          } else if (drag.handle === 'ne') {
            nextTop = drag.originTop + dy
            nextWidth = drag.originWidth + dx
            nextHeight = drag.originHeight - dy
          } else if (drag.handle === 'nw') {
            nextLeft = drag.originLeft + dx
            nextTop = drag.originTop + dy
            nextWidth = drag.originWidth - dx
            nextHeight = drag.originHeight - dy
          }
          nextWidth = Math.max(24, nextWidth)
          nextHeight = Math.max(24, nextHeight)
        }

        const siblingRects = Array.from(doc.querySelectorAll('[data-monet-node-id]'))
          .filter((node): node is HTMLElement => node instanceof HTMLElement && node.dataset.monetNodeId !== drag.nodeId)
          .map((node) => getHtmlElementRect(node, doc))

        const artboardCenterX = editW / 2
        const artboardCenterY = editH / 2
        const candidateXs = [
          0,
          editW,
          artboardCenterX,
          ...siblingRects.flatMap((rect) => [rect.left, rect.left + rect.width, rect.left + rect.width / 2])
        ]
        const candidateYs = [
          0,
          editH,
          artboardCenterY,
          ...siblingRects.flatMap((rect) => [rect.top, rect.top + rect.height, rect.top + rect.height / 2])
        ]

        const leftSnap = snapValue(nextLeft, candidateXs, HTML_SNAP_THRESHOLD)
        const rightSnap = snapValue(nextLeft + nextWidth, candidateXs, HTML_SNAP_THRESHOLD)
        const centerXSnap = snapValue(nextLeft + nextWidth / 2, candidateXs, HTML_SNAP_THRESHOLD)
        const topSnap = snapValue(nextTop, candidateYs, HTML_SNAP_THRESHOLD)
        const bottomSnap = snapValue(nextTop + nextHeight, candidateYs, HTML_SNAP_THRESHOLD)
        const centerYSnap = snapValue(nextTop + nextHeight / 2, candidateYs, HTML_SNAP_THRESHOLD)

        if (centerXSnap.guide !== null) nextLeft = centerXSnap.value - nextWidth / 2
        else if (leftSnap.guide !== null) nextLeft = leftSnap.value
        else if (rightSnap.guide !== null) nextLeft = rightSnap.value - nextWidth

        if (centerYSnap.guide !== null) nextTop = centerYSnap.value - nextHeight / 2
        else if (topSnap.guide !== null) nextTop = topSnap.value
        else if (bottomSnap.guide !== null) nextTop = bottomSnap.value - nextHeight

        const nextRectRaw = {
          left: nextLeft,
          top: nextTop,
          width: nextWidth,
          height: nextHeight
        }
        const overlappingSiblings = siblingRects.filter((rect) =>
          !(nextRectRaw.top + nextRectRaw.height < rect.top || nextRectRaw.top > rect.top + rect.height)
        )
        let nextSpacingGuide: HtmlSpacingGuide | null = null
        for (const rect of overlappingSiblings) {
          const distances = [
            { distance: Math.abs(nextRectRaw.left - (rect.left + rect.width)), start: rect.left + rect.width, end: nextRectRaw.left, cross: Math.max(rect.top, nextRectRaw.top), orientation: 'horizontal' as const },
            { distance: Math.abs(rect.left - (nextRectRaw.left + nextRectRaw.width)), start: nextRectRaw.left + nextRectRaw.width, end: rect.left, cross: Math.max(rect.top, nextRectRaw.top), orientation: 'horizontal' as const }
          ].filter((entry) => entry.distance <= 48)
          const best = distances.sort((a, b) => a.distance - b.distance)[0]
          if (best && (!nextSpacingGuide || best.distance < nextSpacingGuide.distance)) {
            nextSpacingGuide = best
          }
        }
        if (!nextSpacingGuide) {
          const verticalSiblings = siblingRects.filter((rect) =>
            !(nextRectRaw.left + nextRectRaw.width < rect.left || nextRectRaw.left > rect.left + rect.width)
          )
          for (const rect of verticalSiblings) {
            const distances = [
              { distance: Math.abs(nextRectRaw.top - (rect.top + rect.height)), start: rect.top + rect.height, end: nextRectRaw.top, cross: Math.max(rect.left, nextRectRaw.left), orientation: 'vertical' as const },
              { distance: Math.abs(rect.top - (nextRectRaw.top + nextRectRaw.height)), start: nextRectRaw.top + nextRectRaw.height, end: rect.top, cross: Math.max(rect.left, nextRectRaw.left), orientation: 'vertical' as const }
            ].filter((entry) => entry.distance <= 48)
            const best = distances.sort((a, b) => a.distance - b.distance)[0]
            if (best && (!nextSpacingGuide || best.distance < nextSpacingGuide.distance)) {
              nextSpacingGuide = best
            }
          }
        }

        target.style.position = 'absolute'
        target.style.left = `${Math.round(nextLeft)}px`
        target.style.top = `${Math.round(nextTop)}px`
        target.style.width = `${Math.round(nextWidth)}px`
        target.style.height = `${Math.round(nextHeight)}px`
        target.style.margin = '0'

        const nextRect = {
          left: Math.round(nextLeft),
          top: Math.round(nextTop),
          width: Math.round(nextWidth),
          height: Math.round(nextHeight)
        }
        setHtmlOverlayRect(nextRect)
        setHtmlGuideLines({
          left: leftSnap.guide ?? nextRect.left,
          right: rightSnap.guide ?? (nextRect.left + nextRect.width),
          top: topSnap.guide ?? nextRect.top,
          bottom: bottomSnap.guide ?? (nextRect.top + nextRect.height),
          centerX: centerXSnap.guide ?? (nextRect.left + nextRect.width / 2),
          centerY: centerYSnap.guide ?? (nextRect.top + nextRect.height / 2),
          snappedVertical: centerXSnap.guide !== null ? 'center' : leftSnap.guide !== null ? 'left' : rightSnap.guide !== null ? 'right' : undefined,
          snappedHorizontal: centerYSnap.guide !== null ? 'center' : topSnap.guide !== null ? 'top' : bottomSnap.guide !== null ? 'bottom' : undefined
        })
        setHtmlSpacingGuide(nextSpacingGuide)
      } else if (isPanningRef.current) {
        const { mx, my, px, py } = panStartRef.current
        setPan({ x: px + (e.clientX - mx), y: py + (e.clientY - my) })
      } else if (pendingPanRef.current) {
        // Activate pan once drag distance exceeds 4px (Figma-style threshold)
        const dx = e.clientX - pendingPanRef.current.mx
        const dy = e.clientY - pendingPanRef.current.my
        if (Math.sqrt(dx * dx + dy * dy) > 4) {
          isPanningRef.current = true
          panStartRef.current = pendingPanRef.current
          pendingPanRef.current = null
          if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing'
        }
      }
    }
    const onMouseUp = () => {
      if (htmlDragRef.current) {
        const drag = htmlDragRef.current
        syncEditHtmlFromIframe(drag.artboardId)
        setTimeout(() => selectHtmlNodeById(drag.nodeId), 0)
      }
      designDragRef.current = null
      htmlDragRef.current = null
      setHtmlGuideLines(null)
      setHtmlSpacingGuide(null)
      pendingPanRef.current = null
      if (isPanningRef.current) {
        isPanningRef.current = false
        if (viewportRef.current) viewportRef.current.style.cursor = isSpaceRef.current ? 'grab' : ''
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [editH, editMode, editW, editingId, nudgeSelectedHtmlNodes, selectHtmlNodeById, selectedHtmlNodeIds.length, syncEditHtmlFromIframe, zoom])

  const onViewportMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || isSpaceRef.current) {
      // Middle click or Space: immediate pan
      e.preventDefault()
      isPanningRef.current = true
      panStartRef.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y }
      if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing'
    } else if (e.button === 0 && e.target === viewportRef.current) {
      // Left click on empty canvas background: pending pan (activates after drag threshold)
      pendingPanRef.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y }
    }
  }, [pan])

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const rect = viewportRef.current?.getBoundingClientRect()
      if (!rect) return
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const next = Math.max(0.05, Math.min(8, zoom * factor))
      setPan(p => ({
        x: mx - (mx - p.x) * (next / zoom),
        y: my - (my - p.y) * (next / zoom),
      }))
      setZoom(next)
    } else {
      setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }))
    }
  }, [zoom])

  // --- Artboard management ---
  const addArtboard = useCallback((w = 1280, h = 720, mode: ArtboardMode = 'html') => {
    const last = artboards[artboards.length - 1]
    const x = last ? last.x + last.width + GAP : 80
    const y = last ? last.y : 80
    const ab: Artboard = {
      id: uid(),
      name: `Frame ${artboards.length + 1}`,
      width: w,
      height: h,
      html: '',
      script: '',
      mode,
      design: normalizeDesignDocument(undefined, w, h),
      x,
      y
    }
    setArtboards(prev => [...prev, ab])
    setSelectedId(ab.id)
    setSelectedNodeId(mode === 'design' ? ab.design?.nodes[0]?.id ?? null : null)
    openEditor(ab)
    setShowPresets(false)
  }, [artboards]) // eslint-disable-line react-hooks/exhaustive-deps

  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    setArtboards(prev => prev.filter(a => a.id !== selectedId))
    setSelectedId(null)
    if (editingId === selectedId) setEditingId(null)
  }, [selectedId, editingId])

  const exportCanvas = useCallback(async () => {
    if (artboards.length === 0) return
    try {
      await window.api.exportCanvasState(artboards)
    } catch { /* user canceled or error — non-fatal */ }
  }, [artboards])

  const importCanvas = useCallback(async () => {
    try {
      const result = await window.api.importCanvasState()
      if (!result.ok || !result.artboards || !Array.isArray(result.artboards)) return
      // Add imported artboards to current canvas (don't replace) — assign new IDs to avoid conflicts
      setArtboards(prev => {
        const last = prev[prev.length - 1]
        let nextX = last ? last.x + last.width + GAP : 80
        const baseY = last ? last.y : 80
        const remapped = (result.artboards as Artboard[]).map((ab, i) => {
          const safeAb: Artboard = {
            id: uid(),
            name: typeof ab.name === 'string' ? ab.name : `Imported ${i + 1}`,
            width: typeof ab.width === 'number' ? ab.width : 1280,
            height: typeof ab.height === 'number' ? ab.height : 720,
            html: typeof ab.html === 'string' ? ab.html : '',
            script: typeof ab.script === 'string' ? ab.script : '',
            mode: (ab.mode === 'design' || ab.mode === 'paperjs' || ab.mode === 'matterjs' || ab.mode === 'html') ? ab.mode : 'paperjs',
            design: normalizeDesignDocument(ab.design, typeof ab.width === 'number' ? ab.width : 1280, typeof ab.height === 'number' ? ab.height : 720),
            x: nextX,
            y: baseY,
          }
          nextX += safeAb.width + GAP
          return safeAb
        })
        return [...prev, ...remapped]
      })
    } catch { /* non-fatal */ }
  }, [])

  const openEditor = useCallback((ab: Artboard) => {
    setEditingId(ab.id)
    setEditHtml(ab.html)
    setEditScript(ab.script)
    setEditMode(ab.mode)
    setEditDesign(cloneDesignDocument(normalizeDesignDocument(ab.design, ab.width, ab.height)))
    setLiveHtml(ab.html)
    setEditName(ab.name)
    setEditW(ab.width)
    setEditH(ab.height)
    setSelectedNodeId(null)
    setSelectedHtmlNode(null)
    setSelectedHtmlNodeIds([])
    setHtmlDomTree([])
    setHtmlOverlayRect(null)
    setHtmlGuideLines(null)
    setHtmlSpacingGuide(null)
  }, [])

  const saveEdit = useCallback(() => {
    if (!editingId) return
    setArtboards(prev => prev.map(a =>
      a.id === editingId
        ? {
            ...a,
            html: editHtml,
            script: editScript,
            mode: editMode,
            name: editName,
            width: editW,
            height: editH,
            design: cloneDesignDocument(normalizeDesignDocument(editDesign, editW, editH))
          }
        : a
    ))
    setEditingId(null)
  }, [editingId, editHtml, editScript, editMode, editName, editW, editH, editDesign])

  function syncEditHtmlFromIframe(artboardId: string) {
    const iframe = iframeRefs.current.get(artboardId)
    const doc = iframe?.contentDocument
    if (!doc?.body) return
    setEditHtml(doc.body.innerHTML.replace(/<script[\s\S]*<\/script>\s*$/i, '').trim())
    setHtmlDomTree(buildHtmlInspectorTree(doc))
    setHtmlSelectionRects(collectHtmlSelectionRects(doc, selectedHtmlNodeIds))
    if (selectedHtmlNode?.id) {
      const target = doc.querySelector(`[data-monet-node-id="${selectedHtmlNode.id}"]`)
      if (target instanceof HTMLElement) {
        setHtmlOverlayRect(getHtmlElementRect(target, doc))
      } else {
        setHtmlOverlayRect(null)
      }
    }
  }

  function postSelectHtmlNode(artboardId: string, nodeId: string | null) {
    const iframe = iframeRefs.current.get(artboardId)
    iframe?.contentWindow?.postMessage({ type: 'monet-select-html-node', artboardId, nodeId }, '*')
  }

  function selectHtmlNodeById(nodeId: string, additive = false) {
    if (!editingId) return
    const iframe = iframeRefs.current.get(editingId)
    const doc = iframe?.contentDocument
    const target = doc?.querySelector(`[data-monet-node-id="${nodeId}"]`)
    if (!(target instanceof HTMLElement)) return
    const computed = window.getComputedStyle(target)
    if (doc) setHtmlOverlayRect(getHtmlElementRect(target, doc))
    setSelectedNodeId(nodeId)
    setSelectedHtmlNode({
      id: nodeId,
      tagName: target.tagName.toLowerCase(),
      label: target.dataset.monetLabel || '',
      textContent: (target.innerText || '').trim(),
      color: computed.color || '',
      backgroundColor: computed.backgroundColor || '',
      width: computed.width || '',
      height: computed.height || '',
      minHeight: computed.minHeight || '',
      fontSize: computed.fontSize || '',
      fontWeight: computed.fontWeight || '',
      borderRadius: computed.borderRadius || '',
      padding: computed.padding || '',
      margin: computed.margin || '',
      display: computed.display || '',
      flexDirection: computed.flexDirection || '',
      justifyContent: computed.justifyContent || '',
      alignItems: computed.alignItems || '',
      flexWrap: computed.flexWrap || '',
      gap: computed.gap || '',
      border: computed.border || '',
      boxShadow: computed.boxShadow || '',
      opacity: computed.opacity || ''
    })
    postSelectHtmlNode(editingId, nodeId)
    const nextSelectedIds = additive
      ? Array.from(new Set(selectedHtmlNodeIds.includes(nodeId) ? selectedHtmlNodeIds : [...selectedHtmlNodeIds, nodeId]))
      : [nodeId]
    setSelectedHtmlNodeIds(nextSelectedIds)
    if (doc) setHtmlSelectionRects(collectHtmlSelectionRects(doc, nextSelectedIds))
  }

  const updateSelectedHtmlNodeStyle = useCallback((property: keyof CSSStyleDeclaration, value: string) => {
    if (!editingId || !selectedHtmlNode?.id) return
    const iframe = iframeRefs.current.get(editingId)
    const doc = iframe?.contentDocument
    const target = doc?.querySelector(`[data-monet-node-id="${selectedHtmlNode.id}"]`)
    if (!(target instanceof HTMLElement)) return
    target.style.setProperty(property.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`), value)
    syncEditHtmlFromIframe(editingId)
    const computed = window.getComputedStyle(target)
    setSelectedHtmlNode((prev) => prev ? {
      ...prev,
      color: computed.color || prev.color,
      backgroundColor: computed.backgroundColor || prev.backgroundColor,
      width: computed.width || prev.width,
      height: computed.height || prev.height,
      minHeight: computed.minHeight || prev.minHeight,
      fontSize: computed.fontSize || prev.fontSize,
      fontWeight: computed.fontWeight || prev.fontWeight,
      borderRadius: computed.borderRadius || prev.borderRadius,
      padding: computed.padding || prev.padding,
      margin: computed.margin || prev.margin,
      display: computed.display || prev.display,
      flexDirection: computed.flexDirection || prev.flexDirection,
      justifyContent: computed.justifyContent || prev.justifyContent,
      alignItems: computed.alignItems || prev.alignItems,
      flexWrap: computed.flexWrap || prev.flexWrap,
      gap: computed.gap || prev.gap,
      border: computed.border || prev.border,
      boxShadow: computed.boxShadow || prev.boxShadow,
      opacity: computed.opacity || prev.opacity
    } : prev)
  }, [editingId, selectedHtmlNode?.id, syncEditHtmlFromIframe])

  const updateSelectedHtmlNodeText = useCallback((value: string) => {
    if (!editingId || !selectedHtmlNode?.id) return
    const iframe = iframeRefs.current.get(editingId)
    const doc = iframe?.contentDocument
    const target = doc?.querySelector(`[data-monet-node-id="${selectedHtmlNode.id}"]`)
    if (!(target instanceof HTMLElement)) return
    target.textContent = value
    syncEditHtmlFromIframe(editingId)
    setSelectedHtmlNode((prev) => prev ? { ...prev, textContent: value } : prev)
  }, [editingId, selectedHtmlNode?.id, syncEditHtmlFromIframe])

  const renameSelectedHtmlNode = useCallback((value: string) => {
    if (!editingId || !selectedHtmlNode?.id) return
    const iframe = iframeRefs.current.get(editingId)
    const doc = iframe?.contentDocument
    const target = doc?.querySelector(`[data-monet-node-id="${selectedHtmlNode.id}"]`)
    if (!(target instanceof HTMLElement)) return
    if (value.trim()) target.dataset.monetLabel = value.trim()
    else delete target.dataset.monetLabel
    syncEditHtmlFromIframe(editingId)
    setSelectedHtmlNode((prev) => prev ? { ...prev, tagName: target.tagName.toLowerCase(), label: value.trim() } : prev)
  }, [editingId, selectedHtmlNode?.id, syncEditHtmlFromIframe])

  const duplicateSelectedHtmlNode = useCallback(() => {
    if (!editingId || !selectedHtmlNode?.id) return
    const iframe = iframeRefs.current.get(editingId)
    const doc = iframe?.contentDocument
    const target = doc?.querySelector(`[data-monet-node-id="${selectedHtmlNode.id}"]`)
    if (!(target instanceof HTMLElement) || !target.parentElement) return
    const clone = target.cloneNode(true)
    if (!(clone instanceof HTMLElement)) return
    clearMonetDomIds(clone)
    assignMonetDomIds(clone)
    target.parentElement.insertBefore(clone, target.nextSibling)
    syncEditHtmlFromIframe(editingId)
    setTimeout(() => {
      if (clone.dataset.monetNodeId) selectHtmlNodeById(clone.dataset.monetNodeId)
    }, 0)
  }, [editingId, selectedHtmlNode?.id, selectHtmlNodeById, syncEditHtmlFromIframe])

  const deleteSelectedHtmlNode = useCallback(() => {
    if (!editingId || !selectedHtmlNode?.id) return
    const iframe = iframeRefs.current.get(editingId)
    const doc = iframe?.contentDocument
    const target = doc?.querySelector(`[data-monet-node-id="${selectedHtmlNode.id}"]`)
    if (!(target instanceof HTMLElement)) return
    const fallback = target.previousElementSibling instanceof HTMLElement
      ? target.previousElementSibling
      : target.nextElementSibling instanceof HTMLElement
      ? target.nextElementSibling
      : target.parentElement instanceof HTMLElement && target.parentElement !== doc.body
      ? target.parentElement
      : null
    target.remove()
    syncEditHtmlFromIframe(editingId)
    if (fallback?.dataset.monetNodeId) {
      setTimeout(() => selectHtmlNodeById(fallback.dataset.monetNodeId || ''), 0)
    } else {
      setSelectedNodeId(null)
      setSelectedHtmlNode(null)
    }
  }, [editingId, selectedHtmlNode?.id, selectHtmlNodeById, syncEditHtmlFromIframe])

  const moveSelectedHtmlNode = useCallback((direction: 'up' | 'down') => {
    if (!editingId || !selectedHtmlNode?.id) return
    const iframe = iframeRefs.current.get(editingId)
    const doc = iframe?.contentDocument
    const target = doc?.querySelector(`[data-monet-node-id="${selectedHtmlNode.id}"]`)
    if (!(target instanceof HTMLElement) || !target.parentElement) return
    if (direction === 'up') {
      const previous = target.previousElementSibling
      if (previous) target.parentElement.insertBefore(target, previous)
    } else {
      const next = target.nextElementSibling
      if (next) target.parentElement.insertBefore(next, target)
    }
    syncEditHtmlFromIframe(editingId)
    setTimeout(() => selectHtmlNodeById(selectedHtmlNode.id), 0)
  }, [editingId, selectedHtmlNode?.id, selectHtmlNodeById, syncEditHtmlFromIframe])

  const primeHtmlNodeForAbsoluteEditing = useCallback((target: HTMLElement, doc: Document) => {
    const computed = window.getComputedStyle(target)
    const rect = getHtmlElementRect(target, doc)
    if (computed.position === 'static') {
      target.style.position = 'absolute'
      target.style.left = `${Math.round(rect.left)}px`
      target.style.top = `${Math.round(rect.top)}px`
      target.style.width = `${Math.round(rect.width)}px`
      target.style.height = `${Math.round(rect.height)}px`
      target.style.margin = '0'
    } else {
      if (!target.style.left) target.style.left = `${Math.round(rect.left)}px`
      if (!target.style.top) target.style.top = `${Math.round(rect.top)}px`
      if (!target.style.width) target.style.width = `${Math.round(rect.width)}px`
      if (!target.style.height) target.style.height = `${Math.round(rect.height)}px`
    }
    return rect
  }, [])

  function nudgeSelectedHtmlNodes(dx: number, dy: number) {
    if (!editingId || editMode !== 'html' || selectedHtmlNodeIds.length === 0) return
    const iframe = iframeRefs.current.get(editingId)
    const doc = iframe?.contentDocument
    if (!doc) return
    for (const id of selectedHtmlNodeIds) {
      const target = doc.querySelector(`[data-monet-node-id="${id}"]`)
      if (!(target instanceof HTMLElement)) continue
      const rect = primeHtmlNodeForAbsoluteEditing(target, doc)
      target.style.left = `${Math.round(rect.left + dx)}px`
      target.style.top = `${Math.round(rect.top + dy)}px`
    }
    syncEditHtmlFromIframe(editingId)
    if (selectedHtmlNode?.id) selectHtmlNodeById(selectedHtmlNode.id)
  }

  const addChildToSelectedHtmlNode = useCallback(() => {
    if (!editingId || !selectedHtmlNode?.id) return
    const iframe = iframeRefs.current.get(editingId)
    const doc = iframe?.contentDocument
    const target = doc?.querySelector(`[data-monet-node-id="${selectedHtmlNode.id}"]`)
    if (!(target instanceof HTMLElement)) return
    const child = doc.createElement('div')
    child.textContent = 'New block'
    child.style.minHeight = '48px'
    child.style.padding = '12px'
    child.style.borderRadius = '12px'
    child.style.background = 'rgba(148, 163, 184, 0.14)'
    child.style.color = '#f8fafc'
    child.style.fontFamily = 'Inter, sans-serif'
    clearMonetDomIds(child)
    assignMonetDomIds(child)
    target.appendChild(child)
    syncEditHtmlFromIframe(editingId)
    setTimeout(() => {
      if (child.dataset.monetNodeId) selectHtmlNodeById(child.dataset.monetNodeId)
    }, 0)
  }, [editingId, selectedHtmlNode?.id, selectHtmlNodeById, syncEditHtmlFromIframe])

  const wrapSelectedHtmlNodeInContainer = useCallback(() => {
    if (!editingId || !selectedHtmlNode?.id) return
    const iframe = iframeRefs.current.get(editingId)
    const doc = iframe?.contentDocument
    const target = doc?.querySelector(`[data-monet-node-id="${selectedHtmlNode.id}"]`)
    if (!(target instanceof HTMLElement) || !target.parentElement) return
    const wrapper = doc.createElement('div')
    wrapper.style.display = 'flex'
    wrapper.style.flexDirection = 'column'
    wrapper.style.gap = '12px'
    wrapper.style.padding = '16px'
    wrapper.style.borderRadius = '16px'
    wrapper.style.background = 'rgba(15, 23, 42, 0.72)'
    wrapper.style.border = '1px solid rgba(148, 163, 184, 0.2)'
    clearMonetDomIds(wrapper)
    assignMonetDomIds(wrapper)
    target.parentElement.insertBefore(wrapper, target)
    wrapper.appendChild(target)
    syncEditHtmlFromIframe(editingId)
    setTimeout(() => {
      if (wrapper.dataset.monetNodeId) selectHtmlNodeById(wrapper.dataset.monetNodeId)
    }, 0)
  }, [editingId, selectedHtmlNode?.id, selectHtmlNodeById, syncEditHtmlFromIframe])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== 'object' || data.type !== 'monet-html-selection') return
      if (typeof data.artboardId !== 'string' || data.artboardId !== editingId) return
      const node = data.node
      if (!node || typeof node !== 'object' || typeof node.id !== 'string') return
      const additive = Boolean((data as { additive?: unknown }).additive)
      setSelectedHtmlNode(node as HtmlInspectorNode)
      setSelectedNodeId(node.id)
      setSelectedHtmlNodeIds((prev) => additive
        ? Array.from(new Set(prev.includes(node.id) ? prev : [...prev, node.id]))
        : [node.id]
      )
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [editingId])

  useEffect(() => {
    if (editMode !== 'html' || !editingId || !selectedHtmlNode?.id) return
    postSelectHtmlNode(editingId, selectedHtmlNode.id)
  }, [editMode, editingId, postSelectHtmlNode, selectedHtmlNode?.id, liveHtml])

  useEffect(() => {
    if (editMode !== 'html' || !editingId) return
    const timer = setTimeout(() => syncEditHtmlFromIframe(editingId), 220)
    return () => clearTimeout(timer)
  }, [editMode, editingId, liveHtml, syncEditHtmlFromIframe])

  useEffect(() => {
    if (editMode !== 'html' || !selectedHtmlNode) {
      setHtmlOverlayRect(null)
      setHtmlGuideLines(null)
      setHtmlSpacingGuide(null)
    }
  }, [editMode, selectedHtmlNode])

  const isDesignInspector = Boolean(editingAb && editMode === 'design')
  const selectedNodeLocation = isDesignInspector && selectedNodeId
    ? findDesignNodeLocation(editDesign.nodes, selectedNodeId)
    : null
  const selectedDesignNode = selectedNodeLocation?.node ?? null
  const selectedNodeInsideStack = Boolean(selectedNodeLocation?.parent)
  const stackReorderLabels = selectedNodeLocation?.parent?.type === 'stack' && selectedNodeLocation.parent.direction === 'horizontal'
    ? { front: 'To right', back: 'To left', forward: 'Right', backward: 'Left' }
    : selectedNodeLocation?.parent?.type === 'grid'
    ? { front: 'Last cell', back: 'First cell', forward: 'Next cell', backward: 'Prev cell' }
    : selectedNodeInsideStack
    ? { front: 'To bottom', back: 'To top', forward: 'Down', backward: 'Up' }
    : { front: 'Bring front', back: 'Send back', forward: 'Forward', backward: 'Backward' }

  const updateSelectedDesignNode = useCallback((updater: (node: DesignNode) => DesignNode) => {
    if (!selectedNodeId) return
    setEditDesign((prev) => ({
      ...prev,
      nodes: mapDesignNodes(prev.nodes, selectedNodeId, updater)
    }))
  }, [selectedNodeId])

  const addDesignNode = useCallback((type: DesignNode['type']) => {
    const flatNodes = flattenDesignNodes(editDesign.nodes).map((entry) => entry.node)
    const selectedParentId = selectedDesignNode && isContainerNode(selectedDesignNode) ? selectedDesignNode.id : null
    const targetWidth = selectedNodeLocation?.parent?.width ?? editW
    const targetHeight = selectedNodeLocation?.parent?.height ?? editH
    const nextIndex = flatNodes.filter((item) => item.type === type).length + 1
    const node: DesignNode = type === 'rect'
      ? {
          id: uid(),
          name: `Rectangle ${nextIndex}`,
          type: 'rect',
          x: 80,
          y: 80,
          width: selectedParentId ? Math.max(120, targetWidth - 48) : 240,
          height: 160,
          rotation: 0,
          opacity: 1,
          radius: 20,
          fill: '#f59e0b',
          stroke: '#fcd34d',
          strokeWidth: 0
        }
      : type === 'text'
      ? {
          id: uid(),
          name: `Text ${nextIndex}`,
          type: 'text',
          x: 96,
          y: 120,
          width: selectedParentId ? Math.max(160, targetWidth - 48) : 420,
          height: 96,
          rotation: 0,
          opacity: 1,
          text: 'Edit this text',
          fill: '#ffffff',
          fontSize: 42,
          fontWeight: 700,
          letterSpacing: -0.6,
          align: 'left',
          sizing: selectedParentId ? 'hug' : 'fixed'
        }
      : type === 'stack'
      ? {
          id: uid(),
          name: `Stack ${nextIndex}`,
          type: 'stack',
          x: 96,
          y: 96,
          width: Math.min(Math.max(280, targetWidth - 120), editW - 48),
          height: Math.min(Math.max(220, Math.round(targetHeight * 0.5)), editH - 48),
          rotation: 0,
          opacity: 1,
          direction: 'vertical',
          gap: 16,
          padding: 24,
          alignItems: 'start',
          justifyContent: 'start',
          fill: '#111827',
          radius: 24,
          stroke: '#334155',
          strokeWidth: 1,
          sizing: selectedParentId ? 'hug' : 'fixed',
          children: []
        }
      : {
          id: uid(),
          name: `Grid ${nextIndex}`,
          type: 'grid',
          x: 96,
          y: 96,
          width: Math.min(Math.max(320, targetWidth - 120), editW - 48),
          height: Math.min(Math.max(240, Math.round(targetHeight * 0.55)), editH - 48),
          rotation: 0,
          opacity: 1,
          columns: 2,
          gap: 16,
          padding: 24,
          alignItems: 'start',
          fill: '#111827',
          radius: 24,
          stroke: '#334155',
          strokeWidth: 1,
          sizing: selectedParentId ? 'hug' : 'fixed',
          children: []
        }

    setEditDesign((prev) => ({ ...prev, nodes: insertDesignNode(prev.nodes, selectedParentId, node) }))
    setSelectedNodeId(node.id)
  }, [editDesign.nodes, editH, editW, selectedDesignNode, selectedNodeLocation])

  const removeSelectedDesignNode = useCallback(() => {
    if (!selectedNodeId) return
    setEditDesign((prev) => ({ ...prev, nodes: removeDesignNode(prev.nodes, selectedNodeId) }))
    setSelectedNodeId(null)
  }, [selectedNodeId])

  const moveSelectedDesignNodeInStack = useCallback((direction: 'forward' | 'backward' | 'front' | 'back') => {
    if (!selectedNodeId) return
    setEditDesign((prev) => {
      return { ...prev, nodes: moveDesignNodeInStack(prev.nodes, selectedNodeId, direction) }
    })
  }, [selectedNodeId])

  const exportSelectedDesignComponent = useCallback(async () => {
    if (!selectedDesignNode || !isContainerNode(selectedDesignNode)) return
    const payload = JSON.stringify(selectedDesignNode, null, 2)
    try {
      await navigator.clipboard.writeText(payload)
    } catch (error) {
      console.warn('Failed to copy design component', error)
    }
  }, [selectedDesignNode])

  const importDesignComponentFromClipboard = useCallback(async () => {
    const selectedParentId = selectedDesignNode && isContainerNode(selectedDesignNode) ? selectedDesignNode.id : null
    try {
      const raw = await navigator.clipboard.readText()
      if (!raw.trim()) return
      const parsed = JSON.parse(raw) as DesignNode
      if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return
      const cloned = cloneDesignNodeIds(normalizeDesignDocument({ background: editDesign.background, nodes: [parsed] }, editW, editH).nodes[0]!)
      setEditDesign((prev) => ({ ...prev, nodes: insertDesignNode(prev.nodes, selectedParentId, cloned) }))
      setSelectedNodeId(cloned.id)
    } catch (error) {
      console.warn('Failed to paste design component', error)
    }
  }, [editDesign.background, editH, editW, selectedDesignNode])

  const fitAll = useCallback(() => {
    if (!artboards.length || !viewportRef.current) return
    const rect = viewportRef.current.getBoundingClientRect()
    const vw = rect.width - (showLayers ? 176 : 0) - (editingId ? 384 : 0)
    const vh = rect.height
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const a of artboards) {
      minX = Math.min(minX, a.x)
      minY = Math.min(minY, a.y)
      maxX = Math.max(maxX, a.x + a.width)
      maxY = Math.max(maxY, a.y + a.height)
    }
    const cw = maxX - minX + 160
    const ch = maxY - minY + 160
    const nz = Math.min(1.5, vw / cw, vh / ch)
    setZoom(nz)
    setPan({
      x: (showLayers ? 176 : 0) + (vw - cw * nz) / 2 - (minX - 80) * nz,
      y: (vh - ch * nz) / 2 - (minY - 80) * nz,
    })
  }, [artboards, showLayers, editingId])

  const scrollToAb = useCallback((ab: Artboard) => {
    if (!viewportRef.current) return
    const rect = viewportRef.current.getBoundingClientRect()
    const cx = ab.x * zoom + pan.x
    const cy = ab.y * zoom + pan.y
    const tx = rect.width / 2 - (ab.width * zoom) / 2
    const ty = rect.height / 2 - (ab.height * zoom) / 2
    setPan(p => ({ x: p.x + (tx - cx), y: p.y + (ty - cy) }))
  }, [zoom, pan])

  const zoomIn = () => setZoom(z => Math.min(8, +(z * 1.25).toFixed(3)))
  const zoomOut = () => setZoom(z => Math.max(0.05, +(z / 1.25).toFixed(3)))
  const zoom100 = () => setZoom(1)

  const renderDesignNode = useCallback((ab: Artboard, node: DesignNode, insideStack = false): React.ReactNode => {
    const isSelected = editingId === ab.id && selectedNodeId === node.id
    const nodeChildren = isContainerNode(node) ? node.children : []
    const canDragFreely = !insideStack
    const sizingMode = node.type === 'text' || node.type === 'stack' || node.type === 'grid' ? node.sizing : 'fixed'
    const isFill = sizingMode === 'fill'
    const isHug = sizingMode === 'hug'
    const wrapperStyle = insideStack
      ? {
          position: 'relative' as const,
          width: isFill ? '100%' : isHug ? 'fit-content' : node.width,
          height: isHug ? 'fit-content' : node.height,
          maxWidth: '100%',
          minWidth: 0,
          flex: isFill ? '1 1 0%' : '0 0 auto',
        }
      : {
          position: 'absolute' as const,
          left: node.x,
          top: node.y,
          width: node.width,
          height: node.height,
        }

    return (
      <div
        key={node.id}
        onClick={(event) => {
          event.stopPropagation()
          setSelectedId(ab.id)
          setSelectedNodeId(node.id)
          if (editingId !== ab.id) openEditor(ab)
          setShowPresets(false)
        }}
        onMouseDown={(event) => {
          if (!canDragFreely || editingId !== ab.id || selectedNodeId !== node.id || event.button !== 0) return
          event.stopPropagation()
          designDragRef.current = {
            artboardId: ab.id,
            nodeId: node.id,
            mode: 'move',
            startMouseX: event.clientX,
            startMouseY: event.clientY,
            originX: node.x,
            originY: node.y,
            originWidth: node.width,
            originHeight: node.height
          }
        }}
        style={{
          ...wrapperStyle,
          transform: `rotate(${node.rotation}deg)`,
          opacity: node.opacity,
          cursor: canDragFreely ? 'default' : 'pointer',
          outline: isSelected ? '2px solid rgba(250,204,21,0.95)' : 'none',
          outlineOffset: 2,
          boxShadow: isSelected ? '0 0 0 1px rgba(255,255,255,0.18)' : 'none',
          borderRadius: node.type === 'rect' || node.type === 'stack' || node.type === 'grid' ? node.radius : 0,
          border: node.type === 'rect' || node.type === 'stack' || node.type === 'grid'
            ? node.strokeWidth > 0
              ? `${node.strokeWidth}px solid ${node.stroke}`
              : 'none'
            : 'none',
          background: node.type === 'rect' || node.type === 'stack' || node.type === 'grid' ? node.fill : 'transparent',
          overflow: 'hidden',
          userSelect: 'none',
          minHeight: insideStack && !isHug ? node.height : undefined
        }}
      >
        {node.type === 'text' ? (
          <div
            style={{
              width: isHug ? 'fit-content' : '100%',
              height: isHug ? 'fit-content' : '100%',
              minWidth: isFill ? 0 : undefined,
              maxWidth: insideStack ? '100%' : undefined,
              color: node.fill,
              fontSize: node.fontSize,
              fontWeight: node.fontWeight,
              letterSpacing: `${node.letterSpacing}px`,
              textAlign: node.align,
              fontFamily: 'Inter, sans-serif',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: node.align === 'center' ? 'center' : node.align === 'right' ? 'flex-end' : 'flex-start',
              whiteSpace: isHug ? 'pre' : 'pre-wrap',
              lineHeight: 1.05
            }}
          >
            {node.text}
          </div>
        ) : null}
        {node.type === 'stack' ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: node.direction === 'horizontal' ? 'row' : 'column',
              gap: node.gap,
              padding: node.padding,
              alignItems: node.alignItems === 'start' ? 'flex-start' : node.alignItems === 'end' ? 'flex-end' : node.alignItems,
              justifyContent: node.justifyContent === 'start' ? 'flex-start' : node.justifyContent === 'end' ? 'flex-end' : node.justifyContent,
              boxSizing: 'border-box'
            }}
          >
            {nodeChildren.map((child) => renderDesignNode(ab, child, true))}
          </div>
        ) : null}
        {node.type === 'grid' ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.max(1, node.columns)}, minmax(0, 1fr))`,
              gap: node.gap,
              padding: node.padding,
              alignItems: node.alignItems === 'start' ? 'start' : node.alignItems === 'end' ? 'end' : node.alignItems,
              boxSizing: 'border-box',
              alignContent: 'start'
            }}
          >
            {nodeChildren.map((child) => renderDesignNode(ab, child, true))}
          </div>
        ) : null}
        {editingId === ab.id && isSelected && canDragFreely && (
          <>
            {([
              ['nw', -DESIGN_HANDLE_SIZE / 2, -DESIGN_HANDLE_SIZE / 2, 'nwse-resize'],
              ['ne', node.width - DESIGN_HANDLE_SIZE / 2, -DESIGN_HANDLE_SIZE / 2, 'nesw-resize'],
              ['sw', -DESIGN_HANDLE_SIZE / 2, node.height - DESIGN_HANDLE_SIZE / 2, 'nesw-resize'],
              ['se', node.width - DESIGN_HANDLE_SIZE / 2, node.height - DESIGN_HANDLE_SIZE / 2, 'nwse-resize']
            ] as const).map(([handle, left, top, cursor]) => (
              <div
                key={handle}
                onMouseDown={(event) => {
                  event.stopPropagation()
                  designDragRef.current = {
                    artboardId: ab.id,
                    nodeId: node.id,
                    mode: 'resize',
                    handle,
                    startMouseX: event.clientX,
                    startMouseY: event.clientY,
                    originX: node.x,
                    originY: node.y,
                    originWidth: node.width,
                    originHeight: node.height
                  }
                }}
                style={{
                  position: 'absolute',
                  left,
                  top,
                  width: DESIGN_HANDLE_SIZE,
                  height: DESIGN_HANDLE_SIZE,
                  borderRadius: 999,
                  background: '#fde047',
                  border: '1px solid rgba(0,0,0,0.55)',
                  boxShadow: '0 1px 6px rgba(0,0,0,0.35)',
                  cursor,
                  zIndex: 2
                }}
              />
            ))}
          </>
        )}
      </div>
    )
  }, [editingId, openEditor, selectedNodeId])

  const renderHtmlTree = useCallback((nodes: HtmlInspectorTreeNode[], depth = 0): React.ReactNode[] => (
    nodes.flatMap((node) => [
      <button
        key={node.id}
        onClick={(event) => selectHtmlNodeById(node.id, event.shiftKey)}
        className={clsx(
          'flex w-full items-center justify-between rounded border px-2 py-1.5 text-left transition-colors',
          selectedHtmlNodeIds.includes(node.id)
            ? 'border-amber-300/40 bg-amber-300/10 text-amber-100'
            : 'border-border bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary'
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <span className="truncate text-[11px] font-medium">{node.label}</span>
        <span className="text-[10px] font-mono opacity-70">{node.tagName}</span>
      </button>,
      ...renderHtmlTree(node.children, depth + 1)
    ])
  ), [selectHtmlNodeById, selectedHtmlNodeIds])

  // Expose programmatic API for Playwright / AI control
  const artboardsRef = useRef<Artboard[]>(artboards)
  useEffect(() => { artboardsRef.current = artboards }, [artboards])

  useEffect(() => {
    ;(window as any).__monetCanvas = {
      addFrame: (name: string, w: number, h: number, html: string) => {
        const newId = uid()
        setArtboards(prev => {
          const last = prev[prev.length - 1]
          const x = last ? last.x + last.width + GAP : 80
          const y = last ? last.y : 80
          return [...prev, { id: newId, name, width: w, height: h, html, script: '', mode: 'html' as ArtboardMode, design: normalizeDesignDocument(undefined, w, h), x, y }]
        })
        setSelectedId(newId)
        return newId
      },
      addPaperFrame: (name: string, w: number, h: number, script: string) => {
        const newId = uid()
        setArtboards(prev => {
          const last = prev[prev.length - 1]
          const x = last ? last.x + last.width + GAP : 80
          const y = last ? last.y : 80
          return [...prev, { id: newId, name, width: w, height: h, html: '', script: script || '', mode: 'paperjs' as ArtboardMode, design: normalizeDesignDocument(undefined, w, h), x, y }]
        })
        setSelectedId(newId)
        return newId
      },
      addMatterFrame: (name: string, w: number, h: number, scene: string) => {
        const newId = uid()
        setArtboards(prev => {
          const last = prev[prev.length - 1]
          const x = last ? last.x + last.width + GAP : 80
          const y = last ? last.y : 80
          return [...prev, { id: newId, name, width: w, height: h, html: '', script: scene || '', mode: 'matterjs' as ArtboardMode, design: normalizeDesignDocument(undefined, w, h), x, y }]
        })
        setSelectedId(newId)
        return newId
      },
      setFrameHtml: (id: string, html: string) => {
        setArtboards(prev => prev.map(a => a.id === id ? { ...a, html } : a))
      },
      setFrameName: (id: string, name: string) => {
        setArtboards(prev => prev.map(a => a.id === id ? { ...a, name } : a))
      },
      setFrameMode: (id: string, mode: ArtboardMode, content: string) => {
        setArtboards(prev => prev.map(a => {
          if (a.id !== id) return a
          if (mode === 'design') return { ...a, mode, design: normalizeDesignDocument(a.design, a.width, a.height) }
          if (mode === 'html') return { ...a, mode, html: content }
          return { ...a, mode, script: content }
        }))
      },
      deleteFrame: (id: string) => {
        setArtboards(prev => prev.filter(a => a.id !== id))
      },
      getFrames: () => artboardsRef.current.map(a => ({ id: a.id, name: a.name, width: a.width, height: a.height, mode: a.mode })),
      getFramesDetailed: () => artboardsRef.current,
      selectFrame: (id: string) => {
        const ab = artboardsRef.current.find(a => a.id === id)
        if (ab) { setSelectedId(id); scrollToAb(ab) }
      },
      clearAll: () => { setArtboards([]); setSelectedId(null); setEditingId(null) },
      fitAll,
      setZoom: (z: number) => setZoom(z),
    }
    return () => { delete (window as any).__monetCanvas }
  }, [fitAll, scrollToAb])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#090909] text-text-primary">

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between border-b border-border bg-surface-1 px-3 py-1.5 flex-shrink-0 gap-3">

        {/* Left: layers toggle + add */}
        <div className="flex items-center gap-2">
          <button
            title="Toggle layers panel"
            onClick={() => setShowLayers(v => !v)}
            className={clsx('rounded p-1.5 transition-colors', showLayers ? 'text-accent bg-accent/10' : 'text-text-dim hover:text-text-secondary')}
          >
            <LayoutGrid size={12} />
          </button>

          <div className="h-3.5 w-px bg-border" />

          {/* Add artboard */}
          <div className="relative">
            <button
              onClick={() => setShowPresets(v => !v)}
              className="flex items-center gap-1.5 rounded border border-accent/30 bg-accent/10 px-2 py-1 text-2xs font-medium text-accent hover:bg-accent/20 transition-colors"
            >
              <Plus size={11} />
              New Frame
              <ChevronDown size={10} className={clsx('transition-transform', showPresets && 'rotate-180')} />
            </button>
            {showPresets && (
              <div className="absolute top-full left-0 mt-1 z-50 rounded-lg border border-border bg-surface-2 shadow-2xl py-1 min-w-[160px]">
                <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-widest text-text-dim opacity-50">Frame Type</div>
                <button
                  onClick={() => addArtboard(1280, 720, 'paperjs')}
                  className="w-full text-left px-3 py-1.5 text-2xs text-blue-300 hover:bg-surface-3 transition-colors flex items-center gap-2"
                >
                  <span className="text-[9px] font-mono bg-blue-900/50 text-blue-300 px-1 rounded">pjs</span>
                  Paper.js Frame
                </button>
                <button
                  onClick={() => addArtboard(1280, 720, 'matterjs')}
                  className="w-full text-left px-3 py-1.5 text-2xs text-green-300 hover:bg-surface-3 transition-colors flex items-center gap-2"
                >
                  <span className="text-[9px] font-mono bg-green-900/50 text-green-300 px-1 rounded">mjs</span>
                  Matter.js Frame
                </button>
                <button
                  onClick={() => addArtboard(1280, 720, 'html')}
                  className="w-full text-left px-3 py-1.5 text-2xs text-text-secondary hover:bg-surface-3 transition-colors flex items-center gap-2"
                >
                  <span className="text-[9px] font-mono bg-surface-3 text-text-dim px-1 rounded">html</span>
                  Raw HTML Frame
                </button>
              </div>
            )}
          </div>

          {selectedAb && !editingId && (
            <button
              onClick={() => openEditor(selectedAb)}
              className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-2xs font-medium text-text-secondary hover:text-text-primary hover:border-text-dim transition-colors"
            >
              <Code2 size={11} />
              Edit
            </button>
          )}

          {selectedAb && !editingId && (
            <button
              onClick={deleteSelected}
              className="rounded p-1.5 text-text-dim hover:text-red-400 transition-colors"
              title="Delete selected frame"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>

        {/* Center: canvas name */}
        <div className="absolute left-1/2 -translate-x-1/2 text-2xs font-medium text-text-dim pointer-events-none">
          {selectedAb ? selectedAb.name : 'Monet Canvas'}
          {selectedAb && (
            <span className="ml-1.5 text-text-dim opacity-50">{selectedAb.width}×{selectedAb.height}</span>
          )}
        </div>

        {/* Right: import/export + zoom */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={importCanvas}
            title="Import canvas (.json)"
            className="rounded p-1.5 text-text-dim hover:text-text-secondary transition-colors"
          >
            <Upload size={12} />
          </button>
          <button
            onClick={exportCanvas}
            disabled={artboards.length === 0}
            title="Export canvas (.json)"
            className="rounded p-1.5 text-text-dim hover:text-text-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Download size={12} />
          </button>
          <div className="h-3.5 w-px bg-border mx-1" />
          {artboards.length > 0 && (
            <>
              <button onClick={fitAll} title="Fit all frames" className="rounded p-1.5 text-text-dim hover:text-text-secondary transition-colors">
                <Maximize2 size={12} />
              </button>
              <div className="h-3.5 w-px bg-border mx-1" />
            </>
          )}
          <button onClick={zoomOut} className="rounded p-1.5 text-text-dim hover:text-text-secondary transition-colors">
            <ZoomOut size={12} />
          </button>
          <button
            onClick={zoom100}
            className="min-w-[40px] text-center text-2xs text-text-dim hover:text-text-secondary transition-colors tabular-nums"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={zoomIn} className="rounded p-1.5 text-text-dim hover:text-text-secondary transition-colors">
            <ZoomIn size={12} />
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Layers sidebar */}
        {showLayers && (
          <div className="w-44 flex-shrink-0 border-r border-border bg-surface-1 flex flex-col overflow-hidden">
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-text-dim border-b border-border flex-shrink-0">
              Frames
            </div>
            <div className="flex-1 overflow-y-auto">
              {artboards.length === 0 ? (
                <div className="px-3 py-6 text-center">
                  <Palette size={18} className="mx-auto mb-2 text-text-dim opacity-25" />
                  <div className="text-[11px] text-text-dim opacity-40 leading-relaxed">
                    No frames yet
                  </div>
                </div>
              ) : (
                artboards.map(ab => {
                  const badge = MODE_BADGE[ab.mode]
                  return (
                    <button
                      key={ab.id}
                      onClick={() => {
                        setSelectedId(ab.id)
                        if (ab.mode === 'design') {
                          if (editingId !== ab.id) openEditor(ab)
                          setSelectedNodeId(ab.design?.nodes[0]?.id ?? null)
                        }
                        scrollToAb(ab)
                      }}
                      onDoubleClick={() => openEditor(ab)}
                      className={clsx(
                        'w-full text-left px-3 py-2 border-b border-border/40 transition-colors',
                        selectedId === ab.id
                          ? 'bg-accent/10 text-accent'
                          : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
                      )}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Palette size={10} className="flex-shrink-0 opacity-50" />
                        <span className="truncate text-[11px] font-medium flex-1">{ab.name}</span>
                        <span className={clsx('text-[9px] font-mono px-1 rounded flex-shrink-0', badge.classes)}>
                          {badge.label}
                        </span>
                      </div>
                      <div className="text-[10px] text-text-dim mt-0.5 pl-4">{ab.width}×{ab.height}</div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}

        {/* Canvas viewport */}
        <div
          ref={viewportRef}
          className="flex-1 min-w-0 overflow-hidden relative select-none"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)
            `,
            backgroundSize: `${GRID * zoom}px ${GRID * zoom}px`,
            backgroundPosition: `${pan.x % (GRID * zoom)}px ${pan.y % (GRID * zoom)}px`,
          }}
          onWheel={onWheel}
          onMouseDown={onViewportMouseDown}
          onClick={e => { if (e.target === viewportRef.current) { setSelectedId(null); setSelectedNodeId(null); setShowPresets(false) } }}
        >
          {/* Empty state */}
          {artboards.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-3">
              <Palette size={36} className="text-text-dim opacity-15" />
              <div className="text-sm font-medium text-text-dim opacity-30">Monet Canvas</div>
              <div className="text-xs text-text-dim opacity-20">Click &ldquo;New Frame&rdquo; to get started</div>
            </div>
          )}

          {/* Canvas transform root */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              transformOrigin: '0 0',
              transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
            }}
          >
            {artboards.map(ab => (
              <div
                key={ab.id}
                style={{ position: 'absolute', left: ab.x, top: ab.y, width: ab.width, height: ab.height }}
              >
                {/* Name label */}
                <div
                  style={{
                    position: 'absolute',
                    top: -26,
                    left: 0,
                    fontSize: Math.max(11, 12 / zoom),
                    color: selectedId === ab.id ? 'rgba(99,179,237,0.85)' : 'rgba(255,255,255,0.3)',
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                    pointerEvents: 'none',
                    lineHeight: 1,
                  }}
                >
                  {ab.name}
                  {ab.mode !== 'html' && (
                    <span style={{
                      marginLeft: 6,
                      fontSize: Math.max(9, 10 / zoom),
                      color: ab.mode === 'design'
                        ? 'rgba(253,224,71,0.8)'
                        : ab.mode === 'paperjs'
                        ? 'rgba(147,197,253,0.7)'
                        : 'rgba(134,239,172,0.7)',
                      fontFamily: 'monospace',
                    }}>
                      [{ab.mode === 'design' ? 'dsg' : ab.mode === 'paperjs' ? 'pjs' : 'mjs'}]
                    </span>
                  )}
                </div>

                {/* Artboard frame */}
                <div
                  onClick={e => {
                    e.stopPropagation()
                    setSelectedId(ab.id)
                    if (ab.mode === 'design') {
                      if (editingId !== ab.id) openEditor(ab)
                      setSelectedNodeId(ab.design?.nodes[0]?.id ?? null)
                    }
                    setShowPresets(false)
                  }}
                  onDoubleClick={e => { e.stopPropagation(); openEditor(ab) }}
                  style={{
                    width: ab.width,
                    height: ab.height,
                    overflow: 'hidden',
                    position: 'relative',
                    background: '#111',
                    cursor: 'default',
                    outline: selectedId === ab.id
                      ? '2px solid rgba(99,179,237,0.8)'
                      : editingId === ab.id
                      ? '2px solid rgba(99,179,237,0.4)'
                      : 'none',
                    outlineOffset: 1,
                    boxShadow: selectedId === ab.id
                      ? '0 20px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(99,179,237,0.2)'
                      : '0 8px 40px rgba(0,0,0,0.6)',
                  }}
                >
                  {ab.mode === 'design' ? (
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        position: 'relative',
                        background: editingId === ab.id ? editDesign.background : (ab.design?.background ?? '#111111')
                      }}
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelectedId(ab.id)
                        setSelectedNodeId(null)
                        if (editingId !== ab.id) openEditor(ab)
                        setShowPresets(false)
                      }}
                    >
                      {(editingId === ab.id ? editDesign.nodes : (ab.design?.nodes ?? [])).map((node) => renderDesignNode(ab, node))}
                    </div>
                  ) : (editingId === ab.id ? (ab.mode === 'html' ? liveHtml : editScript) : hasContent(ab)) ? (
                    <>
                      <iframe
                        key={`${ab.id}-${editingId === ab.id ? 'live' : 'saved'}-${ab.mode}`}
                        ref={el => { if (el) iframeRefs.current.set(ab.id, el); else iframeRefs.current.delete(ab.id) }}
                        data-frame-id={ab.id}
                        srcDoc={getArtboardSrcDoc(
                          ab.mode === 'html' && resolvedHtmlMap.has(ab.id)
                            ? { ...ab, html: resolvedHtmlMap.get(ab.id)! }
                            : ab,
                          liveHtml, editHtml, editScript, editingId
                        )}
                        onLoad={() => {
                          if (editingId === ab.id && ab.mode === 'html') {
                            setTimeout(() => syncEditHtmlFromIframe(ab.id), 0)
                          }
                        }}
                        style={{
                          width: ab.width,
                          height: ab.height,
                          border: 'none',
                          display: 'block',
                          pointerEvents: editingId === ab.id && ab.mode === 'html' ? 'auto' : 'none'
                        }}
                        sandbox="allow-scripts allow-same-origin"
                        title={ab.name}
                      />
                      {editingId === ab.id && ab.mode === 'html' && htmlGuideLines && (
                        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 }}>
                          <div style={{ position: 'absolute', left: htmlGuideLines.left, top: 0, bottom: 0, width: 1, background: htmlGuideLines.snappedVertical === 'left' ? 'rgba(59,130,246,1)' : 'rgba(59,130,246,0.45)' }} />
                          <div style={{ position: 'absolute', left: htmlGuideLines.right, top: 0, bottom: 0, width: 1, background: htmlGuideLines.snappedVertical === 'right' ? 'rgba(59,130,246,1)' : 'rgba(59,130,246,0.45)' }} />
                          <div style={{ position: 'absolute', left: htmlGuideLines.centerX, top: 0, bottom: 0, width: 2, background: htmlGuideLines.snappedVertical === 'center' ? 'rgba(96,165,250,1)' : 'rgba(96,165,250,0.55)' }} />
                          <div style={{ position: 'absolute', top: htmlGuideLines.top, left: 0, right: 0, height: 1, background: htmlGuideLines.snappedHorizontal === 'top' ? 'rgba(59,130,246,1)' : 'rgba(59,130,246,0.45)' }} />
                          <div style={{ position: 'absolute', top: htmlGuideLines.bottom, left: 0, right: 0, height: 1, background: htmlGuideLines.snappedHorizontal === 'bottom' ? 'rgba(59,130,246,1)' : 'rgba(59,130,246,0.45)' }} />
                          <div style={{ position: 'absolute', top: htmlGuideLines.centerY, left: 0, right: 0, height: 2, background: htmlGuideLines.snappedHorizontal === 'center' ? 'rgba(96,165,250,1)' : 'rgba(96,165,250,0.55)' }} />
                        </div>
                      )}
                      {editingId === ab.id && ab.mode === 'html' && htmlSpacingGuide && (
                        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 }}>
                          {htmlSpacingGuide.orientation === 'horizontal' ? (
                            <>
                              <div style={{ position: 'absolute', left: Math.min(htmlSpacingGuide.start, htmlSpacingGuide.end), top: htmlSpacingGuide.cross, width: Math.abs(htmlSpacingGuide.end - htmlSpacingGuide.start), height: 1, background: 'rgba(125,211,252,0.95)' }} />
                              <div style={{ position: 'absolute', left: htmlSpacingGuide.start, top: htmlSpacingGuide.cross - 5, width: 1, height: 10, background: 'rgba(125,211,252,0.95)' }} />
                              <div style={{ position: 'absolute', left: htmlSpacingGuide.end, top: htmlSpacingGuide.cross - 5, width: 1, height: 10, background: 'rgba(125,211,252,0.95)' }} />
                              <div style={{ position: 'absolute', left: (htmlSpacingGuide.start + htmlSpacingGuide.end) / 2 - 14, top: htmlSpacingGuide.cross - 18, fontSize: 10, color: '#7dd3fc', fontFamily: 'Inter, sans-serif' }}>
                                {Math.round(htmlSpacingGuide.distance)}
                              </div>
                            </>
                          ) : (
                            <>
                              <div style={{ position: 'absolute', top: Math.min(htmlSpacingGuide.start, htmlSpacingGuide.end), left: htmlSpacingGuide.cross, height: Math.abs(htmlSpacingGuide.end - htmlSpacingGuide.start), width: 1, background: 'rgba(125,211,252,0.95)' }} />
                              <div style={{ position: 'absolute', top: htmlSpacingGuide.start, left: htmlSpacingGuide.cross - 5, height: 1, width: 10, background: 'rgba(125,211,252,0.95)' }} />
                              <div style={{ position: 'absolute', top: htmlSpacingGuide.end, left: htmlSpacingGuide.cross - 5, height: 1, width: 10, background: 'rgba(125,211,252,0.95)' }} />
                              <div style={{ position: 'absolute', top: (htmlSpacingGuide.start + htmlSpacingGuide.end) / 2 - 8, left: htmlSpacingGuide.cross + 8, fontSize: 10, color: '#7dd3fc', fontFamily: 'Inter, sans-serif' }}>
                                {Math.round(htmlSpacingGuide.distance)}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                      {editingId === ab.id && ab.mode === 'html' && htmlOverlayRect && selectedHtmlNode?.id && (
                        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
                          {selectedHtmlNodeIds
                            .filter((id) => id !== selectedHtmlNode.id)
                            .map((id) => {
                              const rect = htmlSelectionRects[id]
                              if (!rect) return null
                              return (
                                <div
                                  key={id}
                                  style={{
                                    position: 'absolute',
                                    left: rect.left,
                                    top: rect.top,
                                    width: rect.width,
                                    height: rect.height,
                                    border: '1px solid rgba(96,165,250,0.75)',
                                    boxShadow: '0 0 0 1px rgba(255,255,255,0.08)'
                                  }}
                                />
                              )
                            })}
                          <div
                            onMouseDown={(event) => {
                              event.stopPropagation()
                              const iframe = iframeRefs.current.get(ab.id)
                              const doc = iframe?.contentDocument
                              const target = doc?.querySelector(`[data-monet-node-id="${selectedHtmlNode.id}"]`)
                              if (!(target instanceof HTMLElement) || !doc) return
                              const rect = primeHtmlNodeForAbsoluteEditing(target, doc)
                              htmlDragRef.current = {
                                artboardId: ab.id,
                                nodeId: selectedHtmlNode.id,
                                mode: 'move',
                                startMouseX: event.clientX,
                                startMouseY: event.clientY,
                                originLeft: rect.left,
                                originTop: rect.top,
                                originWidth: rect.width,
                                originHeight: rect.height
                              }
                              setHtmlGuideLines({
                                left: rect.left,
                                right: rect.left + rect.width,
                                top: rect.top,
                                bottom: rect.top + rect.height,
                                centerX: rect.left + rect.width / 2,
                                centerY: rect.top + rect.height / 2
                              })
                            }}
                            style={{
                              position: 'absolute',
                              left: htmlOverlayRect.left,
                              top: htmlOverlayRect.top,
                              width: htmlOverlayRect.width,
                              height: htmlOverlayRect.height,
                              border: '2px solid rgba(59,130,246,0.95)',
                              boxShadow: '0 0 0 1px rgba(255,255,255,0.15)',
                              cursor: 'move',
                              pointerEvents: 'auto'
                            }}
                          >
                            {([
                              ['nw', -DESIGN_HANDLE_SIZE / 2, -DESIGN_HANDLE_SIZE / 2, 'nwse-resize'],
                              ['ne', htmlOverlayRect.width - DESIGN_HANDLE_SIZE / 2, -DESIGN_HANDLE_SIZE / 2, 'nesw-resize'],
                              ['sw', -DESIGN_HANDLE_SIZE / 2, htmlOverlayRect.height - DESIGN_HANDLE_SIZE / 2, 'nesw-resize'],
                              ['se', htmlOverlayRect.width - DESIGN_HANDLE_SIZE / 2, htmlOverlayRect.height - DESIGN_HANDLE_SIZE / 2, 'nwse-resize']
                            ] as const).map(([handle, left, top, cursor]) => (
                              <div
                                key={handle}
                                onMouseDown={(event) => {
                                  event.stopPropagation()
                                  const iframe = iframeRefs.current.get(ab.id)
                                  const doc = iframe?.contentDocument
                                  const target = doc?.querySelector(`[data-monet-node-id="${selectedHtmlNode.id}"]`)
                                  if (!(target instanceof HTMLElement) || !doc) return
                                  const rect = primeHtmlNodeForAbsoluteEditing(target, doc)
                                  htmlDragRef.current = {
                                    artboardId: ab.id,
                                    nodeId: selectedHtmlNode.id,
                                    mode: 'resize',
                                    handle,
                                    startMouseX: event.clientX,
                                    startMouseY: event.clientY,
                                    originLeft: rect.left,
                                    originTop: rect.top,
                                    originWidth: rect.width,
                                    originHeight: rect.height
                                  }
                                  setHtmlGuideLines({
                                    left: rect.left,
                                    right: rect.left + rect.width,
                                    top: rect.top,
                                    bottom: rect.top + rect.height,
                                    centerX: rect.left + rect.width / 2,
                                    centerY: rect.top + rect.height / 2
                                  })
                                }}
                                style={{
                                  position: 'absolute',
                                  left,
                                  top,
                                  width: DESIGN_HANDLE_SIZE,
                                  height: DESIGN_HANDLE_SIZE,
                                  borderRadius: 999,
                                  background: '#60a5fa',
                                  border: '1px solid rgba(0,0,0,0.55)',
                                  boxShadow: '0 1px 6px rgba(0,0,0,0.35)',
                                  cursor,
                                  zIndex: 2
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{
                      width: '100%', height: '100%',
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      gap: 8, background: '#111',
                    }}>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.18)', fontFamily: 'Inter,sans-serif' }}>Empty frame</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.1)', fontFamily: 'Inter,sans-serif' }}>Double-click to edit</div>
                    </div>
                  )}
                  {/* Per-artboard loading overlay — sits above the iframe, scales with zoom */}
                  {loadingFrameIds.has(ab.id) && <ArtboardLoadingOverlay message={loadingFrameMessages[ab.id]} />}
                  {frameErrors[ab.id] && <ArtboardErrorOverlay message={frameErrors[ab.id]} />}
                </div>

                {/* Size label */}
                <div style={{
                  position: 'absolute', bottom: -20, right: 0,
                  fontSize: 11, color: 'rgba(255,255,255,0.18)',
                  fontFamily: 'Inter,sans-serif', userSelect: 'none', pointerEvents: 'none',
                }}>
                  {ab.width}×{ab.height}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Editor panel ── */}
        {editingId && editingAb && (
          <div className="w-96 flex-shrink-0 border-l border-border bg-surface-1 flex flex-col overflow-hidden">

            {/* Editor header */}
            <div className="flex items-center justify-between border-b border-border px-3 py-2 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Code2 size={12} className="text-accent" />
                <span className="text-xs font-semibold text-text-primary">Frame Editor</span>
                <span className="text-[10px] text-text-dim bg-accent/10 border border-accent/20 rounded px-1.5 py-0.5">live preview</span>
              </div>
              <button onClick={() => setEditingId(null)} className="rounded p-1 text-text-dim hover:text-text-secondary transition-colors">
                <X size={13} />
              </button>
            </div>

            {/* Name + size */}
            <div className="border-b border-border px-3 py-2 flex-shrink-0 space-y-2">
              <input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className="w-full bg-transparent text-xs font-medium text-text-primary outline-none placeholder:text-text-dim"
                placeholder="Frame name"
              />
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 flex-1">
                  <span className="text-[10px] text-text-dim w-3">W</span>
                  <input
                    type="number"
                    value={editW}
                    onChange={e => setEditW(parseInt(e.target.value) || 1280)}
                    className="flex-1 bg-surface-2 border border-border rounded px-2 py-0.5 text-xs text-text-primary outline-none focus:border-accent/50 [appearance:textfield]"
                  />
                </div>
                <div className="flex items-center gap-1.5 flex-1">
                  <span className="text-[10px] text-text-dim w-3">H</span>
                  <input
                    type="number"
                    value={editH}
                    onChange={e => setEditH(parseInt(e.target.value) || 720)}
                    className="flex-1 bg-surface-2 border border-border rounded px-2 py-0.5 text-xs text-text-primary outline-none focus:border-accent/50 [appearance:textfield]"
                  />
                </div>
                <select
                  onChange={e => {
                    const p = PRESETS[parseInt(e.target.value)]
                    if (p) { setEditW(p.w); setEditH(p.h) }
                    e.target.value = ''
                  }}
                  defaultValue=""
                  className="bg-surface-2 border border-border rounded px-1.5 py-0.5 text-[10px] text-text-dim outline-none cursor-pointer"
                >
                  <option value="" disabled>preset</option>
                  {PRESETS.map((p, i) => (
                    <option key={p.label} value={i}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Mode display */}
            <div className="border-b border-border px-3 py-2 flex-shrink-0">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-text-dim">Mode</span>
                  <span
                    className={clsx(
                      'rounded px-2 py-0.5 text-[10px] font-medium',
                      editMode === 'design'
                        ? 'bg-amber-900/60 text-amber-200'
                        : editMode === 'html'
                        ? 'bg-surface-3 text-text-primary'
                        : editMode === 'paperjs'
                        ? 'bg-blue-900/60 text-blue-200'
                        : 'bg-green-900/60 text-green-200'
                    )}
                  >
                    {editMode === 'design' ? 'Design' : editMode === 'html' ? 'HTML' : editMode === 'paperjs' ? 'Paper.js' : 'Matter.js'}
                  </span>
                </div>
                <span className="text-[10px] text-text-dim">
                  Create a new frame to use a different mode
                </span>
              </div>
            </div>

            {/* Editor surface */}
            <div className="flex-1 min-h-0 overflow-hidden relative">
              {editMode === 'design' ? (
                <div className="absolute inset-0 overflow-y-auto bg-[#0d0d0f] px-3 py-3">
                  <div className="space-y-3">
                    <div className="rounded-lg border border-border bg-surface-1 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-widest text-text-dim">Frame</div>
                          <div className="mt-1 text-xs text-text-primary">Direct-edit design mode</div>
                        </div>
                        <div className="text-[10px] text-amber-200/80">Figma-style inspector</div>
                      </div>
                      <div className="grid grid-cols-[1fr,88px] gap-2">
                        <label className="flex items-center gap-2 rounded border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-text-secondary">
                          Background
                          <input
                            type="text"
                            value={editDesign.background}
                            onChange={(event) => setEditDesign((prev) => ({ ...prev, background: event.target.value }))}
                            className="min-w-0 flex-1 bg-transparent text-text-primary outline-none"
                          />
                        </label>
                        <input
                          type="color"
                          value={editDesign.background}
                          onChange={(event) => setEditDesign((prev) => ({ ...prev, background: event.target.value }))}
                          className="h-9 w-full rounded border border-border bg-surface-2"
                        />
                      </div>
                    </div>

                    <div className="rounded-lg border border-border bg-surface-1 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-[10px] font-semibold uppercase tracking-widest text-text-dim">Layers</div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => addDesignNode('rect')}
                            className="rounded border border-border bg-surface-2 px-2 py-1 text-[11px] text-text-primary hover:bg-surface-3 transition-colors"
                          >
                            + Rect
                          </button>
                          <button
                            onClick={() => addDesignNode('stack')}
                            className="rounded border border-border bg-surface-2 px-2 py-1 text-[11px] text-text-primary hover:bg-surface-3 transition-colors"
                          >
                            + Stack
                          </button>
                          <button
                            onClick={() => addDesignNode('grid')}
                            className="rounded border border-border bg-surface-2 px-2 py-1 text-[11px] text-text-primary hover:bg-surface-3 transition-colors"
                          >
                            + Grid
                          </button>
                          <button
                            onClick={() => addDesignNode('text')}
                            className="rounded border border-border bg-surface-2 px-2 py-1 text-[11px] text-text-primary hover:bg-surface-3 transition-colors"
                          >
                            + Text
                          </button>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {[...flattenDesignNodes(editDesign.nodes)].reverse().map(({ node, depth }) => (
                          <button
                            key={node.id}
                            onClick={() => setSelectedNodeId(node.id)}
                            className={clsx(
                              'flex w-full items-center justify-between rounded border px-2 py-1.5 text-left transition-colors',
                              selectedNodeId === node.id
                                ? 'border-amber-300/40 bg-amber-300/10 text-amber-100'
                                : 'border-border bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary'
                            )}
                          >
                            <span className="truncate text-[11px] font-medium" style={{ paddingLeft: depth * 12 }}>
                              {depth > 0 ? '↳ ' : ''}{node.name}
                            </span>
                            <span className="text-[10px] font-mono opacity-70">{node.type}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {selectedDesignNode ? (
                      <div className="rounded-lg border border-border bg-surface-1 p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-[10px] font-semibold uppercase tracking-widest text-text-dim">Selection</div>
                            <div className="mt-1 text-xs text-text-primary">{selectedDesignNode.name}</div>
                          </div>
                          <button
                            onClick={removeSelectedDesignNode}
                            className="rounded px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10 transition-colors"
                          >
                            Delete node
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => moveSelectedDesignNodeInStack('front')}
                            className="rounded border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-text-primary hover:bg-surface-3 transition-colors"
                          >
                            {stackReorderLabels.front}
                          </button>
                          <button
                            onClick={() => moveSelectedDesignNodeInStack('back')}
                            className="rounded border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-text-primary hover:bg-surface-3 transition-colors"
                          >
                            {stackReorderLabels.back}
                          </button>
                          <button
                            onClick={() => moveSelectedDesignNodeInStack('forward')}
                            className="rounded border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-text-primary hover:bg-surface-3 transition-colors"
                          >
                            {stackReorderLabels.forward}
                          </button>
                          <button
                            onClick={() => moveSelectedDesignNodeInStack('backward')}
                            className="rounded border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-text-primary hover:bg-surface-3 transition-colors"
                          >
                            {stackReorderLabels.backward}
                          </button>
                        </div>

                        {isContainerNode(selectedDesignNode) && (
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={exportSelectedDesignComponent}
                              className="rounded border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-text-primary hover:bg-surface-3 transition-colors"
                            >
                              Copy component JSON
                            </button>
                            <button
                              onClick={importDesignComponentFromClipboard}
                              className="rounded border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-text-primary hover:bg-surface-3 transition-colors"
                            >
                              Paste component JSON
                            </button>
                          </div>
                        )}

                        <label className="block">
                          <div className="mb-1 text-[10px] text-text-dim">Layer name</div>
                          <input
                            type="text"
                            value={selectedDesignNode.name}
                            onChange={(event) => updateSelectedDesignNode((node) => ({ ...node, name: event.target.value }))}
                            className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                          />
                        </label>

                        {selectedNodeInsideStack && (
                          <div className="rounded border border-amber-300/20 bg-amber-300/10 px-2 py-1.5 text-[10px] text-amber-100/85">
                            This layer is inside an auto-layout container. The parent controls placement and order.
                          </div>
                        )}

                        {selectedDesignNode.type === 'text' && (
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Text</div>
                            <textarea
                              value={selectedDesignNode.text}
                              onChange={(event) => updateSelectedDesignNode((node) => node.type === 'text' ? { ...node, text: event.target.value } : node)}
                              className="h-24 w-full resize-none rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                            />
                          </label>
                        )}

                        <div className="grid grid-cols-2 gap-2">
                          {[
                            ...(!selectedNodeInsideStack ? [
                              ['X', selectedDesignNode.x, (value: number) => updateSelectedDesignNode((node) => ({ ...node, x: value }))],
                              ['Y', selectedDesignNode.y, (value: number) => updateSelectedDesignNode((node) => ({ ...node, y: value }))]
                            ] : []),
                            ['W', selectedDesignNode.width, (value: number) => updateSelectedDesignNode((node) => ({ ...node, width: Math.max(1, value) }))],
                            ['H', selectedDesignNode.height, (value: number) => updateSelectedDesignNode((node) => ({ ...node, height: Math.max(1, value) }))],
                            ['Rot', selectedDesignNode.rotation, (value: number) => updateSelectedDesignNode((node) => ({ ...node, rotation: value }))],
                            ['Opacity', selectedDesignNode.opacity, (value: number) => updateSelectedDesignNode((node) => ({ ...node, opacity: Math.max(0, Math.min(1, value)) }))]
                          ].map(([label, value, onChange]) => (
                            <label key={label as string} className="block">
                              <div className="mb-1 text-[10px] text-text-dim">{label as string}</div>
                              <input
                                type="number"
                                value={value as number}
                                step={label === 'Opacity' ? 0.05 : 1}
                                onChange={(event) => (onChange as (value: number) => void)(parseFloat(event.target.value) || 0)}
                                className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                              />
                            </label>
                          ))}
                        </div>

                        {(selectedDesignNode.type === 'text' || selectedDesignNode.type === 'stack' || selectedDesignNode.type === 'grid') && (
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Sizing</div>
                            <select
                              value={selectedDesignNode.sizing}
                              onChange={(event) => updateSelectedDesignNode((node) => node.type === 'text' || node.type === 'stack' || node.type === 'grid' ? { ...node, sizing: event.target.value as DesignStackSizing } : node)}
                              className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                            >
                              <option value="fixed">Fixed</option>
                              <option value="fill">Fill container</option>
                              <option value="hug">Hug content</option>
                            </select>
                          </label>
                        )}

                        {selectedDesignNode.type === 'rect' ? (
                          <>
                            <div className="grid grid-cols-[1fr,88px] gap-2">
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Fill</div>
                                <input
                                  type="text"
                                  value={selectedDesignNode.fill}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'rect' ? { ...node, fill: event.target.value } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                />
                              </label>
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Color</div>
                                <input
                                  type="color"
                                  value={selectedDesignNode.fill}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'rect' ? { ...node, fill: event.target.value } : node)}
                                  className="h-8 w-full rounded border border-border bg-surface-2"
                                />
                              </label>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Radius</div>
                                <input
                                  type="number"
                                  value={selectedDesignNode.radius}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'rect' ? { ...node, radius: Math.max(0, parseInt(event.target.value) || 0) } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                />
                              </label>
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Stroke width</div>
                                <input
                                  type="number"
                                  value={selectedDesignNode.strokeWidth}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'rect' ? { ...node, strokeWidth: Math.max(0, parseInt(event.target.value) || 0) } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                />
                              </label>
                            </div>
                          </>
                        ) : selectedDesignNode.type === 'stack' ? (
                          <>
                            <div className="grid grid-cols-2 gap-2">
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Direction</div>
                                <select
                                  value={selectedDesignNode.direction}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'stack' ? { ...node, direction: event.target.value as DesignStackDirection } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                >
                                  <option value="vertical">Vertical</option>
                                  <option value="horizontal">Horizontal</option>
                                </select>
                              </label>
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Gap</div>
                                <input
                                  type="number"
                                  value={selectedDesignNode.gap}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'stack' ? { ...node, gap: Math.max(0, parseInt(event.target.value) || 0) } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                />
                              </label>
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Padding</div>
                                <input
                                  type="number"
                                  value={selectedDesignNode.padding}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'stack' ? { ...node, padding: Math.max(0, parseInt(event.target.value) || 0) } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                />
                              </label>
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Align items</div>
                                <select
                                  value={selectedDesignNode.alignItems}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'stack' ? { ...node, alignItems: event.target.value as DesignStackAlign } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                >
                                  <option value="start">Start</option>
                                  <option value="center">Center</option>
                                  <option value="end">End</option>
                                  <option value="stretch">Stretch</option>
                                </select>
                              </label>
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Justify</div>
                                <select
                                  value={selectedDesignNode.justifyContent}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'stack' ? { ...node, justifyContent: event.target.value as DesignStackJustify } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                >
                                  <option value="start">Start</option>
                                  <option value="center">Center</option>
                                  <option value="end">End</option>
                                  <option value="space-between">Space between</option>
                                </select>
                              </label>
                            </div>
                            <div className="grid grid-cols-[1fr,88px] gap-2">
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Fill</div>
                                <input
                                  type="text"
                                  value={selectedDesignNode.fill}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'stack' ? { ...node, fill: event.target.value } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                />
                              </label>
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Color</div>
                                <input
                                  type="color"
                                  value={selectedDesignNode.fill}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'stack' ? { ...node, fill: event.target.value } : node)}
                                  className="h-8 w-full rounded border border-border bg-surface-2"
                                />
                              </label>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Radius</div>
                                <input
                                  type="number"
                                  value={selectedDesignNode.radius}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'stack' ? { ...node, radius: Math.max(0, parseInt(event.target.value) || 0) } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                />
                              </label>
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Stroke width</div>
                                <input
                                  type="number"
                                  value={selectedDesignNode.strokeWidth}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'stack' ? { ...node, strokeWidth: Math.max(0, parseInt(event.target.value) || 0) } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                />
                              </label>
                            </div>
                          </>
                        ) : selectedDesignNode.type === 'grid' ? (
                          <>
                            <div className="grid grid-cols-2 gap-2">
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Columns</div>
                                <input
                                  type="number"
                                  value={selectedDesignNode.columns}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'grid' ? { ...node, columns: Math.max(1, Math.min(6, parseInt(event.target.value) || 1)) } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                />
                              </label>
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Gap</div>
                                <input
                                  type="number"
                                  value={selectedDesignNode.gap}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'grid' ? { ...node, gap: Math.max(0, parseInt(event.target.value) || 0) } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                />
                              </label>
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Padding</div>
                                <input
                                  type="number"
                                  value={selectedDesignNode.padding}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'grid' ? { ...node, padding: Math.max(0, parseInt(event.target.value) || 0) } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                />
                              </label>
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Align items</div>
                                <select
                                  value={selectedDesignNode.alignItems}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'grid' ? { ...node, alignItems: event.target.value as DesignGridAlign } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                >
                                  <option value="start">Start</option>
                                  <option value="center">Center</option>
                                  <option value="end">End</option>
                                  <option value="stretch">Stretch</option>
                                </select>
                              </label>
                            </div>
                            <div className="grid grid-cols-[1fr,88px] gap-2">
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Fill</div>
                                <input
                                  type="text"
                                  value={selectedDesignNode.fill}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'grid' ? { ...node, fill: event.target.value } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                />
                              </label>
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Color</div>
                                <input
                                  type="color"
                                  value={selectedDesignNode.fill}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'grid' ? { ...node, fill: event.target.value } : node)}
                                  className="h-8 w-full rounded border border-border bg-surface-2"
                                />
                              </label>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Radius</div>
                                <input
                                  type="number"
                                  value={selectedDesignNode.radius}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'grid' ? { ...node, radius: Math.max(0, parseInt(event.target.value) || 0) } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                />
                              </label>
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Stroke width</div>
                                <input
                                  type="number"
                                  value={selectedDesignNode.strokeWidth}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'grid' ? { ...node, strokeWidth: Math.max(0, parseInt(event.target.value) || 0) } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                />
                              </label>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="grid grid-cols-[1fr,88px] gap-2">
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Text color</div>
                                <input
                                  type="text"
                                  value={selectedDesignNode.fill}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'text' ? { ...node, fill: event.target.value } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                />
                              </label>
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Color</div>
                                <input
                                  type="color"
                                  value={selectedDesignNode.fill}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'text' ? { ...node, fill: event.target.value } : node)}
                                  className="h-8 w-full rounded border border-border bg-surface-2"
                                />
                              </label>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Font size</div>
                                <input
                                  type="number"
                                  value={selectedDesignNode.fontSize}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'text' ? { ...node, fontSize: Math.max(8, parseInt(event.target.value) || 8) } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                />
                              </label>
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Weight</div>
                                <input
                                  type="number"
                                  value={selectedDesignNode.fontWeight}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'text' ? { ...node, fontWeight: Math.max(100, parseInt(event.target.value) || 100) } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                />
                              </label>
                              <label className="block">
                                <div className="mb-1 text-[10px] text-text-dim">Align</div>
                                <select
                                  value={selectedDesignNode.align}
                                  onChange={(event) => updateSelectedDesignNode((node) => node.type === 'text' ? { ...node, align: event.target.value as 'left' | 'center' | 'right' } : node)}
                                  className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                                >
                                  <option value="left">Left</option>
                                  <option value="center">Center</option>
                                  <option value="right">Right</option>
                                </select>
                              </label>
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border bg-surface-1 p-4 text-xs text-text-dim leading-relaxed">
                        Select a layer on the canvas to edit its fill, text, size, or placement.
                      </div>
                    )}
                  </div>
                </div>
              ) : editMode === 'html' ? (
                <div className="absolute inset-0 flex flex-col bg-[#0d0d0f]">
                  <div className="border-b border-border px-3 py-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-widest text-text-dim">DOM Inspector</div>
                        <div className="mt-1 text-xs text-text-primary">Click an element on the canvas preview to select and edit it.</div>
                      </div>
                      {selectedHtmlNode ? (
                        <div className="rounded bg-surface-2 px-2 py-1 text-[10px] font-mono text-amber-200">
                          {selectedHtmlNode.tagName} · {selectedHtmlNode.id}
                        </div>
                      ) : null}
                    </div>

                    <div className="mb-3 rounded-lg border border-border bg-surface-1 p-3">
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-text-dim">DOM Layers</div>
                      <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                        {htmlDomTree.length > 0 ? renderHtmlTree(htmlDomTree) : (
                          <div className="rounded border border-dashed border-border bg-surface-2 px-2 py-2 text-[11px] text-text-dim">
                            Open or edit the HTML frame to inspect its hierarchy.
                          </div>
                        )}
                      </div>
                    </div>

                    {selectedHtmlNode ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={addChildToSelectedHtmlNode}
                            className="rounded border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-text-primary hover:bg-surface-3 transition-colors"
                          >
                            Add child
                          </button>
                          <button
                            onClick={wrapSelectedHtmlNodeInContainer}
                            className="rounded border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-text-primary hover:bg-surface-3 transition-colors"
                          >
                            Wrap in container
                          </button>
                          <button
                            onClick={() => moveSelectedHtmlNode('up')}
                            className="rounded border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-text-primary hover:bg-surface-3 transition-colors"
                          >
                            Move up
                          </button>
                          <button
                            onClick={() => moveSelectedHtmlNode('down')}
                            className="rounded border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-text-primary hover:bg-surface-3 transition-colors"
                          >
                            Move down
                          </button>
                          <button
                            onClick={duplicateSelectedHtmlNode}
                            className="rounded border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-text-primary hover:bg-surface-3 transition-colors"
                          >
                            Duplicate
                          </button>
                          <button
                            onClick={deleteSelectedHtmlNode}
                            className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200 hover:bg-red-500/20 transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                        <label className="block">
                          <div className="mb-1 text-[10px] text-text-dim">Layer label</div>
                          <input
                            type="text"
                            value={selectedHtmlNode.label}
                            placeholder={selectedHtmlNode.tagName}
                            onChange={(event) => renameSelectedHtmlNode(event.target.value)}
                            className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                          />
                        </label>
                        <label className="block">
                          <div className="mb-1 text-[10px] text-text-dim">Text</div>
                          <textarea
                            value={selectedHtmlNode.textContent}
                            onChange={(event) => updateSelectedHtmlNodeText(event.target.value)}
                            className="h-20 w-full resize-none rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                          />
                        </label>
                        <div className="grid grid-cols-[1fr,88px] gap-2">
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Text color</div>
                            <input
                              type="text"
                              value={selectedHtmlNode.color}
                              onChange={(event) => updateSelectedHtmlNodeStyle('color', event.target.value)}
                              className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                            />
                          </label>
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Color</div>
                            <input
                              type="color"
                              value={selectedHtmlNode.color.startsWith('#') ? selectedHtmlNode.color : '#ffffff'}
                              onChange={(event) => updateSelectedHtmlNodeStyle('color', event.target.value)}
                              className="h-8 w-full rounded border border-border bg-surface-2"
                            />
                          </label>
                        </div>
                        <div className="grid grid-cols-[1fr,88px] gap-2">
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Background</div>
                            <input
                              type="text"
                              value={selectedHtmlNode.backgroundColor}
                              onChange={(event) => updateSelectedHtmlNodeStyle('backgroundColor', event.target.value)}
                              className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                            />
                          </label>
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Color</div>
                            <input
                              type="color"
                              value={selectedHtmlNode.backgroundColor.startsWith('#') ? selectedHtmlNode.backgroundColor : '#111827'}
                              onChange={(event) => updateSelectedHtmlNodeStyle('backgroundColor', event.target.value)}
                              className="h-8 w-full rounded border border-border bg-surface-2"
                            />
                          </label>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Width</div>
                            <input
                              type="text"
                              value={selectedHtmlNode.width}
                              onChange={(event) => updateSelectedHtmlNodeStyle('width', event.target.value)}
                              className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                            />
                          </label>
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Height</div>
                            <input
                              type="text"
                              value={selectedHtmlNode.height}
                              onChange={(event) => updateSelectedHtmlNodeStyle('height', event.target.value)}
                              className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                            />
                          </label>
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Min height</div>
                            <input
                              type="text"
                              value={selectedHtmlNode.minHeight}
                              onChange={(event) => updateSelectedHtmlNodeStyle('minHeight', event.target.value)}
                              className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                            />
                          </label>
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Font size</div>
                            <input
                              type="text"
                              value={selectedHtmlNode.fontSize}
                              onChange={(event) => updateSelectedHtmlNodeStyle('fontSize', event.target.value)}
                              className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                            />
                          </label>
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Weight</div>
                            <input
                              type="text"
                              value={selectedHtmlNode.fontWeight}
                              onChange={(event) => updateSelectedHtmlNodeStyle('fontWeight', event.target.value)}
                              className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                            />
                          </label>
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Padding</div>
                            <input
                              type="text"
                              value={selectedHtmlNode.padding}
                              onChange={(event) => updateSelectedHtmlNodeStyle('padding', event.target.value)}
                              className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                            />
                          </label>
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Radius</div>
                            <input
                              type="text"
                              value={selectedHtmlNode.borderRadius}
                              onChange={(event) => updateSelectedHtmlNodeStyle('borderRadius', event.target.value)}
                              className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                            />
                          </label>
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Display</div>
                            <input
                              type="text"
                              value={selectedHtmlNode.display}
                              onChange={(event) => updateSelectedHtmlNodeStyle('display', event.target.value)}
                              className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                            />
                          </label>
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Gap</div>
                            <input
                              type="text"
                              value={selectedHtmlNode.gap}
                              onChange={(event) => updateSelectedHtmlNodeStyle('gap', event.target.value)}
                              className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                            />
                          </label>
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Flex direction</div>
                            <input
                              type="text"
                              value={selectedHtmlNode.flexDirection}
                              onChange={(event) => updateSelectedHtmlNodeStyle('flexDirection', event.target.value)}
                              className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                            />
                          </label>
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Justify</div>
                            <input
                              type="text"
                              value={selectedHtmlNode.justifyContent}
                              onChange={(event) => updateSelectedHtmlNodeStyle('justifyContent', event.target.value)}
                              className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                            />
                          </label>
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Align items</div>
                            <input
                              type="text"
                              value={selectedHtmlNode.alignItems}
                              onChange={(event) => updateSelectedHtmlNodeStyle('alignItems', event.target.value)}
                              className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                            />
                          </label>
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Wrap</div>
                            <input
                              type="text"
                              value={selectedHtmlNode.flexWrap}
                              onChange={(event) => updateSelectedHtmlNodeStyle('flexWrap', event.target.value)}
                              className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                            />
                          </label>
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Border</div>
                            <input
                              type="text"
                              value={selectedHtmlNode.border}
                              onChange={(event) => updateSelectedHtmlNodeStyle('border', event.target.value)}
                              className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                            />
                          </label>
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Shadow</div>
                            <input
                              type="text"
                              value={selectedHtmlNode.boxShadow}
                              onChange={(event) => updateSelectedHtmlNodeStyle('boxShadow', event.target.value)}
                              className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                            />
                          </label>
                          <label className="block">
                            <div className="mb-1 text-[10px] text-text-dim">Opacity</div>
                            <input
                              type="text"
                              value={selectedHtmlNode.opacity}
                              onChange={(event) => updateSelectedHtmlNodeStyle('opacity', event.target.value)}
                              className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-amber-300/40"
                            />
                          </label>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border bg-surface-1 p-3 text-xs text-text-dim leading-relaxed">
                        Select an element in the canvas preview to inspect its text and CSS properties.
                      </div>
                    )}
                  </div>

                  <textarea
                    value={editHtml}
                    onChange={e => setEditHtml(e.target.value)}
                    placeholder={`<div style="width:${editingAb.width}px;height:${editingAb.height}px;background:#000;display:flex;align-items:center;justify-content:center;">\n  <!-- your design -->\n</div>`}
                    className="min-h-0 flex-1 resize-none bg-[#0d0d0f] px-3 py-3 text-[11px] text-text-primary outline-none leading-relaxed placeholder:text-text-dim border-0"
                    spellCheck={false}
                    style={{ fontFamily: 'Menlo, Monaco, SF Mono, Consolas, monospace', tabSize: 2, lineHeight: 1.65 }}
                    onKeyDown={e => {
                      if (e.key === 'Tab') {
                        e.preventDefault()
                        const s = e.currentTarget.selectionStart
                        const end = e.currentTarget.selectionEnd
                        const v = editHtml.substring(0, s) + '  ' + editHtml.substring(end)
                        setEditHtml(v)
                        requestAnimationFrame(() => { e.currentTarget.selectionStart = e.currentTarget.selectionEnd = s + 2 })
                      }
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault()
                        saveEdit()
                      }
                    }}
                  />
                </div>
              ) : (
                <textarea
                  value={editScript}
                  onChange={e => setEditScript(e.target.value)}
                  placeholder={
                    editMode === 'paperjs'
                      ? `// Paper.js script\nvar circle = new Path.Circle({\n  center: view.center,\n  radius: 80,\n  fillColor: '#5b82f7'\n});\n// Animation:\n// view.onFrame = function(event) { circle.rotate(1); };`
                      : `// Matter.js scene\nvar ground = Bodies.rectangle(width/2, height-25, width, 50, { isStatic: true });\nComposite.add(engine.world, [ground]);\nengine.gravity.y = 1;`
                  }
                  className="absolute inset-0 w-full h-full resize-none bg-[#0d0d0f] px-3 py-3 text-[11px] text-text-primary outline-none leading-relaxed placeholder:text-text-dim border-0"
                  spellCheck={false}
                  style={{ fontFamily: 'Menlo, Monaco, SF Mono, Consolas, monospace', tabSize: 2, lineHeight: 1.65 }}
                  onKeyDown={e => {
                    if (e.key === 'Tab') {
                      e.preventDefault()
                      const s = e.currentTarget.selectionStart
                      const end = e.currentTarget.selectionEnd
                      const v = editScript.substring(0, s) + '  ' + editScript.substring(end)
                      setEditScript(v)
                      requestAnimationFrame(() => { e.currentTarget.selectionStart = e.currentTarget.selectionEnd = s + 2 })
                    }
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault()
                      saveEdit()
                    }
                  }}
                />
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-border px-3 py-2 flex-shrink-0">
              <button
                onClick={() => {
                  if (!editingId) return
                  setArtboards(prev => prev.filter(a => a.id !== editingId))
                  setSelectedId(null)
                  setEditingId(null)
                }}
                className="text-[11px] text-red-400/60 hover:text-red-400 transition-colors"
              >
                Delete frame
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditingId(null)}
                  className="rounded px-2.5 py-1 text-xs text-text-dim hover:text-text-secondary hover:bg-surface-2 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  className="flex items-center gap-1.5 rounded border border-status-green/30 bg-status-green/15 px-3 py-1 text-xs font-medium text-status-green hover:bg-status-green/20 transition-colors"
                >
                  <Check size={11} />
                  Apply
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Click-away to close presets */}
      {showPresets && (
        <div className="fixed inset-0 z-40" onClick={() => setShowPresets(false)} />
      )}
    </div>
  )
}
