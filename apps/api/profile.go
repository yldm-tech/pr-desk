package main

import (
	"github.com/gin-gonic/gin"
)

func (s *Server) profile(c *gin.Context) {
	var connection OAuthToken
	if connectionQuery(s.db).Where("session_id = ?", requestSessionID(c)).First(&connection).Error != nil {
		c.JSON(401, gin.H{"error": "not connected"})
		return
	}
	token, err := decrypt(connection.Token)
	if err != nil {
		c.JSON(401, gin.H{"error": "Reconnect GitHub"})
		return
	}
	user, _, err := githubClient(token).Users.Get(c.Request.Context(), "")
	if err != nil {
		c.JSON(502, gin.H{"error": "Unable to load GitHub profile"})
		return
	}
	c.JSON(200, gin.H{"login": user.GetLogin(), "name": user.GetName(), "avatar_url": user.GetAvatarURL(), "bio": user.GetBio(), "company": user.GetCompany(), "location": user.GetLocation(), "created_at": user.GetCreatedAt().Time, "followers": user.GetFollowers(), "following": user.GetFollowing(), "public_repos": user.GetPublicRepos()})
}
