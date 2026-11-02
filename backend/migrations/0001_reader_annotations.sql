-- Reader annotation data is independent from renderer state and can be shared by native shells.
CREATE TABLE IF NOT EXISTS reader_bookmarks (
    id TEXT PRIMARY KEY NOT NULL,
    document_id TEXT NOT NULL,
    page_index INTEGER NOT NULL CHECK (page_index >= 0),
    label TEXT NOT NULL DEFAULT '',
    anchor_json TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reader_bookmarks_document
    ON reader_bookmarks(document_id, page_index, created_at);

CREATE TABLE IF NOT EXISTS reader_annotations (
    id TEXT PRIMARY KEY NOT NULL,
    document_id TEXT NOT NULL,
    page_index INTEGER NOT NULL CHECK (page_index >= 0),
    kind TEXT NOT NULL CHECK (kind IN ('highlight', 'note')),
    color TEXT NOT NULL DEFAULT 'yellow',
    content TEXT NOT NULL DEFAULT '',
    anchor_json TEXT,
    rectangles_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reader_annotations_document
    ON reader_annotations(document_id, page_index, created_at);

CREATE TABLE IF NOT EXISTS reader_quotes (
    id TEXT PRIMARY KEY NOT NULL,
    document_id TEXT NOT NULL,
    page_index INTEGER NOT NULL CHECK (page_index >= 0),
    text TEXT NOT NULL,
    attribution TEXT NOT NULL DEFAULT '',
    annotation_id TEXT,
    anchor_json TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reader_quotes_document
    ON reader_quotes(document_id, page_index, created_at);
