package main

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

// Restore a fresh login's cache only after GitHub confirms that both tokens
// represent the same account. A matching display name alone is not sufficient.
func restoreAccountCache(ctx context.Context, db *gorm.DB, current OAuthToken, accountID int64) error {
	var count int64
	if err := db.Model(&PullRequest{}).Where("session_id = ?", current.SessionID).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	var candidates []OAuthToken
	if err := db.Where("username = ? AND session_id <> ?", current.Username, current.SessionID).Order("created_at DESC").Find(&candidates).Error; err != nil {
		return err
	}
	for _, previous := range candidates {
		var available int64
		if err := db.Model(&PullRequest{}).Where("session_id = ?", previous.SessionID).Count(&available).Error; err != nil {
			return err
		}
		if available == 0 {
			continue
		}
		token, err := decrypt(previous.Token)
		if err != nil {
			continue
		}
		user, _, err := githubClient(token).Users.Get(ctx, "")
		if err != nil || accountID == 0 || user.GetID() != accountID {
			continue
		}
		return copySessionCache(db.WithContext(ctx), previous.SessionID, current.SessionID)
	}
	return nil
}

func copySessionCache(db *gorm.DB, source, target string) error {
	if source == "" || target == "" || source == target {
		return fmt.Errorf("invalid cache sessions")
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var rows []PullRequest
		if err := tx.Where("session_id = ?", source).Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			oldID := row.ID
			row.ID, row.SessionID = 0, target
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
			var comments []ReviewComment
			if err := tx.Where("session_id = ? AND pull_request_id = ?", source, oldID).Find(&comments).Error; err != nil {
				return err
			}
			for i := range comments {
				comments[i].ID = 0
				comments[i].SessionID = target
				comments[i].PullRequestID = row.ID
			}
			if len(comments) > 0 {
				if err := tx.CreateInBatches(&comments, 100).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
}
