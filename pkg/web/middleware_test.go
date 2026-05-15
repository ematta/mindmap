package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRecoveryMiddleware(t *testing.T) {
	// Handler that panics
	panicHandler := func(ctx *Context) error {
		panic("something went wrong")
	}

	wrapped := RecoveryMiddleware(panicHandler)

	req := httptest.NewRequest("GET", "/", nil)
	rec := httptest.NewRecorder()
	ctx := &Context{Request: req, Response: rec}

	wrapped(ctx)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("Status = %d; want %d", rec.Code, http.StatusInternalServerError)
	}

	body := rec.Body.String()
	if !strings.Contains(body, "Internal Server Error") {
		t.Errorf("Body = %s; want 'Internal Server Error'", body)
	}
}

func TestCORSMiddleware(t *testing.T) {
	handler := func(ctx *Context) error {
		return ctx.Text(200, "ok")
	}

	wrapped := CORSMiddleware(handler)

	req := httptest.NewRequest("GET", "/", nil)
	rec := httptest.NewRecorder()
	ctx := &Context{Request: req, Response: rec}

	err := wrapped(ctx)
	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}

	// Check CORS headers
	if rec.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Error("Missing CORS header")
	}
}

func TestCORSMiddlewareOPTIONS(t *testing.T) {
	handler := func(ctx *Context) error {
		return ctx.Text(200, "ok")
	}

	wrapped := CORSMiddleware(handler)

	req := httptest.NewRequest("OPTIONS", "/", nil)
	rec := httptest.NewRecorder()
	ctx := &Context{Request: req, Response: rec}

	err := wrapped(ctx)
	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}

	if rec.Code != http.StatusNoContent {
		t.Errorf("Status = %d; want %d", rec.Code, http.StatusNoContent)
	}
}
