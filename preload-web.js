const { ipcRenderer } = require("electron");

// --- Contract Definition ---
const IPC_CHANNELS = {
  SHOW_NOTIFICATION: "show-notification",
  UPDATE_BADGE: "update-badge",
  UPDATE_FAVICON: "update-favicon",
};

// --- State Variables ---
let lastFaviconUrl = "";
let lastBadgeCount = -1;

/**
 * Intercepts web notifications and forwards them to the main process for native display.
 */
function setupNativeNotificationProxy() {
  const OriginalNotification = Notification;
  window.Notification = function (title, options) {
    // Relay the notification data to the main process
    ipcRenderer.send(IPC_CHANNELS.SHOW_NOTIFICATION, {
      title,
      body: options.body,
    });
    // Return a silent original notification to satisfy the calling script's API expectations.
    return new OriginalNotification(title, { ...options, silent: true });
  };
}

function getSourceId() {
  const href = window.location.href;
  if (href.includes("mail.google.com/chat")) return "chat";
  if (href.includes("drive.google.com")) return "drive";
  if (href.includes("calendar.google.com")) return "calendar";
  return "gmail";
}

/**
 * Observes and reports favicon URL changes for both services.
 * This is the primary driver for the dynamic menu icons.
 */
function observeFaviconChanges(sourceId) {
  const headElement = document.querySelector("head");
  if (!headElement) return;

  const observer = new MutationObserver(() => {
    const faviconElement = document.querySelector('link[rel="icon"]');
    if (faviconElement && faviconElement.href !== lastFaviconUrl) {
      lastFaviconUrl = faviconElement.href;
      ipcRenderer.send(IPC_CHANNELS.UPDATE_FAVICON, {
        source: sourceId,
        faviconUrl: lastFaviconUrl,
      });
    }
  });

  observer.observe(headElement, { childList: true, subtree: true });

  // Initial check on load
  const initialFavicon = document.querySelector('link[rel="icon"]');
  if (initialFavicon) {
    lastFaviconUrl = initialFavicon.href;
    ipcRenderer.send(IPC_CHANNELS.UPDATE_FAVICON, {
      source: sourceId,
      faviconUrl: lastFaviconUrl,
    });
  }
}

/**
 * Observes the document title specifically for Gmail's unread count.
 * This runs ONLY on the Gmail page.
 */
function observeGmailBadge() {
  const titleElement = document.querySelector("head > title");
  if (!titleElement) return;

  const observer = new MutationObserver(() => {
    const titleMatch = document.title.match(/\((\d+)\)/);
    const count = titleMatch ? parseInt(titleMatch[1], 10) : 0;
    if (count !== lastBadgeCount) {
      lastBadgeCount = count;
      ipcRenderer.send(IPC_CHANNELS.UPDATE_BADGE, {
        count: lastBadgeCount,
        source: "gmail",
      });
    }
  });

  observer.observe(titleElement, { childList: true });

  // Initial check on load
  const initialMatch = document.title.match(/\((\d+)\)/);
  const initialCount = initialMatch ? parseInt(initialMatch[1], 10) : 0;
  if (initialCount !== lastBadgeCount) {
    lastBadgeCount = initialCount;
    ipcRenderer.send(IPC_CHANNELS.UPDATE_BADGE, {
      count: lastBadgeCount,
      source: "gmail",
    });
  }
}

// --- Main Execution ---
document.addEventListener("DOMContentLoaded", () => {
  setupNativeNotificationProxy();
  let sourceId = getSourceId();
  // Favicon observation is universal for all services.
  observeFaviconChanges(sourceId);

  // Badge observation is specific to Gmail.
  if (sourceId === "gmail") {
    observeGmailBadge();
  }
});
