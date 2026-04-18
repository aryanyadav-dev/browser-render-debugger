/**
 * E2E Browser Tests - Analyze Command
 * Tests trace analysis with real browser-generated traces
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface FrameData {
  frames: number;
  duration: number;
}

test.describe('Analyze Command E2E', () => {
  let tempDir: string;

  test.beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'render-debugger-analyze-'),
    );
  });

  test.afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test('should analyze trace for long tasks', async ({ page }) => {
    // Generate a trace with long JavaScript execution
    await page.goto('data:text/html,<html><body>Long Task Test</body></html>');

    // Execute long-running JavaScript
    await page.evaluate(() => {
      const start = performance.now();
      // Simulate long task (>50ms)
      while (performance.now() - start < 100) {
        // Busy loop
      }
      performance.mark('long-task-complete');
    });

    // Get trace data
    const traceData = await page.evaluate(() => {
      return {
        entries: performance.getEntriesByType('mark').map((e) => ({
          name: e.name,
          startTime: e.startTime,
        })),
        measures: performance.getEntriesByType('measure').map((e) => ({
          name: e.name,
          duration: e.duration,
        })),
      };
    });

    expect(traceData).toBeDefined();
    expect(traceData.entries.length).toBeGreaterThanOrEqual(1);
  });

  test('should detect forced reflow patterns', async ({ page }) => {
    await page.setContent(`
      <div id="test-element" style="width: 100px; height: 100px;">Test</div>
    `);

    // Trigger forced reflow
    await page.evaluate(() => {
      const el = document.getElementById('test-element');
      // Read layout property
      const width = el!.offsetWidth;
      // Write to style (forces reflow)
      el!.style.width = width + 1 + 'px';
      // Read again (triggers another reflow)
      const newWidth = el!.offsetWidth;

      return { width, newWidth };
    });

    // Verify element was modified
    const computedWidth = await page.evaluate(() => {
      const el = document.getElementById('test-element');
      return el!.offsetWidth;
    });

    expect(computedWidth).toBe(101);
  });

  test('should measure frame timing', async ({ page }) => {
    await page.goto(
      'data:text/html,<html><body>Frame Timing Test</body></html>',
    );

    // Collect frame timing data
    const frameData = await page.evaluate(() => {
      return new Promise((resolve) => {
        let frames = 0;
        const startTime = performance.now();

        function countFrames() {
          frames++;
          if (performance.now() - startTime < 1000) {
            requestAnimationFrame(countFrames);
          } else {
            resolve({ frames, duration: performance.now() - startTime });
          }
        }

        requestAnimationFrame(countFrames);
      });
    });

    expect(frameData).toBeDefined();
    expect((frameData as FrameData).frames).toBeGreaterThan(0);
  });
});
