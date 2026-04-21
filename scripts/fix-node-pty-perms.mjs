import { chmod } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const helpers = [
  join(process.cwd(), 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'),
  join(process.cwd(), 'node_modules/node-pty/prebuilds/darwin-x64/spawn-helper')
]

await Promise.all(
  helpers.map(async (helperPath) => {
    if (!existsSync(helperPath)) return
    await chmod(helperPath, 0o755)
  })
)
