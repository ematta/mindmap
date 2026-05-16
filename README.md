# MindMap

A lightweight, zero-dependency vanilla HTML5 SPA for brainstorming with multiple idea boards. All data is stored client-side in IndexedDB — no server, no signup, no tracking.

## Quick Start

### Local Development

Serve `web/` with any static file server. No build step required.

```bash
# Python
python3 -m http.server 8080 --directory web

# Node (npx)
npx serve web -p 8080

# PHP
php -S localhost:8080 -t web
```

Open `http://localhost:8080` in a browser.

### Docker

```bash
docker compose up --build
# → http://localhost:8080
```

The container runs nginx on port 8080 serving the static assets with gzip, security headers, and caching (see `nginx.conf`).

## Features

- **Multiple boards** — Create, rename, switch between, and delete boards. Each board has its own isolated notes, connections, and viewport.
- **Shareable links** — Share a board via URL (base64-encoded state in the URL hash). Recipients get it added as a new board.
- **Pannable/zoomable canvas** — Drag to pan, scroll to zoom. Viewport is saved per board in IndexedDB.
- **Resizable cards** — Drag the bottom-right corner handle. Minimum 120×80px.
- **Connections** — Link ideas with directional arrows. Right-click a line to delete it.
- **Dark mode** — System, light, or dark theme (persisted in localStorage).
- **Import/Export** — Save/load boards as JSON files.

## Project Structure

```
├── web/
│   ├── index.html       # Entry page — toolbar, context menus, board panel, canvas
│   ├── app.js           # All application logic (~1900 lines, single IIFE)
│   └── style.css        # Styles — light/dark themes via [data-theme] attribute
├── Dockerfile           # Production build: nginx:alpine, non-root, port 8080
├── docker-compose.yml   # Compose wrapper for the Dockerfile
├── nginx.conf           # Nginx config: gzip, cache headers, SPA fallback, healthcheck
├── AGENTS.md            # AI agent instructions (architecture, conventions, features)
└── README.md            # This file
```

## Architecture

### Single-IIFE Pattern

`app.js` wraps everything in an IIFE with `"use strict"` and uses `var` throughout for broad browser compatibility. There are no modules, no bundler, and no external dependencies.

All state lives in closure-scoped variables at the top of the IIFE. There is one global `<canvas>` element; all notes, connections, and the grid are drawn via the 2D canvas API on every `render()` call (immediate-mode rendering).

### Data Model

| Store | Key | Key Fields | Indexed By |
|-------|-----|------------|------------|
| `notes` | `id` | `x`, `y`, `w`, `h`, `header`, `text`, `color`, `boardId` | `boardId` |
| `connections` | `id` (`"fromId->toId"`) | `from`, `to`, `boardId` | `boardId` |
| `viewport` | board ID | `panX`, `panY`, `zoomLevel` | — |
| `boards` | `id` | `name`, `createdAt`, `updatedAt` | — |

IndexedDB database: `mindmapdb`, version `5`. The `onupgradeneeded` handler migrates older schemas (adds `w`/`h` defaults, `boardId` index, seed board).

### Rendering Pipeline

1. `render()` clears the canvas, applies `dpr` scaling via `setTransform`
2. Translates by `panX`/`panY` and scales by `zoomLevel`
3. Draws the dot grid → connections (arrows) → notes (cards)
4. Notes are drawn in array order (last = top); `bringToFront()` reorders on click

### Coordinate System

- **Screen coords**: CSS pixel position from the mouse event, relative to the canvas
- **World coords**: `(screenX - panX) / zoomLevel`, `(screenY - panY) / zoomLevel`

All note positions and sizes are stored in world coordinates. The canvas transform handles the mapping.

### Interaction State Machine

The app uses flat state objects (not a formal state machine) to track which interaction mode is active:

| State Variable | Purpose |
|----------------|---------|
| `drag` | Note dragging (mousedown on card body) |
| `resize` | Note resizing (mousedown on corner handle) |
| `pan` | Canvas panning (mousedown on empty space) |
| `editState` | Text body editing (textarea overlay) |
| `headerEditState` | Header/title editing (input overlay) |
| `connectState` | Connection creation mode (click source → click target) |
| `contextMenuState` | Which note the context menu is open on |
| `connectionMenuState` | Which connection the context menu is open on |

These are mutually exclusive in practice — mousedown handlers check them in priority order.

### Theme System

- `localStorage` key `mindmap-theme` stores `"system"`, `"light"`, or `"dark"`
- `applyTheme()` resolves the effective mode and sets `data-theme` on `<html>`
- Canvas colors come from `THEME_COLORS` (light/dark objects), not CSS
- CSS uses `[data-theme="dark"]` selectors for HTML elements (menus, panels, modals)

### Share / Import / Export

- **Share**: Base64-encodes `{ boardName, notes, connections, viewport }` into the URL hash. Limited to ~65KB.
- **Export**: Downloads the same structure as a `.json` file.
- **Import**: Reads a `.json` file, creates a new board, and persists all data to IndexedDB.

Both import and share create a new board rather than overwriting the current one.

## Key Functions Reference

### Database Helpers (`app.js:297–364`)

- `dbGetAll(store)` / `dbGet(store, id)` / `dbPut(store, item)` / `dbDelete(store, id)` — Promise-wrapped IndexedDB CRUD
- `dbGetByIndex(store, index, value)` — Query by secondary index (used for board-scoped data)
- `dbClearByIndex(store, index, value)` — Delete all records matching an index value

### Board Management (`app.js:414–491`)

- `createBoard(name?)` — New board with random adjective+noun name, persists to IndexedDB
- `deleteBoardAndData(boardId)` — Removes board + all its notes, connections, and viewport
- `switchToBoard(boardId)` — Saves current viewport, loads new board data, re-renders
- `loadBoardData(boardId)` — Loads notes/connections for a board, resets `COLOR_CYCLE`

### Rendering (`app.js:525–757`)

- `render()` — Full canvas redraw (grid → connections → notes)
- `drawNote(note, idx)` — Draws a single card with shadow, header, body text, close button, and resize handle
- `drawArrow(fromNote, toNote)` — Draws a directional arrow between two note edges
- `drawDotGrid()` — Draws the background dot grid within the visible viewport
- `getEdgePoint(note, targetX, targetY)` — Calculates the intersection of a ray from note center to target with the note's bounding rectangle

### Input Handling (`app.js:869–1015`)

- `showInput(noteIdx)` / `hideInput()` / `commitInput(idx)` — Body text editing via a floating `<textarea>`
- `showHeaderInput(noteIdx)` / `hideHeaderInput()` / `commitHeaderInput(idx)` — Header editing via a floating `<input>`
- `getMousePos(e)` — Converts mouse event to world coordinates

### Hit Testing (`app.js:801–846`)

- `hitTest(mx, my)` — Returns the index of the topmost note at world coords, or `-1`
- `hitTestConnection(mx, my)` — Returns the index of the nearest connection within 8px threshold
- `isCloseBtn(mx, my, note)` / `isHeaderArea(mx, my, note)` / `isResizeHandle(mx, my, note)` — Region checks within a note

## Development Conventions

- **No build tools** — vanilla HTML/CSS/JS only. Open `index.html` in a browser or use any static server.
- **No frameworks** — no React, Vue, etc. Direct DOM manipulation and Canvas 2D API.
- **`var` everywhere** — for IE11-class compatibility (no `let`/`const`).
- **No ES modules** — single IIFE closure, no `import`/`export`.
- **IndexedDB via promises** — all DB operations return Promises for async/await compatibility.
- **Keep docs current** — update `README.md` and `AGENTS.md` when adding features or changing architecture.

## Keyboard & Mouse Reference

| Action | Input |
|--------|-------|
| Add idea | Double-click canvas, or toolbar "+ Add Idea", or right-click → "Add Idea" |
| Edit body | Double-click a note |
| Edit header | Single-click the header area (top 28px) |
| Drag note | Click and drag the card body |
| Resize note | Drag the bottom-right corner triangle |
| Delete note | Click the × button, or right-click → "Delete Idea" |
| Connect notes | Right-click → "Connect To..." then click the target note |
| Delete connection | Right-click on a connection line → "Delete Connection" |
| Pan canvas | Click and drag empty space |
| Zoom | Mouse scroll wheel, or toolbar +/− buttons |
| Connect mode cancel | Press `Escape` |

## Browser Support

Targets evergreen browsers with Canvas 2D, IndexedDB, and ES5 support. Uses `fetch`/`clipboard` APIs with fallbacks.

## License

Private project.
