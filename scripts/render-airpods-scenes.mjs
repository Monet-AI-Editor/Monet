import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const root = process.cwd()
const sourcePath = path.join(root, 'tmp', 'airpods-launch-scenes.html')
const outputDir = path.join(root, 'tmp', 'airpods-scenes-rendered')

const chromiumCandidates = [
  process.env.CHROMIUM_PATH,
  path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright', 'chromium-1194', 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
  path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright', 'chromium-1187', 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
  path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright', 'chromium-1181', 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
]

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} exited with code ${code}`))
    })
    child.on('error', reject)
  })

const main = async () => {
  const chromiumPath = chromiumCandidates.find(Boolean)
  if (!chromiumPath) {
    throw new Error('Chromium binary not found. Set CHROMIUM_PATH.')
  }

  const html = await fs.readFile(sourcePath, 'utf8')
  const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/)
  if (!styleMatch) {
    throw new Error('Style block not found in scene source.')
  }

  const sceneMatches = [...html.matchAll(/<section class="scene\s+(scene-\d+)" id="(scene-\d+)">([\s\S]*?)<\/section>/g)]
  if (!sceneMatches.length) {
    throw new Error('No scene sections found in source.')
  }

  await fs.mkdir(outputDir, { recursive: true })

  const variants = sceneMatches.flatMap(([, sceneClass, sceneId, sceneMarkup]) => {
    const transparentShell = 'body{background:transparent !important;} .scene{background:transparent !important;}'
    const variant = (fileStem, cssPatch = '') => ({ sceneClass, sceneId, fileStem, markup: sceneMarkup, cssPatch })

    if (sceneId === 'scene-1') {
      return [
        variant('scene-1-bg', '.scene-1 .copy, .scene-1 .pods, .scene-1 .floor-glow{display:none !important;}'),
        variant('scene-1-copy', `${transparentShell} .scene-1 .pods, .scene-1 .floor-glow{display:none !important;}`),
        variant('scene-1-pods', `${transparentShell} .scene-1 .copy, .scene-1 .floor-glow{display:none !important;}`),
      ]
    }

    if (sceneId === 'scene-2') {
      return [
        variant('scene-2-bg', '.scene-2 .copy, .scene-2 .pods, .scene-2 .ring{display:none !important;}'),
        variant('scene-2-copy', `${transparentShell} .scene-2 .pods, .scene-2 .ring{display:none !important;}`),
        variant('scene-2-pods', `${transparentShell} .scene-2 .copy{display:none !important;}`),
      ]
    }

    if (sceneId === 'scene-3') {
      return [
        variant('scene-3-bg', '.scene-3 .copy, .scene-3 .case, .scene-3 .pods, .scene-3 .badge-row{display:none !important;}'),
        variant('scene-3-copy', `${transparentShell} .scene-3 .case, .scene-3 .pods, .scene-3 .badge-row{display:none !important;}`),
        variant('scene-3-product', `${transparentShell} .scene-3 .copy, .scene-3 .badge-row{display:none !important;}`),
      ]
    }

    return [variant(sceneId)]
  })

  for (const variant of variants) {
    const sceneHtmlPath = path.join(outputDir, `${variant.fileStem}.html`)
    const scenePngPath = path.join(outputDir, `${variant.fileStem}.png`)
    const sceneHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${variant.fileStem}</title>
    <style>${styleMatch[1]} ${variant.cssPatch ?? ''}</style>
  </head>
  <body>
    <section class="scene ${variant.sceneClass}" id="${variant.sceneId}">${variant.markup}</section>
  </body>
</html>
`

    await fs.writeFile(sceneHtmlPath, sceneHtml, 'utf8')
    await run(chromiumPath, [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--default-background-color=00000000',
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=2000',
      '--window-size=1920,1080',
      `--screenshot=${scenePngPath}`,
      `file://${sceneHtmlPath}`,
    ])
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
