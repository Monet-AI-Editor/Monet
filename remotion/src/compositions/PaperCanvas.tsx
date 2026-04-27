import { AbsoluteFill, useCurrentFrame, useVideoConfig, delayRender, continueRender } from 'remotion'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'

export const paperCanvasSchema = z.object({
  script: z.string().describe(
    'Paper.js script executed each frame. Globals in scope: frame (number), fps (number), ' +
    'width, height, t (0..1 normalized time), and all Paper.js globals: ' +
    'Path, Shape, Group, PointText, Raster, Color, Gradient, GradientStop, ' +
    'Point, Size, Rectangle, view, project, layer. ' +
    'Clear the project each frame with: project.clear(). ' +
    'Example: project.clear(); var r = frame * 2; new Path.Circle({ center: view.center, radius: r, fillColor: new Color(t, 0.5, 1) });'
  ),
  backgroundColor: z.string().default('#111318'),
})

type Props = z.infer<typeof paperCanvasSchema>

export function PaperCanvas({ script, backgroundColor }: Props) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [handle] = useState(() => delayRender('paper-canvas'))
  const renderedRef = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false

    // paper.js is in node_modules; load via dynamic require in Chromium context
    const loadPaper = async () => {
      try {
        // @ts-ignore — paper is available as ESM in browser context
        const paperModule = await import('paper/dist/paper-full.js').catch(
          // fallback: load from unpkg CDN
          () => new Promise<any>((resolve) => {
            if ((window as any).paper) { resolve({ default: (window as any).paper }); return }
            const s = document.createElement('script')
            s.src = 'https://unpkg.com/paper@0.12.18/dist/paper-full.min.js'
            s.onload = () => resolve({ default: (window as any).paper })
            document.head.appendChild(s)
          })
        )

        if (cancelled) return

        const paper = paperModule?.default ?? (window as any).paper
        if (!paper) throw new Error('paper.js not available')

        paper.setup(canvas)
        const t = fps > 0 ? frame / (fps * 10) : 0 // normalized 0..1 over ~10s

        // Build execution scope with all Paper.js globals exposed
        const fn = new Function(
          'paper', 'frame', 'fps', 'width', 'height', 't',
          'Path', 'Shape', 'CompoundPath', 'Group', 'Layer', 'Raster', 'PointText', 'Symbol',
          'Color', 'Gradient', 'GradientStop', 'Point', 'Size', 'Rectangle', 'Matrix',
          'view', 'project', 'layer',
          `"use strict";\n${script}`
        )

        fn(
          paper, frame, fps, width, height, t,
          paper.Path, paper.Shape, paper.CompoundPath, paper.Group, paper.Layer,
          paper.Raster, paper.PointText, paper.Symbol,
          paper.Color, paper.Gradient, paper.GradientStop,
          paper.Point, paper.Size, paper.Rectangle, paper.Matrix,
          paper.view, paper.project, paper.project.activeLayer
        )

        paper.view.draw()

        if (!renderedRef.current) {
          renderedRef.current = true
          continueRender(handle)
        }
      } catch (err) {
        console.error('[PaperCanvas] script error:', err)
        // Draw error state on canvas
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.fillStyle = backgroundColor
          ctx.fillRect(0, 0, width, height)
          ctx.fillStyle = '#f07178'
          ctx.font = '16px monospace'
          ctx.fillText(`Paper.js error: ${String(err)}`, 20, 40)
        }
        if (!renderedRef.current) {
          renderedRef.current = true
          continueRender(handle)
        }
      }
    }

    void loadPaper()
    return () => { cancelled = true }
  }, [frame, fps, width, height, script, backgroundColor, handle])

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
    </AbsoluteFill>
  )
}
