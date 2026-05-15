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

- **Run**: `make run` or `go run main.go` (starts on `:8080`, override with `PORT` env var)
- **Test**: `make test` or `go test ./pkg/web/ -v`
- **Build**: `make build` or `go build .`
- **Docker up**: `make docker-up` (app + postgres via compose)
- **Docker down**: `make docker-down`

## Docker

- `Dockerfile` — Multi-stage build (golang:1.26-alpine → alpine:3.21)
- `docker-compose.yml` — App + PostgreSQL 17 sidecar
- Postgres credentials: user=`mindmap`, password=`mindmap`, db=`mindmap`
- `DATABASE_URL` is injected into the app container automatically
