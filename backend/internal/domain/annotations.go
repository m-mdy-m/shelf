package domain

import (
	"errors"
	"time"
)

var (
	ErrInvalid  = errors.New("invalid reader annotation input")
	ErrNotFound = errors.New("reader annotation record not found")
)

type TextAnchor struct {
	SelectedText        string `json:"selected_text"`
	NormalizedText      string `json:"normalized_text"`
	StartOffset         int    `json:"start_offset"`
	EndOffset           int    `json:"end_offset"`
	DocumentFingerprint string `json:"document_fingerprint,omitempty"`
	AnchorVersion       int    `json:"anchor_version"`
}

type PageRect struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type Bookmark struct {
	ID         string      `json:"id"`
	DocumentID string      `json:"document_id"`
	PageIndex  int         `json:"page_index"`
	Label      string      `json:"label,omitempty"`
	Anchor     *TextAnchor `json:"anchor,omitempty"`
	CreatedAt  time.Time   `json:"created_at"`
}

type AnnotationKind string

const (
	AnnotationHighlight AnnotationKind = "highlight"
	AnnotationNote      AnnotationKind = "note"
)

type Annotation struct {
	ID         string          `json:"id"`
	DocumentID string          `json:"document_id"`
	PageIndex  int             `json:"page_index"`
	Kind       AnnotationKind  `json:"kind"`
	Color      string          `json:"color,omitempty"`
	Content    string          `json:"content,omitempty"`
	Anchor     *TextAnchor     `json:"anchor,omitempty"`
	Rectangles []PageRect      `json:"rectangles"`
	CreatedAt  time.Time       `json:"created_at"`
	UpdatedAt  time.Time       `json:"updated_at"`
}

type Quote struct {
	ID           string      `json:"id"`
	DocumentID   string      `json:"document_id"`
	PageIndex    int         `json:"page_index"`
	Text         string      `json:"text"`
	Attribution  string      `json:"attribution,omitempty"`
	AnnotationID string      `json:"annotation_id,omitempty"`
	Anchor       *TextAnchor `json:"anchor,omitempty"`
	Tags         []string    `json:"tags"`
	CreatedAt    time.Time   `json:"created_at"`
	UpdatedAt    time.Time   `json:"updated_at"`
}
