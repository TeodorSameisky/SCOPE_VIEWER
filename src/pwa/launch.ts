/**
 * File Handling API: when the installed app is opened with a file from the operating system
 * ("Open with Scope Viewer", double-click on a .tss), the files arrive through `launchQueue`.
 */
interface LaunchParams {
  files: FileSystemFileHandle[]
}
interface LaunchQueue {
  setConsumer: (consumer: (params: LaunchParams) => void) => void
}

export function onLaunchFiles(open: (files: File[]) => void): void {
  const queue = (window as { launchQueue?: LaunchQueue }).launchQueue
  if (!queue) return
  queue.setConsumer(async (params) => {
    if (!params.files?.length) return
    const files = await Promise.all(params.files.map((h) => h.getFile()))
    open(files)
  })
}
