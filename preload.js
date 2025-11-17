const { contextBridge, ipcRenderer } = require("electron");

/**
 * @fileoverview Securely exposes a controlled IPC API to the renderer process.
 * This preload script acts as a security boundary, ensuring that the renderer can only
 * access predefined IPC channels and cannot access Node.js APIs directly.
 */

// --- API Contract Definition ---
// This object defines the single source of truth for the IPC API contract.
// It prevents "magic strings" and provides a clear, self-documenting overview
// of the available communication channels.
const IPC_API_CONTRACT = {
  // Channels the renderer can send messages ON
  sendChannels: ["switch-tab"],
  // Channels the renderer can receive messages FROM
  receiveChannels: ["set-active-tab", "update-menu-badges", "update-menu-icon"],
  // Channels the renderer can both send and receive on (e.g., for request/response)
  // None defined for this use case, but included for architectural completeness.
  invokeChannels: [],
};

// --- API Implementation ---
// This is the API object that will be exposed to the renderer process.
const exposedApi = {
  /**
   * Sends a message to the main process on a whitelisted channel.
   * @param {string} channel - The IPC channel to send the message on. Must be in `sendChannels`.
   * @param {*} data - The payload to send.
   */
  send: (channel, data) => {
    if (IPC_API_CONTRACT.sendChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    } else {
      console.warn(
        `[Security] Ignored attempt to send on untrusted channel: ${channel}`,
      );
    }
  },

  /**
   * Subscribes to a message from the main process on a whitelisted channel.
   * @param {string} channel - The IPC channel to subscribe to. Must be in `receiveChannels`.
   * @param {function} func - The callback function to execute when a message is received.
   * @returns {function} A function to unsubscribe the listener.
   */
  on: (channel, func) => {
    if (IPC_API_CONTRACT.receiveChannels.includes(channel)) {
      const subscription = (event, ...args) => func(...args);
      ipcRenderer.on(channel, subscription);

      // Return a cleanup function for robust lifecycle management in the renderer (e.g., in React's useEffect).
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    } else {
      console.warn(
        `[Security] Ignored attempt to listen on untrusted channel: ${channel}`,
      );
      // Return a no-op function to prevent errors in the renderer.
      return () => {};
    }
  },
};

// --- Secure Exposure ---
// Use contextBridge to expose the defined API to the renderer under a specific global variable.
// This is the only secure way to bridge the isolated renderer and the Node.js context of the preload script.
contextBridge.exposeInMainWorld("electronAPI", exposedApi);
