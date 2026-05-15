# MindMap

A lightweight, no-dependency web framework for Go that serves vanilla HTML5 SPAs.

## Quick Start

```bash
go run main.go
```

Open [http://localhost:8080](http://localhost:8080) to see the SPA.

## Architecture

```
├── main.go              # Entry point
├── pkg/web/             # Framework (zero dependencies)
│   ├── handler.go       # Context and Handler types
│   ├── router.go        # Trie-based URL router
│   ├── server.go        # HTTP server with middleware
│   ├── middleware.go     # Logging, recovery, CORS
│   └── spa.go           # Static file serving with SPA fallback
├── web/                 # SPA static assets
│   ├── index.html       # Entry page
│   ├── app.js           # Application logic
│   └── style.css        # Styles
```

## Framework API

### Create a Server

```go
app := web.New()
```

### Middleware

```go
app.Use(web.RecoveryMiddleware)  // Panic recovery
app.Use(web.LoggingMiddleware)   // Request logging
app.Use(web.CORSMiddleware)      // CORS headers
```

Write custom middleware:

```go
app.Use(func(next web.Handler) web.Handler {
    return func(ctx *web.Context) error {
        // before
        err := next(ctx)
        // after
        return err
    }
})
```

### Routes

```go
app.Get("/api/users", listUsers)
app.Post("/api/users", createUser)
app.Get("/api/users/:id", getUser)
app.Delete("/api/users/:id", deleteUser)
app.Get("/api/*", catchAll)
```

### Route Parameters

```go
app.Get("/users/:id", func(ctx *web.Context) error {
    id := ctx.Param("id")
    return ctx.Text(200, "User: "+id)
})
```

### Responses

```go
ctx.Text(200, "plain text")
ctx.JSON(200, `{"key": "value"}`)
ctx.HTML(200, "<h1>Hello</h1>")
```

### SPA Mode

Serve static files from a directory with automatic SPA fallback (unmatched routes serve `index.html`):

```go
app.SPA("./web", "static")
```

- `/static/app.js` serves `./web/app.js`
- `/static/style.css` serves `./web/style.css`
- `/any/spa/route` serves `./web/index.html`

### Listen

```go
app.Listen(":8080")
```

Set the `PORT` environment variable to override.

## Running Tests

```bash
go test ./pkg/web/ -v
```

## Dependencies

None. Uses only the Go standard library.
