package web

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestSPAFileServerServesExistingFile(t *testing.T) {
	// Create temp dir with a file
	dir, err := os.MkdirTemp("", "spa-test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)

	content := []byte("hello from file")
	if err := os.WriteFile(filepath.Join(dir, "test.txt"), content, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<h1>SPA</h1>"), 0644); err != nil {
		t.Fatal(err)
	}

	handler := newSPAFileServer(dir, "index.html", "/static")

	// Request existing file
	req := httptest.NewRequest("GET", "/static/test.txt", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("Status = %d; want 200", rec.Code)
	}
}

func TestSPAFileServerFallsBackToIndex(t *testing.T) {
	dir, err := os.MkdirTemp("", "spa-test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)

	indexContent := []byte("<h1>SPA App</h1>")
	if err := os.WriteFile(filepath.Join(dir, "index.html"), indexContent, 0644); err != nil {
		t.Fatal(err)
	}

	handler := newSPAFileServer(dir, "index.html", "/static")

	// Request non-existent path - should serve index.html
	req := httptest.NewRequest("GET", "/static/some/route", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("Status = %d; want 200", rec.Code)
	}
}
