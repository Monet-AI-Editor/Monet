import type { Effect, Transition } from '../../shared/editor.js'

export class EffectsService {
  /**
   * Generate FFmpeg filter string for a clip effect
   */
  getEffectFilter(effect: Effect): string {
    if (!effect.enabled) return ''

    switch (effect.type) {
      case 'color_grade': {
        const brightness = (effect.parameters.brightness as number) || 0
        const contrast = (effect.parameters.contrast as number) || 1.0
        const saturation = (effect.parameters.saturation as number) || 1.0
        return `eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`
      }

      case 'blur': {
        const radius = (effect.parameters.radius as number) || 5
        return `boxblur=${radius}:${radius}`
      }

      case 'sharpen': {
        const amount = (effect.parameters.amount as number) || 1.0
        return `unsharp=5:5:${amount}:5:5:0`
      }

      case 'fade_in': {
        const duration = (effect.parameters.duration as number) || 1.0
        return `fade=t=in:st=0:d=${duration}`
      }

      case 'fade_out': {
        const duration = (effect.parameters.duration as number) || 1.0
        const clipDuration = typeof effect.parameters.clipDuration === 'number' ? (effect.parameters.clipDuration as number) : undefined
        const explicitStart = effect.parameters.start
        const start =
          typeof explicitStart === 'number'
            ? explicitStart
            : clipDuration !== undefined
              ? Math.max(0, clipDuration - duration)
              : 0
        return `fade=t=out:st=${start}:d=${duration}`
      }

      case 'speed_ramp': {
        const speed = (effect.parameters.speed as number) || 1.0
        return `setpts=${1 / speed}*PTS`
      }

      default:
        return ''
    }
  }

  /**
   * Generate FFmpeg filter for transitions between two clips
   */
  getTransitionFilter(transition: Transition, previousDuration: number): string {
    const offset = Math.max(0, previousDuration - transition.duration)

    switch (transition.type) {
      case 'crossfade':
        return `xfade=transition=fade:duration=${transition.duration}:offset=${offset}`

      case 'dip_to_black':
        return `xfade=transition=fadeblack:duration=${transition.duration}:offset=${offset}`

      case 'wipe':
        return `xfade=transition=wiperight:duration=${transition.duration}:offset=${offset}`

      case 'slide':
        return `xfade=transition=slideleft:duration=${transition.duration}:offset=${offset}`

      default:
        return ''
    }
  }

  /**
   * Combine multiple effect filters into a filter chain
   */
  combineFilters(filters: string[]): string {
    return filters.filter((f) => f.length > 0).join(',')
  }
}
