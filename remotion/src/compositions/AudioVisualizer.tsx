import { AbsoluteFill, Audio, useCurrentFrame, useVideoConfig } from 'remotion'
import { useAudioData, visualizeAudio } from '@remotion/media-utils'
import { z } from 'zod'

export const audioVisualizerSchema = z.object({
  audioSrc: z.string().describe('Absolute path to an audio file (mp3, wav, etc.)'),
  title: z.string().default(''),
  barCount: z.number().int().min(8).max(256).default(64),
  barColor: z.string().default('#7aa2f7'),
  barColorPeak: z.string().default('#f07178'),
  backgroundColor: z.string().default('#0f1115'),
  textColor: z.string().default('#e8eaed'),
  mirror: z.boolean().default(true),
})

type Props = z.infer<typeof audioVisualizerSchema>

export function AudioVisualizer({ audioSrc, title, barCount, barColor, barColorPeak, backgroundColor, textColor, mirror }: Props) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const audioData = useAudioData(audioSrc)

  const bars = audioData
    ? visualizeAudio({ audioData, frame, fps, numberOfSamples: barCount, smoothing: true })
    : Array(barCount).fill(0)

  const effectiveBars = mirror ? bars.slice(0, Math.floor(barCount / 2)) : bars
  const displayBars = mirror ? [...effectiveBars.reverse(), ...effectiveBars] : effectiveBars

  const barWidth = width / displayBars.length
  const maxBarHeight = height * 0.7

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      <Audio src={audioSrc} />
      <AbsoluteFill style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
        <svg width={width} height={height}>
          {displayBars.map((amplitude, i) => {
            const barH = Math.max(2, amplitude * maxBarHeight)
            const x = i * barWidth
            const y = height / 2 - barH / 2
            const isPeak = amplitude > 0.7
            return (
              <rect
                key={i}
                x={x + barWidth * 0.1}
                y={y}
                width={barWidth * 0.8}
                height={barH}
                fill={isPeak ? barColorPeak : barColor}
                rx={2}
              />
            )
          })}
        </svg>
      </AbsoluteFill>
      {title && (
        <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 48 }}>
          <div style={{ color: textColor, fontSize: 28, fontFamily: 'system-ui, sans-serif', opacity: 0.7 }}>
            {title}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  )
}
