package web

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestServerBasicRouting(t *testing.T) {
	s := New()

	s.Get("/hello", func(ctx *Context) error {
		return ctx.Text(200, "hello world")
	})

	s.Post("/data", func(ctx *Context) error {
		return ctx.JSON(201, `{"status":"ok"}`)
	})

	// Test GET /hello
	req := httptest.NewRequest("GET", "/hello", nil)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Errorf("Status = %d; want 200", rec.Code)
	}
	if rec.Body.String() != "hello world" {
		t.Errorf("Body = %s; want 'hello world'", rec.Body.String())
	}

	// Test POST /data
	req = httptest.NewRequest("POST", "/data", nil)
	rec = httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	if rec.Code != 201 {
		t.Errorf("Status = %d; want 201", rec.Code)
	}
}

func TestServerMiddleware(t *testing.T) {
	s := New()

	var order []string

	s.Use(func(next Handler) Handler {
		return func(ctx *Context) error {
			order = append(order, "mw1")
			return next(ctx)
		}
	})

	s.Use(func(next Handler) Handler {
		return func(ctx *Context) error {
			order = append(order, "mw2")
			return next(ctx)
		}
	})

	s.Get("/test", func(ctx *Context) error {
		order = append(order, "handler")
		return ctx.Text(200, "ok")
	})

	req := httptest.NewRequest("GET", "/test", nil)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	if len(order) != 3 {
		t.Fatalf("Expected 3 calls, got %d", len(order))
	}
	if order[0] != "mw1" || order[1] != "mw2" || order[2] != "handler" {
		t.Errorf("Order = %v; want [mw1 mw2 handler]", order)
	}
}

func TestServerNotFound(t *testing.T) {
	s := New()

	req := httptest.NewRequest("GET", "/nonexistent", nil)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("Status = %d; want 404", rec.Code)
	}
}

func TestServerWithParams(t *testing.T) {
	s := New()

	s.Get("/users/:id", func(ctx *Context) error {
		return ctx.Text(200, ctx.Param("id"))
	})

	req := httptest.NewRequest("GET", "/users/42", nil)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	if rec.Body.String() != "42" {
		t.Errorf("Body = %s; want '42'", rec.Body.String())
	}
}
