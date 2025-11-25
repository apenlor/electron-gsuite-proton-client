const { contextBridge, ipcRenderer } = require("electron");

const IPC_API_CONTRACT = {
  sendChannels: ["switch-tab", "show-context-menu"],
  receiveChannels: [
    "set-active-tab",
    "update-menu-badges",
    "update-menu-icon",
    "get-enabled-services",
  ],
};

const exposedApi = {
  send: (channel, data) => {
    if (IPC_API_CONTRACT.sendChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    } else {
      console.warn(`[Security] Ignored send: ${channel}`);
    }
  },
  on: (channel, func) => {
    if (IPC_API_CONTRACT.receiveChannels.includes(channel)) {
      const subscription = (event, ...args) => func(...args);
      ipcRenderer.on(channel, subscription);
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    } else {
      console.warn(`[Security] Ignored on: ${channel}`);
      return () => {};
    }
  },
};

contextBridge.exposeInMainWorld("electronAPI", exposedApi);
