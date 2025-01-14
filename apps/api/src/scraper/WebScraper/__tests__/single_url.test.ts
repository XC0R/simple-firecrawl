import { scrapeSingleUrl } from '../single_url';
import { PageOptions } from '../../../lib/entities';


jest.mock('../single_url', () => {
  const originalModule = jest.requireActual('../single_url');
  originalModule.fetchHtmlContent = jest.fn().mockResolvedValue('<html><head><title>Test</title></head><body><h1>Roast</h1></body></html>');

  return originalModule;
});

describe('scrapSingleUrl', () => {
  it('should handle includeHtml option correctly', async () => {
    const url = 'https://roastmywebsite.ai';
    const pageOptionsWithHtml: PageOptions = { includeHtml: true };
    const pageOptionsWithoutHtml: PageOptions = { includeHtml: false };

    const resultWithHtml = await scrapeSingleUrl("TEST", url, pageOptionsWithHtml);
    const resultWithoutHtml = await scrapeSingleUrl("TEST", url, pageOptionsWithoutHtml);

    expect(resultWithHtml.html).toBeDefined();
    expect(resultWithoutHtml.html).toBeUndefined();
  }, 10000);
});

it('should return a list of links on the firecrawl.ai page', async () => {
  const url = 'https://flutterbricks.com';
  const pageOptions: PageOptions = { includeHtml: true };

  const result = await scrapeSingleUrl("TEST", url, pageOptions);

  // Check if the result contains a list of links
  expect(result.linksOnPage).toBeDefined();
  expect(Array.isArray(result.linksOnPage)).toBe(true);
  expect(result.linksOnPage.length).toBeGreaterThan(0);
  expect(result.linksOnPage).toContain('https://flutterbricks.com/features')
}, 15000);
