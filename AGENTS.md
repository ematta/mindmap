# AGENTS.md

## Project Structure

- `web/` — SPA static assets (vanilla HTML5/JS/CSS)

## Features

- **Multi-board support**: Create, rename, switch between, and delete multiple idea boards. Each board has its own isolated notes, connections, and viewport. Boards are listed in a slide-out panel accessible from the toolbar. Board names default to a random adjective+noun pair if not named. The current board is persisted in localStorage and restored on reload. IndexedDB uses a `boards` object store and a `boardId` index on notes/connections for per-board data isolation.
- **Resizable cards**: Drag the bottom-right corner handle to resize notes. Minimum size is 120x80px. Sizes persist in IndexedDB and are included in JSON export/import.
- **Deletable connections**: Right-click on a connection line to delete it. Connections show a pointer cursor on hover.
- **Share via link**: Right-click canvas → "Share Link" encodes the board state (board name, notes, connections, and viewport position/zoom) as base64 in the URL hash and copies the link to clipboard. Opening a shared link adds it as a new board to the recipient's board list (with confirmation). Works entirely client-side with no backend.
- **Pannable canvas**: Left-click and drag on empty canvas to pan around. Shows a grab/grabbing hand cursor. Pan position and zoom level persist per board in IndexedDB (via `viewport` object store keyed by boardId) and are included in JSON export/import and shared links.

## Development Conventions

- **Keep docs current**: Update `README.md` and `AGENTS.md` when adding features, changing architecture, or modifying development workflows.

## Docker

- `Dockerfile` — Multi-stage build
