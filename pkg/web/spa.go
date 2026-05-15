package web

import (
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// spaFileServer serves static files and falls back to index.html for SPAs
type spaFileServer struct {
	root      http.FileSystem
	indexPath string
	prefix    string
}

func newSPAFileServer(root string, indexPath string, prefix string) *spaFileServer {
	return &spaFileServer{
		root:      http.Dir(root),
		indexPath: indexPath,
		prefix:    prefix,
	}
}

func (fs *spaFileServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Remove prefix from path
	upath := r.URL.Path
	if fs.prefix != "" {
		upath = strings.TrimPrefix(upath, fs.prefix)
	}
	upath = path.Clean(upath)
	if upath == "." {
		upath = "/"
	}

	// Try to open the file
	f, err := fs.root.Open(upath)
	if err != nil {
		if os.IsNotExist(err) {
			// File not found - serve index.html for SPA routing
			fs.serveIndex(w, r)
			return
		}
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	defer f.Close()

	// Check if it's a directory
	stat, err := f.Stat()
	if err != nil {
		fs.serveIndex(w, r)
		return
	}

	if stat.IsDir() {
		// Try index.html in directory
		indexPath := filepath.Join(upath, "index.html")
		if _, err := fs.root.Open(indexPath); err != nil {
			fs.serveIndex(w, r)
			return
		}
		// Serve the directory's index.html
		http.ServeFile(w, r, filepath.Join(string(fs.root.(http.Dir)), indexPath))
		return
	}

	// Serve the file
	http.ServeContent(w, r, stat.Name(), stat.ModTime(), f.(io.ReadSeeker))
}

func (fs *spaFileServer) serveIndex(w http.ResponseWriter, r *http.Request) {
	f, err := fs.root.Open(fs.indexPath)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()

	stat, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}

	http.ServeContent(w, r, stat.Name(), stat.ModTime(), f.(io.ReadSeeker))
}
