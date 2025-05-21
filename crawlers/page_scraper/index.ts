import * as htmlparser2 from "htmlparser2";
import { WritableStream as htmlparser2WritableStream } from "htmlparser2/WritableStream";

const version = "dev";
const sharedHeaders = {
  "User-Agent": `ApexskierScraper/${version}`,
};

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

  await new Promise((resolve, reject) => {
    if (!fullResponse.body) {
      throw new Error("Response body is null");
    }

    const parserStream = new htmlparser2WritableStream({
      onopentag(name, attributes) {
        /*
         * This fires when a new tag is opened.
         *
         * If you don't need an aggregated `attributes` object,
         * have a look at the `onopentagname` and `onattribute` events.
         */
        if (name === "script" && attributes.type === "text/javascript") {
          console.log("JS! Hooray!");
        }
      },
      ontext(text) {
        /*
         * Fires whenever a section of text was processed.
         *
         * Note that this can fire at any point within text and you might
         * have to stitch together multiple pieces.
         */
        console.log("-->", text);
      },
      onclosetag(tagname) {
        /*
         * Fires when a tag is closed.
         *
         * You can rely on this event only firing when you have received an
         * equivalent opening tag before. Closing tags without corresponding
         * opening tags will be ignored.
         */
        if (tagname === "script") {
          console.log("That's it?!");
        }
      },
    });
    parserStream.on("finish", resolve);
    fullResponse.body.pipeTo(parserStream as any);
  });

  // htmlparser2.parseDocument(body, {
  //   lowerCaseTags: true,
  //   lowerCaseAttributeNames: true,
  //   recognizeSelfClosing: true,
  // });

  return { etag: newEtag, lastModified: newDateModified, body };
}

async function main() {
  console.log(
    await scrape(new URL("https://angular.io"), {
      etag: null,
      lastModified: null,
    })
  );
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
