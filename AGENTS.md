# AGENTS.md

## Project Structure

- `web/` — SPA static assets (vanilla HTML5/JS/CSS)

## Features

- **Resizable cards**: Drag the bottom-right corner handle to resize notes. Minimum size is 120x80px. Sizes persist in IndexedDB and are included in JSON export/import.
- **Deletable connections**: Right-click on a connection line to delete it. Connections show a pointer cursor on hover.
- **Share via link**: Right-click canvas → "Share Link" encodes the board state as base64 in the URL hash and copies the link to clipboard. Anyone opening the link gets the board loaded automatically. Works entirely client-side with no backend. Boards with existing data are prompted before replacing.

## Development Conventions

- **Keep docs current**: Update `README.md` and `AGENTS.md` when adding features, changing architecture, or modifying development workflows.

## Docker

- `Dockerfile` — Multi-stage build
