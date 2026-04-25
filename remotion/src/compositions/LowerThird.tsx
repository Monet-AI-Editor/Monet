import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { z } from 'zod'

export const lowerThirdSchema = z.object({
  name: z.string().default('John Doe'),
  title: z.string().default('Executive Producer'),
  accentColor: z.string().default('#7aa2f7'),
  textColor: z.string().default('#ffffff'),
  backgroundColor: z.string().default('rgba(0,0,0,0)'),
  position: z.enum(['left', 'center', 'right']).default('left'),
  holdDuration: z.number().int().default(120),
})

type Props = z.infer<typeof lowerThirdSchema>

export function LowerThird({ name, title, accentColor, textColor, position, holdDuration }: Props) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()

  const exitFrame = durationInFrames - 30

  const enterProgress = spring({ frame, fps, config: { damping: 120, stiffness: 200 } })
  const exitProgress = spring({ frame: frame - exitFrame, fps, config: { damping: 120, stiffness: 200 } })

  const translateX = interpolate(enterProgress, [0, 1], [-400, 0]) + interpolate(exitProgress, [0, 1], [0, -400])
  const opacity = Math.min(enterProgress, 1 - exitProgress)

  const alignItems = position === 'left' ? 'flex-start' : position === 'right' ? 'flex-end' : 'center'
  const paddingLeft = position === 'left' ? 80 : 0
  const paddingRight = position === 'right' ? 80 : 0

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems, paddingBottom: 120, paddingLeft, paddingRight }}>
      <div style={{ opacity, transform: `translateX(${translateX}px)` }}>
        <div style={{
          borderLeft: `4px solid ${accentColor}`,
          paddingLeft: 16,
          paddingTop: 6,
          paddingBottom: 6,
        }}>
          <div style={{
            color: textColor,
            fontSize: 36,
            fontWeight: 700,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            lineHeight: 1.2,
            textShadow: '0 2px 8px rgba(0,0,0,0.8)',
          }}>
            {name}
          </div>
          <div style={{
            color: accentColor,
            fontSize: 22,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            lineHeight: 1.2,
            textShadow: '0 2px 8px rgba(0,0,0,0.8)',
          }}>
            {title}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}
