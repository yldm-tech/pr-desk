package main

import (
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"

	"github.com/gin-gonic/gin"
)

// Keep API misses as errors; only frontend document routes receive the SPA.
func registerWeb(r *gin.Engine, files fs.FS) {
	if files == nil {
		return
	}
	// Go's built-in extension table has no entry for .webmanifest, and the container image this ships in carries none of the /etc/mime.types files the mime package would otherwise read, so http.FileServer would sniff the manifest and answer text/plain. Registering it here rather than relying on the host keeps the served type identical everywhere the binary runs. The error is the "not a valid media type" one, which a constant cannot produce.
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
	server := http.FileServer(http.FS(files))
	r.NoRoute(func(c *gin.Context) {
		urlPath := c.Request.URL.Path
		if (c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead) || urlPath == "/api" || strings.HasPrefix(urlPath, "/api/") || urlPath == "/swagger" || strings.HasPrefix(urlPath, "/swagger/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		name := strings.TrimPrefix(path.Clean("/"+urlPath), "/")
		if name == "" {
			name = "index.html"
		}
		info, err := fs.Stat(files, name)
		request := c.Request
		if err != nil || info.IsDir() {
			if path.Ext(name) != "" || strings.HasPrefix(name, "assets/") || (err == nil && info.IsDir()) {
				http.NotFound(c.Writer, c.Request)
				return
			}
			request = c.Request.Clone(c.Request.Context())
			request.URL.Path = "/"
			request.URL.RawPath = ""
		}
		c.Header("Cache-Control", "no-cache")
		if strings.HasPrefix(name, "assets/") && err == nil {
			c.Header("Cache-Control", "public, max-age=31536000, immutable")
		}
		c.Status(http.StatusOK)
		server.ServeHTTP(c.Writer, request)
	})
}
