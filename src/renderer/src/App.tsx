import { useRef, useState, useCallback, useEffect } from 'react'
import { TerminalSquare, Clock } from 'lucide-react'
import { useEditorStore } from './store/useEditorStore'
import { TopBar } from './components/TopBar'
import { LeftSidebar } from './components/LeftSidebar'
import { PreviewMonitor } from './components/PreviewMonitor'
import { Timeline } from './components/Timeline'
import { TerminalPanel } from './components/RightPanel'
import { SettingsModal } from './components/SettingsModal'
import { ExportModal } from './components/ExportModal'
import { ProjectManagerModal } from './components/ProjectManagerModal'
import { WelcomeScreen } from './components/WelcomeScreen'
import clsx from 'clsx'
import type { AppUpdateState } from './types'

type BottomTab = 'timeline' | 'terminal'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('.xterm')) return true
  const tagName = target.tagName.toLowerCase()
  return (
    target.isContentEditable ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select'
  )
}

export default function App() {
  const store = useEditorStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const welcomeTrackedRef = useRef(false)
  const previousGuideBottomFractionRef = useRef<number | null>(null)
  const isLauncherView = new URLSearchParams(window.location.search).get('view') === 'launcher'

  const [isDraggingLeft, setIsDraggingLeft] = useState(false)
  const [bottomTab, setBottomTab] = useState<BottomTab>('timeline')
  const [bottomFraction, setBottomFraction] = useState(0.36)
  const [terminalGuideOpen, setTerminalGuideOpen] = useState(false)
  const [appUpdateState, setAppUpdateState] = useState<AppUpdateState>({
    status: 'idle',
    availableVersion: null,
    currentVersion: '0.0.0',
    source: 'none'
  })
  const [showSettings, setShowSettings] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [showProjectManager, setShowProjectManager] = useState(false)
  const shouldShowWelcome = isLauncherView

  useEffect(() => {
    if (!shouldShowWelcome) {
      welcomeTrackedRef.current = false
      return
    }
    if (!store.isReady) return
    if (welcomeTrackedRef.current) return
    welcomeTrackedRef.current = true
    void window.api.trackAnalytics('welcome_shown', {
      hasRecoverableWorkspace: Boolean(store.projectFilePath) || store.assets.length > 0 || store.sequences.length > 1
    })
  }, [shouldShowWelcome, store.assets.length, store.isReady, store.projectFilePath, store.sequences.length])

  const handleOpenProject = useCallback(async (filePath?: string) => {
    const opened = await store.openProject(filePath)
    if (!opened) return
    await window.api.enterWorkspace()
    void window.api.trackAnalytics('launch_project_selected', {
      source: filePath ? 'recent' : 'picker'
    })
  }, [store])

  const handleCreateProject = useCallback(async (name?: string) => {
    await store.createProject(name)
    await window.api.enterWorkspace()
    void window.api.trackAnalytics('launch_project_selected', {
      source: 'new'
    })
  }, [store])

  const handleEnterWorkspace = useCallback(() => {
    void window.api.enterWorkspace()
    void window.api.trackAnalytics('workspace_resumed', {
      hasProjectFile: Boolean(store.projectFilePath),
      assetCount: store.assets.length
    })
  }, [store.assets.length, store.projectFilePath])

  const startDrag = useCallback((side: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault()
    if (side === 'left') setIsDraggingLeft(true)

    const startX = e.clientX
    const startW = side === 'left' ? store.leftWidth : store.rightWidth

    function onMove(me: MouseEvent) {
      const delta = me.clientX - startX
      const newW = side === 'left'
        ? Math.max(180, Math.min(360, startW + delta))
        : Math.max(260, Math.min(480, startW - delta))
      if (side === 'left') store.setLeftWidth(newW)
    }

    function onUp() {
      setIsDraggingLeft(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [store])

  const startBottomDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const containerH = containerRef.current?.clientHeight ?? 800
    const startY = e.clientY
    const startFrac = bottomFraction

    function onMove(me: MouseEvent) {
      const delta = me.clientY - startY
      const centerH = containerH - 44
      const newFrac = Math.max(0.18, Math.min(0.65, startFrac - delta / centerH))
      setBottomFraction(newFrac)
    }

    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [bottomFraction])

  const handleTerminalGuideToggle = useCallback((open: boolean) => {
    setTerminalGuideOpen(open)
    setBottomFraction((current) => {
      if (open) {
        if (previousGuideBottomFractionRef.current == null) {
          previousGuideBottomFractionRef.current = current
        }
        return Math.max(current, 0.56)
      }

      const previous = previousGuideBottomFractionRef.current
      previousGuideBottomFractionRef.current = null
      return previous ?? current
    })
  }, [])

  useEffect(() => {
    let disposed = false

    void window.api.getUpdateState().then((state) => {
      if (!disposed) setAppUpdateState(state)
    })
    const unsubscribe = window.api.onUpdateState((state) => {
      setAppUpdateState(state)
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (shouldShowWelcome) return

    function onKeyDown(event: KeyboardEvent) {
      if (!event.metaKey || event.altKey) return
      const key = event.key.toLowerCase()
      const editableTarget = isEditableTarget(event.target)

      if (key === 'z' && !editableTarget) {
        event.preventDefault()

        if (event.shiftKey) {
          void store.redo()
          return
        }

        void store.undo()
        return
      }

    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shouldShowWelcome, store])

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-screen w-screen overflow-hidden bg-black"
      style={{ cursor: isDraggingLeft ? 'col-resize' : 'default' }}
    >
      {shouldShowWelcome ? (
        <WelcomeScreen
          projectManager={store.projectManager}
          projectName={store.projectName}
          projectFilePath={store.projectFilePath}
          assets={store.assets}
          sequences={store.sequences}
          aiSettings={store.aiSettings}
          loading={!store.isReady}
          openProject={handleOpenProject}
          createProject={handleCreateProject}
          setAnalyticsEnabled={store.setAnalyticsEnabled}
          setApiKey={store.setApiKey}
          setOnboardingCompleted={store.setOnboardingCompleted}
          persistAISettings={store.persistAISettings}
          onOpenProjects={() => setShowProjectManager(true)}
          onEnterWorkspace={handleEnterWorkspace}
        />
      ) : (
        <>
          {/* Top Bar */}
          <TopBar
            projectName={store.projectName}
            setProjectName={store.setProjectName}
            importMedia={store.importMedia}
            saveProject={store.saveProject}
            undo={store.undo}
            redo={store.redo}
            canUndo={store.canUndo}
            canRedo={store.canRedo}
            projectFilePath={store.projectFilePath}
            exportStatus={store.exportStatus}
            exportMessage={store.exportMessage}
            exportProgress={store.exportProgress}
            isPlaying={store.isPlaying}
            setIsPlaying={store.setIsPlaying}
            playheadTime={store.playheadTime}
            setPlayheadTime={store.setPlayheadTime}
            totalDuration={store.totalDuration}
            appUpdateState={appUpdateState}
            onOpenProjects={() => setShowProjectManager(true)}
            onOpenSettings={() => setShowSettings(true)}
            onOpenExport={() => setShowExportModal(true)}
            onApplyUpdate={() => void window.api.applyUpdate()}
          />

          {/* Main layout */}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Left Sidebar */}
            <div className="flex-shrink-0 overflow-hidden" style={{ width: store.leftWidth }}>
              <LeftSidebar
                leftTab={store.leftTab}
                setLeftTab={store.setLeftTab}
                sequences={store.sequences}
                assets={store.assets}
                selectedAssetId={store.selectedAssetId}
                selectAsset={store.selectAsset}
                removeAsset={store.removeAsset}
                importMedia={store.importMedia}
                activateSequence={store.activateSequence}
                tasks={store.tasks}
              />
            </div>

            {/* Left resize handle */}
            <div className="resize-handle w-1 flex-shrink-0 cursor-col-resize" onMouseDown={startDrag('left')} />

            {/* Center — Preview + tabbed bottom panel */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <div className="flex-1 min-h-0 overflow-hidden">
                  <PreviewMonitor
                    isPlaying={store.isPlaying}
                    setIsPlaying={store.setIsPlaying}
                    playheadTime={store.playheadTime}
                    setPlayheadTime={store.setPlayheadTime}
                    totalDuration={store.totalDuration}
                    selectedClipId={store.selectedClipId}
                    selectedAssetId={store.selectedAssetId}
                    assets={store.assets}
                    tracks={store.tracks}
                    splitSelectedClip={store.splitSelectedClip}
                  />
                </div>
              </div>

              <div
                className="h-1 flex-shrink-0 bg-border hover:bg-accent/40 cursor-row-resize transition-colors"
                onMouseDown={startBottomDrag}
              />

              <div
                className="flex-shrink-0 flex flex-col overflow-hidden"
                style={{ height: `${bottomFraction * 100}%` }}
              >
                <div className="flex items-center gap-0 border-b border-border bg-surface-1 flex-shrink-0 px-2">
                  <TabButton
                    label="Timeline"
                    icon={<Clock size={11} />}
                    active={bottomTab === 'timeline'}
                    onClick={() => setBottomTab('timeline')}
                  />
                  <TabButton
                    label="Terminal"
                    icon={<TerminalSquare size={11} />}
                    active={bottomTab === 'terminal'}
                    onClick={() => setBottomTab('terminal')}
                  />
                </div>

                <div className="flex-1 min-h-0 overflow-hidden relative">
                  <div className={bottomTab === 'timeline' ? 'absolute inset-0' : 'absolute inset-0 pointer-events-none invisible'}>
                    <Timeline
                      tracks={store.tracks}
                      assets={store.assets}
                      selectedClipId={store.selectedClipId}
                      playheadTime={store.playheadTime}
                      totalDuration={store.totalDuration}
                      zoom={store.zoom}
                      selectClip={store.selectClip}
                      setPlayheadTime={store.setPlayheadTime}
                      setZoom={store.setZoom}
                      addTrack={store.addTrack}
                    />
                  </div>
                  <div className={bottomTab === 'terminal' ? 'absolute inset-0' : 'absolute inset-0 pointer-events-none invisible'}>
                    <TerminalPanel
                      aiSettings={store.aiSettings}
                      persistAISettings={store.persistAISettings}
                      onGuideToggle={handleTerminalGuideToggle}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
      {showSettings && (
        <SettingsModal
          aiSettings={store.aiSettings}
          setApiKey={store.setApiKey}
          setAnalyticsEnabled={store.setAnalyticsEnabled}
          persistAISettings={store.persistAISettings}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showProjectManager && (
        <ProjectManagerModal
          projectManager={store.projectManager}
          openProject={handleOpenProject}
          createProject={handleCreateProject}
          onClose={() => setShowProjectManager(false)}
        />
      )}
      {showExportModal && (
        <ExportModal
          exportStatus={store.exportStatus}
          exportMessage={store.exportMessage}
          exportProgress={store.exportProgress}
          onClose={() => setShowExportModal(false)}
          onExport={async (options) => {
            await store.exportSequence(options)
            setShowExportModal(false)
          }}
        />
      )}
      {store.exportStatus === 'running' && (
        <div className="fixed inset-0 z-40 pointer-events-none flex items-center justify-center bg-black/20 backdrop-blur-[1px]">
          <div className="pointer-events-auto rounded-xl border border-border bg-surface-1 px-5 py-4 shadow-2xl min-w-[320px] max-w-[420px]">
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
              <div>
                <div className="text-sm font-semibold text-text-primary">Exporting sequence</div>
                <div className="mt-1 text-2xs text-text-dim">
                  {typeof store.exportProgress === 'number'
                    ? `${Math.round(store.exportProgress * 100)}% · ${store.exportMessage ?? 'Rendering export…'}`
                    : (store.exportMessage ?? 'Rendering export…')}
                </div>
                {typeof store.exportProgress === 'number' && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-300"
                      style={{ width: `${Math.max(6, Math.round(store.exportProgress * 100))}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {store.exportStatus === 'idle' && store.lastExportPath && (
        <div className="fixed right-5 bottom-5 z-40">
          <div className="rounded-xl border border-border bg-surface-1 px-4 py-3 shadow-2xl min-w-[300px] max-w-[420px]">
            <div className="text-sm font-semibold text-text-primary">Export complete</div>
            <div className="mt-1 truncate text-2xs text-text-dim">{store.lastExportPath}</div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                className="rounded px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-3 hover:text-text-primary"
                onClick={() => void window.api.revealInFinder(store.lastExportPath!)}
              >
                Show in Finder
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TabButton({ label, icon, active, onClick }: {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1.5 px-3 py-2 text-2xs font-medium transition-colors border-b-2 -mb-px',
        active
          ? 'border-accent text-text-primary'
          : 'border-transparent text-text-dim hover:text-text-secondary hover:border-border'
      )}
    >
      {icon}
      {label}
    </button>
  )
}
