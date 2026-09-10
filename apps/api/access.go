package main

import (
	"github.com/gin-gonic/gin"
	github "github.com/google/go-github/v68/github"
	"net/url"
	"os"
	"time"
)

func (s *Server) repositoryAccess(c *gin.Context) {
	var connection OAuthToken
	if s.db.Where("session_id = ? AND created_at > ?", requestSessionID(c), time.Now().Add(-30*24*time.Hour)).First(&connection).Error != nil {
		c.JSON(401, gin.H{"error": "not connected"})
		return
	}
	token, err := decrypt(connection.Token)
	if err != nil {
		c.JSON(401, gin.H{"error": "Reconnect GitHub"})
		return
	}
	gh := githubClient(token)
	count := 0
	readable := false
	accounts := []gin.H{}
	installURL := ""
	if slug := os.Getenv("GITHUB_APP_SLUG"); slug != "" {
		installURL = "https://github.com/apps/" + url.PathEscape(slug) + "/installations/new"
	}
	options := &github.ListOptions{PerPage: 100}
	for {
		installations, response, err := gh.Apps.ListUserInstallations(c.Request.Context(), options)
		if err != nil {
			c.JSON(502, gin.H{"error": "Unable to verify repository access"})
			return
		}
		count += len(installations)
		for _, installation := range installations {
			permission := installation.GetPermissions().GetPullRequests()
			canRead := (permission == "read" || permission == "write") && installation.SuspendedAt == nil
			readable = readable || canRead
			accounts = append(accounts, gin.H{"account": installation.GetAccount().GetLogin(), "repository_selection": installation.GetRepositorySelection(), "can_read_prs": canRead, "settings_url": installation.GetHTMLURL()})
		}
		if response.NextPage == 0 {
			break
		}
		options.Page = response.NextPage
	}
	c.JSON(200, gin.H{"has_installations": count > 0, "can_read_private": readable, "install_url": installURL, "installations": accounts})
}

// Keep the installation entry available after the first organization is authorized.
func repositoryInstall(c *gin.Context) {
	slug := os.Getenv("GITHUB_APP_SLUG")
	if slug == "" {
		c.JSON(503, gin.H{"error": "GitHub App installation is not configured"})
		return
	}
	c.Redirect(302, "https://github.com/apps/"+url.PathEscape(slug)+"/installations/new")
}
