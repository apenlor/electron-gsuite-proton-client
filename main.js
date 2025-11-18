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
import { createMenu } from "./menu.js";
import { fileURLToPath } from "url";
import Store from "electron-store";
import pkg from "electron-updater";
const { autoUpdater } = pkg;
import contextMenu from "electron-context-menu";

// --- Constants & Configuration ---
const IPC_CHANNELS = {
  SWITCH_TAB: "switch-tab",
  UPDATE_BADGE: "update-badge",
  SHOW_NOTIFICATION: "show-notification",
  SET_ACTIVE_TAB: "set-active-tab",
  UPDATE_MENU_BADGES: "update-menu-badges",
  UPDATE_FAVICON: "update-favicon", // For dynamic icons
  UPDATE_MENU_ICON: "update-menu-icon", // For dynamic icons
};

const VIEW_CONFIG = {
  MENU: {
    id: "menu",
    width: 70,
    preload: "preload.js",
    isContent: false,
  },
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

const VALID_VIEW_IDS = new Set(Object.values(VIEW_CONFIG).filter(c => c.isContent).map(c => c.id));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MainWindow {
  constructor() {
    this.store = new Store();
    this.win = null;
    this.views = {};
    this.activeViewId = null;
    this.unreadCounts = {
      [VIEW_CONFIG.CHAT.id]: 0,
      [VIEW_CONFIG.GMAIL.id]: 0,
    };
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
      title: "Google Suite",
      backgroundColor: "#202124",
      icon: path.join(__dirname, "assets/icon.png"),
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
  }

  _setupSecurity() {
    // The only security setup needed here is the permission handler.
    const session = this.win.webContents.session;
    session.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowedPermissions = new Set(["media"]);
      if (allowedPermissions.has(permission)) {
        callback(true);
      } else {
        callback(false);
      }
    });
  }

  _createViews() {
    Object.values(VIEW_CONFIG).forEach((config) => {
      const webPreferences = {
        preload: path.join(__dirname, config.preload),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      };

      const view = new BrowserView({ webPreferences });

      if (config.isContent) {
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

    // Layout Menu View
    this.views[menuConfig.id].setBounds({
      x: 0,
      y: 0,
      width: menuConfig.width,
      height: bounds.height,
    });
    this.views[menuConfig.id].setAutoResize({ height: true });

    // Layout Content Views
    Object.values(VIEW_CONFIG)
      .filter((c) => c.isContent)
      .forEach((config) => {
        this.views[config.id].setBounds({
          x: menuConfig.width,
          y: 0,
          width: bounds.width - menuConfig.width,
          height: bounds.height,
        });
        this.views[config.id].setAutoResize({ width: true, height: true });
      });
  }

  _loadInitialContent() {
    // Load the menu file
    this.views[VIEW_CONFIG.MENU.id].webContents.loadFile(
      path.join(__dirname, "menu.html"),
    );

    // Load URL for ALL content views defined in the config
    Object.values(VIEW_CONFIG)
      .filter((c) => c.isContent)
      .forEach((config) => {
        this.views[config.id].webContents.loadURL(config.url);
      });

    const lastTabId = this.store.get("lastTab", VIEW_CONFIG.CHAT.id);
    if (!VALID_VIEW_IDS.has(lastTabId)) {
        lastTabId = VIEW_CONFIG.CHAT.id;
    }
    this.activeViewId = lastTabId;
    this.win.setTopBrowserView(this.views[lastTabId]);

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

  _setupIpcHandlers() {
    ipcMain.on(IPC_CHANNELS.SWITCH_TAB, (event, tabId) => {
      if (!VALID_VIEW_IDS.has(tabId)) {
          console.warn(`[Security] Ignored invalid tabId from IPC: ${tabId}`);
          return;
      }
      this.store.set("lastTab", tabId);
      this.activeViewId = tabId;
      if (this.win && this.views[tabId]) {
        this.win.setTopBrowserView(this.views[tabId]);
      }
    });

    ipcMain.on(IPC_CHANNELS.UPDATE_BADGE, (event, { count, source }) => {
      if (!VALID_VIEW_IDS.has(source)) {
          console.warn(`[Security] Ignored invalid source from IPC: ${source}`);
          return;
      }
      this.unreadCounts[source] = count ?? 0;
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
          title,
          body,
          icon: path.join(__dirname, "assets/icon.png"),
        });
        notification.on("click", () => this.win?.focus());
        notification.show();
      }
    });

    ipcMain.on(IPC_CHANNELS.UPDATE_FAVICON, (event, { source, faviconUrl }) => {
      if (!faviconUrl) return;
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
      request.end();
    });
  }
}

// --- Application Lifecycle ---
let mainWindow;

app.whenReady().then(() => {
  mainWindow = new MainWindow();
  mainWindow.create();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = new MainWindow();
    mainWindow.create();
  }
});
