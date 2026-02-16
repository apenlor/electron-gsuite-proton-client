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
            const activeView = mainWindow?.views.get(mainWindow.activeViewId);
            if (activeView) {
              activeView.webContents.reload();
            }
          },
        },
        {
          label: "Force Reload",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => {
            const activeView = mainWindow?.views.get(mainWindow.activeViewId);
            if (activeView) {
              activeView.webContents.reloadIgnoringCache();
            }
          },
        },
        {
          label: "Toggle Developer Tools",
          accelerator: isMac ? "Alt+Command+I" : "Ctrl+Shift+I",
          click: () => {
            const activeView = mainWindow?.views.get(mainWindow.activeViewId);
            if (activeView) {
              activeView.webContents.toggleDevTools();
            }
          },
        },
        { type: "separator" },
        // --- DYNAMIC SERVICE SHORTCUTS ---
        ...(() => {
          // Get all content views in the order they appear in the UI
          const services = Object.values(
            mainWindow?.constructor.VIEW_CONFIG || {},
          )
            .filter((c) => c.isContent && mainWindow?.enabledServices[c.id])
            .sort((a, b) => {
              // Ensure Proton Mail is always last if present
              if (a.id === "protonmail") return 1;
              if (b.id === "protonmail") return -1;
              return 0; // Maintain VIEW_CONFIG order for others
            });

          return services.map((service, index) => ({
            label: service.title,
            accelerator: `CmdOrCtrl+${index + 1}`,
            click: () => mainWindow?._switchToTab(service.id),
          }));
        })(),
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
