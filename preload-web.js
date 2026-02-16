const { ipcRenderer, contextBridge } = require("electron");

// --- Contract Definition ---
const IPC_CHANNELS = {
  UPDATE_BADGE: "update-badge",
  UPDATE_FAVICON: "update-favicon",
};

// --- Secure Bridge for Main World ---
contextBridge.exposeInMainWorld("gsuiteBridge", {
  focusCalendar: () => ipcRenderer.send("switch-tab", "calendar"),
  triggerNotification: (title, body) =>
    ipcRenderer.send("show-notification", {
      title,
      body,
      source: getSourceId(),
    }),
});

// --- Logic for Isolated World (Favicons/Badges) ---
// Utility: Debounce function to limit rate of execution
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
let lastBadgeCount = -1;

function getSourceId() {
  const href = window.location.href;
  if (href.includes("calendar.google.com")) return "calendar";
  if (href.includes("mail.google.com/chat")) return "chat";
  if (href.includes("drive.google.com")) return "drive";
  if (href.includes("tasks.google.com")) return "tasks";
  return "gmail";
}

/**
 * Monitors DOM mutations to detect favicon changes.
 * Sends updated favicon URLs to main process for display in the sidebar menu.
 * @param {string} sourceId - The service identifier (gmail, chat, drive, etc.)
 */
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

  // Debounce to prevent excessive IPC calls during rapid DOM changes
  const debouncedCheck = debounce(checkAndSend, 500);

  const observer = new MutationObserver(debouncedCheck);
  observer.observe(headElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href"],
  });
  checkAndSend();
}

/**
 * Observes Gmail page title for unread count indicator.
 * Parses "(N)" pattern from document.title and sends count via IPC.
 * Gmail-specific feature; other services use different badge mechanisms.
 */
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

/**
 * Intercepts Service Worker notifications for Google Calendar.
 * This injects a script into the Main World to bypass Isolated World restrictions.
 */
function interceptCalendarServiceWorker() {
  const scriptContent = `
    (function() {
      function patchShowNotification(registration) {
        if (!registration || registration.__patched) return;
        registration.__patched = true;

        const originalShow = registration.showNotification.bind(registration);
        registration.showNotification = function(title, options) {
          try {
            if (window.gsuiteBridge) {
              window.gsuiteBridge.triggerNotification(title, options?.body || "");
            }
          } catch (e) {
            console.error('[Calendar] Main World Notification failed:', e);
          }
          return originalShow(title, options);
        };
      }

      // 1. Intercept future registrations
      const originalRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = async function(...args) {
        const registration = await originalRegister(...args);
        patchShowNotification(registration);
        return registration;
      };

      // 2. Patch existing registrations
      if (navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(patchShowNotification).catch(() => {});
      }
      
      navigator.serviceWorker.getRegistrations().then(regs => {
        regs.forEach(patchShowNotification);
      }).catch(() => {});
    })();
  `;

  try {
    const script = document.createElement("script");
    script.textContent = scriptContent;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  } catch (e) {
    console.error("[Calendar] Failed to inject interception script:", e);
  }

  // Also enable the fallback detector in the Isolated World
  enableFallbackNotificationDetector();
}

function enableFallbackNotificationDetector() {
  let lastNotificationTime = 0;
  const DEBOUNCE_MS = 5000;

  document.addEventListener(
    "play",
    (e) => {
      if (
        e.target.tagName === "AUDIO" &&
        Date.now() - lastNotificationTime > DEBOUNCE_MS
      ) {
        lastNotificationTime = Date.now();
        showGenericCalendarNotification();
      }
    },
    true,
  );

  const titleObserver = new MutationObserver(() => {
    const hasEventIndicator = /\(\d+\)/.test(document.title);
    if (hasEventIndicator && Date.now() - lastNotificationTime > DEBOUNCE_MS) {
      lastNotificationTime = Date.now();
      showGenericCalendarNotification();
    }
  });

  const titleElement = document.querySelector("title");
  if (titleElement) {
    titleObserver.observe(titleElement, { childList: true });
  }
}

function showGenericCalendarNotification() {
  if (window.gsuiteBridge) {
    window.gsuiteBridge.triggerNotification(
      "📅 Calendar Event",
      "You have a calendar reminder - check your calendar",
    );
  } else {
    // Fallback for cases where bridge might not be ready
    ipcRenderer.send("show-notification", {
      title: "📅 Calendar Event",
      body: "You have a calendar reminder - check your calendar",
      source: "calendar",
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const sourceId = getSourceId();
  observeFaviconChanges(sourceId);

  if (sourceId === "gmail") {
    observeGmailBadge();
  }

  if (sourceId === "calendar") {
    interceptCalendarServiceWorker();
  }
});
