import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { z } from 'zod'

export const kineticTextSchema = z.object({
  text: z.string().default('Make something amazing'),
  backgroundColor: z.string().default('#0f1115'),
  textColor: z.string().default('#e8eaed'),
  accentColor: z.string().default('#7aa2f7'),
  fontSize: z.number().default(120),
  staggerFrames: z.number().int().default(4),
  animationStyle: z.enum(['rise', 'fall', 'scale', 'blur']).default('rise'),
})

type Props = z.infer<typeof kineticTextSchema>

export function KineticText({ text, backgroundColor, textColor, accentColor, fontSize, staggerFrames, animationStyle }: Props) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const words = text.split(' ')

  return (
    <AbsoluteFill style={{ backgroundColor, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '0 24px',
        padding: '0 80px',
        maxWidth: 1600,
      }}>
        {words.map((word, i) => {
          const delay = i * staggerFrames
          const progress = spring({ frame: frame - delay, fps, config: { damping: 150, stiffness: 300 } })
          const color = i % 3 === 1 ? accentColor : textColor

          let style: React.CSSProperties = {
            color,
            fontSize,
            fontWeight: 800,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            display: 'inline-block',
            lineHeight: 1.15,
          }

          if (animationStyle === 'rise') {
            style = { ...style, opacity: progress, transform: `translateY(${interpolate(progress, [0, 1], [60, 0])}px)` }
          } else if (animationStyle === 'fall') {
            style = { ...style, opacity: progress, transform: `translateY(${interpolate(progress, [0, 1], [-60, 0])}px)` }
          } else if (animationStyle === 'scale') {
            style = { ...style, opacity: progress, transform: `scale(${interpolate(progress, [0, 1], [0.4, 1])})` }
          } else if (animationStyle === 'blur') {
            const blur = interpolate(progress, [0, 1], [20, 0])
            style = { ...style, opacity: progress, filter: `blur(${blur}px)` }
          }

          return (
            <span key={i} style={style}>
              {word}
            </span>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}
