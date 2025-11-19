import {
  app,
  BrowserWindow,
  BrowserView,
  ipcMain,
  shell,
  Notification,
  net,
  Menu,
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
  SHOW_NOTIFICATION: "show-notification",
  SET_ACTIVE_TAB: "set-active-tab",
  UPDATE_MENU_BADGES: "update-menu-badges",
  UPDATE_FAVICON: "update-favicon",
  UPDATE_MENU_ICON: "update-menu-icon",
};

const VIEW_CONFIG = {
  MENU: { id: "menu", width: 80, preload: "preload.js", isContent: false },
  CHAT: {
    id: "chat",
    url: "https://mail.google.com/chat/u/0/#chat/home",
    preload: "preload-web.js",
    isContent: true,
  },
  GMAIL: {
    id: "gmail",
    url: "https://mail.google.com/mail/u/0/",
    preload: "preload-web.js",
    isContent: true,
  },
  DRIVE: {
    id: "drive",
    url: "https://drive.google.com/drive/u/0/my-drive",
    preload: "preload-web.js",
    isContent: true,
  },
  CALENDAR: {
    id: "calendar",
    url: "https://calendar.google.com/calendar/u/0/r",
    preload: "preload-web.js",
    isContent: true,
  },
};

const VALID_VIEW_IDS = new Set(
  Object.values(VIEW_CONFIG)
    .filter((c) => c.isContent)
    .map((c) => c.id),
);
const VALID_PRELOADS = new Set(
  Object.values(VIEW_CONFIG).map((c) => c.preload),
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "package.json"), "utf8"),
);

class MainWindow {
  constructor() {
    this.store = new Store();
    this.win = null;
    this.views = {};
    this.activeViewId = null;
    this.unreadCounts = { chat: 0, gmail: 0, drive: 0, calendar: 0 };
    this.activeNotifications = new Set();
  }

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
      icon: path.join(__dirname, "assets/icons/png/256x256.png"),
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

    // 1. Permission Handler
    session.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowedPermissions = new Set(["media", "notifications"]);
      callback(allowedPermissions.has(permission));
    });

    // 2. Header Stripping (Security Trade-off for Functionality)
    session.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      // Remove X-Frame-Options to allow embedding
      delete responseHeaders["x-frame-options"];
      delete responseHeaders["X-Frame-Options"];
      // Remove CSP to allow script injection (Required for Notifications)
      delete responseHeaders["content-security-policy"];
      delete responseHeaders["Content-Security-Policy"];
      callback({ responseHeaders });
    });
  }

  _createViews() {
    Object.values(VIEW_CONFIG).forEach((config) => {
      if (!VALID_PRELOADS.has(config.preload)) {
        throw new Error(`[Security] Invalid preload: ${config.preload}`);
      }

      const isContent = config.isContent;
      const webPreferences = {
        preload: path.join(__dirname, config.preload),
        contextIsolation: true,
        sandbox: isContent,
        nodeIntegration: !isContent,
        backgroundThrottling: false, // Prevent background tabs from freezing
      };

      const view = new BrowserView({ webPreferences });

      if (isContent) {
        contextMenu({
          window: view,
          showInspectElement: true,
          showSaveImageAs: false,
          showCopyImageAddress: false,
        });
        view.webContents.setWindowOpenHandler(({ url }) => {
          shell.openExternal(url);
          return { action: "deny" };
        });
      }

      this.views[config.id] = view;
    });
  }

  _attachViews() {
    Object.values(this.views).forEach((view) => this.win.addBrowserView(view));
  }

  _layoutViews() {
    if (!this.win) return;
    const bounds = this.win.getBounds();
    const menuConfig = VIEW_CONFIG.MENU;

    // Menu View
    this.views[menuConfig.id].setBounds({
      x: 0,
      y: 0,
      width: menuConfig.width,
      height: bounds.height,
    });
    this.views[menuConfig.id].setAutoResize({ height: true });

    // Content Views
    const contentBounds = {
      x: menuConfig.width,
      y: 0,
      width: bounds.width - menuConfig.width,
      height: bounds.height,
    };

    Object.values(VIEW_CONFIG)
      .filter((c) => c.isContent)
      .forEach((config) => {
        this.views[config.id].setBounds(contentBounds);
        this.views[config.id].setAutoResize({ width: true, height: true });
      });
  }

  _loadInitialContent() {
    this.views[VIEW_CONFIG.MENU.id].webContents.loadFile(
      path.join(__dirname, "menu.html"),
    );
    Object.values(VIEW_CONFIG)
      .filter((c) => c.isContent)
      .forEach((config) => {
        this.views[config.id].webContents.loadURL(config.url);
      });

    let lastTabId = this.store.get("lastTab", VIEW_CONFIG.CHAT.id);
    if (!VALID_VIEW_IDS.has(lastTabId)) lastTabId = VIEW_CONFIG.CHAT.id;

    const targetView = this._getSafeView(lastTabId);
    if (targetView) {
      this.activeViewId = lastTabId;
      this.win.setTopBrowserView(targetView);
    }

    this.views[VIEW_CONFIG.MENU.id].webContents.on("did-finish-load", () => {
      this.views[VIEW_CONFIG.MENU.id].webContents.send(
        IPC_CHANNELS.SET_ACTIVE_TAB,
        lastTabId,
      );
    });
  }

  _setupAutoUpdater() {
    autoUpdater.logger = console;
    autoUpdater.checkForUpdatesAndNotify();
  }

  _getSafeView(id) {
    switch (id) {
      case "chat":
        return this.views.chat;
      case "gmail":
        return this.views.gmail;
      case "drive":
        return this.views.drive;
      case "calendar":
        return this.views.calendar;
      default:
        return undefined;
    }
  }

  _updateUnreadCount(source, count) {
    const newCount = count ?? 0;
    this.unreadCounts[source] = newCount; // Safe due to Valid ID check upstream
  }

  _setupIpcHandlers() {
    ipcMain.on(IPC_CHANNELS.SWITCH_TAB, (event, tabId) => {
      if (!VALID_VIEW_IDS.has(tabId)) return;

      const targetView = this._getSafeView(tabId);

      if (this.activeViewId) {
        const currentView = this._getSafeView(this.activeViewId);
        currentView?.webContents.executeJavaScript("window.blur()", true);
      }

      if (targetView) {
        this.store.set("lastTab", tabId);
        this.activeViewId = tabId;
        this.win.setTopBrowserView(targetView);
        targetView.webContents.focus();
      }
    });

    ipcMain.on(IPC_CHANNELS.UPDATE_BADGE, (event, { count, source }) => {
      if (!VALID_VIEW_IDS.has(source)) return;

      this._updateUnreadCount(source, count);

      const total = Object.values(this.unreadCounts).reduce((a, b) => a + b, 0);
      app.setBadgeCount(total);
      if (this.views.menu) {
        this.views.menu.webContents.send(
          IPC_CHANNELS.UPDATE_MENU_BADGES,
          this.unreadCounts,
        );
      }
    });

    ipcMain.on(IPC_CHANNELS.SHOW_NOTIFICATION, (event, { title, body }) => {
      if (Notification.isSupported()) {
        const notification = new Notification({
          title: title || "GSuite Client",
          body: body || "New notification",
          icon: path.join(__dirname, "assets/icon.png"),
          silent: true,
        });

        this.activeNotifications.add(notification);
        notification.on("close", () =>
          this.activeNotifications.delete(notification),
        );
        notification.on("click", () => {
          this.win?.focus();
          this.activeNotifications.delete(notification);
        });

        notification.show();
      }
    });

    ipcMain.on(IPC_CHANNELS.UPDATE_FAVICON, (event, { source, faviconUrl }) => {
      if (!faviconUrl) return;

      // CASE 1: Already Data URL - Proxy directly
      if (faviconUrl.startsWith("data:")) {
        this.views.menu?.webContents.send(IPC_CHANNELS.UPDATE_MENU_ICON, {
          source,
          dataUrl: faviconUrl,
        });
        return;
      }

      // CASE 2: Remote URL - Fetch via Net
      try {
        const request = net.request(faviconUrl);
        request.on("response", (response) => {
          if (response.statusCode !== 200) return;
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            const buffer = Buffer.concat(chunks);
            const dataUrl = `data:${response.headers["content-type"]};base64,${buffer.toString("base64")}`;
            if (this.views.menu) {
              this.views.menu.webContents.send(IPC_CHANNELS.UPDATE_MENU_ICON, {
                source,
                dataUrl,
              });
            }
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
  }
}

// --- Lifecycle ---
let mainWindow;

app.whenReady().then(() => {
  if (process.platform === "darwin") app.setName(packageJson.build.productName);
  mainWindow = new MainWindow();
  mainWindow.create();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = new MainWindow();
    mainWindow.create();
  }
});
