export interface ControlState {
  playheadTime: number
  selectedClipId: string | null
  selectedAssetId: string | null
  activeSequenceId: string | null
}

export class ControlStateService {
  private state: ControlState = {
    playheadTime: 0,
    selectedClipId: null,
    selectedAssetId: null,
    activeSequenceId: null
  }

  getState(): ControlState {
    return { ...this.state }
  }

  update(partial: Partial<ControlState>): ControlState {
    this.state = {
      ...this.state,
      ...partial
    }
    return this.getState()
  }
}
