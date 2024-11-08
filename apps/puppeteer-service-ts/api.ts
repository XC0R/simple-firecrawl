import express from 'express';
import type { Request, Response } from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import Hero, { Resource, WebsocketResource } from '@ulixee/hero';
import Core from '@ulixee/hero-core';
import { TransportBridge } from '@ulixee/net';
import { ConnectionToHeroCore } from '@ulixee/hero';
import { getError } from "./helpers/get_error";

dotenv.config();

const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3003;
const HERO_CORE_PORT = process.env.HERO_CORE_PORT ? parseInt(process.env.HERO_CORE_PORT, 10) : 1337;
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY) || 2;

let heroCore: Core;
let connectionToCore: ConnectionToHeroCore;

app.use(bodyParser.json());

interface UrlModel {
  url: string;
  wait_after_load?: number;
  timeout?: number;
  headers?: { [key: string]: string };
  check_selector?: string;
}

const isValidUrl = (urlString: string): boolean => {
  try {
    new URL(urlString);
    return true;
  } catch (_) {
    return false;
  }
};

async function initializeHeroCore(): Promise<void> {
  try {
    const bridge = new TransportBridge();
    connectionToCore = new ConnectionToHeroCore(bridge.transportToCore);
    
    heroCore = new Core({
      maxConcurrentClientCount: MAX_CONCURRENCY
    });
    
    heroCore.addConnection(bridge.transportToClient);
    await Core.start();
    await connectionToCore.connect();
    
    console.log('Hero Core started and connected successfully');
    console.log(`Max concurrent sessions: ${MAX_CONCURRENCY}`);
  } catch (error) {
    console.error('Failed to start Hero Core:', error);
    process.exit(1);
  }
}

app.post("/scrape", async (req: Request, res: Response) => {
  const {
    url,
    wait_after_load = 0,
    timeout = 60000,
    headers,
    check_selector,
  }: UrlModel = req.body;

  console.log(`\n================= Scrape Request =================`);
  console.log(`URL: ${url}`);
  console.log(`Wait After Load: ${wait_after_load}`);
  console.log(`Timeout: ${timeout}`);
  console.log(`Headers: ${headers ? JSON.stringify(headers) : "None"}`);
  console.log(`Check Selector: ${check_selector ? check_selector : "None"}`);
  console.log(`==================================================`);

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({ error: "Invalid URL" });
  }

  let pageContent: string | null = null;
  let pageStatusCode: number | null = null;
  let heroInstance: Hero | undefined;
  const startTime = Date.now();

  try {
    heroInstance = new Hero({ 
      connectionToCore,
      userAgent: headers?.['User-Agent'] || 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/109.0'
    });

    const tab = await heroInstance.activeTab;

    if (headers) {
      tab.on('resource', (resource: Resource | WebsocketResource) => {
        if ('request' in resource && 'headers' in resource.request) {
          Object.entries(headers).forEach(([key, value]) => {
            if (typeof value === 'string') {
              resource.request.headers[key] = value;
            }
          });
        }
      });
    }

    // Wait for navigation to complete and get response
    const resource = await tab.goto(url, {
      timeoutMs: timeout
    });
    
    pageStatusCode = resource.response.statusCode;

    // Wait for page to be stable first
    await tab.waitForPaintingStable();

    // Check for required selector if specified
    if (check_selector) {
      await tab.waitForElement(tab.querySelector(check_selector), {
        timeoutMs: timeout,
      });
    }

    // Wait additional time if specified
    if (wait_after_load > 0) {
      await tab.waitForMillis(wait_after_load);
    }

    // Get the page content
    const documentElement = await tab.document.documentElement;
    pageContent = await documentElement.innerHTML;

  } catch (error) {
    console.error('Scraping error:', error);
    return res.status(500).json({
      error: 'Failed to scrape the page',
      details: error instanceof Error ? error.message : String(error)
    });
  } finally {
    if (heroInstance) {
      await heroInstance.close().catch(console.error);
    }
  }

  const errorMessage = getError(pageStatusCode);
  const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);

  // Log success/failure based on error message
  if (!errorMessage) {
    console.log(`✅ Scrape of ${url} successful! (${executionTime}s)`);
  } else {
    console.log(`🚨 Scrape of ${url} failed: ${pageStatusCode} - ${errorMessage}`);
  }

  res.json({
    content: pageContent,
    pageStatusCode,
    pageError: errorMessage,
  });
});

app.get('/health', async (_req: Request, res: Response) => {
  try {
    if (!heroCore) {
      return res.status(503).json({ 
        status: 'error',
        message: 'Hero Core not initialized'
      });
    }
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(503).json({ 
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

const shutdown = async () => {
  console.log('\nShutting down server...');
  
  try {
    await Core.shutdown();
    console.log('Hero Core shut down successfully');
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

(async () => {
  await initializeHeroCore();
  
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
})().catch(console.error);

export default app;