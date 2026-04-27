import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { useEffect, useRef, useMemo } from 'react'
import { z } from 'zod'

// We import matter-js from the npm package (already installed)
// In Remotion's Chromium renderer window, this works fine.
// The `matter-js` package exports Matter as default.

export const physicsSceneSchema = z.object({
  setupScript: z.string().describe(
    'Matter.js setup code that adds bodies to the world. ' +
    'Pre-declared variables: engine, world, width, height, ' +
    'Bodies, Body, Composite, Constraint, Events. ' +
    'Set engine.gravity.y/x to control gravity (default: y=1). ' +
    'Use body.render.fillStyle / strokeStyle for colors. ' +
    'Example: ' +
    'engine.gravity.y = 1; ' +
    'var ground = Bodies.rectangle(width/2, height-25, width, 50, { isStatic: true, render: { fillStyle: "#334155" } }); ' +
    'var ball = Bodies.circle(width/2, 80, 40, { restitution: 0.8, render: { fillStyle: "#5b82f7" } }); ' +
    'Composite.add(world, [ground, ball]);'
  ),
  backgroundColor: z.string().default('#111318'),
  wireframes: z.boolean().default(false),
  showVelocity: z.boolean().default(false),
})

type Props = z.infer<typeof physicsSceneSchema>

interface MatterBody {
  vertices: Array<{ x: number; y: number }>
  isStatic: boolean
  render?: { fillStyle?: string; strokeStyle?: string; lineWidth?: number; opacity?: number }
  angle: number
  velocity: { x: number; y: number }
  speed: number
}

export function PhysicsScene({ setupScript, backgroundColor, wireframes, showVelocity }: Props) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Deterministic replay: simulate from frame 0 to current frame.
  // This makes each frame independent and safe for Remotion's renderer.
  const bodies = useMemo<MatterBody[]>(() => {
    try {
      // matter-js is installed as an npm dep
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Matter = require('matter-js') as typeof import('matter-js')
      const { Engine, Bodies, Body, Composite, Constraint, Events } = Matter

      const engine = Engine.create()
      const world = engine.world

      // Run user setup script with all Matter.js APIs in scope
      const setupFn = new Function(
        'engine', 'world', 'width', 'height',
        'Bodies', 'Body', 'Composite', 'Constraint', 'Events',
        `"use strict";\n${setupScript}`
      )
      setupFn(engine, world, width, height, Bodies, Body, Composite, Constraint, Events)

      // Step physics deterministically to this frame
      const dtMs = 1000 / fps
      for (let f = 0; f < frame; f++) {
        Engine.update(engine, dtMs)
      }

      // Snapshot body state for rendering
      return Composite.allBodies(world).map((b) => ({
        vertices: b.vertices.map((v) => ({ x: v.x, y: v.y })),
        isStatic: b.isStatic,
        render: b.render as MatterBody['render'],
        angle: b.angle,
        velocity: { x: b.velocity.x, y: b.velocity.y },
        speed: b.speed,
      }))
    } catch (err) {
      console.error('[PhysicsScene] simulation error:', err)
      return []
    }
  }, [frame, fps, width, height, setupScript])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Background
    ctx.fillStyle = backgroundColor
    ctx.fillRect(0, 0, width, height)

    // Render bodies
    for (const body of bodies) {
      const verts = body.vertices
      if (verts.length < 2) continue

      ctx.beginPath()
      ctx.moveTo(verts[0].x, verts[0].y)
      for (let i = 1; i < verts.length; i++) {
        ctx.lineTo(verts[i].x, verts[i].y)
      }
      ctx.closePath()

      const fillStyle = body.render?.fillStyle
      const strokeStyle = body.render?.strokeStyle
      const lineWidth = body.render?.lineWidth ?? 1

      if (wireframes) {
        ctx.strokeStyle = strokeStyle ?? (body.isStatic ? '#475569' : '#5b82f7')
        ctx.lineWidth = 1.5
        ctx.stroke()
      } else {
        if (fillStyle && fillStyle !== 'transparent') {
          ctx.fillStyle = fillStyle
          ctx.fill()
        } else {
          ctx.fillStyle = body.isStatic ? '#334155' : '#5b82f7'
          ctx.fill()
        }
        if (strokeStyle && strokeStyle !== 'transparent') {
          ctx.strokeStyle = strokeStyle
          ctx.lineWidth = lineWidth
          ctx.stroke()
        }
      }

      // Velocity arrows (debug mode)
      if (showVelocity && !body.isStatic && body.speed > 0.5) {
        const cx = verts.reduce((sum, v) => sum + v.x, 0) / verts.length
        const cy = verts.reduce((sum, v) => sum + v.y, 0) / verts.length
        const scale = 4
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(cx + body.velocity.x * scale, cy + body.velocity.y * scale)
        ctx.strokeStyle = '#f9e2af'
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }

    if (bodies.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)'
      ctx.font = '14px monospace'
      ctx.fillText('No bodies — check setupScript', 20, 40)
    }
  }, [bodies, backgroundColor, width, height, wireframes, showVelocity])

  return (
    <AbsoluteFill>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
    </AbsoluteFill>
  )
}
