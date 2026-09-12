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
		// The id the response carried in X-Request-ID. Without it the identifier a person quotes from a failed request matches nothing an operator can search, which is the only reason it is minted.
		if id := c.GetString("request_id"); id != "" {
			log.Printf("HTTP %s %s %d id=%s", c.Request.Method, route, c.Writer.Status(), id)
			return
		}
		log.Printf("HTTP %s %s %d", c.Request.Method, route, c.Writer.Status())
	}
}
