import { Worker } from 'node:worker_threads'
import type { WwwaxeOptions } from '../../src/index.ts'

/**
 * Convert in a worker thread with a 4 MB stack. Deep-nesting behaviour depends on the stack
 * size, and a worker's is the same everywhere, unlike the main thread's.
 */
function run<T>(workerData: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./convert-worker.mts', import.meta.url), {
      workerData,
      resourceLimits: { stackSizeMb: 4 },
      execArgv: ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON'],
    })
    worker.once('message', (message: { ok: boolean; value?: T; message?: string }) => {
      if (message.ok) resolve(message.value as T)
      else reject(new Error(message.message))
    })
    worker.once('error', reject)
  })
}

export function wwwaxeInWorker(html: string, options: WwwaxeOptions = {}): Promise<string> {
  return run({ call: 'wwwaxe', html, options })
}

export function fullAndCoreInWorker(
  html: string,
  options: WwwaxeOptions = {},
  coreOptions: Pick<WwwaxeOptions, 'keepIds'> = {},
): Promise<{ full: string; core: string }> {
  return run({ call: 'fullAndCore', html, options, coreOptions })
}
