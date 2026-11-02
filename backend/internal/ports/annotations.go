package ports

import (
	"context"
	"shelf/backend/internal/domain"
	"time"
)

// ReaderAnnotationRepository is the persistence boundary shared by storage adapters.
type ReaderAnnotationRepository interface {
	ListBookmarks(context.Context, string) ([]domain.Bookmark, error)
	GetBookmark(context.Context, string) (domain.Bookmark, error)
	SaveBookmark(context.Context, domain.Bookmark) error
	UpdateBookmark(context.Context, domain.Bookmark) error
	DeleteBookmark(context.Context, string) error

	ListAnnotations(context.Context, string) ([]domain.Annotation, error)
	GetAnnotation(context.Context, string) (domain.Annotation, error)
	SaveAnnotation(context.Context, domain.Annotation) error
	UpdateAnnotation(context.Context, domain.Annotation) error
	DeleteAnnotation(context.Context, string) error

	ListQuotes(context.Context, string) ([]domain.Quote, error)
	SaveQuote(context.Context, domain.Quote) error
	DeleteQuote(context.Context, string) error
}

type IDGenerator interface {
	NewID(kind string) (string, error)
}

type Clock interface {
	Now() time.Time
}
