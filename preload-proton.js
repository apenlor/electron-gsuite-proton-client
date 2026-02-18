const { ipcRenderer, contextBridge } = require("electron");

const IPC_CHANNELS = {
  UPDATE_BADGE: "update-badge",
  UPDATE_FAVICON: "update-favicon",
};

function getSourceId() {
  const href = window.location.href;
  if (href.includes("calendar.proton.me")) return "protoncalendar";
  return "protonmail";
}

// Bridge for notifications
contextBridge.exposeInMainWorld("protonBridge", {
  triggerNotification: (title, body) =>
    ipcRenderer.send("show-notification", {
      title,
      body,
      source: getSourceId(),
    }),
});

// --- Utilities ---
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

let lastFaviconUrl = "";

// --- Favicon Observer ---
function observeFaviconChanges() {
  const sourceId = getSourceId();
  const headElement = document.querySelector("head");
  if (!headElement) {
    setTimeout(() => observeFaviconChanges(), 500);
    return;
  }

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

  const debouncedCheck = debounce(checkAndSend, 500);
  const observer = new MutationObserver(debouncedCheck);
  observer.observe(headElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href"],
  });

  // Immediate check
  checkAndSend();

  // Delayed retries for late-loaded favicons
  setTimeout(checkAndSend, 1500);
  setTimeout(checkAndSend, 3000);
  setTimeout(checkAndSend, 5000);
}

// --- Native Notification Interception ---
function interceptNotifications() {
  const scriptContent = `
    (function() {
      const OriginalNotification = window.Notification;
      
      window.Notification = function(title, options) {
        if (window.protonBridge) {
          window.protonBridge.triggerNotification(title, options?.body || "");
        }
        return new OriginalNotification(title, options);
      };
      
      Object.defineProperty(window.Notification, 'permission', {
        get: () => OriginalNotification.permission
      });
      window.Notification.requestPermission = OriginalNotification.requestPermission.bind(OriginalNotification);
    })();
  `;

  try {
    const script = document.createElement("script");
    script.textContent = scriptContent;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  } catch (e) {
    console.error("[Proton] Failed to inject notification interception:", e);
  }
}

// --- Badge Detection (Best effort) ---
function attemptBadgeDetection() {
  const checkUnreadCount = () => {
    const sourceId = getSourceId();
    // Only apply unread count for mail
    if (sourceId !== "protonmail") return;

    const titleMatch = document.title.match(/\((\d+)\)/);
    const count = titleMatch ? parseInt(titleMatch[1], 10) : 0;

    ipcRenderer.send(IPC_CHANNELS.UPDATE_BADGE, {
      count,
      source: sourceId,
    });
  };

  const debouncedCheck = debounce(checkUnreadCount, 1000);
  const titleElement = document.querySelector("head > title");
  if (titleElement) {
    const observer = new MutationObserver(debouncedCheck);
    observer.observe(titleElement, { childList: true });
  }
  checkUnreadCount();
}

document.addEventListener("DOMContentLoaded", () => {
  observeFaviconChanges();
  interceptNotifications();
  attemptBadgeDetection();
});
