#!/usr/bin/env node
/**
 * Live IPC bridge to add effects to the running app
 * Usage: node scripts/live-add-effect.mjs <clipId> <effectType> [params...]
 */

console.log('Live effect addition requires IPC bridge to running Electron app')
console.log('This would need a socket/IPC connection to the main process')
console.log('')
console.log('For now, use the app UI or save the project and use editorctl')
console.log('')
console.log('Quick steps:')
console.log('1. In the app: File → Save Project')
console.log('2. Run: AI_VIDEO_EDITOR_PROJECT=yourfile.aiveproj.json ./bin/editorctl add-effect <clipId> fade_in')
console.log('3. In the app: File → Open Project to reload')
