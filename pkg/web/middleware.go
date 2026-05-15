package web

import (
	"fmt"
	"net/http"
	"time"
)

// Middleware is a function that wraps a handler
type Middleware func(next Handler) Handler

// LoggingMiddleware logs each request
func LoggingMiddleware(next Handler) Handler {
	return func(ctx *Context) error {
		start := time.Now()
		err := next(ctx)
		duration := time.Since(start)
		fmt.Printf("[%s] %s %s - %v\n",
			start.Format("2006-01-02 15:04:05"),
			ctx.Request.Method,
			ctx.Request.URL.Path,
			duration,
		)
		return err
	}
}

// RecoveryMiddleware catches panics and returns 500
func RecoveryMiddleware(next Handler) Handler {
	return func(ctx *Context) error {
		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("PANIC: %v\n", r)
				ctx.Response.WriteHeader(http.StatusInternalServerError)
				ctx.Response.Write([]byte("Internal Server Error"))
			}
		}()
		return next(ctx)
	}
}

// CORSMiddleware adds CORS headers
func CORSMiddleware(next Handler) Handler {
	return func(ctx *Context) error {
		ctx.Response.Header().Set("Access-Control-Allow-Origin", "*")
		ctx.Response.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		ctx.Response.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if ctx.Request.Method == "OPTIONS" {
			ctx.Response.WriteHeader(http.StatusNoContent)
			return nil
		}

		return next(ctx)
	}
}
