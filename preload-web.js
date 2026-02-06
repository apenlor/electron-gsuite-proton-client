const { ipcRenderer } = require("electron");

// --- Contract Definition ---
const IPC_CHANNELS = {
  UPDATE_BADGE: "update-badge",
  UPDATE_FAVICON: "update-favicon",
};

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
  if (href.includes("aistudio.google.com")) return "aistudio";
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

document.addEventListener("DOMContentLoaded", () => {
  const sourceId = getSourceId();
  observeFaviconChanges(sourceId);

  if (sourceId === "gmail") {
    observeGmailBadge();
  }
});
