package main

import (
	"github.com/gin-gonic/gin"
	"log"
)

// Route templates reveal neither OAuth codes nor user-supplied IDs or queries.
func safeRequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
		route := c.FullPath()
		if route == "" {
			route = "unmatched"
		}
		log.Printf("HTTP %s %s %d", c.Request.Method, route, c.Writer.Status())
	}
}
