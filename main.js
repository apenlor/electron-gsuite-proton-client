import {
  app,
  BrowserWindow,
  BrowserView,
  ipcMain,
  shell,
  Notification,
} from "electron";
import path from "path";
import { fileURLToPath } from "url";
import Store from "electron-store";
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
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MainWindow {
  constructor() {
    this.store = new Store();
    this.win = null;
    this.views = {};
    this.unreadCounts = {
      [VIEW_CONFIG.CHAT.id]: 0,
      [VIEW_CONFIG.GMAIL.id]: 0,
    };
  }

  create() {
    this._createWindow();
    this._createViews();
    this._attachViews();
    this._layoutViews();
    this._setupIpcHandlers();
    this._loadInitialContent();
  }

  _createWindow() {
    const bounds = this.store.get("windowBounds", { width: 1200, height: 800 });

    this.win = new BrowserWindow({
      ...bounds,
      minWidth: 1000,
      minHeight: 700,
      autoHideMenuBar: true,
      title: "Google Suite",
      backgroundColor: "#202124",
      icon: path.join(__dirname, "assets/icon.png"),
    });

    this.win.on("resized", () =>
      this.store.set("windowBounds", this.win.getBounds()),
    );
    this.win.on("moved", () =>
      this.store.set("windowBounds", this.win.getBounds()),
    );
    this.win.on("resize", () => this._layoutViews());
  }

  _createViews() {
    Object.values(VIEW_CONFIG).forEach((config) => {
      const view = new BrowserView({
        webPreferences: { preload: path.join(__dirname, config.preload) },
      });

      if (config.isContent) {
        contextMenu({ window: view, showInspectElement: true });
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
    this.views[VIEW_CONFIG.MENU.id].webContents.loadFile(
      path.join(__dirname, "menu.html"),
    );
    this.views[VIEW_CONFIG.CHAT.id].webContents.loadURL(VIEW_CONFIG.CHAT.url);
    this.views[VIEW_CONFIG.GMAIL.id].webContents.loadURL(VIEW_CONFIG.GMAIL.url);

    const lastTabId = this.store.get("lastTab", VIEW_CONFIG.CHAT.id);
    this.win.setTopBrowserView(this.views[lastTabId]);

    this.views[VIEW_CONFIG.MENU.id].webContents.on("did-finish-load", () => {
      this.views[VIEW_CONFIG.MENU.id].webContents.send(
        IPC_CHANNELS.SET_ACTIVE_TAB,
        lastTabId,
      );
    });
  }

  _setupIpcHandlers() {
    ipcMain.on(IPC_CHANNELS.SWITCH_TAB, (event, tabId) => {
      this.store.set("lastTab", tabId);
      if (this.win && this.views[tabId]) {
        this.win.setTopBrowserView(this.views[tabId]);
      }
    });

    ipcMain.on(IPC_CHANNELS.UPDATE_BADGE, (event, { count, source }) => {
      this.unreadCounts[source] = count;
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
