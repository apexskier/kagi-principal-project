import express from "express";
import postgres from "postgres";
import ejs from "ejs";
import { Client as OpenSearchClient } from "@opensearch-project/opensearch";
import fs from "fs";
import path from "path";
import sql from "./db";

const namespace = "1f0365d8-2a44-6ef0-a5ff-7804559ef9c4";

const config = {
  OPENSEARCH_HOST: "http://localhost:9200",
  OPENSEARCH_INDEX: "page_content_1",
  OPENSEARCH_PIPELINE: "content_pipeline_1",
};

const app = express();
app.set("view engine", "ejs");
const port = 3000;

const indexHtmlPath = path.join(__dirname, "index.html");
const indexHtmlContent = fs.readFileSync(indexHtmlPath, "utf-8");

app.get("/", (req, res) => {
  res.send(indexHtmlContent);
});

const client = new OpenSearchClient({
  node: config.OPENSEARCH_HOST,
  auth: {
    username: "admin",
    password: process.env.OPENSEARCH_INITIAL_ADMIN_PASSWORD || "",
  },
});

const resultsTemplatePath = path.join(__dirname, "results.ejs");
const resultsTemplateContent = fs.readFileSync(resultsTemplatePath, "utf-8");
const resultsTemplate = ejs.compile(resultsTemplateContent);

app.get("/search", async (req, res) => {
  if (typeof req.query.q !== "string") {
    res
      .status(400)
      .send(
        "Bad Request: 'q' query parameter is required and must be a string."
      );
    return;
  }

  const query = req.query.q.trim();
  const results = await client.search({
    index: config.OPENSEARCH_INDEX,
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
      size: 10,
      from: 0,
      highlight: {
        fields: {
          content_cleaned: {
            fragment_size: 150,
            number_of_fragments: 3,
            pre_tags: ["<strong>"],
            post_tags: ["</strong>"],
          },
        },
      },
    },
  });

  if (results.body.hits.total === 0) {
    res.status(404).send("No results found.");
    return;
  }

  const resultsHtml = resultsTemplate({
    q: query,
    took_ms: results.body.took,
    results: results.body.hits.hits.map((hit) => ({
      id: hit._id,
      highlight: hit.highlight,
      source: hit._source,
    })),
  });

  res.send(resultsHtml);
});

const statsTemplatePath = path.join(__dirname, "stats.ejs");
const statsTemplateContent = fs.readFileSync(statsTemplatePath, "utf-8");
const statsTemplate = ejs.compile(statsTemplateContent);

app.get("/stats", async (req, res) => {
  const after = (req.query.after as string | null) || null;

  const results = await sql`
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
    `;

  const statsHtml = statsTemplate({ after, results });
  res.send(statsHtml);
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
