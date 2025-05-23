import os from "node:os";
import * as htmlparser2 from "htmlparser2";
import domSerializer from "dom-serializer";
import type { Document } from "domhandler";
import { Client as OpenSearchClient } from "@opensearch-project/opensearch";
import { v5 as uuid } from "uuid";
import { localsName } from "ejs";
import sql, { ScrapedUrl, UrlBase } from "../../db";

// we use v5 uuid to generate a unique id for the document based on the URL
// can't use urls directly because of size constraints with the opensearch bulk API

const namespace = "1f0365d8-2a44-6ef0-a5ff-7804559ef9c4";

const sharedHeaders = {
  "User-Agent": `ApexskierScraper/${process.env.VERSION} (pid:${process.pid})`,
};

function parseRobotsValue(value: string | null): {
  noindex: boolean;
  nofollow: boolean;
} {
  // TODO: support bot names? may need to differentiate between header and meta tag values
  if (!value) {
    return { noindex: false, nofollow: false };
  }
  const tags = value.split(",").map((tag) => tag.trim().toLowerCase());
  return {
    noindex: tags.includes("noindex"),
    nofollow: tags.includes("nofollow"),
  };
}

function findTitle(document: Document): string | null {
  // first look for a <title> tag
  const titleNode = htmlparser2.DomUtils.findOne(
    (element) => element.name === "title",
    document,
  );
  if (titleNode) {
    const title = htmlparser2.DomUtils.textContent(titleNode).trim();
    if (title) {
      return title;
    }
  }

  // if no <title> tag, look for a <meta name="title"> tag
  const metaTitleNode = htmlparser2.DomUtils.findOne(
    (element) => element.name === "meta" && element.attribs.name === "title",
    document,
  );
  if (metaTitleNode) {
    const title = metaTitleNode.attribs.content.trim();
    if (title) {
      return title;
    }
  }

  // TODO: could consider prioritizing og:title or twitter:title tags

  return null;
}

function findDescription(document: Document): string | null {
  // first look for a <meta name="description"> tag
  const metaDescriptionNode = htmlparser2.DomUtils.findOne(
    (element) =>
      element.name === "meta" && element.attribs.name === "description",
    document,
  );
  if (metaDescriptionNode) {
    const description = metaDescriptionNode.attribs.content.trim();
    if (description) {
      return description;
    }
  }

  // TODO: could consider prioritizing og:description or twitter:description tags

  // TODO: could use an LLM to summarize page content.
  // This likely should be async triggered out of band of the main scraper.

  return null;
}

// findContent attempts to find the main content of a page, using html semantics
// as a guide. It returns full HTML content.
function findContent(document: Document): string | null {
  const mainNode = htmlparser2.DomUtils.findOne((element) => {
    if (element.name !== "main") {
      return false;
    }

    const hidden = element.attributes.find(({ name }) => name === "hidden");
    if (hidden) {
      return false;
    }

    return true;
  }, document);
  // The specification says there should be only one non-hidden <main> tag
  // Pages that have more than one will be implicitly penalized
  if (mainNode) {
    return domSerializer(mainNode);
  }

  // fall back to role="main"
  const roleMainNode = htmlparser2.DomUtils.findOne(
    (element) => element.attribs.role === "main",
    document,
  );
  if (roleMainNode) {
    return domSerializer(roleMainNode);
  }

  // fall back to <body> tag
  const bodyNode = htmlparser2.DomUtils.findOne(
    (element) => element.name === "body",
    document,
  );
  if (bodyNode) {
    return domSerializer(bodyNode);
  }

  return null;
}

function findHrefs(document: Document, base: URL): ReadonlyArray<URL> {
  return Array.from(
    new Set(
      htmlparser2.DomUtils.findAll(
        (element) =>
          element.name === "a" &&
          !!element.attribs.href &&
          !!element.attribs.href.trim(),
        document,
      ).map((element) => element.attribs.href.trim()),
    ),
  )
    .map((href) => new URL(href, base))
    .filter((href) => {
      // filter out non https URLs
      if (href.protocol !== "https:") {
        return false;
      }
      // simple optimization. If the href is just the base URL, it's not allowed or already in the url bases table.
      if (href.pathname === "/") {
        return false;
      }
      // Filter out hrefs that are the same as the current base URL
      if (href.toString() === base.toString()) {
        return false;
      }
      return true;
    });
}

function parseETag(etag: string | null): string | null {
  if (!etag) return null;
  // strip W/ from start of etag if present
  // weak matches are considered the same for content purposes
  if (etag.startsWith("W/")) {
    etag = etag.substring(2);
  }
  // Remove quotes from ETag
  return etag.replace(/(^"|"$)/g, "");
}

const NoUpdateNeeded = Symbol("NoUpdateNeeded");
type NoUpdateNeeded = typeof NoUpdateNeeded;

function isFailedStatus(
  x:
    | {
        etag: string | null;
        lastModified: Date | null;
        title: string | null;
        description: string | null;
        content: string | null;
        hrefs: ReadonlyArray<URL>;
        canonical: string;
        status: 200;
      }
    | { failedStatus: number },
): x is { failedStatus: number } {
  return (x as { failedStatus: number }).failedStatus !== undefined;
}

export async function scrape(
  page: URL,
  meta: {
    id: number;
    priorEtag: string | null;
    lastModified: Date | null;
  },
): Promise<
  | {
      etag: string | null;
      lastModified: Date | null;
      title: string | null;
      description: string | null;
      content: string | null;
      hrefs: ReadonlyArray<URL>;
      canonical: string;
      status: 200;
    }
  | NoUpdateNeeded
  | { failedStatus: number }
> {
  console.log("Initial HEAD request to:", page.toString());
  // first perform a HEAD request for a lighter weight check
  const headResponse = await fetch(page, {
    method: "HEAD",
    redirect: "follow",
    ...sharedHeaders,
  }).catch((err) => {
    // this can happen, for instance, if the SSL cert is bad
    console.error("Error in HEAD request:", err);
    return new Response(null, { status: 0 });
  });
  if (headResponse.status !== 200) {
    console.warn(`Failed to fetch page HEAD: ${headResponse.status}`);
    return { failedStatus: headResponse.status };
  }

  let noindex = false;
  let nofollow = false;

  const robotsHeader = headResponse.headers.get("x-robots-tag");
  ({ noindex, nofollow } = parseRobotsValue(robotsHeader));
  if (noindex) {
    console.warn(
      "noindex header prevents indexing, skipping:",
      page.toString(),
    );
    return NoUpdateNeeded;
  }

  // verify content type is html
  const contentType = headResponse.headers.get("content-type");
  if (!contentType || !contentType.startsWith("text/html")) {
    // we only index html content
    console.log(
      "Content type is not HTML, skipping:",
      page.toString(),
      contentType,
    );
    return NoUpdateNeeded;
  }

  // check etag
  const etag = parseETag(headResponse.headers.get("etag"));
  if (etag && etag === meta.priorEtag) {
    console.log("ETag matches, no update needed");
    return NoUpdateNeeded;
  }

  // check last modified
  const lastModified = headResponse.headers.get("last-modified");
  if (lastModified) {
    const lastModifiedDate = new Date(lastModified);
    if (meta.lastModified && lastModifiedDate <= meta.lastModified) {
      console.log("Last modified date matches, no update needed");
      return NoUpdateNeeded;
    }
  }

  // if we get here, we need to do a full fetch
  console.log("Full page request to:", page.toString());
  const fullResponse = await fetch(page, {
    method: "GET",
    redirect: "follow",
    ...sharedHeaders,
  }).catch((err) => {
    // this can happen, for instance, if the SSL cert is bad
    console.error("Error in HEAD request:", err);
    return new Response(null, { status: 0 });
  });
  if (fullResponse.status !== 200) {
    console.warn(`Failed to fetch page: ${fullResponse.status}`);
    return { failedStatus: fullResponse.status };
  }

  const newEtag = parseETag(fullResponse.headers.get("etag"));
  const newLastModified = fullResponse.headers.get("last-modified");
  let newDateModified: Date | null = null;
  if (newLastModified) {
    newDateModified = new Date(newLastModified);
  }

  // This does't use htmlparser2's streaming interface because
  // we want to understand semantics before deciding how to handle content.
  // For example, we want to index only the body of the page if possible,
  // ignoring header and footer, but not all html documents use the <main> tag.
  // Main risk here is high memory usage for large pages.

  const document = htmlparser2.parseDocument(await fullResponse.text());

  const title = findTitle(document);
  const description = findDescription(document);
  const content = findContent(document);
  const canonical =
    htmlparser2.DomUtils.findOne(
      (element) =>
        element.name === "link" &&
        element.attribs.rel === "canonical" &&
        !!element.attribs.href.trim(),
      document,
    )?.attribs.href || page.toString();
  ({ noindex, nofollow } = parseRobotsValue(
    htmlparser2.DomUtils.findOne(
      (element) => element.name === "meta" && element.attribs.name === "robots",
      document,
    )?.attribs.content ?? null,
  ));

  if (noindex) {
    console.warn(
      "noindex meta tag prevents indexing, skipping:",
      page.toString(),
    );
    return NoUpdateNeeded;
  }

  // don't follow links if nofollow is set
  const hrefs = nofollow ? [] : findHrefs(document, page);

  // TODO: set no scrape before based on cache control
  // TODO: handle backoff for 429 errors
  // TODO: improve db status marking? e.g. recoverable errors, permanent blocks, etc

  return {
    etag: newEtag,
    lastModified: newDateModified,
    title,
    description,
    content,
    hrefs,
    canonical,
    status: fullResponse.status,
  };
}

const openSearchClient = new OpenSearchClient({
  node: process.env.OPENSEARCH_HOST,
});

async function scrapeAndStore(item: {
  id: ScrapedUrl["id"];
  path: ScrapedUrl["path"];
  etag: ScrapedUrl["etag"];
  last_modified: ScrapedUrl["last_modified"];
  url_prefix: UrlBase["url_prefix"];
}) {
  const url = new URL(item.path, `https://${item.url_prefix}`);

  console.log("Scraping page:", url.toString());

  const result = await scrape(url, {
    id: item.id,
    priorEtag: item.etag,
    lastModified: item.last_modified,
  }).catch<ReturnType<typeof scrape>>(async (err) => {
    console.error("Error in scrape:", err, url.toString());
    await sql<never>`
    UPDATE scraped_urls
    SET
      last_check_time = NOW(),
      last_scrape_status = 0
    WHERE id = ${item.id};
    `;
    return NoUpdateNeeded;
  });

  // Update scrape status
  if (result == NoUpdateNeeded) {
    console.log("No update needed for page:", url.toString());
    await sql<never>`
    UPDATE scraped_urls
    SET
      last_check_time = NOW()
    WHERE id = ${item.id};
  `;
    return;
  }
  if (isFailedStatus(result)) {
    await sql<never>`
    UPDATE scraped_urls
    SET
      last_check_time = NOW(),
      last_scrape_status = ${result.failedStatus}
    WHERE id = ${item.id};
  `;
    return;
  }
  await sql<never>`
    UPDATE scraped_urls
    SET
      etag = ${result.etag},
      last_check_time = NOW(),
      last_scrape_status = ${result.status}
    WHERE id = ${item.id};
  `;

  // add hrefs to the scraped_urls table in bulk
  // TODO: merge into one query, dynamically generating the insert statement
  for (const href of result.hrefs) {
    const urlPrefixMatcher = href.toString().slice(href.protocol.length + 2);
    try {
      const sqlResult = await sql`
      INSERT INTO scraped_urls (url_base_id, path)
        SELECT id, ${href.pathname}
        FROM url_bases
        WHERE ${urlPrefixMatcher} LIKE url_prefix || '%'
        ORDER BY LENGTH(url_prefix) DESC
        LIMIT 1
      ON CONFLICT DO NOTHING;
    `;
      if (sqlResult.count === 0) {
        // no rows were inserted, this means the URL is already in the table or not allowed
        console.log("URL already in table or not allowed:", href.toString());
      } else {
        console.log("Queued URL:", href.toString());
      }
    } catch (err) {
      console.error("Error inserting href:", href.toString(), err);
    }
  }

  const bulkResponse = await openSearchClient.bulk({
    index: process.env.OPENSEARCH_INDEX,
    pipeline: process.env.OPENSEARCH_PIPELINE,
    timeout: "1s",
    body: [
      // index content for the page we're targeting
      // (using the Upsert operation doesn't process the pipeline)
      {
        index: {
          _id: uuid(result.canonical, namespace),
        },
      },
      {
        canonical_url: result.canonical,
        content: result.content,
        description: result.description,
        etag: result.etag,
        last_scraped: new Date(),
        last_updated: result.lastModified,
        title: result.title,
      },

      // if the canonical URL is different from the page URL, delete the old one
      ...(url.toString() === result.canonical
        ? []
        : [
            {
              delete: {
                _id: uuid(url.toString(), namespace),
              },
            },
          ]),
    ],
  });
  for (const item of bulkResponse.body.items) {
    for (const [key, value] of Object.entries(item)) {
      if (value.error) {
        if (key === "create" && value.status === 409) {
          // ignore conflict errors for create operations, indicates this is already queued
        } else {
          console.error(`Error in bulk response: ${key}`, value.error);
        }
      }
    }
  }
  if (bulkResponse.warnings) {
    console.warn("Bulk warnings:", bulkResponse.warnings);
  }

  console.log("Indexed page content:", result.canonical);
}

enum SelectionStrategy {
  Random = "random",
  // RandomByUrlBase reduces the bias towards large sites with many URLs
  // and allows us to scrape a more diverse set of sites
  RandomByUrlBase = "random_by_url_base",
}

async function selectAndLock(strategy: SelectionStrategy): Promise<
  ReadonlyArray<{
    id: ScrapedUrl["id"];
    path: ScrapedUrl["path"];
    etag: ScrapedUrl["etag"];
    last_modified: ScrapedUrl["last_modified"];
    url_prefix: UrlBase["url_prefix"];
  }>
> {
  const lockName = os.hostname() || process.pid;
  switch (strategy) {
    case SelectionStrategy.Random:
      return sql<
        ReadonlyArray<{
          id: ScrapedUrl["id"];
          path: ScrapedUrl["path"];
          etag: ScrapedUrl["etag"];
          last_modified: ScrapedUrl["last_modified"];
          url_prefix: UrlBase["url_prefix"];
        }>
      >`
      WITH locked AS (
        UPDATE scraped_urls
        SET lock = ROW(${localsName}::text, NOW())
        WHERE id = (
          SELECT id from scraped_urls
          WHERE
           last_check_time IS NULL
           AND lock IS NULL
          ORDER BY RANDOM()
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, url_base_id, path, etag, last_modified
      )
      SELECT locked.id, locked.path, locked.etag, locked.last_modified, url_bases.url_prefix
      FROM locked
      JOIN url_bases ON locked.url_base_id = url_bases.id;
      `;
    case SelectionStrategy.RandomByUrlBase: {
      // First, select a random url_base_id that has unchecked URLs
      const [{ id } = {}] = await sql<ReadonlyArray<{ id: UrlBase["id"] }>>`
      SELECT id
      FROM url_bases
      WHERE EXISTS (
        SELECT 1 FROM scraped_urls WHERE scraped_urls.url_base_id = url_bases.id
      )
      ORDER BY RANDOM()
      LIMIT 1
      `;
      if (!id) {
        throw new Error("No URL base ID found");
      }

      // Lock and select a random scraped_url for that url_base_id
      return sql<
        ReadonlyArray<{
          id: ScrapedUrl["id"];
          path: ScrapedUrl["path"];
          etag: ScrapedUrl["etag"];
          last_modified: ScrapedUrl["last_modified"];
          url_prefix: UrlBase["url_prefix"];
        }>
      >`
      WITH locked AS (
        UPDATE scraped_urls
        SET lock = ROW(${lockName}::text, NOW())
        WHERE id = (
          SELECT id FROM scraped_urls
          WHERE
            url_base_id = ${id}
            AND last_check_time IS NULL
            AND lock IS NULL
          ORDER BY RANDOM()
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, url_base_id, path, etag, last_modified
      )
      SELECT locked.id, locked.path, locked.etag, locked.last_modified, url_bases.url_prefix
      FROM locked
      JOIN url_bases ON locked.url_base_id = url_bases.id;
    `;
    }
    default:
      throw new Error(`Unknown selection strategy: ${strategy}`);
  }
}

async function lockAndProcess() {
  const unchecked = await selectAndLock(SelectionStrategy.RandomByUrlBase);

  if (unchecked.length === 0) {
    console.warn("No URLs to check");
    return;
  }

  try {
    await scrapeAndStore(unchecked[0]);
  } catch (err) {
    console.error("Error in scrapeAndStore:", err);
  } finally {
    // unlock
    await sql<never>`
        UPDATE scraped_urls
        SET lock = NULL
        WHERE id = ${unchecked[0].id};
        `;
  }
}

let keepRunning = true;
process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down after next scrape...");
  keepRunning = false;
});

async function main() {
  while (keepRunning) {
    try {
      await lockAndProcess();
    } catch (err) {
      console.error("Error in main loop:", err);
    }
  }
}

main()
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  })
  .then(() => {
    process.exit(0);
  });
