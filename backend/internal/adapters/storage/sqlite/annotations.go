package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"shelf/backend/internal/domain"
)

// AnnotationRepository implements ReaderAnnotationRepository with database/sql.
// The host supplies its SQLite driver and owns the database lifecycle.
type AnnotationRepository struct{ db *sql.DB }

func NewAnnotationRepository(db *sql.DB) *AnnotationRepository {
	return &AnnotationRepository{db: db}
}

func encode(value any) (string, error) {
	bytes, err := json.Marshal(value)
	if err != nil { return "", fmt.Errorf("encode reader annotation: %w", err) }
	return string(bytes), nil
}

func decodeAnchor(value sql.NullString) (*domain.TextAnchor, error) {
	if !value.Valid || value.String == "" || value.String == "null" { return nil, nil }
	var anchor domain.TextAnchor
	if err := json.Unmarshal([]byte(value.String), &anchor); err != nil {
		return nil, fmt.Errorf("decode reader text anchor: %w", err)
	}
	return &anchor, nil
}

func (r *AnnotationRepository) ListBookmarks(ctx context.Context, documentID string) ([]domain.Bookmark, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, document_id, page_index, label, anchor_json, created_at FROM reader_bookmarks WHERE document_id = ? ORDER BY page_index, created_at`, documentID)
	if err != nil { return nil, err }
	defer rows.Close()
	items := []domain.Bookmark{}
	for rows.Next() {
		var item domain.Bookmark
		var anchorJSON sql.NullString
		var createdAt int64
		if err := rows.Scan(&item.ID, &item.DocumentID, &item.PageIndex, &item.Label, &anchorJSON, &createdAt); err != nil { return nil, err }
		item.Anchor, err = decodeAnchor(anchorJSON)
		if err != nil { return nil, err }
		item.CreatedAt = time.UnixMilli(createdAt).UTC()
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *AnnotationRepository) SaveBookmark(ctx context.Context, item domain.Bookmark) error {
	anchor, err := encode(item.Anchor)
	if err != nil { return err }
	_, err = r.db.ExecContext(ctx, `INSERT INTO reader_bookmarks (id, document_id, page_index, label, anchor_json, created_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET document_id=excluded.document_id, page_index=excluded.page_index,
label=excluded.label, anchor_json=excluded.anchor_json`,
		item.ID, item.DocumentID, item.PageIndex, item.Label, anchor, item.CreatedAt.UnixMilli())
	return err
}

func (r *AnnotationRepository) DeleteBookmark(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, "DELETE FROM reader_bookmarks WHERE id = ?", id)
	return err
}

func (r *AnnotationRepository) ListAnnotations(ctx context.Context, documentID string) ([]domain.Annotation, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, document_id, page_index, kind, color, content, anchor_json,
rectangles_json, created_at, updated_at FROM reader_annotations WHERE document_id = ? ORDER BY page_index, created_at`, documentID)
	if err != nil { return nil, err }
	defer rows.Close()
	items := []domain.Annotation{}
	for rows.Next() {
		var item domain.Annotation
		var anchorJSON sql.NullString
		var rectanglesJSON string
		var createdAt, updatedAt int64
		if err := rows.Scan(&item.ID, &item.DocumentID, &item.PageIndex, &item.Kind, &item.Color, &item.Content,
			&anchorJSON, &rectanglesJSON, &createdAt, &updatedAt); err != nil { return nil, err }
		item.Anchor, err = decodeAnchor(anchorJSON)
		if err != nil { return nil, err }
		if err := json.Unmarshal([]byte(rectanglesJSON), &item.Rectangles); err != nil { return nil, err }
		item.CreatedAt, item.UpdatedAt = time.UnixMilli(createdAt).UTC(), time.UnixMilli(updatedAt).UTC()
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *AnnotationRepository) SaveAnnotation(ctx context.Context, item domain.Annotation) error {
	anchor, err := encode(item.Anchor)
	if err != nil { return err }
	rectangles, err := encode(item.Rectangles)
	if err != nil { return err }
	_, err = r.db.ExecContext(ctx, `INSERT INTO reader_annotations
(id, document_id, page_index, kind, color, content, anchor_json, rectangles_json, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET document_id=excluded.document_id, page_index=excluded.page_index,
kind=excluded.kind, color=excluded.color, content=excluded.content, anchor_json=excluded.anchor_json,
rectangles_json=excluded.rectangles_json, updated_at=excluded.updated_at`,
		item.ID, item.DocumentID, item.PageIndex, item.Kind, item.Color, item.Content, anchor, rectangles,
		item.CreatedAt.UnixMilli(), item.UpdatedAt.UnixMilli())
	return err
}

func (r *AnnotationRepository) DeleteAnnotation(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, "DELETE FROM reader_annotations WHERE id = ?", id)
	return err
}

func (r *AnnotationRepository) ListQuotes(ctx context.Context, documentID string) ([]domain.Quote, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, document_id, page_index, text, attribution, annotation_id,
anchor_json, tags_json, created_at, updated_at FROM reader_quotes WHERE document_id = ? ORDER BY page_index, created_at`, documentID)
	if err != nil { return nil, err }
	defer rows.Close()
	items := []domain.Quote{}
	for rows.Next() {
		var item domain.Quote
		var anchorJSON sql.NullString
		var annotationID sql.NullString
		var tagsJSON string
		var createdAt, updatedAt int64
		if err := rows.Scan(&item.ID, &item.DocumentID, &item.PageIndex, &item.Text, &item.Attribution,
			&annotationID, &anchorJSON, &tagsJSON, &createdAt, &updatedAt); err != nil { return nil, err }
		if annotationID.Valid { item.AnnotationID = annotationID.String }
		item.Anchor, err = decodeAnchor(anchorJSON)
		if err != nil { return nil, err }
		if err := json.Unmarshal([]byte(tagsJSON), &item.Tags); err != nil { return nil, err }
		item.CreatedAt, item.UpdatedAt = time.UnixMilli(createdAt).UTC(), time.UnixMilli(updatedAt).UTC()
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *AnnotationRepository) SaveQuote(ctx context.Context, item domain.Quote) error {
	anchor, err := encode(item.Anchor)
	if err != nil { return err }
	tags, err := encode(item.Tags)
	if err != nil { return err }
	var annotationID any
	if item.AnnotationID != "" { annotationID = item.AnnotationID }
	_, err = r.db.ExecContext(ctx, `INSERT INTO reader_quotes
(id, document_id, page_index, text, attribution, annotation_id, anchor_json, tags_json, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET document_id=excluded.document_id, page_index=excluded.page_index,
text=excluded.text, attribution=excluded.attribution, annotation_id=excluded.annotation_id,
anchor_json=excluded.anchor_json, tags_json=excluded.tags_json, updated_at=excluded.updated_at`,
		item.ID, item.DocumentID, item.PageIndex, item.Text, item.Attribution, annotationID, anchor, tags,
		item.CreatedAt.UnixMilli(), item.UpdatedAt.UnixMilli())
	return err
}

func (r *AnnotationRepository) DeleteQuote(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, "DELETE FROM reader_quotes WHERE id = ?", id)
	return err
}
