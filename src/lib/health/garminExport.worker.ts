import { inspectGarminExports, type GarminWorkerMessage } from './garminExport'

function send(message: GarminWorkerMessage) { self.postMessage(message) }

self.addEventListener('message', (event: MessageEvent<{ files: File[]; zone?: string }>) => {
  const { files, zone } = event.data
  void inspectGarminExports(files, zone, text => send({ type: 'progress', text })).then(
    preview => send({ type: 'done', preview }),
    error => send({ type: 'error', text: error instanceof Error ? error.message : 'Could not read the export.' }),
  )
})
