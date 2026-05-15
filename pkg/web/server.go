package web

import (
	"fmt"
	"net/http"
	"strings"
)

// Server is the main web framework
type Server struct {
	router      *Router
	middlewares []Middleware
	spaDir      string
	spaPrefix   string
}

// New creates a new Server
func New() *Server {
	return &Server{
		router: NewRouter(),
	}
}

// Use adds middleware to the chain
func (s *Server) Use(mw Middleware) {
	s.middlewares = append(s.middlewares, mw)
}

// Get registers a GET handler
func (s *Server) Get(path string, handler Handler) {
	s.router.Add("GET", path, handler)
}

// Post registers a POST handler
func (s *Server) Post(path string, handler Handler) {
	s.router.Add("POST", path, handler)
}

// Put registers a PUT handler
func (s *Server) Put(path string, handler Handler) {
	s.router.Add("PUT", path, handler)
}

// Delete registers a DELETE handler
func (s *Server) Delete(path string, handler Handler) {
	s.router.Add("DELETE", path, handler)
}

// SPA configures static file serving with SPA fallback
func (s *Server) SPA(dir string, prefix string) {
	s.spaDir = dir
	s.spaPrefix = "/" + strings.Trim(prefix, "/")
}

// Listen starts the HTTP server
func (s *Server) Listen(addr string) error {
	fmt.Printf("Server listening on %s\n", addr)
	return http.ListenAndServe(addr, s)
}

// ServeHTTP implements http.Handler
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	// Try SPA static files first
	if s.spaDir != "" && strings.HasPrefix(path, s.spaPrefix) {
		handler := newSPAFileServer(s.spaDir, "index.html", s.spaPrefix)
		handler.ServeHTTP(w, r)
		return
	}

	// Try router
	handler, params := s.router.Match(r.Method, path)
	if handler != nil {
		ctx := &Context{
			Request:  r,
			Response: w,
			Params:   params,
		}

		// Wrap handler with middleware chain (last added runs first)
		final := handler
		for i := len(s.middlewares) - 1; i >= 0; i-- {
			final = s.middlewares[i](final)
		}

		if err := final(ctx); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	// If SPA is configured, serve index.html for unmatched routes
	if s.spaDir != "" {
		handler := newSPAFileServer(s.spaDir, "index.html", "")
		handler.ServeHTTP(w, r)
		return
	}

	http.NotFound(w, r)
}
