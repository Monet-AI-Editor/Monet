import { AbsoluteFill, Img, interpolate, useCurrentFrame } from 'remotion'
import { z } from 'zod'

export const slideshowSchema = z.object({
  images: z.array(z.string()),
  frameDuration: z.number().default(90),
  transitionDuration: z.number().default(20),
  backgroundColor: z.string().default('#0f1115'),
})

type Props = z.infer<typeof slideshowSchema>

export function Slideshow({ images, frameDuration, transitionDuration, backgroundColor }: Props) {
  const frame = useCurrentFrame()

  if (images.length === 0) {
    return (
      <AbsoluteFill style={{ backgroundColor, justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ color: '#5c6370', fontSize: 32, fontFamily: 'system-ui, sans-serif' }}>
          No images — pass image paths via props
        </div>
      </AbsoluteFill>
    )
  }

  const totalFramesPerSlide = frameDuration + transitionDuration
  const currentIndex = Math.floor(frame / totalFramesPerSlide) % images.length
  const nextIndex = (currentIndex + 1) % images.length
  const frameInSlide = frame % totalFramesPerSlide
  const isTransitioning = frameInSlide >= frameDuration

  const currentOpacity = isTransitioning
    ? interpolate(frameInSlide, [frameDuration, frameDuration + transitionDuration], [1, 0])
    : 1

  const nextOpacity = isTransitioning
    ? interpolate(frameInSlide, [frameDuration, frameDuration + transitionDuration], [0, 1])
    : 0

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      <AbsoluteFill style={{ opacity: currentOpacity }}>
        <Img src={images[currentIndex]} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </AbsoluteFill>
      {isTransitioning && (
        <AbsoluteFill style={{ opacity: nextOpacity }}>
          <Img src={images[nextIndex]} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  )
}
