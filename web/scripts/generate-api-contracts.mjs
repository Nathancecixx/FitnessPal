import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const currentDir = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(currentDir, '..')
const repoRoot = resolve(webRoot, '..')
const schemaPath = resolve(webRoot, 'src', 'lib', 'generated', 'openapi.json')
const typesPath = resolve(webRoot, 'src', 'lib', 'generated', 'api-schema.d.ts')
const exportScript = resolve(repoRoot, 'api', 'scripts', 'export_openapi.py')

await mkdir(dirname(schemaPath), { recursive: true })
await execFileAsync('python', [exportScript, schemaPath], { cwd: repoRoot })
await execFileAsync('npx', ['openapi-typescript', schemaPath, '-o', typesPath], { cwd: webRoot, shell: true })

process.stdout.write(`Generated contracts at ${typesPath}\n`)
