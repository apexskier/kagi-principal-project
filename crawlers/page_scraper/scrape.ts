import * as htmlparser2 from "htmlparser2";
import domSerializer from "dom-serializer";
import type { Document } from "domhandler";
import pino from "pino";

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
      htmlparser2.DomUtils.findAll((element) => {
        if (element.name !== "a") {
          return false;
        }
        if (!element.attribs.href?.trim()) {
          return false;
        }
        // filter out hrefs that have nofollow
        if (
          element.attribs.rel &&
          element.attribs.rel
            .split(/\s+/)
            .map((rel: string) => rel.toLowerCase())
            .includes("nofollow")
        ) {
          return false;
        }
        return true;
      }, document).map((element) => element.attribs.href.trim()),
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

export const NoUpdateNeeded = Symbol("NoUpdateNeeded");
export type NoUpdateNeeded = typeof NoUpdateNeeded;

export const NoIndex = Symbol("NoIndex");
export type NoIndex = typeof NoIndex;

export function isFailedStatus<T>(
  x: T | { failedStatus: number },
): x is { failedStatus: number } {
  return (x as { failedStatus: number }).failedStatus !== undefined;
}

// checkHead uses a lighter weight HEAD request to check if the page has changed
// and if it should be indexed
async function checkHead(
  page: URL,
  etag: string | null,
  lastModified: Date | null,
  logger: pino.Logger,
) {
  logger.debug("HEAD request");

  // first perform a HEAD request for a lighter weight check
  const response = await fetch(page, {
    method: "HEAD",
    redirect: "follow",
    ...sharedHeaders,
  }).catch((err) => {
    // this can happen, for instance, if the SSL cert is bad
    logger.error({ err, msg: "error in HEAD request" });
    return new Response(null, { status: 599 });
  });
  if (response.status !== 200) {
    logger.error({ msg: "failed to HEAD", status: response.status });
    return { failedStatus: response.status };
  }

  const robotsHeader = response.headers.get("x-robots-tag");
  const { noindex, nofollow } = parseRobotsValue(robotsHeader);
  if (noindex) {
    logger.info("noindex header prevents indexing");
    return NoIndex;
  }

  // verify content type is html
  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.startsWith("text/html")) {
    // we only index html content
    logger.info("non-html content");
    return NoIndex;
  }

  // check etag
  const newEtag = parseETag(response.headers.get("etag"));
  if (newEtag && newEtag === etag) {
    logger.info("etag matches");
    return NoUpdateNeeded;
  }

  // check last modified
  if (lastModified) {
    const newLastModified = response.headers.get("last-modified");
    if (newLastModified) {
      const newLastModifiedDate = new Date(newLastModified);
      if (newLastModifiedDate && newLastModifiedDate <= lastModified) {
        logger.info("last modified date matches");
        return NoUpdateNeeded;
      }
    }
  }

  return { nofollow };
}

const defaultCacheAge = parseInt(process.env.DEFAULT_CACHE_AGE ?? "", 10);
if (!defaultCacheAge || isNaN(defaultCacheAge)) {
  throw new Error("DEFAULT_CACHE_AGE must be a number");
}

function getNextScrapeDate(response: Response): Date {
  const dates = [new Date(Date.now() + defaultCacheAge * 1000)];
  const cacheControl = response.headers.get("cache-control");
  if (cacheControl) {
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
    if (maxAgeMatch) {
      const seconds = parseInt(maxAgeMatch[1], 10);
      if (!isNaN(seconds)) {
        dates.push(new Date(Date.now() + seconds * 1000));
      }
    }
  }
  const expires = response.headers.get("expires");
  if (expires) {
    const expiresDate = new Date(expires);
    if (!isNaN(expiresDate.getTime())) {
      dates.push(expiresDate);
    }
  }
  // return the date furthest in the future
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

// scrape handles all page crawling and parsing. It does not write to any databases.
export async function scrape(
  page: URL,
  meta: {
    id: number;
    priorEtag: string | null;
    priorLastModified: Date | null;
  },
  logger: pino.Logger,
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
      nextScrapeAfter: Date;
    }
  | NoUpdateNeeded
  | NoIndex
  | { failedStatus: number }
> {
  const headResponse = await checkHead(
    page,
    meta.priorEtag,
    meta.priorLastModified,
    logger.child({ request: "head" }),
  );
  if (headResponse === NoIndex) {
    return NoIndex;
  }
  // TODO: verify version of indexed data is up to date, otherwise index anyways
  if (headResponse === NoUpdateNeeded) {
    return NoUpdateNeeded;
  }
  if (isFailedStatus(headResponse)) {
    // TODO: handle 429 errors (inspect retry headers, use that as nextScrapeAfter)
    return headResponse;
  }

  // if we get here, we need to do a full fetch
  logger.debug("GET request");
  const response = await fetch(page, {
    method: "GET",
    redirect: "follow",
    ...sharedHeaders,
  }).catch((err) => {
    // this can happen, for instance, if the SSL cert is bad
    logger.error({ err, msg: "error in GET request" });
    return new Response(null, { status: 599 });
  });
  if (response.status !== 200) {
    logger.error({ msg: "failed to GET", status: response.status });
    return { failedStatus: response.status };
  }

  const nextScrapeAfter = getNextScrapeDate(response);
  const newEtag = parseETag(response.headers.get("etag"));
  const newLastModified = response.headers.get("last-modified");
  const newDateModified = newLastModified ? new Date(newLastModified) : null;

  // This does't use htmlparser2's streaming interface because
  // we want to understand semantics before deciding how to handle content.
  // For example, we want to index only the body of the page if possible,
  // ignoring header and footer, but not all html documents use the <main> tag.
  // Main risk here is high memory usage for large pages.

  const document = htmlparser2.parseDocument(await response.text());

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
  const robots = parseRobotsValue(
    htmlparser2.DomUtils.findOne(
      (element) => element.name === "meta" && element.attribs.name === "robots",
      document,
    )?.attribs.content ?? null,
  );
  if (robots.noindex) {
    logger.info("noindex meta tag prevents indexing");
    return NoIndex;
  }

  // don't follow links if nofollow is set
  const hrefs =
    headResponse.nofollow || robots.nofollow ? [] : findHrefs(document, page);

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
    status: response.status,
    nextScrapeAfter,
  };
}
