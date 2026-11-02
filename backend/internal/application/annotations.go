package application

import (
	"context"
	"fmt"
	"math"
	"strings"

	"shelf/backend/internal/domain"
	"shelf/backend/internal/ports"
)

type AnnotationService struct {
	repository ports.ReaderAnnotationRepository
	ids        ports.IDGenerator
	clock      ports.Clock
}

type CreateBookmarkInput struct {
	DocumentID string
	PageIndex  int
	Label      string
	Anchor     *domain.TextAnchor
}

type CreateAnnotationInput struct {
	DocumentID string
	PageIndex  int
	Kind       domain.AnnotationKind
	Color      string
	Content    string
	Anchor     *domain.TextAnchor
	Rectangles []domain.PageRect
}

type CreateQuoteInput struct {
	DocumentID   string
	PageIndex    int
	Text         string
	Attribution  string
	AnnotationID string
	Anchor       *domain.TextAnchor
	Tags         []string
}

func NewAnnotationService(
	repository ports.ReaderAnnotationRepository,
	ids ports.IDGenerator,
	clock ports.Clock,
) *AnnotationService {
	return &AnnotationService{repository: repository, ids: ids, clock: clock}
}

func validateAnchor(anchor *domain.TextAnchor) error {
	if anchor == nil {
		return nil
	}
	if strings.TrimSpace(anchor.SelectedText) == "" || len(anchor.SelectedText) > 20_000 ||
		strings.TrimSpace(anchor.NormalizedText) == "" || len(anchor.NormalizedText) > 20_000 ||
		anchor.StartOffset < 0 || anchor.EndOffset <= anchor.StartOffset || anchor.AnchorVersion < 1 {
		return fmt.Errorf("%w: text anchor is invalid", domain.ErrInvalid)
	}
	return nil
}

func validateDocumentPage(documentID string, pageIndex int) error {
	if strings.TrimSpace(documentID) == "" {
		return fmt.Errorf("%w: document ID is required", domain.ErrInvalid)
	}
	if pageIndex < 0 {
		return fmt.Errorf("%w: page index cannot be negative", domain.ErrInvalid)
	}
	return nil
}

func validateRectangles(rectangles []domain.PageRect) error {
	if len(rectangles) > 512 {
		return fmt.Errorf("%w: annotation contains too many geometry fragments", domain.ErrInvalid)
	}
	for _, rectangle := range rectangles {
		values := []float64{rectangle.X, rectangle.Y, rectangle.Width, rectangle.Height}
		for _, value := range values {
			if math.IsNaN(value) || math.IsInf(value, 0) {
				return fmt.Errorf("%w: annotation geometry must contain finite values", domain.ErrInvalid)
			}
		}
		if rectangle.X < 0 || rectangle.Y < 0 ||
			rectangle.Width <= 0 || rectangle.Height <= 0 ||
			rectangle.X+rectangle.Width > 1 || rectangle.Y+rectangle.Height > 1 {
			return fmt.Errorf("%w: annotation geometry must be normalized to the page", domain.ErrInvalid)
		}
	}
	return nil
}

func validateAnnotation(annotation domain.Annotation) error {
	if err := validateDocumentPage(annotation.DocumentID, annotation.PageIndex); err != nil {
		return err
	}
	if err := validateAnchor(annotation.Anchor); err != nil {
		return err
	}
	if err := validateRectangles(annotation.Rectangles); err != nil {
		return err
	}
	switch annotation.Kind {
	case domain.AnnotationHighlight:
		switch annotation.Color {
		case "yellow", "green", "blue", "pink", "purple":
		default:
			return fmt.Errorf("%w: highlight color is not supported", domain.ErrInvalid)
		}
	case domain.AnnotationNote:
		if strings.TrimSpace(annotation.Content) == "" || len(annotation.Content) > 20_000 {
			return fmt.Errorf("%w: passage note must contain between 1 and 20,000 characters", domain.ErrInvalid)
		}
	default:
		return fmt.Errorf("%w: annotation kind is not supported", domain.ErrInvalid)
	}
	return nil
}

func (s *AnnotationService) ListBookmarks(ctx context.Context, documentID string) ([]domain.Bookmark, error) {
	if strings.TrimSpace(documentID) == "" {
		return nil, fmt.Errorf("%w: document ID is required", domain.ErrInvalid)
	}
	return s.repository.ListBookmarks(ctx, documentID)
}

func (s *AnnotationService) CreateBookmark(ctx context.Context, input CreateBookmarkInput) (domain.Bookmark, error) {
	if err := validateDocumentPage(input.DocumentID, input.PageIndex); err != nil {
		return domain.Bookmark{}, err
	}
	if len(input.Label) > 200 {
		return domain.Bookmark{}, fmt.Errorf("%w: bookmark label is too long", domain.ErrInvalid)
	}
	if err := validateAnchor(input.Anchor); err != nil {
		return domain.Bookmark{}, err
	}
	id, err := s.ids.NewID("bookmark")
	if err != nil {
		return domain.Bookmark{}, err
	}
	item := domain.Bookmark{
		ID: id, DocumentID: input.DocumentID, PageIndex: input.PageIndex,
		Label: strings.TrimSpace(input.Label), Anchor: input.Anchor, CreatedAt: s.clock.Now(),
	}
	if err := s.repository.SaveBookmark(ctx, item); err != nil {
		return domain.Bookmark{}, err
	}
	return item, nil
}

func (s *AnnotationService) UpdateBookmark(ctx context.Context, item domain.Bookmark) (domain.Bookmark, error) {
	if strings.TrimSpace(item.ID) == "" {
		return domain.Bookmark{}, fmt.Errorf("%w: bookmark ID is required", domain.ErrInvalid)
	}
	existing, err := s.repository.GetBookmark(ctx, item.ID)
	if err != nil {
		return domain.Bookmark{}, err
	}
	if err := validateDocumentPage(existing.DocumentID, item.PageIndex); err != nil {
		return domain.Bookmark{}, err
	}
	if len(item.Label) > 200 {
		return domain.Bookmark{}, fmt.Errorf("%w: bookmark label is too long", domain.ErrInvalid)
	}
	if err := validateAnchor(item.Anchor); err != nil {
		return domain.Bookmark{}, err
	}
	existing.PageIndex = item.PageIndex
	existing.Label = strings.TrimSpace(item.Label)
	existing.Anchor = item.Anchor
	if err := s.repository.UpdateBookmark(ctx, existing); err != nil {
		return domain.Bookmark{}, err
	}
	return existing, nil
}

func (s *AnnotationService) DeleteBookmark(ctx context.Context, id string) error {
	if strings.TrimSpace(id) == "" {
		return fmt.Errorf("%w: bookmark ID is required", domain.ErrInvalid)
	}
	return s.repository.DeleteBookmark(ctx, id)
}

func (s *AnnotationService) ListAnnotations(ctx context.Context, documentID string) ([]domain.Annotation, error) {
	if strings.TrimSpace(documentID) == "" {
		return nil, fmt.Errorf("%w: document ID is required", domain.ErrInvalid)
	}
	return s.repository.ListAnnotations(ctx, documentID)
}

func (s *AnnotationService) CreateAnnotation(ctx context.Context, input CreateAnnotationInput) (domain.Annotation, error) {
	item := domain.Annotation{
		DocumentID: input.DocumentID, PageIndex: input.PageIndex, Kind: input.Kind,
		Color: strings.ToLower(strings.TrimSpace(input.Color)), Content: strings.TrimSpace(input.Content),
		Anchor: input.Anchor, Rectangles: append([]domain.PageRect(nil), input.Rectangles...),
	}
	if item.Kind == domain.AnnotationHighlight && item.Color == "" {
		item.Color = "yellow"
	}
	if err := validateAnnotation(item); err != nil {
		return domain.Annotation{}, err
	}
	id, err := s.ids.NewID("annotation")
	if err != nil {
		return domain.Annotation{}, err
	}
	now := s.clock.Now()
	item.ID, item.CreatedAt, item.UpdatedAt = id, now, now
	if err := s.repository.SaveAnnotation(ctx, item); err != nil {
		return domain.Annotation{}, err
	}
	return item, nil
}

func (s *AnnotationService) UpdateAnnotation(ctx context.Context, item domain.Annotation) (domain.Annotation, error) {
	if strings.TrimSpace(item.ID) == "" {
		return domain.Annotation{}, fmt.Errorf("%w: annotation ID is required", domain.ErrInvalid)
	}
	existing, err := s.repository.GetAnnotation(ctx, item.ID)
	if err != nil {
		return domain.Annotation{}, err
	}
	existing.PageIndex = item.PageIndex
	existing.Kind = item.Kind
	existing.Color = strings.ToLower(strings.TrimSpace(item.Color))
	existing.Content = strings.TrimSpace(item.Content)
	existing.Anchor = item.Anchor
	existing.Rectangles = append([]domain.PageRect(nil), item.Rectangles...)
	if existing.Kind == domain.AnnotationHighlight && existing.Color == "" {
		existing.Color = "yellow"
	}
	if err := validateAnnotation(existing); err != nil {
		return domain.Annotation{}, err
	}
	existing.UpdatedAt = s.clock.Now()
	if err := s.repository.UpdateAnnotation(ctx, existing); err != nil {
		return domain.Annotation{}, err
	}
	return existing, nil
}

func (s *AnnotationService) DeleteAnnotation(ctx context.Context, id string) error {
	if strings.TrimSpace(id) == "" {
		return fmt.Errorf("%w: annotation ID is required", domain.ErrInvalid)
	}
	return s.repository.DeleteAnnotation(ctx, id)
}

func (s *AnnotationService) ListQuotes(ctx context.Context, documentID string) ([]domain.Quote, error) {
	if strings.TrimSpace(documentID) == "" {
		return nil, fmt.Errorf("%w: document ID is required", domain.ErrInvalid)
	}
	return s.repository.ListQuotes(ctx, documentID)
}

func (s *AnnotationService) CreateQuote(ctx context.Context, input CreateQuoteInput) (domain.Quote, error) {
	if err := validateDocumentPage(input.DocumentID, input.PageIndex); err != nil {
		return domain.Quote{}, err
	}
	if strings.TrimSpace(input.Text) == "" || len(input.Text) > 20_000 {
		return domain.Quote{}, fmt.Errorf("%w: quote must contain between 1 and 20,000 characters", domain.ErrInvalid)
	}
	if len(input.Attribution) > 500 || len(input.Tags) > 50 {
		return domain.Quote{}, fmt.Errorf("%w: quote metadata exceeds its limit", domain.ErrInvalid)
	}
	for _, tag := range input.Tags {
		if strings.TrimSpace(tag) == "" || len(tag) > 80 {
			return domain.Quote{}, fmt.Errorf("%w: quote tags must be non-empty and at most 80 characters", domain.ErrInvalid)
		}
	}
	if err := validateAnchor(input.Anchor); err != nil {
		return domain.Quote{}, err
	}
	id, err := s.ids.NewID("quote")
	if err != nil {
		return domain.Quote{}, err
	}
	now := s.clock.Now()
	item := domain.Quote{
		ID: id, DocumentID: input.DocumentID, PageIndex: input.PageIndex,
		Text: strings.TrimSpace(input.Text), Attribution: strings.TrimSpace(input.Attribution),
		AnnotationID: input.AnnotationID, Anchor: input.Anchor,
		Tags: append([]string(nil), input.Tags...), CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repository.SaveQuote(ctx, item); err != nil {
		return domain.Quote{}, err
	}
	return item, nil
}

func (s *AnnotationService) DeleteQuote(ctx context.Context, id string) error {
	if strings.TrimSpace(id) == "" {
		return fmt.Errorf("%w: quote ID is required", domain.ErrInvalid)
	}
	return s.repository.DeleteQuote(ctx, id)
}
