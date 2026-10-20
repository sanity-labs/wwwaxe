import { parentPort, workerData } from 'node:worker_threads'
import { wwwaxe, wwwaxeFullAndCore } from '../../src/wwwaxe.ts'

const { call, html, options, coreOptions } = workerData

try {
  const value =
    call === 'fullAndCore' ? wwwaxeFullAndCore(html, options, coreOptions) : wwwaxe(html, options)
  parentPort!.postMessage({ ok: true, value })
} catch (error) {
  parentPort!.postMessage({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  })
}
