import { Menu, shell, app } from "electron";

/**
 * Creates and returns the application menu template.
 * This version is designed to be dynamically aware of the active view by
 * accepting the main window instance.
 * @param {object} mainWindow - The instance of the MainWindow class from main.js.
 * @returns {Electron.Menu} The configured application menu.
 */
export function createMenu(mainWindow) {
  const isMac = process.platform === "darwin";

  const template = [
    // { role: 'appMenu' } for macOS
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    // { role: 'fileMenu' }
    {
      label: "File",
      submenu: [isMac ? { role: "close" } : { role: "quit" }],
    },
    // { role: 'editMenu' }
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    // { role: 'viewMenu' }
    {
      label: "View",
      submenu: [
        // --- CUSTOM HANDLERS FOR VIEW-SPECIFIC ACTIONS ---
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            const activeView = mainWindow?.views[mainWindow.activeViewId];
            if (activeView) {
              activeView.webContents.reload();
            }
          },
        },
        {
          label: "Force Reload",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => {
            const activeView = mainWindow?.views[mainWindow.activeViewId];
            if (activeView) {
              activeView.webContents.reloadIgnoringCache();
            }
          },
        },
        {
          label: "Toggle Developer Tools",
          accelerator: isMac ? "Alt+Command+I" : "Ctrl+Shift+I",
          click: () => {
            const activeView = mainWindow?.views[mainWindow.activeViewId];
            if (activeView) {
              activeView.webContents.toggleDevTools();
            }
          },
        },
        { type: "separator" },
        {
          label: "Gmail",
          accelerator: "CmdOrCtrl+1",
          click: () => mainWindow?._switchToTab("gmail"),
        },
        {
          label: "Google Chat",
          accelerator: "CmdOrCtrl+2",
          click: () => mainWindow?._switchToTab("chat"),
        },
        {
          label: "AI Studio",
          accelerator: "CmdOrCtrl+3",
          click: () => mainWindow?._switchToTab("aistudio"),
        },
        {
          label: "Google Tasks",
          accelerator: "CmdOrCtrl+4",
          click: () => mainWindow?._switchToTab("tasks"),
        },
        {
          label: "Google Drive",
          accelerator: "CmdOrCtrl+5",
          click: () => mainWindow?._switchToTab("drive"),
        },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    // { role: 'windowMenu' }
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [{ type: "separator" }, { role: "front" }]
          : [{ role: "close" }]),
      ],
    },
    {
      role: "help",
      submenu: [
        {
          label: "View Project on GitHub",
          click: async () => {
            await shell.openExternal(
              "https://github.com/apenlor/electron-gsuite-client",
            );
          },
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
