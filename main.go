package main

import (
	"fmt"
	"os"

	"ematta/mindmap/pkg/web"
)

func main() {
	app := web.New()

	app.Use(web.RecoveryMiddleware)
	app.Use(web.LoggingMiddleware)
	app.Use(web.CORSMiddleware)

	app.Get("/api/hello", func(ctx *web.Context) error {
		return ctx.JSON(200, `{"message":"Hello, World!"}`)
	})

	app.SPA("./web", "static")

	addr := ":8080"
	if port := os.Getenv("PORT"); port != "" {
		addr = ":" + port
	}

	fmt.Printf("MindMap running on http://localhost%s\n", addr)
	if err := app.Listen(addr); err != nil {
		fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
		os.Exit(1)
	}
}
