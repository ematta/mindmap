# MindMap

A lightweight vanilla HTML5 SPA for brainstorming with multiple idea boards.

## Features

- **Multiple boards** — Create, rename, switch between, and delete boards. Each board has its own isolated notes, connections, and viewport.
- **Shareable links** — Share a board via URL. Recipients get it added as a new board in their list.
- **Pannable/zoomable canvas** — Drag to pan, scroll to zoom. Viewport is saved per board.
- **Resizable cards** — Drag the corner handle. Minimum 120x80px.
- **Connections** — Link ideas with arrows. Right-click to delete.
- **Dark mode** — System, light, or dark theme.
- **Import/Export** — Save/load boards as JSON.

## Architecture

```
├── web/                 # SPA static assets
│   ├── index.html       # Entry page
│   ├── app.js           # Application logic (IndexedDB, canvas rendering, board management)
│   └── style.css        # Styles (light + dark themes)
```
