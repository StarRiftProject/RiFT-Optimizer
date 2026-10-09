'use strict'

const { contextBridge, ipcRenderer } = require('electron')

const listeners = new Set()
const hardwareListeners = new Set()
const updateListeners = new Set()

function fanOut(target, payload) {
  for (const listener of target) {
    try {
      listener(payload)
    } catch {
      /* a bad listener must not take the stream down */
    }
  }
}

ipcRenderer.on('rift:event', (_event, payload) => fanOut(listeners, payload))
ipcRenderer.on('rift:hardware', (_event, payload) => fanOut(hardwareListeners, payload))
ipcRenderer.on('rift:update', (_event, payload) => fanOut(updateListeners, payload))

const hwid = require('./hwid.cjs')

contextBridge.exposeInMainWorld('rift', {
  isDesktop: true,
  engine: () => ipcRenderer.invoke('rift:engine'),
  hardware: () => ipcRenderer.invoke('rift:hardware'),
  startHardware: () => ipcRenderer.invoke('rift:hardware-start'),
  stopHardware: () => ipcRenderer.invoke('rift:hardware-stop'),
  run: (action, modules, benchSeconds) => ipcRenderer.invoke('rift:run', action, modules, benchSeconds),
  cancel: () => ipcRenderer.invoke('rift:cancel'),
  version: () => ipcRenderer.invoke('rift:version'),
  hwid: () => ipcRenderer.invoke('rift:hwid'),
  checkUpdate: () => ipcRenderer.invoke('rift:update-check'),
  recheckUpdate: () => ipcRenderer.invoke('rift:update-reset'),
  openUpdatePage: () => ipcRenderer.invoke('rift:update-open'),
  onUpdate: (listener) => {
    if (typeof listener !== 'function') return () => {}
    updateListeners.add(listener)
    return () => updateListeners.delete(listener)
  },
  onEvent: (listener) => {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  onHardware: (listener) => {
    if (typeof listener !== 'function') return () => {}
    hardwareListeners.add(listener)
    return () => hardwareListeners.delete(listener)
  },
})