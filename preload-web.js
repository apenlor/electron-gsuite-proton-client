const { ipcRenderer, contextBridge } = require("electron");

// --- Contract Definition ---
const IPC_CHANNELS = {
  SHOW_NOTIFICATION: "show-notification",
  UPDATE_BADGE: "update-badge",
  UPDATE_FAVICON: "update-favicon",
};

// --- 1. Secure Bridge ---
contextBridge.exposeInMainWorld("gsuiteBridge", {
  triggerNotification: (data) => {
    ipcRenderer.send(IPC_CHANNELS.SHOW_NOTIFICATION, data);
  },
});

// --- 2. Main World Injection (The Fix for Calendar & Chat) ---
function injectNotificationProxy() {
  const scriptContent = `
    (function() {
      try {
        // --- A. Mock Permissions API ---
        if (navigator.permissions && navigator.permissions.query) {
          const originalQuery = navigator.permissions.query;
          navigator.permissions.query = (parameters) => {
            if (parameters.name === 'notifications') {
              return Promise.resolve({
                state: 'granted',
                onchange: null,
                addEventListener: () => {},
                removeEventListener: () => {},
                dispatchEvent: () => false
              });
            }
            return originalQuery(parameters);
          };
        }

        // --- B. Class-based Notification Proxy (Main Thread) ---
        const OriginalNotification = window.Notification;

        class GSuiteNotification extends OriginalNotification {
          constructor(title, options) {
            if (window.gsuiteBridge) {
              window.gsuiteBridge.triggerNotification({
                title,
                body: options?.body,
              });
            }
            super(title, { ...options, silent: true });
          }
        }

        Object.defineProperty(GSuiteNotification, 'permission', {
          get: () => 'granted',
          configurable: true
        });
        GSuiteNotification.requestPermission = async () => 'granted';
        window.Notification = GSuiteNotification;

        // --- C. Service Worker Proxy (Critical for Calendar) ---
        // Calendar often uses the Service Worker to show notifications.
        // We override the prototype to catch these calls too.
        if (window.ServiceWorkerRegistration) {
          const originalShowNotification = window.ServiceWorkerRegistration.prototype.showNotification;
          window.ServiceWorkerRegistration.prototype.showNotification = function(title, options) {
            if (window.gsuiteBridge) {
              window.gsuiteBridge.triggerNotification({
                title,
                body: options?.body,
              });
            }
            // Call original to maintain internal state, but silence it if possible options exist
            return originalShowNotification.call(this, title, { ...options, silent: true });
          };
        }

      } catch (e) {
        // Ignore injection errors
      }
    })();
  `;

  // --- D. Injection Mechanism ---
  const attemptInjection = () => {
    const target = document.head || document.documentElement;
    if (target) {
      try {
        const script = document.createElement("script");
        script.textContent = scriptContent;
        target.appendChild(script);
        script.remove();
        return true;
      } catch (e) {
        console.log(e);
      }
    }
    return false;
  };

  if (!attemptInjection()) {
    const observer = new MutationObserver((mutations, obs) => {
      if (attemptInjection()) {
        obs.disconnect();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  }
}

// Run immediately
injectNotificationProxy();

// --- 3. Logic for Isolated World (Favicons/Badges) ---
let lastFaviconUrl = "";
let lastBadgeCount = -1;

function getSourceId() {
  const href = window.location.href;
  if (href.includes("mail.google.com/chat")) return "chat";
  if (href.includes("drive.google.com")) return "drive";
  if (href.includes("calendar.google.com")) return "calendar";
  return "gmail";
}

function observeFaviconChanges(sourceId) {
  const headElement = document.querySelector("head");
  if (!headElement) return;

  const checkAndSend = () => {
    const links = Array.from(document.querySelectorAll("link[rel*='icon']"));
    const currentUrl = links.length > 0 ? links[links.length - 1].href : null;

    if (currentUrl && currentUrl !== lastFaviconUrl) {
      lastFaviconUrl = currentUrl;
      ipcRenderer.send(IPC_CHANNELS.UPDATE_FAVICON, {
        source: sourceId,
        faviconUrl: lastFaviconUrl,
      });
    }
  };

  const observer = new MutationObserver(checkAndSend);
  observer.observe(headElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href"],
  });
  checkAndSend();
}

function observeGmailBadge() {
  const titleElement = document.querySelector("head > title");
  if (!titleElement) return;

  const checkAndSend = () => {
    const titleMatch = document.title.match(/\((\d+)\)/);
    const count = titleMatch ? parseInt(titleMatch[1], 10) : 0;
    if (count !== lastBadgeCount) {
      lastBadgeCount = count;
      ipcRenderer.send(IPC_CHANNELS.UPDATE_BADGE, {
        count: lastBadgeCount,
        source: "gmail",
      });
    }
  };

  const observer = new MutationObserver(checkAndSend);
  observer.observe(titleElement, { childList: true });
  checkAndSend();
}

document.addEventListener("DOMContentLoaded", () => {
  const sourceId = getSourceId();
  observeFaviconChanges(sourceId);

  if (sourceId === "gmail") {
    observeGmailBadge();
  }
});
