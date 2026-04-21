import { initialize as initializeAptabase } from '@aptabase/electron/main'
import * as SentryMain from '@sentry/electron/main'
import { app, shell, BrowserWindow, ipcMain, dialog, net, protocol, powerMonitor, Menu, nativeImage } from 'electron'
import { createReadStream } from 'fs'
import { join, extname, basename, dirname } from 'path'
import { readFile, writeFile, stat, readdir, mkdir, chmod, access, rename } from 'fs/promises'
import { Readable } from 'stream'
import { createHash } from 'crypto'
import { execFile } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { ProjectStore } from './services/project-store'
import { ToolRegistry } from './services/tool-registry'
import { AIChatService } from './services/ai-chat-service'
import { SUPPORTED_MODELS } from './services/model-catalog'
import { SettingsStore } from './services/settings-store'
import { ExportService } from './services/export-service'
import { TerminalService } from './services/terminal-service'
import { TranscriptionService } from './services/transcription-service'
import { APIBridge } from './services/api-bridge'
import { EmbeddingService } from './services/embedding-service'
import { WaveformService } from './services/waveform-service'
import { FrameExtractionService } from './services/frame-extraction-service'
import { ControlStateService } from './services/control-state-service'
import { PreviewProxyService } from './services/preview-proxy-service'
import { RecentProjectsStore } from './services/recent-projects-store'
import { AnalyticsService } from './services/analytics-service'
import { UpdateService } from './services/update-service'
import { ensureAgentContextFiles } from './services/agent-context'
import type { AISettings, EditorChatRequest, EditorProjectRecord, ExportOptions, MediaAssetRecord } from '../shared/editor'

const SENTRY_DSN = process.env.MONET_SENTRY_DSN || ''
const APTABASE_APP_KEY = process.env.MONET_APTABASE_APP_KEY || ''

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

const APP_NAME = 'Monet'
app.setName(APP_NAME)

let projectStore: ProjectStore
let toolRegistry: ToolRegistry
const transcriptionService = new TranscriptionService()
const embeddingService = new EmbeddingService()
const waveformService = new WaveformService()
const frameExtractionService = new FrameExtractionService()
let previewProxyService: PreviewProxyService
let settingsStore: SettingsStore
let recentProjectsStore: RecentProjectsStore
let analyticsService: AnalyticsService
let updateService: UpdateService
let aiChatService: AIChatService
let exportService: ExportService
let apiBridge: APIBridge
const terminalService = new TerminalService()
const controlStateService = new ControlStateService()

const APP_WINDOW = {
  width: 1600,
  height: 960,
  minWidth: 1100,
  minHeight: 700
}

const LAUNCHER_WINDOW = {
  width: 760,
  height: 500,
  minWidth: 700,
  minHeight: 460
}

let launcherWindow: BrowserWindow | null = null
let editorWindow: BrowserWindow | null = null

function clampWindowZoomFactor(value: number): number {
  return Math.min(3, Math.max(0.5, value))
}

function getAppIconPath(): string {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return join(base, 'resources', 'monet-mark.png')
}

function applyAppBranding(): void {
  const iconPath = getAppIconPath()
  const icon = nativeImage.createFromPath(iconPath)
  if (!icon.isEmpty() && process.platform === 'darwin') {
    app.dock.setIcon(icon)
  }
}

function adjustWindowZoom(window: BrowserWindow, direction: 'in' | 'out'): void {
  const currentZoom = window.webContents.getZoomFactor()
  const multiplier = direction === 'in' ? 1.1 : 1 / 1.1
  window.webContents.setZoomFactor(clampWindowZoomFactor(currentZoom * multiplier))
}

function resetWindowZoom(window: BrowserWindow): void {
  window.webContents.setZoomFactor(1)
}

function attachWindowZoomShortcuts(window: BrowserWindow): void {
  window.webContents.on('before-input-event', (event, input) => {
    const hasPrimaryModifier = process.platform === 'darwin' ? input.meta : input.control
    if (!hasPrimaryModifier || input.alt) return

    const key = input.key.toLowerCase()
    const code = input.code

    if (code === 'Equal' || key === '=' || key === '+') {
      event.preventDefault()
      adjustWindowZoom(window, 'in')
      return
    }

    if (code === 'Minus' || code === 'NumpadSubtract' || key === '-' || key === '_' || key === 'subtract') {
      event.preventDefault()
      adjustWindowZoom(window, 'out')
      return
    }

    if (code === 'Digit0' || key === '0') {
      event.preventDefault()
      resetWindowZoom(window)
    }
  })
}

function getZoomTargetWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? editorWindow ?? launcherWindow ?? null
}

function buildApplicationMenu(): Menu {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{
          label: app.getName(),
          submenu: [
            { role: 'about', label: `About ${APP_NAME}` },
            { type: 'separator' as const },
            {
              label: 'Check for Updates…',
              click: async () => {
                const state = await updateService.checkForUpdates()
                if (state.status === 'idle') {
                  await dialog.showMessageBox({
                    type: 'info',
                    buttons: ['OK'],
                    title: `${APP_NAME} is up to date`,
                    message: `${APP_NAME} ${app.getVersion()} is the current version.`
                  })
                  return
                }

                await dialog.showMessageBox({
                  type: state.status === 'available' ? 'info' : 'none',
                  buttons: ['OK'],
                  title: 'Update status',
                  message: state.message || 'Update state changed.',
                  detail:
                    state.status === 'available'
                      ? 'The update button is now available in the top bar.'
                      : state.status === 'downloading' || state.status === 'downloaded' || state.status === 'restarting'
                        ? 'Monet is already applying an update.'
                        : ''
                })
              }
            },
            { type: 'separator' as const },
            { role: 'services' },
            { type: 'separator' as const },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' as const },
            { role: 'quit' }
          ]
        }]
      : []),
    {
      label: 'File',
      submenu: [
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        {
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            const window = getZoomTargetWindow()
            if (window) resetWindowZoom(window)
          }
        },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: () => {
            const window = getZoomTargetWindow()
            if (window) adjustWindowZoom(window, 'in')
          }
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            const window = getZoomTargetWindow()
            if (window) adjustWindowZoom(window, 'out')
          }
        },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin' ? [{ type: 'separator' as const }, { role: 'front' as const }] : [{ role: 'close' as const }])
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}

if (SENTRY_DSN) {
  SentryMain.init({
    dsn: SENTRY_DSN,
    sendDefaultPii: false,
    environment: is.dev ? 'development' : 'production',
    beforeSend(event) {
      if (event.user) {
        delete event.user
      }
      return event
    }
  })
}

if (APTABASE_APP_KEY) {
  void initializeAptabase(APTABASE_APP_KEY).catch((error) => {
    console.warn('[Aptabase] initialization failed:', error)
  })
}

function safeSendToWindow(window: BrowserWindow, channel: string, payload: unknown): void {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return
  try {
    window.webContents.send(channel, payload)
  } catch {
    // Ignore teardown races during close/quit.
  }
}

function safeBroadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    safeSendToWindow(window, channel, payload)
  }
}

function getProjectAutosavePath(projectPath: string | null): string {
  const key = projectPath ? createHash('sha1').update(projectPath).digest('hex') : 'scratch'
  return join(app.getPath('userData'), 'autosaves', `${key}.aiveproj.autosave.json`)
}

function getLegacyAutosavePath(): string {
  return join(app.getPath('userData'), 'autosave.aiveproj.json')
}

function getManagedProjectsDirectory(): string {
  return join(app.getPath('documents'), 'Monet Projects')
}

function getLegacyManagedProjectsDirectory(): string {
  return join(app.getPath('documents'), 'Panda Projects')
}

async function allocateProjectFilePathInDirectory(directory: string, projectName: string): Promise<string> {
  await mkdir(directory, { recursive: true })

  const base = slugifyProjectName(projectName)
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`
    const candidate = join(directory, `${base}${suffix}.aiveproj.json`)
    try {
      await access(candidate)
    } catch {
      return candidate
    }
  }

  throw new Error('Failed to allocate a project file path.')
}

function slugifyProjectName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'untitled-project'
}

async function allocateManagedProjectFilePath(projectName: string): Promise<string> {
  return allocateProjectFilePathInDirectory(getManagedProjectsDirectory(), projectName)
}

async function loadBestProjectState(projectPath: string): Promise<EditorProjectRecord> {
  const autosavePath = getProjectAutosavePath(projectPath)

  const [projectFile, autosaveFile] = await Promise.all([
    readFile(projectPath, 'utf8')
      .then(async (raw) => ({
        raw,
        mtimeMs: (await stat(projectPath)).mtimeMs
      }))
      .catch(() => null),
    readFile(autosavePath, 'utf8')
      .then(async (raw) => ({
        raw,
        mtimeMs: (await stat(autosavePath)).mtimeMs
      }))
      .catch(() => null)
  ])

  const preferred = [autosaveFile, projectFile]
    .filter((entry): entry is { raw: string; mtimeMs: number } => Boolean(entry))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]

  if (!preferred) {
    throw new Error(`Project file not found: ${projectPath}`)
  }

  return JSON.parse(preferred.raw) as EditorProjectRecord
}

function getProjectSummary(project: EditorProjectRecord) {
  const activeSequence = project.sequences.find((sequence) => sequence.active) ?? project.sequences[0] ?? null
  return {
    projectName: project.name,
    assetCount: project.assets.length,
    activeSequenceName: activeSequence?.name ?? null,
    activeSequenceDuration: activeSequence?.duration ?? null,
    assetNames: project.assets.slice(0, 8).map((asset) => asset.name)
  }
}

function getEditorctlCandidates(): string[] {
  const appPath = app.getAppPath()
  return [
    join(process.cwd(), 'out/cli/cli/editorctl.js'),
    join(appPath, 'out/cli/cli/editorctl.js'),
    join(process.resourcesPath, 'app.asar.unpacked/out/cli/cli/editorctl.js'),
    join(process.resourcesPath, 'app.asar/out/cli/cli/editorctl.js')
  ]
}

async function resolveEditorctlEntry(): Promise<string | null> {
  for (const candidate of getEditorctlCandidates()) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // continue
    }
  }
  return null
}

async function resolveBinaryOnPath(binaryName: string): Promise<string | null> {
  const pathEntries = (process.env.PATH ?? '').split(':').filter(Boolean)
  for (const entry of pathEntries) {
    const candidate = join(entry, binaryName)
    try {
      await access(candidate)
      return candidate
    } catch {
      // continue
    }
  }
  return null
}

function buildAgentWrapperScript(binaryPath: string, startupPrompt: string): string {
  const escapedBinaryPath = binaryPath.replace(/"/g, '\\"')
  const escapedPrompt = startupPrompt.replace(/"/g, '\\"')
  return `#!/bin/sh\nif [ "$#" -eq 0 ]; then\n  exec "${escapedBinaryPath}" "${escapedPrompt}"\nelse\n  exec "${escapedBinaryPath}" "$@"\nfi\n`
}

async function ensureEditorctlShim(): Promise<{ shimPath: string | null; binDir: string }> {
  const binDir = join(app.getPath('userData'), 'bin')
  await mkdir(binDir, { recursive: true })
  const shimPath = join(binDir, 'editorctl')
  const entryPath = await resolveEditorctlEntry()
  if (!entryPath) {
    return { shimPath: null, binDir }
  }

  const script = `#!/bin/sh\nnode "${entryPath}" "$@"\n`
  await writeFile(shimPath, script, 'utf8')
  await chmod(shimPath, 0o755)

  const startupPrompt =
    'You are inside Monet, an AI-first video editor. Read ./MONET_AGENT_CONTEXT.md first. Then inspect the live editor state with editorctl get-state and editorctl list-assets before answering the user.'

  for (const binaryName of ['claude', 'codex']) {
    const binaryPath = await resolveBinaryOnPath(binaryName)
    if (!binaryPath) continue
    const wrapperPath = join(binDir, binaryName)
    await writeFile(wrapperPath, buildAgentWrapperScript(binaryPath, startupPrompt), 'utf8')
    await chmod(wrapperPath, 0o755)
  }

  return { shimPath, binDir }
}

async function listSavedProjectsFromDirectory(directory: string): Promise<RecentProjectEntry[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const projects = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.aiveproj.json'))
        .map(async (entry) => {
          const path = join(directory, entry.name)
          try {
            const [raw, stats] = await Promise.all([readFile(path, 'utf8'), stat(path)])
            const parsed = JSON.parse(raw) as Partial<EditorProjectRecord>
            return {
              path,
              name: typeof parsed.name === 'string' && parsed.name.trim().length > 0 ? parsed.name.trim() : basename(entry.name, '.aiveproj.json'),
              lastOpenedAt: stats.mtimeMs
            } satisfies RecentProjectEntry
          } catch {
            return null
          }
        })
    )

    return projects.filter((project): project is RecentProjectEntry => Boolean(project))
  } catch {
    return []
  }
}

async function migrateLegacyManagedProjects(): Promise<Map<string, string>> {
  const migrated = new Map<string, string>()
  const legacyDirectory = getLegacyManagedProjectsDirectory()
  const managedDirectory = getManagedProjectsDirectory()

  try {
    const entries = await readdir(legacyDirectory, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.aiveproj.json')) continue

      const legacyPath = join(legacyDirectory, entry.name)
      const raw = await readFile(legacyPath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<EditorProjectRecord>
      const projectName =
        typeof parsed.name === 'string' && parsed.name.trim().length > 0
          ? parsed.name.trim()
          : basename(entry.name, '.aiveproj.json')
      const nextPath = await allocateProjectFilePathInDirectory(managedDirectory, projectName)

      await rename(legacyPath, nextPath)

      const legacyAutosavePath = getProjectAutosavePath(legacyPath)
      const nextAutosavePath = getProjectAutosavePath(nextPath)
      try {
        await access(legacyAutosavePath)
        try {
          await access(nextAutosavePath)
        } catch {
          await rename(legacyAutosavePath, nextAutosavePath)
        }
      } catch {
        // Ignore missing legacy autosaves.
      }

      migrated.set(legacyPath, nextPath)
    }
  } catch {
    return migrated
  }

  return migrated
}

async function getProjectManagerState() {
  const state = recentProjectsStore.getState()
  const discovered = await listSavedProjectsFromDirectory(getManagedProjectsDirectory())

  const merged = new Map<string, RecentProjectEntry>()
  for (const project of [...state.recentProjects, ...discovered]) {
    const existing = merged.get(project.path)
    if (!existing || project.lastOpenedAt > existing.lastOpenedAt) {
      merged.set(project.path, project)
    }
  }

  return {
    currentProjectFilePath: projectStore.getProjectFilePath(),
    recentProjects: [...merged.values()].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
  }
}

async function resolveProjectPathSelection(selectionPath: string): Promise<string> {
  const selectedStat = await stat(selectionPath)
  if (!selectedStat.isDirectory()) return selectionPath

  const entries = await readdir(selectionPath, { withFileTypes: true })
  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.aiveproj.json'))
    .map((entry) => join(selectionPath, entry.name))

  if (candidates.length === 1) return candidates[0]
  if (candidates.length > 1) {
    const namedCandidate = candidates.find((candidate) => basename(candidate, '.aiveproj.json') === basename(selectionPath))
    return namedCandidate ?? candidates[0]
  }

  throw new Error('No .aiveproj.json project file was found in that folder.')
}

function loadRenderer(window: BrowserWindow, view: 'launcher' | 'editor'): void {
  const baseUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && baseUrl) {
    window.loadURL(`${baseUrl}?view=${view}`)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'), {
      search: `view=${view}`
    })
  }
}

function checkBinaryInstalled(binary: string): Promise<boolean> {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh'
    execFile(shell, ['-lc', `command -v ${binary} >/dev/null 2>&1`], (error) => {
      resolve(!error)
    })
  })
}

function createLauncherWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: APP_NAME,
    width: LAUNCHER_WINDOW.width,
    height: LAUNCHER_WINDOW.height,
    minWidth: LAUNCHER_WINDOW.minWidth,
    minHeight: LAUNCHER_WINDOW.minHeight,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#000000',
    icon: getAppIconPath(),
    resizable: false,
    maximizable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  window.on('ready-to-show', () => {
    window.show()
    window.center()
  })

  window.on('closed', () => {
    if (launcherWindow === window) launcherWindow = null
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  attachWindowZoomShortcuts(window)

  loadRenderer(window, 'launcher')
  launcherWindow = window
  return window
}

function createEditorWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: APP_NAME,
    width: APP_WINDOW.width,
    height: APP_WINDOW.height,
    minWidth: APP_WINDOW.minWidth,
    minHeight: APP_WINDOW.minHeight,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#000000',
    icon: getAppIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })
  const ownerContents = window.webContents

  window.on('ready-to-show', () => {
    window.show()
  })

  window.on('closed', () => {
    terminalService.killAllForOwner(ownerContents)
    if (editorWindow === window) editorWindow = null
  })

  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`)
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] render-process-gone', details)
  })

  window.webContents.on('unresponsive', () => {
    console.error('[renderer] unresponsive')
  })

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer] did-fail-load ${errorCode} ${errorDescription} ${validatedURL}`)
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  attachWindowZoomShortcuts(window)

  loadRenderer(window, 'editor')
  editorWindow = window
  return window
}

app.whenReady().then(async () => {
  app.setName(APP_NAME)
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    version: app.getVersion()
  })
  applyAppBranding()
  electronApp.setAppUserModelId('com.aivideo.editor')
  recentProjectsStore = new RecentProjectsStore(join(app.getPath('userData'), 'recent-projects.json'))
  projectStore = new ProjectStore(getProjectAutosavePath(null))
  settingsStore = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
  updateService = new UpdateService(app.getVersion())
  analyticsService = new AnalyticsService(
    join(app.getPath('userData'), 'analytics', 'state.json'),
    join(app.getPath('userData'), 'analytics', 'events.ndjson'),
    app.getVersion(),
    Boolean(APTABASE_APP_KEY)
  )
  toolRegistry = new ToolRegistry(projectStore, embeddingService)
  aiChatService = new AIChatService(projectStore, toolRegistry)
  exportService = new ExportService(projectStore)
  previewProxyService = new PreviewProxyService(join(app.getPath('userData'), 'preview-proxies'))
  apiBridge = new APIBridge(
    projectStore,
    transcriptionService,
    settingsStore,
    controlStateService,
    embeddingService,
    exportService,
    frameExtractionService
  )
  apiBridge.start()
  Menu.setApplicationMenu(buildApplicationMenu())

  try {
    const migrated = await migrateLegacyManagedProjects()
    for (const [legacyPath, nextPath] of migrated) {
      recentProjectsStore.replaceProjectPath(legacyPath, nextPath)
    }
  } catch (error) {
    console.warn('[Projects] Failed to migrate legacy Panda Projects:', error)
  }

  const recentState = recentProjectsStore.getState()
  if (recentState.lastOpenedProjectPath) {
    loadBestProjectState(recentState.lastOpenedProjectPath)
      .then((project) => {
        projectStore.setAutosavePath(getProjectAutosavePath(recentState.lastOpenedProjectPath))
        projectStore.loadProject(project, recentState.lastOpenedProjectPath)
        recentProjectsStore.noteOpenedProject(recentState.lastOpenedProjectPath!, project.name)
      })
      .catch(() => {
        recentProjectsStore.removeMissingProject(recentState.lastOpenedProjectPath!)
        projectStore.setAutosavePath(getProjectAutosavePath(null))
        projectStore.createProject('Untitled Project')
      })
  } else {
    const legacyAutosavePath = getLegacyAutosavePath()
    readFile(legacyAutosavePath, 'utf8')
      .then((raw) => {
        const project = JSON.parse(raw) as EditorProjectRecord
        if ((project.assets?.length ?? 0) === 0 && (project.sequences?.length ?? 0) <= 1) {
          return
        }
        projectStore.setAutosavePath(getProjectAutosavePath(null))
        projectStore.loadProject(project, null)
      })
      .catch(() => undefined)
  }

  projectStore.subscribe((project) => {
    safeBroadcast('project:updated', project)
    const summary = getProjectSummary(project)
    for (const cwd of terminalService.getSessionDirectories()) {
      void ensureAgentContextFiles(cwd, summary).catch((error) => {
        console.warn('[Terminal] Failed to refresh agent context files:', error)
      })
    }
  })

  updateService.subscribe((state) => {
    safeBroadcast('app:updateState', state)
  })

  // Initialize embedding service key from persisted settings at startup
  void settingsStore.getSettings().then((s) => {
    const key = s.semanticApiKeys.openai || s.apiKeys.openai
    if (key) {
      embeddingService.setApiKey(key)
    }
    void analyticsService.track(s.analyticsEnabled, 'app_opened', {
      hasProjectFile: Boolean(projectStore.getProjectFilePath()),
      assetCount: projectStore.getProject().assets.length,
      sequenceCount: projectStore.getProject().sequences.length
    })
  })
  backfillCaptionsForTranscriptAssets()
  if (is.dev && process.env.MONET_SIMULATE_UPDATE === '1') {
    updateService.scheduleDevSimulation()
  }

  protocol.handle('media', (request) => {
    return handleMediaRequest(request)
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const broadcastAppResume = () => {
    safeBroadcast('app:resume', null)
  }

  app.on('resume', broadcastAppResume)
  powerMonitor.on('resume', broadcastAppResume)

  // IPC: open file dialog
  ipcMain.handle('dialog:openFiles', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Media',
          extensions: [
            'mp4', 'm4v', 'mov', 'avi', 'mkv', 'webm', 'mpg', 'mpeg', 'wmv', 'ts', 'mts', 'm2ts',
            'mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus', 'aif', 'aiff',
            'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'svg'
          ]
        }
      ]
    })
    return result.filePaths
  })

  // IPC: open folder dialog
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:saveExportFile', async (_, defaultFileName?: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: join(app.getPath('downloads'), defaultFileName || 'monet-export.mp4'),
      filters: [
        { name: 'MP4 Video', extensions: ['mp4'] },
        { name: 'QuickTime Movie', extensions: ['mov'] }
      ]
    })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('system:revealInFinder', async (_, filePath: string) => {
    if (!filePath) return false
    shell.showItemInFolder(filePath)
    return true
  })

  ipcMain.handle('dialog:openProjectFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Monet Project', extensions: ['aiveproj.json', 'json'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return resolveProjectPathSelection(result.filePaths[0])
  })

  ipcMain.handle('dialog:saveProjectFile', async () => {
    const result = await dialog.showSaveDialog({
      defaultPath: join(app.getPath('documents'), 'untitled-project.aiveproj.json'),
      filters: [{ name: 'Monet Project', extensions: ['aiveproj.json', 'json'] }]
    })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('editor:getProjectManagerState', async () => {
    return getProjectManagerState()
  })

  ipcMain.handle('system:getAgentToolStatus', async () => {
    const [codexInstalled, claudeInstalled] = await Promise.all([
      checkBinaryInstalled('codex'),
      checkBinaryInstalled('claude')
    ])
    return { codexInstalled, claudeInstalled }
  })

  ipcMain.handle('system:openPrivacySettings', async () => {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy')
    return true
  })

  ipcMain.handle('editor:createProject', async (_, name?: string) => {
    const settings = await settingsStore.getSettings()
    const projectName = name?.trim() || 'Untitled Project'
    const projectPath = await allocateManagedProjectFilePath(projectName)
    recentProjectsStore.clearLastOpenedProject()
    projectStore.setAutosavePath(getProjectAutosavePath(projectPath))
    const project = projectStore.createProject(projectName)
    projectStore.markProjectSaved(projectPath)
    await writeFile(projectPath, JSON.stringify(project, null, 2), 'utf8')
    recentProjectsStore.noteOpenedProject(projectPath, project.name)
    controlStateService.update({
      playheadTime: 0,
      selectedClipId: null,
      selectedAssetId: null,
      activeSequenceId: project.sequences.find((sequence) => sequence.active)?.id ?? null
    })
    void analyticsService.track(settings.analyticsEnabled, 'project_created', {
      hasName: Boolean(name?.trim()),
      fromLaunchFlow: true
    })
    const projectManager = await getProjectManagerState()
    return {
      project,
      projectManager
    }
  })

  ipcMain.handle('editor:getBootstrap', async () => {
    const settings = await settingsStore.getSettings()
    const bootstrap = toolRegistry.getBootstrap()
    const currentControlState = controlStateService.getState()
    const activeSequenceId =
      currentControlState.activeSequenceId ??
      bootstrap.project.sequences.find((sequence) => sequence.active)?.id ??
      null
    const projectManager = await getProjectManagerState()
    return {
      project: bootstrap.project,
      availableTools: bootstrap.availableTools,
      availableModels: SUPPORTED_MODELS,
      settings,
      canUndo: bootstrap.canUndo,
      canRedo: bootstrap.canRedo,
      projectFilePath: bootstrap.projectFilePath,
      projectManager,
      controlState: {
        ...currentControlState,
        activeSequenceId
      }
    }
  })

  ipcMain.handle('editor:updateControlState', async (_, partial) => {
    return controlStateService.update(partial)
  })

  ipcMain.handle('window:setMode', async (event, mode: 'welcome' | 'workspace') => {
    return
  })

  ipcMain.handle('window:enterWorkspace', async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (!editorWindow || editorWindow.isDestroyed()) {
      createEditorWindow()
    } else {
      editorWindow.show()
      editorWindow.focus()
    }
    if (senderWindow && senderWindow === launcherWindow) {
      senderWindow.close()
    }
  })

  ipcMain.handle('app:getUpdateState', async () => {
    return updateService.getState()
  })

  ipcMain.handle('app:checkForUpdates', async () => {
    return updateService.checkForUpdates()
  })

  ipcMain.handle('app:applyUpdate', async () => {
    return updateService.applyUpdate(() => {
      if (editorWindow && !editorWindow.isDestroyed()) {
        editorWindow.reload()
        editorWindow.focus()
      } else if (launcherWindow && !launcherWindow.isDestroyed()) {
        launcherWindow.reload()
        launcherWindow.focus()
      }
    })
  })

  ipcMain.handle('analytics:track', async (_, name: string, payload?: Record<string, string | number | boolean | null>) => {
    const settings = await settingsStore.getSettings()
    await analyticsService.track(settings.analyticsEnabled, name, payload ?? {})
  })

  // Helper: sync embedding service key from current settings
  async function syncEmbeddingKey(): Promise<void> {
    const s = await settingsStore.getSettings()
    const key = s.semanticApiKeys.openai || s.apiKeys.openai
    if (key) embeddingService.setApiKey(key)
  }

  function isTranscribableAsset(asset: MediaAssetRecord): boolean {
    return asset.type === 'video' || asset.type === 'audio'
  }

  async function maybeEmbedAsset(assetId: string): Promise<void> {
    await syncEmbeddingKey()
    if (!embeddingService.isReady) return
    const updatedAsset = projectStore.getProject().assets.find((item) => item.id === assetId)
    if (!updatedAsset) return

    const [assetVector] = await embeddingService.embedAssets([updatedAsset])
    if (assetVector) {
      projectStore.updateAssetVector(assetId, assetVector.vector)
    }

    const segmentVectors = await embeddingService.embedAssetSegments([updatedAsset])
    if (segmentVectors.length > 0) {
      projectStore.updateAssetSegmentVectors(
        assetId,
        segmentVectors.map((result) => ({ segmentId: result.segmentId, vector: result.vector }))
      )
    }
  }

  async function runTranscriptionJob(
    assetId: string,
    options: { language?: string; taskId?: string; requireKey?: boolean } = {}
  ): Promise<{ assetId: string; segments: Awaited<ReturnType<typeof transcriptionService.transcribeAudio>> }> {
    const asset = projectStore.getProject().assets.find((item) => item.id === assetId)
    if (!asset) throw new Error(`Asset not found: ${assetId}`)
    if (!isTranscribableAsset(asset)) throw new Error('Only audio and video assets can be transcribed.')

    const task =
      (options.taskId && projectStore.getTask(options.taskId)) ||
      projectStore.queueTask({
        type: 'transcribe',
        label: `Transcribing ${asset.name}`,
        assetId
      })

    const settings = await settingsStore.getSettings()
    const canUseLocal = transcriptionService.isLocalAvailable()
    if (!canUseLocal && !settings.apiKeys.openai) {
      projectStore.updateTask(task.id, {
        status: 'error',
        progress: 1,
        label: `Transcription unavailable for ${asset.name}: install local transcription or add an OpenAI key`
      })
      if (options.requireKey) {
        throw new Error('No transcription backend configured')
      }
      return { assetId, segments: [] }
    }

    try {
      projectStore.updateTask(task.id, {
        status: 'running',
        progress: 0.1,
        label: `Transcribing ${asset.name}`
      })

      if (settings.apiKeys.openai) {
        transcriptionService.setApiKey(settings.apiKeys.openai)
      }
      const segments = await transcriptionService.transcribeAudio(asset.path, options.language)

      projectStore.updateTask(task.id, {
        status: 'running',
        progress: 0.75,
        label: `Indexing transcript for ${asset.name}`
      })

      projectStore.updateAssetTranscript(assetId, segments)
      try {
        projectStore.generateCaptionsForAsset(assetId, { replaceExisting: true })
      } catch {
        // Asset may not be present in the active sequence yet; transcript still remains useful.
      }
      await maybeEmbedAsset(assetId)

      projectStore.updateTask(task.id, {
        status: 'done',
        progress: 1,
        label:
          segments.length > 0
            ? `Transcribed ${asset.name} (${segments.length} segments)`
            : `No speech detected in ${asset.name}`
      })
      const latestSettings = await settingsStore.getSettings()
      void analyticsService.track(latestSettings.analyticsEnabled, 'transcription_completed', {
        segmentCount: segments.length,
        assetType: asset.type
      })

      return { assetId, segments }
    } catch (error) {
      projectStore.updateTask(task.id, {
        status: 'error',
        progress: 1,
        label: `Transcription failed for ${asset.name}: ${error instanceof Error ? error.message : 'unknown error'}`
      })
      throw error
    }
  }

  async function queueAutomaticIngestionJobs(imported: MediaAssetRecord[]): Promise<void> {
    for (const asset of imported) {
      if (!isTranscribableAsset(asset)) continue
      if (asset.semantic.transcript.length > 0) continue

      const task = projectStore.queueTask({
        type: 'transcribe',
        label: `Queued transcription for ${asset.name}`,
        assetId: asset.id
      })

      void runTranscriptionJob(asset.id, { taskId: task.id, requireKey: false }).catch((error) => {
        console.warn(`[Transcription] Automatic transcription failed for ${asset.id}:`, error)
      })
    }
  }

  function hasCaptionClipsForAsset(assetId: string): boolean {
    const project = projectStore.getProject()
    const activeSequence = project.sequences.find((sequence) => sequence.active) ?? project.sequences[0]
    if (!activeSequence) return false
    return activeSequence.tracks
      .filter((track) => track.kind === 'caption')
      .some((track) => track.clips.some((clip) => clip.assetId === assetId))
  }

  function backfillCaptionsForTranscriptAssets(): void {
    const project = projectStore.getProject()
    for (const asset of project.assets) {
      if (asset.semantic.transcript.length === 0) continue
      if (hasCaptionClipsForAsset(asset.id)) continue
      try {
        projectStore.generateCaptionsForAsset(asset.id, { replaceExisting: false })
      } catch {
        // Ignore assets not present in the active sequence.
      }
    }
  }

  ipcMain.handle('editor:importFiles', async (_, filePaths: string[]) => {
    const settings = await settingsStore.getSettings()
    const imported = projectStore.importFiles(filePaths)
    void analyticsService.track(settings.analyticsEnabled, 'media_imported', {
      importedCount: imported.length,
      videoCount: imported.filter((asset) => asset.type === 'video').length,
      audioCount: imported.filter((asset) => asset.type === 'audio').length,
      imageCount: imported.filter((asset) => asset.type === 'image').length
    })
    void queueAutomaticIngestionJobs(imported)
    void syncEmbeddingKey()
      .then(async () => {
        if (!embeddingService.isReady) return
        const immediateAssets = imported.filter((asset) => !isTranscribableAsset(asset))
        if (immediateAssets.length === 0) return
        const assetResults = await embeddingService.embedAssets(immediateAssets.filter((asset) => !asset.semantic.vector))
        const segmentResults = await embeddingService.embedAssetSegments(immediateAssets)
        for (const { id, vector } of assetResults) {
          projectStore.updateAssetVector(id, vector)
        }
        for (const asset of immediateAssets) {
          const vectors = segmentResults
            .filter((result) => result.assetId === asset.id)
            .map((result) => ({ segmentId: result.segmentId, vector: result.vector }))
          if (vectors.length > 0) projectStore.updateAssetSegmentVectors(asset.id, vectors)
        }
      })
      .catch((err) => console.warn('[Embedding] Auto-embed failed:', err))
    return imported
  })

  ipcMain.handle('editor:embedAssets', async () => {
    await syncEmbeddingKey()
    if (!embeddingService.isReady) throw new Error('OpenAI API key not configured')
    const assetsToEmbed = projectStore.getAssetsWithoutVectors()
    const assetsWithUnembeddedSegments = projectStore.getAssetsWithUnembeddedSegments()
    const totalSegmentsToEmbed = assetsWithUnembeddedSegments.reduce(
      (sum, asset) => sum + asset.semantic.segments.filter((segment) => !segment.vector).length,
      0
    )
    if (assetsToEmbed.length === 0 && assetsWithUnembeddedSegments.length === 0) {
      return { embedded: 0, total: 0, embeddedAssets: 0, embeddedSegments: 0 }
    }
    const assetResults = await embeddingService.embedAssets(assetsToEmbed)
    const segmentResults = await embeddingService.embedAssetSegments(assetsWithUnembeddedSegments)
    for (const { id, vector } of assetResults) {
      projectStore.updateAssetVector(id, vector)
    }
    for (const asset of assetsWithUnembeddedSegments) {
      const vectors = segmentResults
        .filter((result) => result.assetId === asset.id)
        .map((result) => ({ segmentId: result.segmentId, vector: result.vector }))
      if (vectors.length > 0) projectStore.updateAssetSegmentVectors(asset.id, vectors)
    }
    return {
      embedded: assetResults.length + segmentResults.length,
      total: assetsToEmbed.length + totalSegmentsToEmbed,
      embeddedAssets: assetResults.length,
      embeddedSegments: segmentResults.length
    }
  })

  ipcMain.handle('editor:removeAsset', async (_, assetId: string) => {
    projectStore.removeAsset(assetId)
    return projectStore.getProject()
  })

  ipcMain.handle('editor:getWaveform', async (_, filePath: string, sampleCount?: number) => {
    return waveformService.getWaveform(filePath, sampleCount)
  })

  ipcMain.handle('editor:getPreviewPath', async (_, filePath: string, mediaType: 'video' | 'audio' | 'image') => {
    if (mediaType !== 'video') return filePath
    return previewProxyService.getPreviewPath(filePath)
  })

  ipcMain.handle('editor:getPreviewDescriptor', async (_, filePath: string, mediaType: 'video' | 'audio' | 'image') => {
    if (!filePath || filePath === 'undefined') {
      throw new Error('Preview path is missing.')
    }

    const resolvedPath = mediaType === 'video'
      ? await previewProxyService.getPreviewPath(filePath)
      : filePath

    const stats = await stat(resolvedPath)
    return {
      path: resolvedPath,
      cacheKey: `${stats.mtimeMs}:${stats.size}`
    }
  })

  ipcMain.handle('editor:listTools', async () => {
    return toolRegistry.listTools()
  })

  ipcMain.handle('editor:runTool', async (_, name: string, args: Record<string, unknown> = {}) => {
    return toolRegistry.runTool(name, args)
  })

  ipcMain.handle('editor:updateProjectName', async (_, name: string) => {
    const nextName = projectStore.updateProjectName(name)
    let projectPath = projectStore.getProjectFilePath()
    if (!projectPath) {
      projectPath = await allocateManagedProjectFilePath(nextName)
      projectStore.setAutosavePath(getProjectAutosavePath(projectPath))
      projectStore.markProjectSaved(projectPath)
    }

    await writeFile(projectPath, JSON.stringify(projectStore.getProject(), null, 2), 'utf8')
    recentProjectsStore.noteOpenedProject(projectPath, nextName)
    return nextName
  })

  ipcMain.handle('editor:addTrack', async (_, kind: 'video' | 'audio' | 'caption') => {
    return projectStore.addTrack(kind)
  })

  ipcMain.handle('editor:activateSequence', async (_, sequenceId: string) => {
    const sequence = projectStore.activateSequence(sequenceId)
    controlStateService.update({ activeSequenceId: sequence.id })
    return sequence
  })

  ipcMain.handle('editor:splitClip', async (_, clipId: string, splitTime: number) => {
    return projectStore.splitClip(clipId, splitTime)
  })

  ipcMain.handle('editor:undo', async () => {
    return projectStore.undo()
  })

  ipcMain.handle('editor:redo', async () => {
    return projectStore.redo()
  })

  ipcMain.handle('editor:saveProject', async (_, targetPath?: string | null) => {
    const settings = await settingsStore.getSettings()
    const outputPath = targetPath || projectStore.getProjectFilePath()
    if (!outputPath) {
      throw new Error('No project file selected.')
    }

    await writeFile(outputPath, JSON.stringify(projectStore.getProject(), null, 2), 'utf8')
    projectStore.markProjectSaved(outputPath)
    projectStore.setAutosavePath(getProjectAutosavePath(outputPath))
    recentProjectsStore.noteOpenedProject(outputPath, projectStore.getProject().name)
    void analyticsService.track(settings.analyticsEnabled, 'project_saved', {
      hasExistingPath: Boolean(targetPath),
      assetCount: projectStore.getProject().assets.length,
      sequenceCount: projectStore.getProject().sequences.length
    })
    return outputPath
  })

  ipcMain.handle('editor:openProject', async (_, filePath: string) => {
    const settings = await settingsStore.getSettings()
    const project = await loadBestProjectState(filePath)
    projectStore.setAutosavePath(getProjectAutosavePath(filePath))
    const loaded = projectStore.loadProject(project, filePath)
    recentProjectsStore.noteOpenedProject(filePath, loaded.name)
    controlStateService.update({
      playheadTime: 0,
      selectedClipId: null,
      selectedAssetId: null,
      activeSequenceId: loaded.sequences.find((sequence) => sequence.active)?.id ?? null
    })
    backfillCaptionsForTranscriptAssets()
    void analyticsService.track(settings.analyticsEnabled, 'project_opened', {
      assetCount: loaded.assets.length,
      sequenceCount: loaded.sequences.length
    })
    const projectManager = await getProjectManagerState()
    return {
      project: loaded,
      projectManager
    }
  })

  ipcMain.handle('editor:saveAISettings', async (_, settings: AISettings) => {
    const saved = await settingsStore.saveSettings(settings)
    // Keep embedding service in sync with the latest key
    const key = saved.semanticApiKeys.openai || saved.apiKeys.openai
    if (key) embeddingService.setApiKey(key)

    if (saved.apiKeys.openai) {
      const candidates = projectStore
        .getProject()
        .assets.filter((asset) => isTranscribableAsset(asset) && asset.semantic.transcript.length === 0)

      void queueAutomaticIngestionJobs(candidates)
    }
    return saved
  })

  ipcMain.handle('editor:chat', async (_, request: EditorChatRequest) => {
    const settings = await settingsStore.getSettings()
    return aiChatService.generateReply(request.messages, request.modelId, settings)
  })

  ipcMain.handle('editor:exportActiveSequence', async (_, outputPath: string, options?: ExportOptions) => {
    const settings = await settingsStore.getSettings()
    safeBroadcast('editor:exportProgress', {
      stage: 'preparing',
      progress: 0.02,
      message: 'Preparing export…'
    })
    const result = await exportService.exportActiveSequence(outputPath, options, (progress) => {
      safeBroadcast('editor:exportProgress', progress)
    })
    void analyticsService.track(settings.analyticsEnabled, 'export_completed', {
      duration: Math.round(result.duration),
      resolution: options?.resolution ?? '1080p',
      format: options?.format ?? 'mp4'
    })
    return result
  })

  ipcMain.handle('terminal:createSession', async (event, options: { cols: number; rows: number; cwd?: string; shell?: string }) => {
    const settings = await settingsStore.getSettings()
    const projectFilePath = projectStore.getProjectFilePath()
    const scratchTerminalDir = join(app.getPath('documents'), 'Monet')
    if (!projectFilePath && !options.cwd) {
      await mkdir(scratchTerminalDir, { recursive: true })
    }
    const { shimPath, binDir } = await ensureEditorctlShim()
    const resolvedCwd =
      options.cwd ||
      (projectFilePath ? dirname(projectFilePath) : scratchTerminalDir)
    const session = await terminalService.createSession(event.sender, {
      ...options,
      cwd: resolvedCwd,
      env: {
        PATH: `${binDir}:${process.env.PATH ?? ''}`
      }
    })
    try {
      const project = projectStore.getProject()
      const activeSequence = project.sequences.find((sequence) => sequence.active) ?? project.sequences[0] ?? null
      await ensureAgentContextFiles(session.cwd, {
        projectName: project.name,
        assetCount: project.assets.length,
        activeSequenceName: activeSequence?.name ?? null,
        activeSequenceDuration: activeSequence?.duration ?? null,
        assetNames: project.assets.slice(0, 8).map((asset) => asset.name)
      })
      terminalService.sendOutput(
        session.id,
        '\x1b[96mMonet agent context ready.\x1b[0m\r\n' +
          `Project: ${project.name}\r\n` +
          `Assets: ${project.assets.length}\r\n` +
          'This folder now contains CLAUDE.md, AGENTS.md, and MONET_AGENT_CONTEXT.md for coding agents.\r\n' +
          `${shimPath ? 'editorctl is available in this terminal.\r\n' : 'editorctl could not be prepared in this build.\r\n'}` +
          'Start with editorctl list-assets or launch Claude Code / Codex with the Monet prompt.\r\n\r\n'
      )
    } catch (error) {
      console.warn('[Terminal] Failed to bootstrap agent context files:', error)
      terminalService.sendOutput(
        session.id,
        '\x1b[93mMonet could not prepare agent context files in this folder.\x1b[0m\r\n\r\n'
      )
    }
    void analyticsService.track(settings.analyticsEnabled, 'terminal_session_started', {
      hasCustomCwd: Boolean(options.cwd)
    })
    return session
  })

  ipcMain.handle('terminal:write', async (_, sessionId: string, data: string) => {
    terminalService.write(sessionId, data)
  })

  ipcMain.handle('terminal:resize', async (_, sessionId: string, cols: number, rows: number) => {
    terminalService.resize(sessionId, cols, rows)
  })

  ipcMain.handle('terminal:kill', async (_, sessionId: string) => {
    terminalService.kill(sessionId)
  })

  ipcMain.handle('editor:transcribeAsset', async (_, assetId: string, language?: string) => {
    return runTranscriptionJob(assetId, { language, requireKey: true })
  })

  ipcMain.handle('editor:addEffect', async (_, clipId: string, effectType: string, parameters: Record<string, unknown>) => {
    return projectStore.addClipEffect(clipId, effectType, parameters)
  })

  ipcMain.handle('editor:removeEffect', async (_, clipId: string, effectId: string) => {
    return projectStore.removeClipEffect(clipId, effectId)
  })

  ipcMain.handle('editor:setClipVolume', async (_, clipId: string, volume: number) => {
    return projectStore.setClipVolume(clipId, volume)
  })

  ipcMain.handle('editor:setClipSpeed', async (_, clipId: string, speed: number) => {
    return projectStore.setClipSpeed(clipId, speed)
  })

  createLauncherWindow()

  app.on('activate', function () {
    if (!launcherWindow && !editorWindow) createLauncherWindow()
  })

  app.on('before-quit', () => {
    projectStore.flushAutosave()
    updateService.dispose()
    apiBridge.stop()
    terminalService.killAll()
  })
})

const MEDIA_MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.wmv': 'video/x-ms-wmv',
  '.ts': 'video/mp2t',
  '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml'
}

async function handleMediaRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const filePath = url.searchParams.get('path')
  if (!filePath) {
    return new Response('Missing media path.', { status: 400 })
  }

  const fileStats = await stat(filePath)
  const fileSize = fileStats.size
  const mimeType = MEDIA_MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const rangeHeader = request.headers.get('range')

  if (!rangeHeader) {
    const stream = createReadStream(filePath)
    return new Response(Readable.toWeb(stream) as BodyInit, {
      status: 200,
      headers: {
        'content-length': String(fileSize),
        'content-type': mimeType,
        'accept-ranges': 'bytes',
        'cache-control': 'no-cache'
      }
    })
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
  if (!match) {
    return new Response('Invalid range request.', {
      status: 416,
      headers: {
        'content-range': `bytes */${fileSize}`
      }
    })
  }

  let start = match[1] ? Number.parseInt(match[1], 10) : 0
  let end = match[2] ? Number.parseInt(match[2], 10) : fileSize - 1

  if (Number.isNaN(start)) start = 0
  if (Number.isNaN(end)) end = fileSize - 1
  start = Math.max(0, start)
  end = Math.min(fileSize - 1, end)

  if (start > end || start >= fileSize) {
    return new Response('Requested range not satisfiable.', {
      status: 416,
      headers: {
        'content-range': `bytes */${fileSize}`
      }
    })
  }

  const chunkSize = end - start + 1
  const stream = createReadStream(filePath, { start, end })
  return new Response(Readable.toWeb(stream) as BodyInit, {
    status: 206,
    headers: {
      'content-length': String(chunkSize),
      'content-type': mimeType,
      'content-range': `bytes ${start}-${end}/${fileSize}`,
      'accept-ranges': 'bytes',
      'cache-control': 'no-cache'
    }
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
