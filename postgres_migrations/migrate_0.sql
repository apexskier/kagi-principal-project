-- Table for URL prefixes (url_bases)
CREATE TABLE url_bases (
    id SERIAL PRIMARY KEY,
    url_prefix TEXT NOT NULL UNIQUE
);

CREATE DOMAIN text_not_null AS TEXT NOT NULL;
CREATE DOMAIN time_not_null AS TIMESTAMP WITH TIME ZONE NOT NULL;
CREATE TYPE lock_status AS (
    lock_owner text_not_null,
    lock_acquired_at time_not_null
);

-- Table for scraped URLs
CREATE TABLE scraped_urls (
    id SERIAL PRIMARY KEY,
    url_base_id INTEGER NOT NULL REFERENCES url_bases(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    etag TEXT,
    no_scrape_before TIMESTAMP WITH TIME ZONE,
    last_modified TIMESTAMP WITH TIME ZONE,
    last_check_time TIMESTAMP WITH TIME ZONE,
    last_scrape_status INTEGER,
    lock lock_status,
    UNIQUE (url_base_id, path)
);

-- Example: Pagination query for url_bases
-- Replace :limit and :offset with your values
-- SELECT * FROM url_bases ORDER BY id LIMIT :limit OFFSET :offset;

-- Example: Pagination query for scraped_urls
-- SELECT * FROM scraped_urls ORDER BY id LIMIT :limit OFFSET :offset;
