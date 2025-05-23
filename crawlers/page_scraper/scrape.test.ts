import test from "node:test";
import assert from "node:assert/strict";
import pino from "pino";
import pinoTest from "pino-test";
import { NoIndex, NoUpdateNeeded, scrape } from "./scrape";

async function passthroughHead(
  _: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  assert.equal(init?.method, "HEAD");
  return new Response("mocked body", {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}

test.describe("scrape", () => {
  test("scrapes page info", async () => {
    const stream = pinoTest.sink();
    const logger = pino(stream);

    global.fetch = stub([
      passthroughHead,
      async (_, init): Promise<Response> => {
        assert.equal(init?.method, "GET");
        return new Response(
          `
<!doctype html>
<html lang="en">
<head></head>
<body>
  <h1>Test</h1>
  <p>This is a test page.</p>
  <a href="https://example.com/next">Next</a>
  <link rel="canonical" href="https://example.com/canonical">
</body>
</html>
          `,
          {
            status: 200,
            headers: { "Content-Type": "text/html" },
          },
        );
      },
    ]);

    const results = await scrape(
      new URL("https://example.com"),
      {
        id: 1,
        priorEtag: null,
        priorLastModified: null,
      },
      logger,
    );

    assert.deepEqual(results, {
      canonical: "https://example.com/canonical",
      content: `<body>
  <h1>Test</h1>
  <p>This is a test page.</p>
  <a href="https://example.com/next">Next</a>
  <link rel="canonical" href="https://example.com/canonical">
</body>`,
      description: null,
      etag: null,
      hrefs: [new URL("https://example.com/next")],
      lastModified: null,
      status: 200,
      title: null,
    });
  });

  test.describe("HEAD request bailouts", () => {
    test("won't index non-html", async () => {
      const stream = pinoTest.sink();
      const logger = pino(stream);

      global.fetch = async (_, init): Promise<Response> => {
        assert.equal(init?.method, "HEAD");
        return new Response("mocked body", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      };

      const results = await scrape(
        new URL("https://example.com"),
        {
          id: 1,
          priorEtag: null,
          priorLastModified: null,
        },
        logger,
      );

      assert.equal(results, NoIndex);
    });

    test("won't index noindex header", async () => {
      const stream = pinoTest.sink();
      const logger = pino(stream);

      global.fetch = async (_, init): Promise<Response> => {
        assert.equal(init?.method, "HEAD");
        return new Response("mocked body", {
          status: 200,
          headers: {
            "Content-Type": "text/html",
            "X-Robots-Tag": "noindex",
          },
        });
      };

      const results = await scrape(
        new URL("https://example.com"),
        {
          id: 1,
          priorEtag: null,
          priorLastModified: null,
        },
        logger,
      );

      assert.equal(results, NoIndex);
    });

    test("handles errors in HEAD request", async () => {
      const stream = pinoTest.sink();
      const logger = pino(stream);

      global.fetch = async (_, init): Promise<Response> => {
        assert.equal(init?.method, "HEAD");
        throw new Error("Network error");
      };

      const results = await scrape(
        new URL("https://example.com"),
        {
          id: 1,
          priorEtag: null,
          priorLastModified: null,
        },
        logger,
      );

      assert.deepEqual(results, { failedStatus: 599 });
    });

    test("handles failures in HEAD request", async () => {
      const stream = pinoTest.sink();
      const logger = pino(stream);

      global.fetch = async (_, init): Promise<Response> => {
        assert.equal(init?.method, "HEAD");
        return new Response("mocked body", {
          status: 456,
          headers: { "Content-Type": "text/html" },
        });
      };

      const results = await scrape(
        new URL("https://example.com"),
        {
          id: 1,
          priorEtag: null,
          priorLastModified: null,
        },
        logger,
      );

      assert.deepEqual(results, { failedStatus: 456 });
    });

    test("bails out if etag matches priorEtag", async () => {
      const stream = pinoTest.sink();
      const logger = pino(stream);

      global.fetch = async (_, init): Promise<Response> => {
        assert.equal(init?.method, "HEAD");
        return new Response("mocked body", {
          status: 200,
          headers: {
            "Content-Type": "text/html",
            ETag: '"abc123"',
          },
        });
      };

      const results = await scrape(
        new URL("https://example.com"),
        {
          id: 1,
          priorEtag: "abc123",
          priorLastModified: null,
        },
        logger,
      );

      assert.equal(results, NoUpdateNeeded);
    });

    test("bails out if last-modified matches priorLastModified", async () => {
      const stream = pinoTest.sink();
      const logger = pino(stream);

      const lastModified = "Wed, 21 Oct 2015 07:28:00 GMT";
      global.fetch = async (_, init): Promise<Response> => {
        assert.equal(init?.method, "HEAD");
        return new Response("mocked body", {
          status: 200,
          headers: {
            "Content-Type": "text/html",
            "Last-Modified": lastModified,
          },
        });
      };

      const results = await scrape(
        new URL("https://example.com"),
        {
          id: 1,
          priorEtag: null,
          priorLastModified: new Date(lastModified),
        },
        logger,
      );

      assert.equal(results, NoUpdateNeeded);
    });
  });

  test.describe("GET request bailouts", () => {
    test("won't index noindex meta tag", async () => {
      const stream = pinoTest.sink();
      const logger = pino(stream);

      global.fetch = stub([
        passthroughHead,
        async (_, init): Promise<Response> => {
          assert.equal(init?.method, "GET");
          return new Response(
            `
  <!doctype html>
  <html lang="en">
  <head>
    <meta name="robots" content="noindex">
  </head>
  <body>
    <h1>Test</h1>
  </body>
  </html>
        `,
            {
              status: 200,
              headers: { "Content-Type": "text/html" },
            },
          );
        },
      ]);

      const results = await scrape(
        new URL("https://example.com"),
        {
          id: 1,
          priorEtag: null,
          priorLastModified: null,
        },
        logger,
      );

      assert.equal(results, NoIndex);
    });

    test("returns empty hrefs if nofollow in header", async () => {
      const stream = pinoTest.sink();
      const logger = pino(stream);

      global.fetch = stub([
        async (_, init): Promise<Response> => {
          assert.equal(init?.method, "HEAD");
          return new Response("mocked body", {
            status: 200,
            headers: {
              "Content-Type": "text/html",
              "X-Robots-Tag": "nofollow",
            },
          });
        },
        async (_, init): Promise<Response> => {
          assert.equal(init?.method, "GET");
          return new Response(
            `
  <!doctype html>
  <html lang="en">
  <head></head>
  <body>
    <a href="https://example.com/next">Next</a>
  </body>
  </html>
        `,
            {
              status: 200,
              headers: { "Content-Type": "text/html" },
            },
          );
        },
      ]);

      const results = await scrape(
        new URL("https://example.com"),
        {
          id: 1,
          priorEtag: null,
          priorLastModified: null,
        },
        logger,
      );

      assert.deepEqual(
        (results as { hrefs: URL[]; failedStatus: number })?.hrefs,
        [],
      );
    });

    test("returns empty hrefs if nofollow in meta tag", async () => {
      const stream = pinoTest.sink();
      const logger = pino(stream);

      global.fetch = stub([
        passthroughHead,
        async (_, init): Promise<Response> => {
          assert.equal(init?.method, "GET");
          return new Response(
            `
  <!doctype html>
  <html lang="en">
  <head>
    <meta name="robots" content="nofollow">
  </head>
  <body>
    <a href="https://example.com/next">Next</a>
  </body>
  </html>
        `,
            {
              status: 200,
              headers: { "Content-Type": "text/html" },
            },
          );
        },
      ]);

      const results = await scrape(
        new URL("https://example.com"),
        {
          id: 1,
          priorEtag: null,
          priorLastModified: null,
        },
        logger,
      );

      assert.deepEqual(
        (results as { hrefs: URL[]; failedStatus: number })?.hrefs,
        [],
      );
    });

    test("filters out non-https and duplicate hrefs", async () => {
      const stream = pinoTest.sink();
      const logger = pino(stream);

      global.fetch = stub([
        passthroughHead,
        async (_, init): Promise<Response> => {
          assert.equal(init?.method, "GET");
          return new Response(
            `
  <!doctype html>
  <html lang="en">
  <head></head>
  <body>
    <a href="http://example.com/should-not-include">HTTP Link</a>
    <a href="https://example.com/">Root Link</a>
    <a href="https://example.com/next">Next</a>
    <a href="https://example.com/next">Next Duplicate</a>
    <a href="https://example.com">Self Link</a>
  </body>
  </html>
        `,
            {
              status: 200,
              headers: { "Content-Type": "text/html" },
            },
          );
        },
      ]);

      const results = await scrape(
        new URL("https://example.com"),
        {
          id: 1,
          priorEtag: null,
          priorLastModified: null,
        },
        logger,
      );

      assert.deepEqual(
        (results as { hrefs: URL[]; failedStatus: number })?.hrefs,
        [new URL("https://example.com/next")],
      );
    });

    test("parses etag and last-modified headers", async () => {
      const stream = pinoTest.sink();
      const logger = pino(stream);

      global.fetch = stub([
        passthroughHead,
        async (_, init): Promise<Response> => {
          assert.equal(init?.method, "GET");
          return new Response(
            `
  <!doctype html>
  <html lang="en">
  <head></head>
  <body>
    <h1>Test</h1>
  </body>
  </html>
        `,
            {
              status: 200,
              headers: {
                "Content-Type": "text/html",
                ETag: '"abc123"',
                "Last-Modified": "Wed, 21 Oct 2015 07:28:00 GMT",
              },
            },
          );
        },
      ]);

      const results = await scrape(
        new URL("https://example.com"),
        {
          id: 1,
          priorEtag: null,
          priorLastModified: null,
        },
        logger,
      );

      assert.equal(
        (results as { etag: string; failedStatus: number })?.etag,
        "abc123",
      );
      assert.deepEqual(
        (results as { lastModified: Date; failedStatus: number })?.lastModified,
        new Date("Wed, 21 Oct 2015 07:28:00 GMT"),
      );
    });

    test("won't index error in GET request", async () => {});
  });
});

// utility function to create a stub that can have different behavior when called repeatedly
function stub<
  Args extends unknown[],
  Return,
  T extends (...args: Args) => Return,
>(responses: T[]) {
  let count = 0;
  test.after(() => {
    if (count < responses.length) {
      assert.fail(
        `Mock function was not called enough times. Expected ${responses.length} but got ${count}.`,
      );
    }
  });
  return (...args: Args): Return => {
    if (count >= responses.length) {
      assert.fail(
        `Mock function called more times than expected. Expected ${responses.length} but got ${count + 1}.`,
      );
    }
    const result = responses[count](...args);
    count++;
    return result;
  };
}
