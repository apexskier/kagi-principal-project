import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import ejs from "ejs";
import { Client as OpenSearchClient } from "@opensearch-project/opensearch";
import pinoHttp from "pino-http";
import sql, { UrlBase } from "../db";

const logger = pinoHttp({
  level: process.env.LOG_LEVEL || "trace",
  serializers: {
    req: ({ method, url, query, parameters }) => ({
      method,
      url,
      query,
      parameters,
    }),
  },
  base: { hostname: os.hostname(), v: process.env.VERSION },
});

const app = express();
app.use(logger);

const indexHtmlPath = path.join(__dirname, "index.html");
const indexHtmlContent = fs.readFileSync(indexHtmlPath, "utf-8");

app.get("/", (req, res) => {
  res.send(indexHtmlContent);
});

const openSearchClient = new OpenSearchClient({
  node: process.env.OPENSEARCH_HOST,
});

const resultsTemplatePath = path.join(__dirname, "results.ejs");
const resultsTemplateContent = fs.readFileSync(resultsTemplatePath, "utf-8");
const resultsTemplate = ejs.compile(resultsTemplateContent);

app.get("/search", async (req, res) => {
  if (typeof req.query.q !== "string") {
    res
      .status(400)
      .send(
        "Bad Request: 'q' query parameter is required and must be a string.",
      );
    return;
  }

  const query = req.query.q.trim();
  const results = await openSearchClient.search({
    index: process.env.OPENSEARCH_INDEX,
    body: {
      query: {
        match: {
          content_cleaned: {
            query,
            fuzziness: "AUTO",
            operator: "and",
          },
        },
      },
      docvalue_fields: ["canonical_url", "last_scraped"],
      fields: ["title", "description"],
      _source: false,
      size: 10,
      from: 0,
      timeout: "50ms", // wow, this works better than I expected
      highlight: {
        fields: {
          content_cleaned: {
            fragment_size: 150,
            number_of_fragments: 1,
            pre_tags: [""], // TODO: there's an escaping issue here - content_cleaned can still have HTML (example at https://css-tricks.com/one-of-those-onboarding-uis-with-anchor-positioning/)
            post_tags: [""],
          },
        },
      },
    },
  });

  const parameters = {
    q: query,
    took_ms: results.body.took,
    results: results.body.hits.hits.map((hit) => ({
      id: hit._id,
      highlight: hit.highlight,
      fields: Object.fromEntries(
        Object.entries(hit.fields as object).map(([key, value]) => {
          if (Array.isArray(value)) {
            return [key, value[0]];
          }
          return [key, value];
        }),
      ),
    })),
  };
  const resultsHtml = resultsTemplate(parameters);

  res.send(resultsHtml);
});

const statsTemplatePath = path.join(__dirname, "stats.ejs");
const statsTemplateContent = fs.readFileSync(statsTemplatePath, "utf-8");
const statsTemplate = ejs.compile(statsTemplateContent);

app.get("/stats", async (req, res) => {
  const after = (req.query.after as string | null) || null;

  const [results, [totalTrackedResult, totalScrapedResult]] = await Promise.all(
    [
      sql<
        ReadonlyArray<{
          url_base_id: UrlBase["id"];
          url_prefix: UrlBase["url_prefix"];
          scraped_url_count: number;
          checked_url_count: number;
        }>
      >`
      SELECT
        url_bases.id AS url_base_id,
        url_bases.url_prefix,
        COUNT(scraped_urls.id) AS scraped_url_count,
        COUNT(CASE WHEN scraped_urls.last_check_time IS NOT NULL THEN 1 END) AS checked_url_count
      FROM
        url_bases
      LEFT JOIN
        scraped_urls ON scraped_urls.url_base_id = url_bases.id
      WHERE
        url_bases.id > COALESCE(${after}, 0)
      GROUP BY
        url_bases.id, url_bases.url_prefix
      ORDER BY
        url_bases.id
      LIMIT 20;
    `,
      sql`
    SELECT COUNT(*) AS count FROM scraped_urls;
    SELECT COUNT(*) AS count FROM scraped_urls WHERE last_check_time IS NOT NULL;`.simple(),
    ],
  );

  const total_tracked = parseInt(totalTrackedResult[0].count, 10);
  const total_scraped = parseInt(totalScrapedResult[0].count, 10);

  let lang = "en-US";
  const langs = req.acceptsLanguages();
  if (langs.length > 0 && langs[0] !== "*") {
    lang = langs[0];
  }

  const statsHtml = statsTemplate({
    after: after != "0",
    results,
    total_tracked,
    total_scraped,
    human_percentage: new Intl.NumberFormat(lang, {
      style: "percent",
    }).format(total_scraped / total_tracked),
  });
  res.send(statsHtml);
});

const port = 3000;
const server = app.listen(port, (err) => {
  if (err) {
    throw err;
  }
  logger.logger.info("Server is listening on port %d", port);
});

function gracefullyShutdown() {
  server.close(() => {
    logger.logger.info("Server closed");
  });
}

// gracefully shutdown on Ctrl-C
process.on("SIGINT", gracefullyShutdown);
// gracefully shutdown when K8s sends a SIGTERM
process.on("SIGTERM", gracefullyShutdown);
