import {
  app,
  BrowserWindow,
  BrowserView,
  ipcMain,
  shell,
  Notification,
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
  SHOW_NOTIFICATION: "show-notification",
  SET_ACTIVE_TAB: "set-active-tab",
  UPDATE_MENU_BADGES: "update-menu-badges",
  UPDATE_FAVICON: "update-favicon",
  UPDATE_MENU_ICON: "update-menu-icon",
  SHOW_CONTEXT_MENU: "show-context-menu",
  GET_ENABLED_SERVICES: "get-enabled-services",
};

// Enhanced Config: Reordered for UX (Gmail -> Chat -> Drive)
const VIEW_CONFIG = {
  MENU: { id: "menu", width: 80, preload: "preload.js", isContent: false },
  GMAIL: {
    id: "gmail",
    title: "Gmail",
    icon: "assets/default/gmail.png",
    url: "https://mail.google.com/mail/u/0/",
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
};

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
    this.unreadCounts = {};
    this.activeNotifications = new Set();

    // Load persistence state (Default: all enabled)
    this.enabledServices = this.store.get("services", {
      chat: true,
      gmail: true,
      drive: true,
    });
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

    session.setPermissionRequestHandler((webContents, permission, callback) => {
      // Deny notifications to avoid duplicates (handled via IPC)
      const allowedPermissions = new Set(["media"]);
      callback(allowedPermissions.has(permission));
    });

    session.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      delete responseHeaders["x-frame-options"];
      delete responseHeaders["X-Frame-Options"];
      delete responseHeaders["content-security-policy"];
      delete responseHeaders["Content-Security-Policy"];
      callback({ responseHeaders });
    });
  }

  _createViews() {
    Object.values(VIEW_CONFIG).forEach((config) => {
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

      const view = new BrowserView({ webPreferences });

      if (isContent) {
        this.unreadCounts[config.id] = 0;

        const originalUserAgent = view.webContents.getUserAgent();
        const cleanUserAgent = originalUserAgent.replace(
          /Electron\/[0-9.]+\s/,
          "",
        );
        view.webContents.setUserAgent(cleanUserAgent);

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

    this.views[menuConfig.id].setBounds({
      x: 0,
      y: 0,
      width: menuConfig.width,
      height: bounds.height,
    });
    this.views[menuConfig.id].setAutoResize({ height: true });

    const contentBounds = {
      x: menuConfig.width,
      y: 0,
      width: bounds.width - menuConfig.width,
      height: bounds.height,
    };

    Object.values(this.views).forEach((view) => {
      if (view !== this.views.menu) {
        view.setBounds(contentBounds);
        view.setAutoResize({ width: true, height: true });
      }
    });
  }

  _loadInitialContent() {
    this.views[VIEW_CONFIG.MENU.id].webContents.loadFile(
      path.join(__dirname, "menu.html"),
    );

    Object.values(VIEW_CONFIG)
      .filter((c) => c.isContent && this.views[c.id])
      .forEach((config) => {
        this.views[config.id].webContents.loadURL(config.url);
      });

    let lastTabId = this.store.get("lastTab", VIEW_CONFIG.GMAIL.id);

    if (!this.views[lastTabId]) {
      const firstAvailable = Object.keys(this.views).find(
        (id) => id !== "menu",
      );
      lastTabId = firstAvailable || null;
    }

    if (lastTabId && this.views[lastTabId]) {
      this.activeViewId = lastTabId;
      this.win.setTopBrowserView(this.views[lastTabId]);
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
    return this.views[id];
  }

  _updateUnreadCount(source, count) {
    if (Object.prototype.hasOwnProperty.call(this.unreadCounts, source)) {
      this.unreadCounts[source] = count ?? 0;
    }
  }

  _setupIpcHandlers() {
    ipcMain.on(IPC_CHANNELS.SWITCH_TAB, (event, tabId) => {
      const targetView = this.views[tabId];
      if (!targetView) return;

      if (this.activeViewId && this.views[this.activeViewId]) {
        this.views[this.activeViewId].webContents.executeJavaScript(
          "window.blur()",
          true,
        );
      }

      this.store.set("lastTab", tabId);
      this.activeViewId = tabId;
      this.win.setTopBrowserView(targetView);
      targetView.webContents.focus();
    });

    ipcMain.on(IPC_CHANNELS.UPDATE_BADGE, (event, { count, source }) => {
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
      if (!faviconUrl || !this.views.menu) return;

      if (faviconUrl.startsWith("data:")) {
        this.views.menu.webContents.send(IPC_CHANNELS.UPDATE_MENU_ICON, {
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
            this.views.menu.webContents.send(IPC_CHANNELS.UPDATE_MENU_ICON, {
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

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = new MainWindow();
    mainWindow.create();
  }
});
