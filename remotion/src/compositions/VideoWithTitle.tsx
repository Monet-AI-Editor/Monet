import { AbsoluteFill, OffthreadVideo, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { z } from 'zod'

export const videoWithTitleSchema = z.object({
  videoSrc: z.string().describe('Absolute path to the video file (e.g. /Users/you/clip.mp4)'),
  title: z.string().default(''),
  subtitle: z.string().optional(),
  titlePosition: z.enum(['top', 'bottom']).default('bottom'),
  overlayOpacity: z.number().min(0).max(1).default(0.5),
  textColor: z.string().default('#ffffff'),
  accentColor: z.string().default('#7aa2f7'),
})

type Props = z.infer<typeof videoWithTitleSchema>

export function VideoWithTitle({ videoSrc, title, subtitle, titlePosition, overlayOpacity, textColor, accentColor }: Props) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const textOpacity = spring({ frame: frame - 10, fps, config: { damping: 200 } })

  const isBottom = titlePosition === 'bottom'

  return (
    <AbsoluteFill>
      <OffthreadVideo src={videoSrc} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      {title && (
        <AbsoluteFill style={{
          justifyContent: isBottom ? 'flex-end' : 'flex-start',
          alignItems: 'flex-start',
        }}>
          <div style={{
            width: '100%',
            background: `linear-gradient(${isBottom ? 'to top' : 'to bottom'}, rgba(0,0,0,${overlayOpacity}) 0%, transparent 100%)`,
            padding: isBottom ? '80px 60px 60px' : '60px 60px 80px',
            opacity: textOpacity,
          }}>
            <div style={{ color: textColor, fontSize: 64, fontWeight: 700, fontFamily: 'system-ui, sans-serif', lineHeight: 1.1 }}>
              {title}
            </div>
            {subtitle && (
              <div style={{ color: accentColor, fontSize: 32, fontFamily: 'system-ui, sans-serif', marginTop: 12 }}>
                {subtitle}
              </div>
            )}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  )
}
