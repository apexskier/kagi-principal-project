# Page Scraper

This is a simple web scraper.

It polls the postgres table for URLs, selecting and locking based on a configurable strategy. When an URL is found, it performs a lightweight HEAD request to check if the page is up and applicable for scraping (has been updated, is html, etc). Once the HEAD check passes, it does a full GET request and extracts relevant content for searching. This data is indexed into OpenSearch, and the postgres table is unlocked and metadata is updated.

The scraper attempts to be nice. This includes things like:

- Respecting web standards and conventions to avoid overloading sites
- Respecting web standards and conventions to protect privacy
- Fairly scraping across many domains and sites
