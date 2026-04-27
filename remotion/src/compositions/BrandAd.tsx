import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { z } from 'zod'

export const brandAdSchema = z.object({
  logoSrc: z.string(),
  tagline: z.string().default('Edit smarter. Create faster.'),
  cta: z.string().default('Try Monet Today'),
  backgroundColor: z.string().default('#0a0b0e'),
  accentColor: z.string().default('#7aa2f7'),
  textColor: z.string().default('#e8eaed'),
})

type Props = z.infer<typeof brandAdSchema>

export function BrandAd({ logoSrc, tagline, cta, backgroundColor, accentColor, textColor }: Props) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()

  // Logo: scale + fade in during first 40 frames
  const logoScale = spring({ frame, fps, from: 0.6, to: 1, config: { damping: 18, stiffness: 80 } })
  const logoOpacity = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp' })

  // Accent line under logo: expand width after logo settles (~frame 35)
  const lineWidth = interpolate(frame, [35, 70], [0, 320], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const lineOpacity = interpolate(frame, [35, 50], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  // Tagline: fade + slide up from frame 60
  const taglineOpacity = interpolate(frame, [60, 90], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const taglineY = interpolate(frame, [60, 90], [24, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  // CTA: fade in from frame 110, fade out near end
  const ctaOpacity = interpolate(
    frame,
    [110, 140, durationInFrames - 20, durationInFrames - 5],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
  const ctaScale = spring({ frame: frame - 110, fps, from: 0.9, to: 1, config: { damping: 20 } })

  // Subtle background radial glow that pulses
  const glowOpacity = interpolate(
    Math.sin((frame / fps) * Math.PI * 0.6),
    [-1, 1],
    [0.06, 0.14],
  )

  return (
    <AbsoluteFill style={{ backgroundColor, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Background glow */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 55% at 50% 50%, ${accentColor}, transparent)`,
          opacity: glowOpacity,
        }}
      />

      {/* Center layout */}
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: 0 }}>
        {/* Logo */}
        <div
          style={{
            opacity: logoOpacity,
            transform: `scale(${logoScale})`,
            marginBottom: 36,
          }}
        >
          <Img
            src={staticFile(logoSrc)}
            alt="Monet logo"
            style={{ width: 220, height: 220, objectFit: 'contain' }}
          />
        </div>

        {/* Accent line */}
        <div
          style={{
            width: lineWidth,
            height: 3,
            backgroundColor: accentColor,
            borderRadius: 2,
            opacity: lineOpacity,
            marginBottom: 40,
          }}
        />

        {/* Tagline */}
        <div
          style={{
            color: textColor,
            fontSize: 58,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            opacity: taglineOpacity,
            transform: `translateY(${taglineY}px)`,
            textAlign: 'center',
            padding: '0 120px',
            lineHeight: 1.2,
          }}
        >
          {tagline}
        </div>

        {/* CTA pill */}
        <div
          style={{
            marginTop: 56,
            opacity: ctaOpacity,
            transform: `scale(${ctaScale})`,
            backgroundColor: accentColor,
            color: '#0a0b0e',
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: '0.01em',
            padding: '20px 56px',
            borderRadius: 100,
          }}
        >
          {cta}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
