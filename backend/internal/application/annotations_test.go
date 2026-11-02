package application

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	"shelf/backend/internal/domain"
)

type fakeIDs struct{ count int }
func (f *fakeIDs) NewID(kind string) (string, error) {
	f.count++
	return kind + "-test-" + time.Unix(int64(f.count), 0).UTC().Format("150405"), nil
}
type fixedClock struct{ at time.Time }
func (f fixedClock) Now() time.Time { return f.at }

type fakeRepository struct {
	bookmarks map[string]domain.Bookmark
	annotations map[string]domain.Annotation
	quotes map[string]domain.Quote
	failWrites bool
}
func newFakeRepository() *fakeRepository {
	return &fakeRepository{
		bookmarks: map[string]domain.Bookmark{},
		annotations: map[string]domain.Annotation{},
		quotes: map[string]domain.Quote{},
	}
}
func (f *fakeRepository) ListBookmarks(_ context.Context, documentID string) ([]domain.Bookmark, error) {
	items := []domain.Bookmark{}
	for _, item := range f.bookmarks {
		if item.DocumentID == documentID { items = append(items, item) }
	}
	return items, nil
}
func (f *fakeRepository) GetBookmark(_ context.Context, id string) (domain.Bookmark, error) {
	item, ok := f.bookmarks[id]
	if !ok { return domain.Bookmark{}, domain.ErrNotFound }
	return item, nil
}
func (f *fakeRepository) SaveBookmark(_ context.Context, item domain.Bookmark) error {
	if f.failWrites { return errors.New("storage unavailable") }
	f.bookmarks[item.ID] = item
	return nil
}
func (f *fakeRepository) UpdateBookmark(_ context.Context, item domain.Bookmark) error {
	if f.failWrites { return errors.New("storage unavailable") }
	if _, ok := f.bookmarks[item.ID]; !ok { return domain.ErrNotFound }
	f.bookmarks[item.ID] = item
	return nil
}
func (f *fakeRepository) DeleteBookmark(_ context.Context, id string) error { delete(f.bookmarks, id); return nil }
func (f *fakeRepository) ListAnnotations(_ context.Context, documentID string) ([]domain.Annotation, error) {
	items := []domain.Annotation{}
	for _, item := range f.annotations {
		if item.DocumentID == documentID { items = append(items, item) }
	}
	return items, nil
}
func (f *fakeRepository) GetAnnotation(_ context.Context, id string) (domain.Annotation, error) {
	item, ok := f.annotations[id]
	if !ok { return domain.Annotation{}, domain.ErrNotFound }
	return item, nil
}
func (f *fakeRepository) SaveAnnotation(_ context.Context, item domain.Annotation) error {
	if f.failWrites { return errors.New("storage unavailable") }
	f.annotations[item.ID] = item
	return nil
}
func (f *fakeRepository) UpdateAnnotation(_ context.Context, item domain.Annotation) error {
	if f.failWrites { return errors.New("storage unavailable") }
	if _, ok := f.annotations[item.ID]; !ok { return domain.ErrNotFound }
	f.annotations[item.ID] = item
	return nil
}
func (f *fakeRepository) DeleteAnnotation(_ context.Context, id string) error { delete(f.annotations, id); return nil }
func (f *fakeRepository) ListQuotes(_ context.Context, documentID string) ([]domain.Quote, error) {
	items := []domain.Quote{}
	for _, item := range f.quotes {
		if item.DocumentID == documentID { items = append(items, item) }
	}
	return items, nil
}
func (f *fakeRepository) SaveQuote(_ context.Context, item domain.Quote) error {
	if f.failWrites { return errors.New("storage unavailable") }
	f.quotes[item.ID] = item
	return nil
}
func (f *fakeRepository) DeleteQuote(_ context.Context, id string) error { delete(f.quotes, id); return nil }

func newService() (*AnnotationService, *fakeRepository) {
	repository := newFakeRepository()
	return NewAnnotationService(repository, &fakeIDs{}, fixedClock{at: time.Unix(1_800_000_000, 0)}), repository
}

func TestCreateBookmarkPersistsOnlyAfterRepositorySuccess(t *testing.T) {
	service, repository := newService()
	item, err := service.CreateBookmark(context.Background(), CreateBookmarkInput{
		DocumentID: "doc-1", PageIndex: 3, Label: " Important ",
	})
	if err != nil { t.Fatal(err) }
	if item.Label != "Important" || item.ID == "" { t.Fatalf("unexpected bookmark: %#v", item) }
	if len(repository.bookmarks) != 1 { t.Fatalf("expected one saved bookmark, got %d", len(repository.bookmarks)) }

	repository.failWrites = true
	_, err = service.CreateBookmark(context.Background(), CreateBookmarkInput{DocumentID: "doc-1", PageIndex: 4})
	if err == nil { t.Fatal("expected persistence failure") }
	if len(repository.bookmarks) != 1 { t.Fatal("failed write changed persisted state") }
}

func TestCreateAnnotationValidatesNormalizedGeometryAndNoteContent(t *testing.T) {
	service, repository := newService()
	_, err := service.CreateAnnotation(context.Background(), CreateAnnotationInput{
		DocumentID: "doc-1", PageIndex: 0, Kind: domain.AnnotationHighlight, Color: "yellow",
		Rectangles: []domain.PageRect{{X: .8, Y: .1, Width: .5, Height: .1}},
	})
	if !errors.Is(err, domain.ErrInvalid) { t.Fatalf("expected invalid geometry error, got %v", err) }

	_, err = service.CreateAnnotation(context.Background(), CreateAnnotationInput{
		DocumentID: "doc-1", PageIndex: 0, Kind: domain.AnnotationNote, Content: "  ",
	})
	if !errors.Is(err, domain.ErrInvalid) { t.Fatalf("expected empty note error, got %v", err) }

	_, err = service.CreateAnnotation(context.Background(), CreateAnnotationInput{
		DocumentID: "doc-1", PageIndex: 0, Kind: domain.AnnotationHighlight, Color: "yellow",
		Rectangles: []domain.PageRect{{X: math.NaN(), Y: .1, Width: .2, Height: .1}},
	})
	if !errors.Is(err, domain.ErrInvalid) { t.Fatalf("expected non-finite geometry error, got %v", err) }
	if len(repository.annotations) != 0 { t.Fatal("invalid annotations must not be persisted") }
}

func TestCreateAndUpdateAnnotation(t *testing.T) {
	service, repository := newService()
	item, err := service.CreateAnnotation(context.Background(), CreateAnnotationInput{
		DocumentID: "doc-1", PageIndex: 1, Kind: domain.AnnotationHighlight, Color: "yellow",
		Rectangles: []domain.PageRect{{X: .1, Y: .2, Width: .4, Height: .03}},
	})
	if err != nil { t.Fatal(err) }
	item.Color = "blue"
	item.DocumentID = "another-document"
	item.CreatedAt = time.Unix(1, 0).UTC()
	updated, err := service.UpdateAnnotation(context.Background(), item)
	if err != nil { t.Fatal(err) }
	if updated.Color != "blue" || updated.DocumentID != "doc-1" ||
		!updated.CreatedAt.Equal(time.Unix(1_800_000_000, 0)) ||
		updated.UpdatedAt.Before(updated.CreatedAt) {
		t.Fatalf("annotation update changed immutable fields or failed to advance time: %#v", updated)
	}
	if repository.annotations[updated.ID].Color != "blue" { t.Fatal("updated annotation was not saved") }
}

func TestCreateHighlightDefaultsColorToYellow(t *testing.T) {
	service, repository := newService()
	item, err := service.CreateAnnotation(context.Background(), CreateAnnotationInput{
		DocumentID: "doc-1", PageIndex: 0, Kind: domain.AnnotationHighlight,
	})
	if err != nil { t.Fatal(err) }
	if item.Color != "yellow" { t.Fatalf("expected default yellow highlight, got %q", item.Color) }
	if len(repository.annotations) != 1 { t.Fatal("default highlight was not persisted") }
}

func TestUpdateBookmarkPreservesDocumentScopeAndCreationTime(t *testing.T) {
	service, repository := newService()
	created, err := service.CreateBookmark(context.Background(), CreateBookmarkInput{
		DocumentID: "doc-1", PageIndex: 2, Label: "Original",
	})
	if err != nil { t.Fatal(err) }
	mutated := created
	mutated.DocumentID = "another-document"
	mutated.CreatedAt = time.Unix(1, 0)
	mutated.PageIndex = 5
	mutated.Label = "Updated"
	updated, err := service.UpdateBookmark(context.Background(), mutated)
	if err != nil { t.Fatal(err) }
	if updated.DocumentID != "doc-1" || updated.PageIndex != 5 ||
		updated.Label != "Updated" || !updated.CreatedAt.Equal(created.CreatedAt) {
		t.Fatalf("bookmark update changed immutable fields: %#v", updated)
	}
	if stored := repository.bookmarks[created.ID]; stored.DocumentID != "doc-1" ||
		!stored.CreatedAt.Equal(created.CreatedAt) {
		t.Fatalf("persisted bookmark changed immutable fields: %#v", stored)
	}
}

func TestCreateQuoteKeepsItsSourceAnchor(t *testing.T) {
	service, repository := newService()
	anchor := &domain.TextAnchor{
		SelectedText: "a passage", NormalizedText: "a passage",
		StartOffset: 2, EndOffset: 11, AnchorVersion: 1,
	}
	item, err := service.CreateQuote(context.Background(), CreateQuoteInput{
		DocumentID: "doc-1", PageIndex: 2, Text: " a passage ", Anchor: anchor, Tags: []string{"reader"},
	})
	if err != nil { t.Fatal(err) }
	if item.Text != "a passage" || item.Anchor == nil || item.Anchor.StartOffset != 2 {
		t.Fatalf("quote lost source anchor: %#v", item)
	}
	if len(repository.quotes) != 1 { t.Fatal("quote was not stored") }
}
