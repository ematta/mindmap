package web

import (
	"net/http"
)

// Context wraps an HTTP request and response, providing helper methods
type Context struct {
	Request  *http.Request
	Response http.ResponseWriter
	Params   map[string]string
}

// Handler is the framework's handler signature
// It returns an error, which the server converts into an HTTP response
type Handler func(ctx *Context) error

// Text writes a plain text response
func (ctx *Context) Text(status int, text string) error {
	ctx.Response.Header().Set("Content-Type", "text/plain; charset=utf-8")
	ctx.Response.WriteHeader(status)
	_, err := ctx.Response.Write([]byte(text))
	return err
}

// JSON writes a JSON response (manual serialization, no dependencies)
func (ctx *Context) JSON(status int, data string) error {
	ctx.Response.Header().Set("Content-Type", "application/json; charset=utf-8")
	ctx.Response.WriteHeader(status)
	_, err := ctx.Response.Write([]byte(data))
	return err
}

// HTML writes an HTML response
func (ctx *Context) HTML(status int, html string) error {
	ctx.Response.Header().Set("Content-Type", "text/html; charset=utf-8")
	ctx.Response.WriteHeader(status)
	_, err := ctx.Response.Write([]byte(html))
	return err
}

// Param returns a URL parameter value by name
func (ctx *Context) Param(key string) string {
	if ctx.Params == nil {
		return ""
	}
	return ctx.Params[key]
}

// Query returns a query parameter value by name
func (ctx *Context) Query(key string) string {
	return ctx.Request.URL.Query().Get(key)
}
