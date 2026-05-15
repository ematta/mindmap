# AGENTS.md

## Module

- **Module**: `ematta/mindmap`
- **Go version**: `1.26.1`
- **Dependencies**: None (standard library only)

## Project Structure

- `main.go` — Entry point, wires up server
- `pkg/web/` — No-dependency web framework (router, middleware, SPA serving)
- `web/` — SPA static assets (vanilla HTML5/JS/CSS)

## Development Conventions

- **TDD Required**: Write tests before implementation. Use `go test` to drive development. Every exported function and package should have corresponding tests.
- **Keep docs current**: Update `README.md` and `AGENTS.md` when adding features, changing architecture, or modifying development workflows.
- **No external dependencies**: The framework uses only the Go standard library.

## Commands

- **Run**: `go run main.go` (starts on `:8080`, override with `PORT` env var)
- **Test**: `go test ./pkg/web/ -v`
- **Build**: `go build .`
