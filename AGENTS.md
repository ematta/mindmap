# AGENTS.md

## Project Structure

```
├── web/
│   ├── index.html   # SPA entry — toolbar, menus, board panel, canvas element
│   ├── app.js       # All logic in a single IIFE (~2400 lines, no modules)
│   └── style.css    # Light/dark themes via [data-theme] attribute selectors
├── Dockerfile        # Production: nginx:alpine, non-root, port 8080
├── docker-compose.yml
├── nginx.conf        # Gzip, cache headers, SPA fallback, healthcheck
└── README.md         # Developer docs: architecture, data model, API reference
```

## Features

- **Multi-board support**: Create, rename, switch between, and delete multiple idea boards. Each board has its own isolated notes, connections, and viewport. Boards are listed in a slide-out panel accessible from the toolbar. Board names default to a random adjective+noun pair if not named. The current board is persisted in localStorage and restored on reload. IndexedDB uses a `boards` object store and a `boardId` index on notes/connections for per-board data isolation.
- **Resizable cards**: Drag the bottom-right corner handle to resize notes. Minimum size is 120x80px. Sizes persist in IndexedDB and are included in JSON export/import.
- **Deletable connections**: Right-click on a connection line to delete it. Connections show a pointer cursor on hover.
- **Drag-to-connect via edge handles**: Hover over a card to reveal 4 edge handles (small dots at cardinal bounding-box midpoints). Drag from any handle to another card to create a connection. A dashed preview arrow follows the cursor during drag. Connections are created with duplicate and self-connection checks. The existing right-click "Connect To..." method remains available.
- **High-contrast connection lines**: Connection arrows use a 3px width with adaptive contrast colors — near-black (`#222`) on light backgrounds and white (`#ffffff`) on dark backgrounds.
- **Share via link**: Right-click canvas → "Share Link" encodes the board state (board name, notes, connections, and viewport position/zoom) as base64 in the URL hash and copies the link to clipboard. Opening a shared link adds it as a new board to the recipient's board list (with confirmation). Works entirely client-side with no backend. Limited to ~65KB.
- **Pannable/zoomable canvas**: Left-click and drag on empty canvas to pan around. Scroll to zoom (centered on cursor). Pan position and zoom level persist per board in IndexedDB (via `viewport` object store keyed by boardId) and are included in JSON export/import and shared links.
- **Dark mode**: System/light/dark theme toggle persisted in localStorage. Canvas colors use `THEME_COLORS` object; HTML elements use `[data-theme="dark"]` CSS selectors.
- **Import/Export**: Download board as JSON or import a JSON file as a new board.
- **Note shapes**: Right-click a note → "Shape" submenu to change between rectangle (default), circle, pentagon, and star. Shape is stored per-note in the `shape` field, persisted in IndexedDB, and included in JSON export/import and shared links. Connection arrows attach to the actual shape boundary (ellipse for circles, polygon edges for pentagon/star). Hit testing uses shape-accurate collision (ellipse math for circles, point-in-polygon for pentagon/star).

## Architecture

### Single-IIFE Pattern

`app.js` wraps everything in an IIFE with `"use strict"`. Uses `var` throughout (no `let`/`const`). No modules, no bundler, no external dependencies.

All state lives in closure-scoped variables. The single `<canvas>` element uses immediate-mode rendering — `render()` redraws everything on each state change.

### Data Model (IndexedDB: `mindmapdb`, version 5)

| Store | Key | Key Fields | Indexed By |
|-------|-----|------------|------------|
| `notes` | `id` | `x`, `y`, `w`, `h`, `header`, `text`, `color`, `shape`, `boardId` | `boardId` |
| `connections` | `id` (`"fromId->toId"`) | `from`, `to`, `boardId` | `boardId` |
| `viewport` | board ID | `panX`, `panY`, `zoomLevel` | — |
| `boards` | `id` | `name`, `createdAt`, `updatedAt` | — |

### Coordinate System

- **Screen coords**: CSS pixel position from mouse events, relative to the canvas
- **World coords**: `(screenX - panX) / zoomLevel`, `(screenY - panY) / zoomLevel`

All note positions/sizes stored in world coords. Canvas transform handles mapping.

### Interaction State

Flat state objects (mutually exclusive in practice): `drag`, `resize`, `pan`, `editState`, `headerEditState`, `connectState`, `dragConnect`, `contextMenuState`, `connectionMenuState`.

### Theme System

- `localStorage` key `mindmap-theme`: `"system"` | `"light"` | `"dark"`
- `applyTheme()` resolves effective mode, sets `data-theme` on `<html>`
- Canvas colors: `THEME_COLORS` light/dark objects
- CSS elements: `[data-theme="dark"]` selectors

## Development Conventions

- **No build tools**: vanilla HTML/CSS/JS only. Serve `web/` with any static server.
- **No frameworks**: no React, Vue, etc. Direct DOM + Canvas 2D API.
- **`var` everywhere**: for broad browser compatibility.
- **No ES modules**: single IIFE closure, no `import`/`export`.
- **IndexedDB via Promises**: all DB ops return Promises.
- **Keep docs current**: Update `README.md` and `AGENTS.md` when adding features, changing architecture, or modifying workflows.
- **Inline comments**: Section headers use `/* ── Section Name ─── */` format in `app.js`. CSS uses `/* ── Section ─── */`. HTML uses `<!-- Section: ... -->`.

## Docker

- `Dockerfile` — nginx:1.31.0-alpine, non-root, port 8080, healthcheck
- `nginx.conf` — gzip, security headers, cache, SPA fallback, `/health` endpoint
- `docker-compose.yml` — single `app` service