const { ipcRenderer, contextBridge } = require("electron");

// --- Contract Definition ---
const IPC_CHANNELS = {
  SHOW_NOTIFICATION: "show-notification",
  UPDATE_BADGE: "update-badge",
  UPDATE_FAVICON: "update-favicon",
};

// --- 1. Secure Bridge ---
// Exposes a minimal API to the Main World for the injected script to use.
contextBridge.exposeInMainWorld("gsuiteBridge", {
  triggerNotification: (data) => {
    ipcRenderer.send(IPC_CHANNELS.SHOW_NOTIFICATION, data);
  },
});

// --- 2. Main World Injection (The Fix for Calendar) ---
function injectNotificationProxy() {
  try {
    const scriptContent = `
      (function() {
        try {
          // A. Mock Permissions API (Critical for Calendar)
          if (navigator.permissions && navigator.permissions.query) {
            const originalQuery = navigator.permissions.query;
            navigator.permissions.query = (parameters) => {
              if (parameters.name === 'notifications') {
                return Promise.resolve({ state: 'granted', onchange: null });
              }
              return originalQuery(parameters);
            };
          }

          // B. Mock Notification API
          const OriginalNotification = window.Notification;

          // 1. Force static permission properties
          Object.defineProperty(window.Notification, 'permission', {
            get: () => 'granted',
            configurable: true
          });
          window.Notification.requestPermission = async () => 'granted';

          // 2. Override Constructor
          window.Notification = function (title, options) {
            if (window.gsuiteBridge) {
                window.gsuiteBridge.triggerNotification({
                    title,
                    body: options?.body,
                });
            }
            // Return silent notification to satisfy internal app logic
            return new OriginalNotification(title, { ...options, silent: true });
          };

          window.Notification.permission = 'granted';
        } catch (e) {
          console.error("[GSuite] Notification proxy error:", e);
        }
      })();
    `;

    const script = document.createElement("script");
    script.textContent = scriptContent;
    // Immediate injection
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  } catch (error) {
    console.error("[GSuite] Injection failed:", error);
  }
}

// --- 3. Execute Injection ---
// Must run immediately to intercept early checks.
injectNotificationProxy();

// --- 4. Logic for Isolated World (Favicons/Badges) ---
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
    const faviconElement = document.querySelector('link[rel="icon"]');
    if (faviconElement && faviconElement.href !== lastFaviconUrl) {
      lastFaviconUrl = faviconElement.href;
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

  // Initial check
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

  // Initial check
  checkAndSend();
}

// --- Main Execution ---
document.addEventListener("DOMContentLoaded", () => {
  const sourceId = getSourceId();
  observeFaviconChanges(sourceId);

  if (sourceId === "gmail") {
    observeGmailBadge();
  }
});
