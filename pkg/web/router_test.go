package web

import (
	"testing"
)

func TestRouterBasicRoutes(t *testing.T) {
	r := NewRouter()

	// Register handlers
	r.Add("GET", "/", func(ctx *Context) error {
		return ctx.Text(200, "root")
	})
	r.Add("GET", "/hello", func(ctx *Context) error {
		return ctx.Text(200, "hello")
	})
	r.Add("POST", "/hello", func(ctx *Context) error {
		return ctx.Text(201, "created")
	})

	// Test root
	h, _ := r.Match("GET", "/")
	if h == nil {
		t.Fatal("Expected handler for GET /")
	}

	// Test /hello GET
	h, _ = r.Match("GET", "/hello")
	if h == nil {
		t.Fatal("Expected handler for GET /hello")
	}

	// Test /hello POST
	h, _ = r.Match("POST", "/hello")
	if h == nil {
		t.Fatal("Expected handler for POST /hello")
	}

	// Test 404
	h, _ = r.Match("GET", "/notfound")
	if h != nil {
		t.Error("Expected nil for unknown route")
	}
}

func TestRouterParameters(t *testing.T) {
	r := NewRouter()

	r.Add("GET", "/users/:id", func(ctx *Context) error {
		return ctx.Text(200, ctx.Param("id"))
	})
	r.Add("GET", "/users/:id/posts/:postId", func(ctx *Context) error {
		return ctx.Text(200, ctx.Param("id")+"-"+ctx.Param("postId"))
	})

	// Single param
	h, params := r.Match("GET", "/users/123")
	if h == nil {
		t.Fatal("Expected handler for /users/123")
	}
	if params["id"] != "123" {
		t.Errorf("Param id = %s; want 123", params["id"])
	}

	// Multiple params
	h, params = r.Match("GET", "/users/123/posts/456")
	if h == nil {
		t.Fatal("Expected handler for /users/123/posts/456")
	}
	if params["id"] != "123" {
		t.Errorf("Param id = %s; want 123", params["id"])
	}
	if params["postId"] != "456" {
		t.Errorf("Param postId = %s; want 456", params["postId"])
	}
}

func TestRouterWildcard(t *testing.T) {
	r := NewRouter()

	r.Add("GET", "/api/*", func(ctx *Context) error {
		return ctx.Text(200, "api wildcard")
	})

	// Wildcard match
	h, _ := r.Match("GET", "/api/v1/users")
	if h == nil {
		t.Fatal("Expected handler for /api/v1/users")
	}

	// Wildcard match deeper
	h, _ = r.Match("GET", "/api/v1/users/123/posts")
	if h == nil {
		t.Fatal("Expected handler for /api/v1/users/123/posts")
	}
}

func TestRouterHEAD(t *testing.T) {
	r := NewRouter()

	r.Add("GET", "/resource", func(ctx *Context) error {
		return ctx.Text(200, "resource")
	})

	// HEAD should fall back to GET
	h, _ := r.Match("HEAD", "/resource")
	if h == nil {
		t.Fatal("Expected HEAD to match GET handler")
	}
}
