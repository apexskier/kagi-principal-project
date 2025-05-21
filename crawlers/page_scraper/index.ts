import * as htmlparser2 from "htmlparser2";
import sql from "./db";
import render from "dom-serializer";
import type { Document } from "domhandler";
import { Client as OpenSearchClient } from "@opensearch-project/opensearch";
import { v5 as uuid } from "uuid";

// use v5 uuid to generate a unique id for the document based on the URL
// can't use urls directly because of size constraints with the opensearch bulk API

const namespace = "1f0365d8-2a44-6ef0-a5ff-7804559ef9c4";

const config = {
  OPENSEARCH_HOST: "http://localhost:9200",
  OPENSEARCH_INDEX: "page_content_1",
  OPENSEARCH_PIPELINE: "content_pipeline_1",
};

const version = "dev";
const sharedHeaders = {
  "User-Agent": `ApexskierScraper/${version}`,
};

function findTitle(document: Document): string | null {
  // first look for a <title> tag
  const titleNode = htmlparser2.DomUtils.findOne(
    (element) => element.name === "title",
    document
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
    document
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
    document
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
    return render(mainNode);
  }

  // fall back to role="main"
  const roleMainNode = htmlparser2.DomUtils.findOne(
    (element) => element.attribs.role === "main",
    document
  );
  if (roleMainNode) {
    return render(roleMainNode);
  }

  // fall back to <body> tag
  const bodyNode = htmlparser2.DomUtils.findOne(
    (element) => element.name === "body",
    document
  );
  if (bodyNode) {
    return render(bodyNode);
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
        document
      ).map((element) => element.attribs.href.trim())
    )
  ).map((href) => new URL(href, base));
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

export async function scrape(
  page: URL,
  meta: {
    etag: string | null;
    lastModified: Date | null;
  }
) {
  console.log("Initial HEAD request to:", page.toString());
  // first perform a HEAD request for a lighter weight check
  const headResponse = await fetch(page, {
    method: "HEAD",
    redirect: "follow",
    ...sharedHeaders,
  });
  if (!headResponse.ok) {
    throw new Error(`Failed to fetch page: ${headResponse.status}`);
  }
  if (headResponse.status !== 200) {
    throw new Error(`Failed to fetch page HEAD: ${headResponse.status}`);
  }

  // verify content type is html
  const contentType = headResponse.headers.get("content-type");
  if (!contentType || !contentType.startsWith("text/html")) {
    throw new Error(`Invalid content type: ${contentType}`);
  }

  // check etag
  const etag = parseETag(headResponse.headers.get("etag"));
  if (etag && etag === meta.etag) {
    console.log("ETag matches, no update needed");
    return null;
  }

  // check last modified
  const lastModified = headResponse.headers.get("last-modified");
  if (lastModified) {
    const lastModifiedDate = new Date(lastModified);
    if (meta.lastModified && lastModifiedDate <= meta.lastModified) {
      console.log("Last modified date matches, no update needed");
      return null;
    }
  }

  // if we get here, we need to do a full fetch
  console.log("Full page request to:", page.toString());
  const fullResponse = await fetch(page, {
    method: "GET",
    redirect: "follow",
    ...sharedHeaders,
  });
  if (!fullResponse.ok) {
    throw new Error(`Failed to fetch page: ${fullResponse.status}`);
  }
  if (fullResponse.status !== 200) {
    throw new Error(`Failed to fetch page HEAD: ${fullResponse.status}`);
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
  const hrefs = findHrefs(document, page);
  const canonical = htmlparser2.DomUtils.findOne(
    (element) =>
      element.name === "link" &&
      element.attribs.rel === "canonical" &&
      !!element.attribs.href.trim(),
    document
  )?.attribs.href;

  return {
    etag: newEtag,
    lastModified: newDateModified,
    title,
    description,
    content,
    hrefs,
    canonical,
  };
}

const client = new OpenSearchClient({
  node: config.OPENSEARCH_HOST,
  auth: {
    username: "admin",
    password: process.env.OPENSEARCH_INITIAL_ADMIN_PASSWORD || "",
  },
});

async function job(url: URL) {
  console.log("Scraping page:", url.toString());

  const result = await scrape(url, {
    etag: null,
    lastModified: null,
  });
  if (!result || !result.canonical) {
    return;
  }

  const bulkResponse = await client.bulk({
    index: config.OPENSEARCH_INDEX,
    pipeline: config.OPENSEARCH_PIPELINE,
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

async function main() {
  // atomically select and lock a random URL that hasn't been scraped yet

  const unchecked = await sql`
      WITH locked AS (
        UPDATE scraped_urls
        SET lock = ROW(${process.pid}::text, NOW())
        WHERE id = (
          SELECT id from scraped_urls
          WHERE
           last_check_time IS NULL
           AND lock IS NULL
          ORDER BY RANDOM()
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, url_base_id, path
      )
      SELECT locked.id, locked.path, url_bases.url_prefix
      FROM locked
      JOIN url_bases ON locked.url_base_id = url_bases.id;
      `;

  if (unchecked.length === 0) {
    console.log("No URLs to check");
    return;
  }

  try {
    const url = new URL(
      unchecked[0].path,
      `https://${unchecked[0].url_prefix}`
    );
    await job(url);
  } catch (err) {
    console.error("Error in job:", err);
  } finally {
    // unlock
    await sql`
        UPDATE scraped_urls
        SET lock = NULL
        WHERE id = ${unchecked[0].id};
        `;
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
}).then(() => {
  process.exit(0);
});
