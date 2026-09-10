//go:build !webembed

package main

import "io/fs"

// API-only development uses the Vite server; production builds enable webembed.
func frontendFiles() fs.FS { return nil }
