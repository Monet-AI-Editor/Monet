import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { z } from 'zod'

const captionWordSchema = z.object({
  word: z.string(),
  startFrame: z.number().int(),
  endFrame: z.number().int(),
})

export const animatedCaptionsSchema = z.object({
  words: z.array(captionWordSchema).default([
    { word: 'Add', startFrame: 0, endFrame: 20 },
    { word: 'your', startFrame: 20, endFrame: 40 },
    { word: 'captions', startFrame: 40, endFrame: 60 },
    { word: 'here', startFrame: 60, endFrame: 80 },
  ]),
  backgroundColor: z.string().default('rgba(0,0,0,0)'),
  textColor: z.string().default('#ffffff'),
  highlightColor: z.string().default('#7aa2f7'),
  fontSize: z.number().default(72),
  position: z.enum(['top', 'middle', 'bottom']).default('bottom'),
})

type Props = z.infer<typeof animatedCaptionsSchema>

export function AnimatedCaptions({ words, textColor, highlightColor, fontSize, position }: Props) {
  const frame = useCurrentFrame()

  const activeIndex = words.findIndex((w) => frame >= w.startFrame && frame < w.endFrame)
  const activeWord = activeIndex >= 0 ? words[activeIndex] : null

  const visibleWords = words.filter((w) => frame >= w.startFrame)

  const justifyContent =
    position === 'top' ? 'flex-start' : position === 'middle' ? 'center' : 'flex-end'
  const paddingTop = position === 'top' ? 80 : 0
  const paddingBottom = position === 'bottom' ? 100 : 0

  return (
    <AbsoluteFill style={{ justifyContent, alignItems: 'center', paddingTop, paddingBottom }}>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: '0 16px',
        padding: '0 80px',
        maxWidth: 1600,
      }}>
        {visibleWords.map((w, i) => {
          const isActive = activeWord?.word === w.word && activeWord?.startFrame === w.startFrame
          const scale = isActive
            ? interpolate(frame, [w.startFrame, w.startFrame + 5], [0.9, 1], { extrapolateRight: 'clamp' })
            : 1
          return (
            <span
              key={i}
              style={{
                color: isActive ? highlightColor : textColor,
                fontSize,
                fontWeight: 700,
                fontFamily: 'system-ui, -apple-system, sans-serif',
                textShadow: '0 2px 12px rgba(0,0,0,0.9)',
                display: 'inline-block',
                transform: `scale(${scale})`,
                transition: 'color 0.1s',
                lineHeight: 1.3,
              }}
            >
              {w.word}
            </span>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}
