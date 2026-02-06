import {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  shell,
  net,
  Menu,
  MenuItem,
} from "electron";
import path from "path";
import fs from "fs";
import { createMenu } from "./menu.js";
import { fileURLToPath } from "url";
import Store from "electron-store";
import pkg from "electron-updater";
const { autoUpdater } = pkg;
import contextMenu from "electron-context-menu";

// --- Configuration ---

const IPC_CHANNELS = {
  SWITCH_TAB: "switch-tab",
  UPDATE_BADGE: "update-badge",
  SET_ACTIVE_TAB: "set-active-tab",
  UPDATE_MENU_BADGES: "update-menu-badges",
  UPDATE_FAVICON: "update-favicon",
  UPDATE_MENU_ICON: "update-menu-icon",
  SHOW_CONTEXT_MENU: "show-context-menu",
  GET_ENABLED_SERVICES: "get-enabled-services",
  SET_LOADING_STATE: "set-loading-state",
};

const LAYOUT_CONSTANTS = {
  MENU_WIDTH: 80,
};

const VIEW_CONFIG = {
  MENU: { id: "menu", preload: "preload.js", isContent: false },
  AISTUDIO: {
    id: "aistudio",
    title: "AI Studio",
    icon: "assets/default/aistudio.png",
    url: "https://aistudio.google.com",
    preload: "preload-web.js",
    isContent: true,
  },
  GMAIL: {
    id: "gmail",
    title: "Gmail",
    icon: "assets/default/gmail.png",
    url: "https://mail.google.com/mail/u/0/",
    preload: "preload-web.js",
    isContent: true,
  },
  CALENDAR: {
    id: "calendar",
    title: "Calendar",
    icon: "assets/default/calendar.png",
    url: "https://calendar.google.com/calendar/u/0/r",
    preload: "preload-web.js",
    isContent: true,
  },
  CHAT: {
    id: "chat",
    title: "Google Chat",
    icon: "assets/default/chat.png",
    url: "https://mail.google.com/chat/u/0/#chat/home",
    preload: "preload-web.js",
    isContent: true,
  },
  DRIVE: {
    id: "drive",
    title: "Google Drive",
    icon: "assets/default/drive.png",
    url: "https://drive.google.com/drive/u/0/my-drive",
    preload: "preload-web.js",
    isContent: true,
  },
  TASKS: {
    id: "tasks",
    title: "Google Tasks",
    icon: "assets/default/tasks.png",
    url: "https://tasks.google.com/tasks",
    preload: "preload-web.js",
    isContent: true,
  },
};

const VALID_PRELOADS = new Set(
  Object.values(VIEW_CONFIG).map((c) => c.preload),
);

const VALID_VIEW_IDS = new Set(Object.values(VIEW_CONFIG).map((c) => c.id));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "package.json"), "utf8"),
);

class MainWindow {
  static VIEW_CONFIG = VIEW_CONFIG;

  constructor() {
    this.store = new Store();
    this.win = null;
    this.views = {};
    this.activeViewId = null;
    this.unreadCounts = {};
    this.loadedViews = new Set();

    // Load persistence state (Default: all enabled)
    this.enabledServices = this.store.get("services", {
      aistudio: true,
      gmail: true,
      calendar: true,
      chat: true,
      drive: true,
      tasks: true,
    });

    this.zoomLevels = this.store.get("zoomLevels", {});
  }

  /**
   * Initializes and displays the main application window.
   * Orchestrates window creation, view setup, IPC handlers, and auto-updater.
   */
  create() {
    this._createWindow();
    this._setupSecurity();
    this._createViews();
    this._attachViews();
    this._layoutViews();
    this._setupIpcHandlers();
    this._loadInitialContent();
    this._setupAutoUpdater();
  }

  _createWindow() {
    const bounds = this.store.get("windowBounds", { width: 1200, height: 800 });
    this.win = new BrowserWindow({
      ...bounds,
      minWidth: 1000,
      minHeight: 700,
      title: "GSuite Client",
      backgroundColor: "#202124",
      icon: path.join(__dirname, "assets/icons/png/1024x1024.png"),
    });

    const appMenu = createMenu(this);
    Menu.setApplicationMenu(appMenu);

    this.win.on("resized", () =>
      this.store.set("windowBounds", this.win.getBounds()),
    );
    this.win.on("moved", () =>
      this.store.set("windowBounds", this.win.getBounds()),
    );
    this.win.on("resize", () => this._layoutViews());

    this.win.on("blur", () => {
      const activeView = this.views[this.activeViewId];
      activeView?.webContents.executeJavaScript("window.blur()", true);
    });

    this.win.on("focus", () => {
      const activeView = this.views[this.activeViewId];
      activeView?.webContents.focus();
    });
  }

  _setupSecurity() {
    const session = this.win.webContents.session;

    session.setPermissionRequestHandler(
      (webContents, permission, callback, details) => {
        if (permission === "notifications") {
          const url = details.requestingUrl || webContents.getURL();
          const googleDomains = [
            "https://mail.google.com",
            "https://calendar.google.com",
            "https://chat.google.com",
            "https://aistudio.google.com",
            "https://tasks.google.com",
          ];
          const isGoogleDomain = googleDomains.some((domain) =>
            url.startsWith(domain),
          );
          return callback(isGoogleDomain);
        }

        // Allow media (camera/microphone)
        const allowedPermissions = new Set(["media"]);
        callback(allowedPermissions.has(permission));
      },
    );

    session.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      delete responseHeaders["x-frame-options"];
      delete responseHeaders["X-Frame-Options"];
      delete responseHeaders["content-security-policy"];
      delete responseHeaders["Content-Security-Policy"];
      callback({ responseHeaders });
    });
  }

  /**
   * Creates BrowserView instances for all enabled services.
   * Each view is isolated with its own preload script and security settings.
   * Handles user-agent spoofing for AI Studio compatibility.
   * @throws {Error} Critical error if preload validation fails (security)
   */
  _createViews() {
    Object.values(VIEW_CONFIG).forEach((config) => {
      try {
        // 1. Security Check
        if (!VALID_PRELOADS.has(config.preload)) {
          throw new Error(`[Security] Invalid preload: ${config.preload}`);
        }

        // 2. Skip Disabled Services
        if (config.isContent && !this.enabledServices[config.id]) {
          return;
        }

        const isContent = config.isContent;
        const webPreferences = {
          preload: path.join(__dirname, config.preload),
          contextIsolation: true,
          sandbox: isContent,
          nodeIntegration: !isContent,
          backgroundThrottling: false,
        };

        const view = new WebContentsView({ webPreferences });
        view.setBackgroundColor("#00000000");

        if (isContent) {
          this.unreadCounts[config.id] = 0;

          const originalUserAgent = view.webContents.getUserAgent();

          if (config.id === "aistudio") {
            // AI Studio requires a modern, Chrome-like User-Agent to function correctly.
            view.webContents.setUserAgent(
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            );
          } else {
            const cleanUserAgent = originalUserAgent.replace(
              /Electron\/[0-9.]+\s/,
              "",
            );
            view.webContents.setUserAgent(cleanUserAgent);
          }

          contextMenu({
            window: view,
            showInspectElement: true,
            showSaveImageAs: false,
            showCopyImageAddress: false,
            append: (defaultActions, params) => [
              {
                label: "Open in Browser",
                visible: params.linkURL || params.pageURL,
                click: () => {
                  const url = params.linkURL || params.pageURL;
                  if (url) shell.openExternal(url);
                },
              },
            ],
          });
          view.webContents.setWindowOpenHandler(({ url }) => {
            shell.openExternal(url);
            return { action: "deny" };
          });

          // Restore saved zoom level
          view.webContents.on("did-finish-load", () => {
            const savedZoom = this.zoomLevels[config.id];
            if (savedZoom !== undefined) {
              view.webContents.setZoomFactor(savedZoom);
            }
          });

          // Save zoom level changes
          view.webContents.on("zoom-changed", (event, zoomDirection) => {
            const currentZoom = view.webContents.getZoomFactor();
            const newZoom =
              zoomDirection === "in"
                ? Math.min(currentZoom + 0.1, 3.0)
                : Math.max(currentZoom - 0.1, 0.5);
            view.webContents.setZoomFactor(newZoom);
            this.zoomLevels[config.id] = newZoom;
            this.store.set("zoomLevels", this.zoomLevels);
          });
        }

        this.views[config.id] = view;
      } catch (error) {
        console.error(
          `[MainWindow] Failed to create view "${config.id}":`,
          error.message,
        );
        // Continue with other views instead of crashing
      }
    });
  }

  _attachViews() {
    Object.values(this.views).forEach((view) =>
      this.win.contentView.addChildView(view),
    );
  }

  _layoutViews() {
    if (!this.win) return;
    const bounds = this.win.getBounds();

    this.views[VIEW_CONFIG.MENU.id].setBounds({
      x: 0,
      y: 0,
      width: LAYOUT_CONSTANTS.MENU_WIDTH,
      height: bounds.height,
    });

    const contentBounds = {
      x: LAYOUT_CONSTANTS.MENU_WIDTH,
      y: 0,
      width: bounds.width - LAYOUT_CONSTANTS.MENU_WIDTH,
      height: bounds.height,
    };

    Object.values(this.views).forEach((view) => {
      if (view !== this.views.menu) {
        view.setBounds(contentBounds);
      }
    });
  }

  _loadInitialContent() {
    // Always load menu view
    this.views[VIEW_CONFIG.MENU.id].webContents.loadFile(
      path.join(__dirname, "menu.html"),
    );

    // Determine initial active tab
    let lastTabId = this.store.get("lastTab", VIEW_CONFIG.GMAIL.id);

    if (!this._getSafeView(lastTabId)) {
      const firstAvailable = Object.keys(this.views).find(
        (id) => id !== "menu",
      );
      lastTabId = firstAvailable || null;
    }

    // Load only the active view initially (lazy loading)
    if (lastTabId) {
      const targetView = this._getSafeView(lastTabId);
      if (targetView) {
        const config = Object.values(VIEW_CONFIG).find(
          (c) => c.id === lastTabId,
        );
        if (config?.url) {
          targetView.webContents.loadURL(config.url);
          this.loadedViews.add(lastTabId);
        }
        this.activeViewId = lastTabId;
        this.win.contentView.addChildView(targetView);
      }
    }

    this.views[VIEW_CONFIG.MENU.id].webContents.on("did-finish-load", () => {
      this.views[VIEW_CONFIG.MENU.id].webContents.send(
        IPC_CHANNELS.GET_ENABLED_SERVICES,
        {
          activeId: this.activeViewId,
          services: this.enabledServices,
          config: VIEW_CONFIG,
        },
      );
    });
  }

  _setupAutoUpdater() {
    autoUpdater.logger = console;
    autoUpdater.checkForUpdatesAndNotify();
  }

  _getSafeView(id) {
    if (!VALID_VIEW_IDS.has(id)) return undefined;
    return this.views[id];
  }

  _switchToTab(tabId) {
    const targetView = this._getSafeView(tabId);
    if (!targetView) return;

    // Show loading state
    this._sendToMenu(IPC_CHANNELS.SET_LOADING_STATE, {
      serviceId: tabId,
      loading: true,
    });

    // Lazy load view if not yet loaded
    if (!this.loadedViews.has(tabId)) {
      const config = Object.values(VIEW_CONFIG).find((c) => c.id === tabId);
      if (config?.url) {
        targetView.webContents.loadURL(config.url);
        this.loadedViews.add(tabId);

        // Hide loading state when view finishes loading
        targetView.webContents.once("did-finish-load", () => {
          this._sendToMenu(IPC_CHANNELS.SET_LOADING_STATE, {
            serviceId: tabId,
            loading: false,
          });
        });
      }
    } else {
      // Already loaded, hide loading state immediately
      this._sendToMenu(IPC_CHANNELS.SET_LOADING_STATE, {
        serviceId: tabId,
        loading: false,
      });
    }

    const currentView = this._getSafeView(this.activeViewId);
    if (this.activeViewId && currentView) {
      currentView.webContents.executeJavaScript("window.blur()", true);
    }

    this.store.set("lastTab", tabId);
    this.activeViewId = tabId;
    this.win.contentView.addChildView(targetView);
    targetView.webContents.focus();

    // Update menu state
    this._sendToMenu(IPC_CHANNELS.SET_ACTIVE_TAB, tabId);
  }

  _updateUnreadCount(source, count) {
    if (!VALID_VIEW_IDS.has(source)) return;
    const newCount = count ?? 0;
    if (Object.prototype.hasOwnProperty.call(this.unreadCounts, source)) {
      this.unreadCounts[source] = newCount;
    }
  }

  _sendToMenu(channel, data) {
    if (this.views.menu?.webContents) {
      this.views.menu.webContents.send(channel, data);
    }
  }

  /**
   * Registers all IPC communication handlers between renderer and main process.
   * Handles: tab switching, badge updates, notifications, favicon updates, and context menu.
   */
  _setupIpcHandlers() {
    ipcMain.on(IPC_CHANNELS.SWITCH_TAB, (event, tabId) => {
      this._switchToTab(tabId);
    });

    ipcMain.on(IPC_CHANNELS.UPDATE_BADGE, (event, { count, source }) => {
      this._updateUnreadCount(source, count);
      const total = Object.values(this.unreadCounts).reduce((a, b) => a + b, 0);
      app.setBadgeCount(total);
      this._sendToMenu(IPC_CHANNELS.UPDATE_MENU_BADGES, this.unreadCounts);
    });

    ipcMain.on(IPC_CHANNELS.UPDATE_FAVICON, (event, { source, faviconUrl }) => {
      if (!faviconUrl) return;

      if (faviconUrl.startsWith("data:")) {
        this._sendToMenu(IPC_CHANNELS.UPDATE_MENU_ICON, {
          source,
          dataUrl: faviconUrl,
        });
        return;
      }

      try {
        const request = net.request(faviconUrl);
        request.on("response", (response) => {
          if (response.statusCode !== 200) return;
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            const buffer = Buffer.concat(chunks);
            const dataUrl = `data:${response.headers["content-type"]};base64,${buffer.toString("base64")}`;
            this._sendToMenu(IPC_CHANNELS.UPDATE_MENU_ICON, {
              source,
              dataUrl,
            });
          });
        });
        request.on("error", (e) =>
          console.error(`Favicon error ${source}:`, e.message),
        );
        request.end();
      } catch (e) {
        console.error(`Favicon request failed ${source}:`, e.message);
      }
    });

    ipcMain.on(IPC_CHANNELS.SHOW_CONTEXT_MENU, () => {
      const menu = new Menu();

      menu.append(new MenuItem({ label: "Visible Services", enabled: false }));
      menu.append(new MenuItem({ type: "separator" }));

      Object.values(VIEW_CONFIG)
        .filter((c) => c.isContent)
        .forEach((config) => {
          menu.append(
            new MenuItem({
              label: config.title,
              type: "checkbox",
              checked: this.enabledServices[config.id],
              click: () => {
                this.enabledServices[config.id] =
                  !this.enabledServices[config.id];
                this.store.set("services", this.enabledServices);
                app.relaunch();
                app.exit(0);
              },
            }),
          );
        });

      menu.append(new MenuItem({ type: "separator" }));

      menu.popup({ window: this.win });
    });
  }
}

let mainWindow;

app.whenReady().then(() => {
  if (process.platform === "darwin") app.setName(packageJson.build.productName);
  mainWindow = new MainWindow();
  mainWindow.create();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = new MainWindow();
    mainWindow.create();
  }
});
