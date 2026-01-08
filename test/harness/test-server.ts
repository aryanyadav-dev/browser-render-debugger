/**
 * Test harness server for integration testing
 * Serves crafted HTML pages that trigger specific performance issues
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';

export interface TestServer {
  server: Server;
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
}

/**
 * HTML page that triggers layout thrashing
 * Repeatedly reads and writes DOM properties causing forced reflows
 */
const LAYOUT_THRASH_PAGE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Layout Thrash Test</title>
  <style>
    .card {
      width: 100%;
      padding: 20px;
      margin: 10px;
      background: #f0f0f0;
      box-sizing: border-box;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card" id="card1">Card 1</div>
    <div class="card" id="card2">Card 2</div>
    <div class="card" id="card3">Card 3</div>
    <div class="card" id="card4">Card 4</div>
    <div class="card" id="card5">Card 5</div>
  </div>
  <script>
    // Intentional layout thrashing pattern
    // This is an anti-pattern that causes forced synchronous layouts
    function thrashLayout() {
      const cards = document.querySelectorAll('.card');
      cards.forEach((card, index) => {
        // Read (triggers layout)
        const width = card.offsetWidth;
        // Write (invalidates layout)
        card.style.width = (width + index) + 'px';
        // Read again (forces synchronous layout - THRASHING!)
        const newWidth = card.offsetWidth;
        // Write again
        card.style.padding = (20 + (newWidth % 5)) + 'px';
      });
    }

    // Run thrashing on animation frame for maximum impact
    let frameCount = 0;
    function animate() {
      thrashLayout();
      frameCount++;
      if (frameCount < 100) {
        requestAnimationFrame(animate);
      }
    }

    // Start after page load
    window.addEventListener('load', () => {
      requestAnimationFrame(animate);
    });
  </script>
</body>
</html>`;

/**
 * HTML page that triggers GPU stalls
 * Heavy SVG manipulation and canvas operations
 */
const GPU_STALL_PAGE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>GPU Stall Test</title>
  <style>
    body {
      margin: 0;
      overflow: hidden;
    }
    #canvas {
      position: absolute;
      top: 0;
      left: 0;
    }
    #svg-container {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
    }
    .rotating-element {
      will-change: transform;
    }
  </style>
</head>
<body>
  <svg id="svg-container" width="2000" height="2000">
    <defs>
      <filter id="blur">
        <feGaussianBlur stdDeviation="5" />
      </filter>
      <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:rgb(255,0,0);stop-opacity:1" />
        <stop offset="100%" style="stop-color:rgb(0,0,255);stop-opacity:1" />
      </linearGradient>
    </defs>
    <rect id="big-rect" width="100%" height="100%" fill="url(#gradient)" class="rotating-element"/>
    <circle id="circle1" cx="500" cy="500" r="200" fill="rgba(255,255,0,0.5)" filter="url(#blur)" class="rotating-element"/>
    <circle id="circle2" cx="1000" cy="500" r="200" fill="rgba(0,255,255,0.5)" filter="url(#blur)" class="rotating-element"/>
    <circle id="circle3" cx="750" cy="800" r="200" fill="rgba(255,0,255,0.5)" filter="url(#blur)" class="rotating-element"/>
  </svg>
  <canvas id="canvas" width="2000" height="2000"></canvas>
  <script>
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const bigRect = document.getElementById('big-rect');
    const circles = [
      document.getElementById('circle1'),
      document.getElementById('circle2'),
      document.getElementById('circle3')
    ];

    let angle = 0;
    let frameCount = 0;

    function heavyGPUWork() {
      // Heavy SVG transforms causing GPU work
      angle += 2;
      bigRect.style.transform = 'rotate(' + angle + 'deg) scale(' + (1 + Math.sin(angle * 0.01) * 0.1) + ')';
      
      circles.forEach((circle, i) => {
        const offset = i * 120;
        circle.style.transform = 'rotate(' + (angle + offset) + 'deg) translateX(' + (Math.sin(angle * 0.02) * 50) + 'px)';
      });

      // Heavy canvas operations
      ctx.clearRect(0, 0, 2000, 2000);
      for (let i = 0; i < 50; i++) {
        ctx.beginPath();
        ctx.arc(
          1000 + Math.cos(angle * 0.01 + i * 0.1) * 400,
          1000 + Math.sin(angle * 0.01 + i * 0.1) * 400,
          50 + i * 2,
          0,
          Math.PI * 2
        );
        ctx.fillStyle = 'rgba(' + (i * 5) + ', ' + (255 - i * 5) + ', 128, 0.3)';
        ctx.fill();
      }

      frameCount++;
      if (frameCount < 100) {
        requestAnimationFrame(heavyGPUWork);
      }
    }

    window.addEventListener('load', () => {
      requestAnimationFrame(heavyGPUWork);
    });
  </script>
</body>
</html>`;

/**
 * HTML page that triggers long JavaScript tasks
 * Heavy computation blocking the main thread
 */
const LONG_TASK_PAGE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Long Task Test</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      padding: 20px;
    }
    #output {
      margin-top: 20px;
      padding: 10px;
      background: #f0f0f0;
      min-height: 200px;
    }
    .result {
      padding: 5px;
      margin: 2px 0;
      background: #e0e0e0;
    }
  </style>
</head>
<body>
  <h1>Long Task Test</h1>
  <p>This page runs heavy computations that block the main thread.</p>
  <div id="output"></div>
  <script>
    const output = document.getElementById('output');

    // Heavy computation that takes >50ms
    function heavyComputation(iterations) {
      let result = 0;
      const data = [];
      
      // Create large array
      for (let i = 0; i < iterations; i++) {
        data.push(Math.random());
      }
      
      // Sort multiple times (expensive)
      for (let j = 0; j < 5; j++) {
        data.sort((a, b) => a - b);
        data.reverse();
      }
      
      // Reduce with complex operation
      result = data.reduce((acc, val, idx) => {
        return acc + Math.sin(val) * Math.cos(idx) * Math.tan(val + idx);
      }, 0);
      
      return result;
    }

    // Process data in a way that blocks the main thread
    function processData() {
      const startTime = performance.now();
      
      // This should take >50ms
      const result = heavyComputation(100000);
      
      const duration = performance.now() - startTime;
      
      const div = document.createElement('div');
      div.className = 'result';
      div.textContent = 'Computation took ' + duration.toFixed(2) + 'ms, result: ' + result.toFixed(4);
      output.appendChild(div);
      
      return duration;
    }

    // Run multiple long tasks
    let taskCount = 0;
    function runLongTasks() {
      const duration = processData();
      taskCount++;
      
      if (taskCount < 10) {
        // Schedule next task with minimal delay to maximize blocking
        setTimeout(runLongTasks, 10);
      }
    }

    // Also add event-driven long tasks
    document.addEventListener('mousemove', function handleMouseMove(e) {
      if (taskCount < 5) {
        // Heavy work on mouse move
        let sum = 0;
        for (let i = 0; i < 50000; i++) {
          sum += Math.sqrt(e.clientX * e.clientY * i);
        }
      }
    });

    window.addEventListener('load', () => {
      // Start long tasks after a short delay
      setTimeout(runLongTasks, 100);
    });
  </script>
</body>
</html>`;

/**
 * Simple index page listing all test pages
 */
const INDEX_PAGE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Render Debugger Test Pages</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: 50px auto;
      padding: 20px;
    }
    h1 {
      color: #333;
    }
    ul {
      list-style: none;
      padding: 0;
    }
    li {
      margin: 10px 0;
    }
    a {
      display: block;
      padding: 15px;
      background: #f0f0f0;
      color: #333;
      text-decoration: none;
      border-radius: 5px;
    }
    a:hover {
      background: #e0e0e0;
    }
    .description {
      font-size: 0.9em;
      color: #666;
      margin-top: 5px;
    }
  </style>
</head>
<body>
  <h1>Render Debugger Test Pages</h1>
  <p>These pages are designed to trigger specific performance issues for testing.</p>
  <ul>
    <li>
      <a href="/layout-thrash">
        Layout Thrash Test
        <div class="description">Triggers forced synchronous layouts through read-write-read patterns</div>
      </a>
    </li>
    <li>
      <a href="/gpu-stall">
        GPU Stall Test
        <div class="description">Heavy SVG and canvas operations causing GPU blocking</div>
      </a>
    </li>
    <li>
      <a href="/long-task">
        Long Task Test
        <div class="description">JavaScript computations exceeding 50ms threshold</div>
      </a>
    </li>
  </ul>
</body>
</html>`;

/**
 * Map of URL paths to HTML content
 */
const TEST_PAGES: Record<string, string> = {
  '/': INDEX_PAGE,
  '/index': INDEX_PAGE,
  '/layout-thrash': LAYOUT_THRASH_PAGE,
  '/gpu-stall': GPU_STALL_PAGE,
  '/long-task': LONG_TASK_PAGE,
};

/**
 * Create a test server serving crafted HTML pages
 * @param port Port to listen on (default: 0 for random available port)
 * @returns Promise resolving to TestServer instance
 */
export function createTestServer(port: number = 0): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? '/';
      const page = TEST_PAGES[url];

      if (page) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
        res.end(page);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      }
    });

    server.on('error', reject);

    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actualPort =
        typeof address === 'object' && address ? address.port : port;
      const baseUrl = `http://127.0.0.1:${actualPort}`;

      resolve({
        server,
        port: actualPort,
        baseUrl,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((err) => {
              if (err) rejectClose(err);
              else resolveClose();
            });
          }),
      });
    });
  });
}

/**
 * Get available test page paths
 */
export function getTestPagePaths(): string[] {
  return Object.keys(TEST_PAGES).filter(
    (path) => path !== '/' && path !== '/index',
  );
}

/**
 * Get test page content by path
 */
export function getTestPageContent(path: string): string | undefined {
  return TEST_PAGES[path];
}
