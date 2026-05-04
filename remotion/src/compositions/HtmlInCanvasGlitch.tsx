import React from 'react'
import { AbsoluteFill, HtmlInCanvas, type HtmlInCanvasOnPaint, useCurrentFrame } from 'remotion'
import { z } from 'zod'

export const htmlInCanvasGlitchSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  backgroundColor: z.string(),
  textColor: z.string(),
  accentColor: z.string(),
  glitchIntensity: z.number().min(0).max(40),
})

type Props = z.infer<typeof htmlInCanvasGlitchSchema>

export const HtmlInCanvasGlitch: React.FC<Props> = ({
  title,
  subtitle,
  backgroundColor,
  textColor,
  accentColor,
  glitchIntensity,
}) => {
  const frame = useCurrentFrame()

  const onPaint: HtmlInCanvasOnPaint = ({ canvas, element, elementImage }) => {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to acquire 2D context')
    ctx.reset()

    const offset = Math.sin(frame / 4) * glitchIntensity
    const slice = Math.floor((frame * 7) % canvas.height)

    ctx.globalCompositeOperation = 'source-over'
    const baseTransform = ctx.drawElementImage(elementImage, 0, 0)

    ctx.globalCompositeOperation = 'screen'
    ctx.filter = 'hue-rotate(120deg)'
    ctx.drawElementImage(elementImage, offset, 0)

    ctx.filter = 'hue-rotate(-120deg)'
    ctx.drawElementImage(elementImage, -offset, 0)

    ctx.filter = 'none'
    ctx.globalCompositeOperation = 'difference'
    ctx.fillStyle = accentColor
    ctx.fillRect(0, slice, canvas.width, 4)

    element.style.transform = baseTransform.toString()
  }

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      <HtmlInCanvas width={1920} height={1080} onPaint={onPaint}>
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor,
            color: textColor,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            gap: 24,
          }}
        >
          <div style={{ fontSize: 160, fontWeight: 800, letterSpacing: -4 }}>{title}</div>
          <div style={{ fontSize: 48, opacity: 0.7 }}>{subtitle}</div>
        </div>
      </HtmlInCanvas>
    </AbsoluteFill>
  )
}
