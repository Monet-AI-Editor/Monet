import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { z } from 'zod'

export const titleCardSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  backgroundColor: z.string().default('#0f1115'),
  textColor: z.string().default('#e8eaed'),
  accentColor: z.string().default('#7aa2f7'),
})

type Props = z.infer<typeof titleCardSchema>

export function TitleCard({ title, subtitle, backgroundColor, textColor, accentColor }: Props) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const titleOpacity = spring({ frame, fps, config: { damping: 200 } })
  const subtitleOpacity = spring({ frame: frame - 15, fps, config: { damping: 200 } })
  const titleY = spring({ frame, fps, from: 40, to: 0, config: { damping: 200 } })
  const subtitleY = spring({ frame: frame - 15, fps, from: 20, to: 0, config: { damping: 200 } })

  return (
    <AbsoluteFill style={{ backgroundColor, justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: 24 }}>
      <div
        style={{
          color: textColor,
          fontSize: 96,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontWeight: 700,
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          textAlign: 'center',
          padding: '0 80px',
          lineHeight: 1.1,
        }}
      >
        {title}
      </div>
      {subtitle && (
        <div
          style={{
            color: accentColor,
            fontSize: 40,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: 400,
            opacity: subtitleOpacity,
            transform: `translateY(${subtitleY}px)`,
            textAlign: 'center',
            padding: '0 120px',
          }}
        >
          {subtitle}
        </div>
      )}
    </AbsoluteFill>
  )
}
