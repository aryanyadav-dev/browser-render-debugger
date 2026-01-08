/**
 * Integration tests for the test harness server
 * Verifies the test server serves crafted HTML pages correctly
 *
 * Requirements: 13.3
 */

import {
  createTestServer,
  getTestPagePaths,
  getTestPageContent,
  TestServer,
} from '../harness/test-server.js';

describe('Test Harness Server Integration', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await createTestServer(0); // Use random available port
  });

  afterAll(async () => {
    await server.close();
  });

  describe('Server Lifecycle', () => {
    it('should start server on available port', () => {
      expect(server.port).toBeGreaterThan(0);
      expect(server.baseUrl).toContain('http://127.0.0.1:');
    });

    it('should have server instance', () => {
      expect(server.server).toBeDefined();
      expect(server.server.listening).toBe(true);
    });
  });

  describe('Test Page Paths', () => {
    it('should return available test page paths', () => {
      const paths = getTestPagePaths();
      expect(paths).toContain('/layout-thrash');
      expect(paths).toContain('/gpu-stall');
      expect(paths).toContain('/long-task');
    });

    it('should not include index in test page paths', () => {
      const paths = getTestPagePaths();
      expect(paths).not.toContain('/');
      expect(paths).not.toContain('/index');
    });
  });

  describe('Test Page Content', () => {
    it('should return layout-thrash page content', () => {
      const content = getTestPageContent('/layout-thrash');
      expect(content).toBeDefined();
      expect(content).toContain('Layout Thrash Test');
      expect(content).toContain('thrashLayout');
      expect(content).toContain('offsetWidth');
    });

    it('should return gpu-stall page content', () => {
      const content = getTestPageContent('/gpu-stall');
      expect(content).toBeDefined();
      expect(content).toContain('GPU Stall Test');
      expect(content).toContain('svg');
      expect(content).toContain('canvas');
    });

    it('should return long-task page content', () => {
      const content = getTestPageContent('/long-task');
      expect(content).toBeDefined();
      expect(content).toContain('Long Task Test');
      expect(content).toContain('heavyComputation');
    });

    it('should return undefined for unknown paths', () => {
      const content = getTestPageContent('/unknown-page');
      expect(content).toBeUndefined();
    });
  });

  describe('HTTP Requests', () => {
    it('should serve index page at root', async () => {
      const response = await fetch(`${server.baseUrl}/`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');

      const html = await response.text();
      expect(html).toContain('Render Debugger Test Pages');
    });

    it('should serve layout-thrash page', async () => {
      const response = await fetch(`${server.baseUrl}/layout-thrash`);
      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toContain('Layout Thrash Test');
    });

    it('should serve gpu-stall page', async () => {
      const response = await fetch(`${server.baseUrl}/gpu-stall`);
      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toContain('GPU Stall Test');
    });

    it('should serve long-task page', async () => {
      const response = await fetch(`${server.baseUrl}/long-task`);
      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toContain('Long Task Test');
    });

    it('should return 404 for unknown paths', async () => {
      const response = await fetch(`${server.baseUrl}/unknown-page`);
      expect(response.status).toBe(404);
    });

    it('should set no-cache header', async () => {
      const response = await fetch(`${server.baseUrl}/layout-thrash`);
      expect(response.headers.get('cache-control')).toBe('no-cache');
    });
  });

  describe('Page Content Validation', () => {
    it('should have valid HTML structure in layout-thrash page', async () => {
      const response = await fetch(`${server.baseUrl}/layout-thrash`);
      const html = await response.text();

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html>');
      expect(html).toContain('</html>');
      expect(html).toContain('<script>');
      expect(html).toContain('</script>');
    });

    it('should have performance-triggering code in layout-thrash page', async () => {
      const response = await fetch(`${server.baseUrl}/layout-thrash`);
      const html = await response.text();

      // Should have read-write-read pattern
      expect(html).toContain('offsetWidth');
      expect(html).toContain('style.width');
      expect(html).toContain('requestAnimationFrame');
    });

    it('should have GPU-intensive code in gpu-stall page', async () => {
      const response = await fetch(`${server.baseUrl}/gpu-stall`);
      const html = await response.text();

      // Should have SVG and canvas operations
      expect(html).toContain('<svg');
      expect(html).toContain('<canvas');
      expect(html).toContain('transform');
      expect(html).toContain('getContext');
    });

    it('should have blocking computation in long-task page', async () => {
      const response = await fetch(`${server.baseUrl}/long-task`);
      const html = await response.text();

      // Should have heavy computation
      expect(html).toContain('heavyComputation');
      expect(html).toContain('sort');
      expect(html).toContain('reduce');
    });
  });
});

describe('Multiple Server Instances', () => {
  it('should support multiple server instances on different ports', async () => {
    const server1 = await createTestServer(0);
    const server2 = await createTestServer(0);

    expect(server1.port).not.toBe(server2.port);
    expect(server1.server.listening).toBe(true);
    expect(server2.server.listening).toBe(true);

    // Both should serve content
    const response1 = await fetch(`${server1.baseUrl}/`);
    const response2 = await fetch(`${server2.baseUrl}/`);

    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);

    await server1.close();
    await server2.close();
  });
});
