package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"shelf/backend/internal/application"
	"shelf/backend/internal/domain"
)

type serviceAdapter interface {
	ListBookmarks(context.Context, string) ([]domain.Bookmark, error)
	CreateBookmark(context.Context, application.CreateBookmarkInput) (domain.Bookmark, error)
	UpdateBookmark(context.Context, domain.Bookmark) (domain.Bookmark, error)
	DeleteBookmark(context.Context, string) error
	ListAnnotations(context.Context, string) ([]domain.Annotation, error)
	CreateAnnotation(context.Context, application.CreateAnnotationInput) (domain.Annotation, error)
	UpdateAnnotation(context.Context, domain.Annotation) (domain.Annotation, error)
	DeleteAnnotation(context.Context, string) error
	ListQuotes(context.Context, string) ([]domain.Quote, error)
	CreateQuote(context.Context, application.CreateQuoteInput) (domain.Quote, error)
	DeleteQuote(context.Context, string) error
}

type Handler struct{ service serviceAdapter }

// NewAnnotationsHandler returns a thin HTTP adapter; domain validation and persistence stay in Application/Ports.
func NewAnnotationsHandler(service serviceAdapter) http.Handler {
	handler := &Handler{service: service}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /documents/{documentID}/bookmarks", handler.listBookmarks)
	mux.HandleFunc("POST /documents/{documentID}/bookmarks", handler.createBookmark)
	mux.HandleFunc("PUT /bookmarks/{id}", handler.updateBookmark)
	mux.HandleFunc("DELETE /bookmarks/{id}", handler.deleteBookmark)
	mux.HandleFunc("GET /documents/{documentID}/annotations", handler.listAnnotations)
	mux.HandleFunc("POST /documents/{documentID}/annotations", handler.createAnnotation)
	mux.HandleFunc("PUT /annotations/{id}", handler.updateAnnotation)
	mux.HandleFunc("DELETE /annotations/{id}", handler.deleteAnnotation)
	mux.HandleFunc("GET /documents/{documentID}/quotes", handler.listQuotes)
	mux.HandleFunc("POST /documents/{documentID}/quotes", handler.createQuote)
	mux.HandleFunc("DELETE /quotes/{id}", handler.deleteQuote)
	return mux
}

func decodeJSON[T any](w http.ResponseWriter, r *http.Request) (T, bool) {
	var value T
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": map[string]string{"code": "invalid-request", "message": "Request body must contain valid JSON."},
		})
		return value, false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": map[string]string{"code": "invalid-request", "message": "Request body must contain exactly one JSON value."},
		})
		return value, false
	}
	return value, true
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, err error) {
	status, code := http.StatusInternalServerError, "reader-storage-failed"
	if errors.Is(err, domain.ErrInvalid) {
		status, code = http.StatusBadRequest, "invalid-input"
	}
	message := "Shelf could not complete the Reader request."
	if errors.Is(err, domain.ErrInvalid) {
		message = err.Error()
	}
	writeJSON(w, status, map[string]any{
		"error": map[string]string{"code": code, "message": message},
	})
}

func (h *Handler) listBookmarks(w http.ResponseWriter, r *http.Request) {
	items, err := h.service.ListBookmarks(r.Context(), strings.TrimSpace(r.PathValue("documentID")))
	if err != nil { writeError(w, err); return }
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) createBookmark(w http.ResponseWriter, r *http.Request) {
	input, ok := decodeJSON[struct {
		PageIndex int `json:"page_index"`
		Label string `json:"label"`
		Anchor *domain.TextAnchor `json:"anchor"`
	}](w, r)
	if !ok { return }
	item, err := h.service.CreateBookmark(r.Context(), application.CreateBookmarkInput{
		DocumentID: r.PathValue("documentID"), PageIndex: input.PageIndex,
		Label: input.Label, Anchor: input.Anchor,
	})
	if err != nil { writeError(w, err); return }
	writeJSON(w, http.StatusCreated, item)
}

func (h *Handler) updateBookmark(w http.ResponseWriter, r *http.Request) {
	input, ok := decodeJSON[struct {
		DocumentID string `json:"document_id"`
		PageIndex int `json:"page_index"`
		Label string `json:"label"`
		Anchor *domain.TextAnchor `json:"anchor"`
		CreatedAt time.Time `json:"created_at"`
	}](w, r)
	if !ok { return }
	item, err := h.service.UpdateBookmark(r.Context(), domain.Bookmark{
		ID: r.PathValue("id"), DocumentID: input.DocumentID, PageIndex: input.PageIndex,
		Label: input.Label, Anchor: input.Anchor, CreatedAt: input.CreatedAt,
	})
	if err != nil { writeError(w, err); return }
	writeJSON(w, http.StatusOK, item)
}

func (h *Handler) deleteBookmark(w http.ResponseWriter, r *http.Request) {
	if err := h.service.DeleteBookmark(r.Context(), r.PathValue("id")); err != nil { writeError(w, err); return }
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) listAnnotations(w http.ResponseWriter, r *http.Request) {
	items, err := h.service.ListAnnotations(r.Context(), strings.TrimSpace(r.PathValue("documentID")))
	if err != nil { writeError(w, err); return }
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) createAnnotation(w http.ResponseWriter, r *http.Request) {
	input, ok := decodeJSON[struct {
		PageIndex int `json:"page_index"`
		Kind domain.AnnotationKind `json:"kind"`
		Color string `json:"color"`
		Content string `json:"content"`
		Anchor *domain.TextAnchor `json:"anchor"`
		Rectangles []domain.PageRect `json:"rectangles"`
	}](w, r)
	if !ok { return }
	item, err := h.service.CreateAnnotation(r.Context(), application.CreateAnnotationInput{
		DocumentID: r.PathValue("documentID"), PageIndex: input.PageIndex, Kind: input.Kind,
		Color: input.Color, Content: input.Content, Anchor: input.Anchor, Rectangles: input.Rectangles,
	})
	if err != nil { writeError(w, err); return }
	writeJSON(w, http.StatusCreated, item)
}

func (h *Handler) updateAnnotation(w http.ResponseWriter, r *http.Request) {
	input, ok := decodeJSON[struct {
		DocumentID string `json:"document_id"`
		PageIndex int `json:"page_index"`
		Kind domain.AnnotationKind `json:"kind"`
		Color string `json:"color"`
		Content string `json:"content"`
		Anchor *domain.TextAnchor `json:"anchor"`
		Rectangles []domain.PageRect `json:"rectangles"`
		CreatedAt time.Time `json:"created_at"`
	}](w, r)
	if !ok { return }
	item, err := h.service.UpdateAnnotation(r.Context(), domain.Annotation{
		ID: r.PathValue("id"), DocumentID: input.DocumentID, PageIndex: input.PageIndex,
		Kind: input.Kind, Color: input.Color, Content: input.Content, Anchor: input.Anchor,
		Rectangles: input.Rectangles, CreatedAt: input.CreatedAt,
	})
	if err != nil { writeError(w, err); return }
	writeJSON(w, http.StatusOK, item)
}

func (h *Handler) deleteAnnotation(w http.ResponseWriter, r *http.Request) {
	if err := h.service.DeleteAnnotation(r.Context(), r.PathValue("id")); err != nil { writeError(w, err); return }
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) listQuotes(w http.ResponseWriter, r *http.Request) {
	items, err := h.service.ListQuotes(r.Context(), strings.TrimSpace(r.PathValue("documentID")))
	if err != nil { writeError(w, err); return }
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) createQuote(w http.ResponseWriter, r *http.Request) {
	input, ok := decodeJSON[struct {
		PageIndex int `json:"page_index"`
		Text string `json:"text"`
		Attribution string `json:"attribution"`
		AnnotationID string `json:"annotation_id"`
		Anchor *domain.TextAnchor `json:"anchor"`
		Tags []string `json:"tags"`
	}](w, r)
	if !ok { return }
	item, err := h.service.CreateQuote(r.Context(), application.CreateQuoteInput{
		DocumentID: r.PathValue("documentID"), PageIndex: input.PageIndex,
		Text: input.Text, Attribution: input.Attribution, AnnotationID: input.AnnotationID,
		Anchor: input.Anchor, Tags: input.Tags,
	})
	if err != nil { writeError(w, err); return }
	writeJSON(w, http.StatusCreated, item)
}

func (h *Handler) deleteQuote(w http.ResponseWriter, r *http.Request) {
	if err := h.service.DeleteQuote(r.Context(), r.PathValue("id")); err != nil { writeError(w, err); return }
	w.WriteHeader(http.StatusNoContent)
}
