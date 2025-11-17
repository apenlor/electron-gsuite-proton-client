const { ipcRenderer } = require("electron");

// --- Constants ---
// This assumes the main process will expose these constants on the global scope
// for preload scripts, which is a common and robust pattern.
const IPC_CHANNELS = {
  SHOW_NOTIFICATION: "show-notification",
  UPDATE_BADGE: "update-badge",
  UPDATE_FAVICON: "update-favicon",
};

/**
 * @class ServiceObserver
 * Encapsulates the logic for observing a specific web service (e.g., Gmail, Chat)
 * and reporting state changes back to the main process.
 */
class ServiceObserver {
  constructor(config) {
    this.sourceId = config.sourceId;
    this.detectionFn = config.detectionFn;
    this.lastBadgeCount = -1;
    this.lastFaviconUrl = "";
  }

  /**
   * Initializes all observers for the service.
   */
  start() {
    this._observeTitle();
    this._observeFavicon();
  }

  /**
   * Observes changes to the document title.
   * This is more efficient than setInterval as it only fires on actual changes.
   */
  _observeTitle() {
    const titleElement = document.querySelector("head > title");
    if (!titleElement) return;

    const observer = new MutationObserver(() => this.detectionFn());
    observer.observe(titleElement, { childList: true });

    // Initial detection on start
    this.detectionFn();
  }

  /**
   * Observes changes to the favicon element.
   * Fires when attributes (like href) change, indicating a status update.
   */
  _observeFavicon() {
    const headElement = document.querySelector("head");
    if (!headElement) return;

    const observer = new MutationObserver((mutationsList) => {
      for (const mutation of mutationsList) {
        if (
          mutation.type === "childList" ||
          (mutation.type === "attributes" && mutation.attributeName === "href")
        ) {
          const faviconElement = document.querySelector('link[rel="icon"]');
          if (faviconElement && faviconElement.href !== this.lastFaviconUrl) {
            this.lastFaviconUrl = faviconElement.href;
            ipcRenderer.send(IPC_CHANNELS.UPDATE_FAVICON, {
              source: this.sourceId,
              faviconUrl: this.lastFaviconUrl,
            });
          }
        }
      }
    });

    observer.observe(headElement, {
      attributes: true,
      childList: true,
      subtree: true,
    });
  }

  /**
   * Sends an IPC message if the badge count has changed.
   * @param {number} newCount - The newly detected unread count.
   */
  _reportBadgeCount(newCount) {
    if (newCount !== this.lastBadgeCount) {
      this.lastBadgeCount = newCount;
      ipcRenderer.send(IPC_CHANNELS.UPDATE_BADGE, {
        count: newCount,
        source: this.sourceId,
      });
    }
  }
}

/**
 * Overrides the global Notification constructor to intercept web notifications
 * and relay them to the main process for native display.
 */
function setupNativeNotificationProxy() {
  const OriginalNotification = Notification;
  window.Notification = function (title, options) {
    ipcRenderer.send(IPC_CHANNELS.SHOW_NOTIFICATION, {
      title,
      body: options.body,
    });
    // Return a silent original notification to satisfy the calling script's API expectations.
    return new OriginalNotification(title, { ...options, silent: true });
  };
}

/**
 * Factory function to create and start the correct observer based on the current URL.
 */
function initializeServiceObserver() {
  const href = window.location.href;

  if (href.includes("mail.google.com/chat")) {
    // Chat primarily signals unread status via favicon changes.
    const chatObserver = new ServiceObserver({
      sourceId: "chat",
      detectionFn: () => {
        // Chat does not reliably use title for unread count. We will rely on favicon changes.
        // This function is kept for title observation but can be a no-op for badge count.
        // We could implement more complex DOM scraping here if needed.
      },
    });
    chatObserver.start();
  } else if (href.includes("mail.google.com/mail")) {
    // Gmail uses the document title for a precise unread count.
    const gmailObserver = new ServiceObserver({
      sourceId: "gmail",
      detectionFn: () => {
        const unreadMatch = document.title.match(/\((\d+)\)/);
        const count = unreadMatch ? parseInt(unreadMatch[1], 10) : 0;
        gmailObserver._reportBadgeCount(count);
      },
    });
    gmailObserver.start();
  }
}

// --- Main Execution ---
document.addEventListener("DOMContentLoaded", () => {
  setupNativeNotificationProxy();
  initializeServiceObserver();
});
