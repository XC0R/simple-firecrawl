import { Response } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  legacyCrawlerOptions,
  mapRequestSchema,
  RequestWithAuth,
} from "./types";
import { crawlToCrawler, StoredCrawl } from "../../lib/crawl-redis";
import { MapResponse, MapRequest } from "./types";
import { configDotenv } from "dotenv";
import {
  checkAndUpdateURLForMap,
  isSameDomain,
  isSameSubdomain,
  removeDuplicateUrls,
} from "../../lib/validateUrl";
import { billTeam } from "../../services/billing/credit_billing";
import { performCosineSimilarity } from "../../lib/map-cosine";
import { Logger } from "../../lib/logger";

configDotenv();

export async function mapController(
  req: RequestWithAuth<{}, MapResponse, MapRequest>,
  res: Response<MapResponse>
) {
  const startTime = new Date().getTime();

  req.body = mapRequestSchema.parse(req.body);

  const limit: number = req.body.limit ?? 5000;

  const id = uuidv4();
  let links: string[] = [req.body.url];

  const sc: StoredCrawl = {
    originUrl: req.body.url,
    crawlerOptions: legacyCrawlerOptions(req.body),
    pageOptions: {},
    team_id: req.auth.team_id,
    createdAt: Date.now(),
    plan: req.auth.plan,
  };

  const crawler = crawlToCrawler(id, sc);

  const sitemap =
    req.body.ignoreSitemap ?? true ? null : await crawler.tryGetSitemap();

  if (sitemap !== null) {
    sitemap.map((x) => {
      links.push(x.url);
    });
  }

  // Perform cosine similarity between the search query and the list of links
  if (req.body.search) {
    const searchQuery = req.body.search.toLowerCase();

    links = performCosineSimilarity(links, searchQuery);
  }

  links = links
    .map((x) => {
      try {
        return checkAndUpdateURLForMap(x).url.trim();
      } catch (_) {
        return null;
      }
    })
    .filter((x) => x !== null);

  // allows for subdomains to be included
  links = links.filter((x) => isSameDomain(x, req.body.url));

  // if includeSubdomains is false, filter out subdomains
  if (!req.body.includeSubdomains) {
    links = links.filter((x) => isSameSubdomain(x, req.body.url));
  }

  // remove duplicates that could be due to http/https or www
  links = removeDuplicateUrls(links);

  billTeam(req.auth.team_id, 1).catch((error) => {
    Logger.error(
      `Failed to bill team ${req.auth.team_id} for 1 credit: ${error}`
    );
    // Optionally, you could notify an admin or add to a retry queue here
  });

  const endTime = new Date().getTime();
  const timeTakenInSeconds = (endTime - startTime) / 1000;

  const linksToReturn = links.slice(0, limit);

  return res.status(200).json({
    success: true,
    links: linksToReturn,
    scrape_id: req.body.origin?.includes("website") ? id : undefined,
  });
}
