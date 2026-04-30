export function getHasRecoverableWorkspace(params: {
  loading: boolean
  projectFilePath: string | null
  assetCount: number
  sequenceCount: number
  firstSequenceDuration: number
}): boolean {
  return (
    !params.loading &&
    (
      Boolean(params.projectFilePath) ||
      params.assetCount > 0 ||
      params.sequenceCount > 1 ||
      params.firstSequenceDuration > 0
    )
  )
}

export function getWelcomeTagline(showOnboarding: boolean): string {
  return showOnboarding
    ? 'Set up Monet once, then edit with AI.'
    : 'Edit faster with AI-native video workflows.'
}
