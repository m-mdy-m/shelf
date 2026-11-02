package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"shelf/backend/internal/application"
	"shelf/backend/internal/domain"
	"shelf/backend/internal/ports"
)

type testClock struct{}
func (testClock) Now() time.Time { return time.Unix(1_800_000_000, 0).UTC() }

type testIDs struct{ next int }
func (i *testIDs) NewID(kind string) (string, error) {
	i.next++
	return kind + "-test-" + strconv.Itoa(i.next), nil
}

type testRepository struct { bookmarks []domain.Bookmark }
func (r *testRepository) ListBookmarks(_ context.Context, _ string) ([]domain.Bookmark, error) { return r.bookmarks, nil }
func (r *testRepository) GetBookmark(_ context.Context, id string) (domain.Bookmark, error) {
	for _, item := range r.bookmarks {
		if item.ID == id { return item, nil }
	}
	return domain.Bookmark{}, domain.ErrNotFound
}
func (r *testRepository) SaveBookmark(_ context.Context, item domain.Bookmark) error { r.bookmarks = append(r.bookmarks, item); return nil }
func (r *testRepository) UpdateBookmark(_ context.Context, item domain.Bookmark) error {
	for index, existing := range r.bookmarks {
		if existing.ID == item.ID { r.bookmarks[index] = item; return nil }
	}
	return domain.ErrNotFound
}
func (r *testRepository) DeleteBookmark(_ context.Context, _ string) error { return nil }
func (r *testRepository) ListAnnotations(context.Context, string) ([]domain.Annotation, error) { return nil, nil }
func (r *testRepository) GetAnnotation(context.Context, string) (domain.Annotation, error) {
	return domain.Annotation{}, domain.ErrNotFound
}
func (r *testRepository) SaveAnnotation(context.Context, domain.Annotation) error { return nil }
func (r *testRepository) UpdateAnnotation(context.Context, domain.Annotation) error {
	return domain.ErrNotFound
}
func (r *testRepository) DeleteAnnotation(context.Context, string) error { return nil }
func (r *testRepository) ListQuotes(context.Context, string) ([]domain.Quote, error) { return nil, nil }
func (r *testRepository) SaveQuote(context.Context, domain.Quote) error { return nil }
func (r *testRepository) DeleteQuote(context.Context, string) error { return nil }

func TestBookmarkHTTPAdapterCreatesAndListsRecords(t *testing.T) {
	repository := &testRepository{}
	var _ ports.ReaderAnnotationRepository = repository
	service := application.NewAnnotationService(repository, &testIDs{}, testClock{})
	server := httptest.NewServer(NewAnnotationsHandler(service))
	defer server.Close()

	response, err := http.Post(
		server.URL+"/documents/doc-1/bookmarks",
		"application/json",
		bytes.NewBufferString(`{"page_index": 4, "label": "Important"}`),
	)
	if err != nil { t.Fatal(err) }
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated { t.Fatalf("unexpected create status: %d", response.StatusCode) }

	var created domain.Bookmark
	if err := json.NewDecoder(response.Body).Decode(&created); err != nil { t.Fatal(err) }
	if created.DocumentID != "doc-1" || created.PageIndex != 4 { t.Fatalf("unexpected bookmark: %#v", created) }

	list, err := http.Get(server.URL+"/documents/doc-1/bookmarks")
	if err != nil { t.Fatal(err) }
	defer list.Body.Close()
	if list.StatusCode != http.StatusOK { t.Fatalf("unexpected list status: %d", list.StatusCode) }
	var items []domain.Bookmark
	if err := json.NewDecoder(list.Body).Decode(&items); err != nil { t.Fatal(err) }
	if len(items) != 1 || items[0].ID != created.ID { t.Fatalf("unexpected saved bookmarks: %#v", items) }
}

func TestBookmarkHTTPAdapterRequiresPageIndex(t *testing.T) {
	service := application.NewAnnotationService(&testRepository{}, &testIDs{}, testClock{})
	server := httptest.NewServer(NewAnnotationsHandler(service))
	defer server.Close()

	response, err := http.Post(
		server.URL+"/documents/doc-1/bookmarks",
		"application/json",
		bytes.NewBufferString(`{"label":"Missing page"}`),
	)
	if err != nil { t.Fatal(err) }
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected missing page_index to return 400, got %d", response.StatusCode)
	}
}

func TestBookmarkHTTPAdapterRejectsClientSuppliedDocumentScope(t *testing.T) {
	service := application.NewAnnotationService(&testRepository{}, &testIDs{}, testClock{})
	server := httptest.NewServer(NewAnnotationsHandler(service))
	defer server.Close()

	request, err := http.NewRequest(http.MethodPut, server.URL+"/bookmarks/bookmark-1", bytes.NewBufferString(
		`{"page_index":2,"document_id":"another-document"}`,
	))
	if err != nil { t.Fatal(err) }
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil { t.Fatal(err) }
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected client-supplied document scope to be rejected, got %d", response.StatusCode)
	}
}

func TestBookmarkHTTPAdapterRejectsMalformedInput(t *testing.T) {
	service := application.NewAnnotationService(&testRepository{}, &testIDs{}, testClock{})
	server := httptest.NewServer(NewAnnotationsHandler(service))
	defer server.Close()

	response, err := http.Post(server.URL+"/documents/doc-1/bookmarks", "application/json", bytes.NewBufferString(`{"page_index": -1}`))
	if err != nil { t.Fatal(err) }
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest { t.Fatalf("expected 400, got %d", response.StatusCode) }
}
