import { existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'

const root = process.cwd()
const venvDir = join(root, '.python-runtime')
const pythonBin = join(venvDir, 'bin', 'python')

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' })
}

if (!existsSync(pythonBin)) {
  run('python3', ['-m', 'venv', venvDir])
}

run(pythonBin, ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel'])
run(pythonBin, ['-m', 'pip', 'install', 'faster-whisper'])

console.log(`Local transcription runtime ready at ${venvDir}`)
