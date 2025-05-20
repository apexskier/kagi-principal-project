This is a prototype search engine for searching programming documentation,
built as a take-home project for Kagi.

## 2025-05-20

Initial thoughts

not an expert in DBs, and this part seems very important.

Scale with multiple crawlers running in parallel, need locking (and scalable locking) (locking can probably be non-guaranteed since we'll rerun to update results, just need to ensure writes are locked) idempotency?. Lock by domain, page...?

follow standards, can't hand-build scrapers for each site
- Respect robots.txt
- Use sitemaps (crawl what the site wants me to crawl, not link traversal).
- Use canonical rels, don't duplicate crawling
- Looks like not all the listed domains have sitemaps or robots.txt files
- Crawling over list of domains (possibly with path constraints)
- Use semantic HTML (hopefully no need to scrape header/footer or common content, target is documentation)
- outdated content - ETAGS (If-None-Match)? cache-control? HEAD requests?

Probably out of scope, but semantic code scraping would be cool. Lex code and allow searching for symbols, etc
Also out of scope - spell check on search terms

Architecture

- Central DB
- Crawlers
    - URL sniffer - finds pages to look at content in. Given entrypoint (url), looks at robots.txt, sitemap.xml, http links. Deduplicates urls. Outputs additional pages to url sniff. Outputs pages to scrape. Outputs metadata (last crawled, what other things are linked to, etc)
    - Page scraper - given a page (url), scrapes contents and adds to search indices. Outputs search indice vectors, outputs page metadata (human readable for UI, stats)
- API
    - search - given query, search DB and aggregate results, returns results and time to search
    - domain stats
    - page stats
    - admin (needs auth)
        - trigger recrawl
        - data resets
- UI 
    - html search form, returns results. Help, error messages, query syntax.
    - https://developer.mozilla.org/en-US/docs/Web/XML/Guides/OpenSearch
- Orchestration - trigger crawlers, ensure site is up

Security

- Prevent abuse, simple cloudflare protection? Simple rate limiting by IP?
- Need authn/authz over admin

Data

- "Each result should include the title, link, and a relevant snippet from the page."
- "Bonus points for supporting both a classical index as well as an embedding based retrieval over results."

- Title, link fairly easy (canonical links!)
- snippet from page - store full page contents likely. Return cursors in page content? HTML, so should we store plain text or html? I would prefer html since formatting is more important for docs (code elements, and ~syntax highlighting~ - syntax highlighting would require css)

Store vector embedding for document?

I'd like to build this in such a way that the page scraper output different types of indices, both to compare quality and in future to add additional search heuristics. Bag of words, word embedding, etc.

Documentation is human facing, html is human facing

Using OpenSearch for search indexing. Flexible (can support many types of searching, including pre-trained vector embedding), full featured, appropriate license, means I don't have to build out myself. Also has ingest pipelines to handle stop word cleaning, etc. Indicing and optimizing is a huge topic and I want to get something up sooner rather than later.

Using Postgres for managing crawling. Postgres is robust, I'm somewhat familiar.
- queuing crawlers
- crawler statistics

What data are we storing per indexed page?
- title
- date last updated
- date indexed/crawled
- indexed content
- url (including domain/path/etc)
- 


**Optimizing rankings comes later. Need the project running to be able to test optimizations**
