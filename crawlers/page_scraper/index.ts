import os from "node:os";
import { Client as OpenSearchClient } from "@opensearch-project/opensearch";
import { v5 as uuid } from "uuid";
import { localsName } from "ejs";
import pino from "pino";
import sql, { ScrapedUrl, UrlBase } from "../../db";
import { isFailedStatus, NoIndex, NoUpdateNeeded, scrape } from "./scrape";

const rootLogger = pino({
  level: process.env.LOG_LEVEL || "trace",
  base: { hostname: os.hostname(), v: process.env.VERSION },
});

// we use v5 uuid to generate a unique id for the document based on the URL
// can't use urls directly because of size constraints with the opensearch bulk API

const namespace = "1f0365d8-2a44-6ef0-a5ff-7804559ef9c4";

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
  const logger = rootLogger.child({ url: url.toString() });

  logger.info("scraping page");

  const result = await scrape(
    url,
    {
      id: item.id,
      priorEtag: item.etag,
      priorLastModified: item.last_modified,
    },
    logger,
  ).catch<ReturnType<typeof scrape>>(async (err) => {
    logger.error({ err, msg: "error in scrape" });
    await sql<never>`
    UPDATE scraped_urls
    SET
      last_check_time = NOW(),
      last_scrape_status = 0
      no_scrape_before = NOW() + INTERVAL '1 hour'
    WHERE id = ${item.id};
    `;
    return NoUpdateNeeded;
  });

  // Update scrape status
  if (result == NoUpdateNeeded || result === NoIndex) {
    logger.info("no update needed");
    await sql<never>`
    UPDATE scraped_urls
    SET
      last_check_time = NOW(),
      no_scrape_before = NOW() + INTERVAL '1 day'
    WHERE id = ${item.id};
  `;
    return;
  }
  if (isFailedStatus(result)) {
    await sql<never>`
    UPDATE scraped_urls
    SET
      last_check_time = NOW(),
      last_scrape_status = ${result.failedStatus},
      no_scrape_before = NOW() + INTERVAL '1 week'
    WHERE id = ${item.id};
  `;
    return;
  }

  await sql<never>`
    UPDATE scraped_urls
    SET
      etag = ${result.etag},
      last_check_time = NOW(),
      last_scrape_status = ${result.status},
      no_scrape_before = ${result.nextScrapeAfter}
    WHERE id = ${item.id};
  `;

  // add hrefs to the scraped_urls table in bulk
  // TODO: merge into one query, dynamically generating the insert statement
  for (const href of result.hrefs) {
    await queueHref(href, logger.child({ href: href.toString() }));
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
          logger.error({
            err: value.error,
            msg: "error in bulk response",
            key,
          });
        }
      }
    }
  }
  if (bulkResponse.warnings) {
    logger.warn({ msg: "bulk warnings:", warnings: bulkResponse.warnings });
  }

  logger.info({ msg: "indexed page content to", canonical: result.canonical });
}

enum SelectionStrategy {
  Random = "random",
  // RandomByUrlBase reduces the bias towards large sites with many URLs
  // and allows us to scrape a more diverse set of sites
  RandomByUrlBase = "random_by_url_base",
}

async function queueHref(href: URL, logger: pino.Logger) {
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
      logger.debug("href already in table or not allowed");
    } else {
      logger.debug("queued");
    }
  } catch (err) {
    logger.error({ err, msg: "error queing href" });
  }
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
    rootLogger.warn("no urls to check");
    return;
  }

  try {
    await scrapeAndStore(unchecked[0]);
  } catch (err) {
    rootLogger.error({ err, msg: "error in scrapeAndStore" });
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
// gracefully shutdown on Ctrl-C
process.on("SIGINT", () => {
  rootLogger.info("SIGINT received, shutting down after next scrape...");
  keepRunning = false;
});
// gracefully shutdown when K8s sends a SIGTERM
process.on("SIGTERM", () => {
  rootLogger.info("SIGTERM received, shutting down after next scrape...");
  keepRunning = false;
});

async function main() {
  while (keepRunning) {
    try {
      await lockAndProcess();
    } catch (err) {
      rootLogger.error({ err, msg: "error in main loop" });
    }
  }
}

main()
  .catch((err) => {
    rootLogger.fatal(err);
    process.exit(1);
  })
  .then(() => {
    process.exit(0);
  });
