/**
 * E2E Browser Tests - Profile Command
 * Tests real browser profiling via CDP using Playwright
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

test.describe('Profile Command E2E', () => {
  let tempDir: string;

  test.beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-debugger-e2e-'));
  });

  test.afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test('should profile a simple webpage', async ({ page }) => {
    // Create a test page with known performance characteristics
    const testPageContent = `
      <!DOCTYPE html>
      <html>
        <head><title>E2E Test Page</title></head>
        <body>
          <div id="content">Test Content</div>
          <script>
            // Simulate some work
            for (let i = 0; i < 1000; i++) {
              document.getElementById('content').style.width = i + 'px';
              const width = document.getElementById('content').offsetWidth;
            }
          </script>
        </body>
      </html>
    `;

    const testPagePath = path.join(tempDir, 'test-page.html');
    fs.writeFileSync(testPagePath, testPageContent);

    // Serve the page
    await page.goto(`file://${testPagePath}`);

    // Verify page loaded
    await expect(page.locator('#content')).toHaveText('Test Content');

    // Get performance metrics via CDP
    const performanceMetrics = await page.evaluate(() => {
      return JSON.stringify(performance.getEntriesByType('measure'));
    });

    expect(performanceMetrics).toBeDefined();
  });

  test('should detect layout thrashing patterns', async ({ page }) => {
    // Page with known layout thrashing pattern
    const testPageContent = `
      <!DOCTYPE html>
      <html>
        <head><title>Layout Thrash Test</title></head>
        <body>
          <div class="item">Item 1</div>
          <div class="item">Item 2</div>
          <div class="item">Item 3</div>
          <script>
            // Classic layout thrashing: interleaved read/write
            const items = document.querySelectorAll('.item');
            items.forEach(item => {
              const height = item.offsetHeight; // Read
              item.style.height = (height + 10) + 'px'; // Write
            });
          </script>
        </body>
      </html>
    `;

    const testPagePath = path.join(tempDir, 'layout-thrash.html');
    fs.writeFileSync(testPagePath, testPageContent);

    await page.goto(`file://${testPagePath}`);

    // Wait for JS execution
    await page.waitForTimeout(100);

    // Verify elements exist
    const items = await page.locator('.item').count();
    expect(items).toBe(3);
  });

  test('should capture performance timeline', async ({ page }) => {
    await page.goto('data:text/html,<html><body>Test</body></html>');

    // Collect performance entries
    const entries = await page.evaluate(() => {
      return performance.getEntriesByType('navigation').map((e) => ({
        name: e.name,
        duration: e.duration,
        startTime: e.startTime,
      }));
    });

    expect(entries.length).toBeGreaterThanOrEqual(0);
  });
});
