This is a prototype search engine for searching programming documentation,
built as a take-home project for Kagi.

## 2025-05-20

Initial thoughts

not an expert in DBs, and this part seems very important.

Scale with multiple crawlers running in parallel, need locking (and scalable locking) (locking can probably be non-guaranteed since we'll rerun to update results, just need to ensure writes are locked) idempotency?. Lock by domain, page...?

follow standards, can't hand-build scrapers for each site

- Respect robots.txt
- noindex meta tag or header
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
  - Domain parser,
  - URL sniffer - finds pages to look at content in. Given entrypoint (url), looks at robots.txt, sitemap.xml, etc. Deduplicates urls. Outputs additional pages to url sniff. Outputs pages to scrape. Outputs metadata (last crawled, what other things are linked to, etc, outputs information about scrapability of urls)
  - Page scraper - given a page (url), scrapes contents and adds to search indices. Outputs search indice vectors, outputs page metadata (human readable for UI, stats), outputs additional pages to crawl via link detection
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
- **Optimizing rankings comes later. Need the project running to be able to test optimizations**

HTML parsing libraries

- https://github.com/fb55/htmlparser2 - forgiving (people don't follow standards), popular, fast.

## 2025-05-21

16:00 notes

I've got something that's working, but not within the desired parameters.

First, index latency is not within 50ms. I don't yet know if this is because I'm not optimizing OpenSearch right (I am running locally), or if it's a fundamental issue with OpenSearch. Given DB/indexing isn't my background, I decided to use an out-of-the box open source option, but in the real world this might require a lot more attention.

User interface is up, it's simple and static and not pretty, but it works. Definitely fulfills the requirements.

Crawler is working, and respects some good standards and conventions but not every one I'd like.

MDN has a lot of pages since they have so many languages. Might want to deprioritize other langauges. I'm randomly selecting the next page to scrape, but this inherently amplifies big sites, and the problem grows since it biases toward following links to those big sites. IDEA: I could randomly select an url prefix, then randomly select a path from that.

given this is in the prompt

> 4. Explain how you optimized ranking to achieve high relevancy in the search results.
>    I'm probably expected to optimize rankings. I'm not doing this at all yet, except for trying to query the body and choosing a solid base of opensearch.

TODO: (for sure)

- documentation for dev environment
- documentation for bootstrapping the project
- documentation for architecture
- documentation for choices made
- deployment to a real environment
- rescraping of outdated content (currently only scraping new urls)

TODO: (hopefully)

- improve latency
- improve result relevancy
- tests
- linting and formatting
- CI/build automation
- monitoring/observability
  - structured logs
  - metrics
  - bug reporting

## 2025-05-22

EOD notes

From yesterday

> TODO: (for sure)
>
> - ~documentation for dev environment~
> - ~documentation for bootstrapping the project~
> - documentation for architecture
> - documentation for choices made
> - ~deployment to a real environment~
> - rescraping of outdated content (currently only scraping new urls)
>
> TODO: (hopefully)
>
> - improve latency
> - improve result relevancy
> - tests
> - ~linting and formatting~
> - CI/build automation **(partial)**
> - monitoring/observability
>   - structured logs **(partial)**
>   - metrics
>   - bug reporting

Deployment and a live environment is working, took a while to get persistent volumes working (first time), but it's working.

More docs are needed, and rescraping is needed.

Couple areas for improvement of rankings:

- I'm scraping non-english pages, and they're showing up in the results. Should be pretty doable to index language and query based on accept-language headers.
- As I add improvements to ranking scores, it might be worth thinking about adding a version to the indexed documents. This could then be used as an input into the url selection strategy the scrapers use. It could also be used to deprioritize documents that we don't have the newest data imported for in search results.

TODO: (for sure)

- documentation for architecture
- documentation for choices made
- rescraping of outdated content (currently only scraping new urls)
- filter by language, currently returning non-english results

TODO: (hopefully)

- improve latency
- improve result relevancy
- tests
- CI/build automation
  - PR checks - linting, tests
  - auto deployment?
- monitoring/observability
  - structured logs in scraper
  - metrics
  - bug reporting
