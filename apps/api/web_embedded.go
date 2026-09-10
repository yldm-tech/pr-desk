//go:build webembed

package main

import (
	"embed"
	"io/fs"
)

//go:embed all:webdist
var webBundle embed.FS

func frontendFiles() fs.FS {
	files, err := fs.Sub(webBundle, "webdist")
	if err != nil {
		panic(err)
	}
	return files
}
