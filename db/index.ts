import postgres from "postgres";

export interface UrlBase {
  id: number;
  url_prefix: string;
}

export interface ScrapedUrl {
  id: number;
  url_base_id: number;
  path: string;
  etag: string | null;
  last_modified: Date | null;
  no_scrape_before: Date | null;
  last_check_time: Date | null;
  last_scrape_status: number | null;
  lock: unknown | null;
}

// configuration is always via psql environment variables
export default postgres();
