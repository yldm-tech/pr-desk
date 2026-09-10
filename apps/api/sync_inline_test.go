package main

import "github.com/gin-gonic/gin"

// Worker integration tests run inline so their assertions observe completion.
// Queue behavior is covered separately through the real HTTP handler.
func (s *Server) syncInlineForTest(c *gin.Context) {
	result := s.syncSession(c.Request.Context(), requestSessionID(c), c.Query("auto") == "1", c.Query("full") == "1")
	c.JSON(result.status, result.body)
}
