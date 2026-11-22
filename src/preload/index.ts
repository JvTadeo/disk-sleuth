import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api, EventMap, InvokeMap, SendMap, Unsubscribe } from '@shared/ipc'

// The window has no Node access: only this small, typed API.

function invoke<K extends keyof InvokeMap>(channel: K, ...args: InvokeMap[K][0]): Promise<InvokeMap[K][1]> {
  return ipcRenderer.invoke(channel, ...args)
}

function send<K extends keyof SendMap>(channel: K, ...args: SendMap[K]): void {
  ipcRenderer.send(channel, ...args)
}

function subscribe<K extends keyof EventMap>(channel: K, cb: (...args: EventMap[K]) => void): Unsubscribe {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as EventMap[K]))
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: Api = {
  window: {
    minimize: () => send('window:minimize'),
    toggleMaximize: () => send('window:toggleMaximize'),
    close: () => send('window:close'),
    isMaximized: () => invoke('window:isMaximized'),
    onMaximizedChange: (cb) => subscribe('window:maximized', cb)
  },
  theme: {
    get: () => invoke('theme:get'),
    set: (source) => invoke('theme:set', source),
    onChange: (cb) => subscribe('theme:changed', cb)
  },
  system: {
    listDrives: () => invoke('system:listDrives')
  },
  scan: {
    start: (root) => invoke('scan:start', root),
    cancel: () => invoke('scan:cancel'),
    state: () => invoke('scan:state'),
    children: (nodeId) => invoke('scan:children', nodeId),
    treemap: (nodeId) => invoke('scan:treemap', nodeId),
    info: (nodeId) => invoke('scan:info', nodeId),
    largestFiles: () => invoke('scan:largestFiles'),
    onProgress: (cb) => subscribe('scan:progress', cb),
    onDone: (cb) => subscribe('scan:done', cb),
    onError: (cb) => subscribe('scan:error', cb),
    activate: (root) => invoke('scan:activate', root),
    onActivated: (cb) => subscribe('scan:activated', cb)
  },
  cache: {
    info: () => invoke('cache:info'),
    clear: (root) => invoke('cache:clear', root)
  },
  report: {
    export: () => invoke('report:export')
  },
  item: {
    showInFolder: (nodeId) => invoke('item:showInFolder', nodeId),
    copyPath: (nodeId) => invoke('item:copyPath', nodeId),
    remove: (nodeId, mode) => invoke('item:remove', nodeId, mode),
    contextMenu: (nodeId) => invoke('item:contextMenu', nodeId),
    empty: (nodeId) => invoke('item:empty', nodeId)
  },
  duplicates: {
    start: (minSize) => invoke('dup:start', minSize),
    cancel: () => invoke('dup:cancel'),
    state: () => invoke('dup:state'),
    onProgress: (cb) => subscribe('dup:progress', cb),
    onDone: (cb) => subscribe('dup:done', cb),
    onError: (cb) => subscribe('dup:error', cb)
  },
  programs: {
    detect: () => invoke('programs:detect'),
    last: () => invoke('programs:last'),
    openFolder: (id) => invoke('programs:openFolder', id),
    uninstall: (id) => invoke('programs:uninstall', id),
    remove: (id, mode) => invoke('programs:remove', id, mode),
    contextMenu: (id) => invoke('programs:contextMenu', id),
    icon: (id) => invoke('programs:icon', id)
  },
  app: {
    info: () => invoke('app:info'),
    ready: () => send('app:ready'),
    relaunchAsAdmin: (scanRoot) => invoke('app:relaunchAsAdmin', scanRoot)
  }
}

contextBridge.exposeInMainWorld('api', api)
