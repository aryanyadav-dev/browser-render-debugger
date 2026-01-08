/**
 * Replay Harness Service
 * Generates minimal HTML+script reproductions of performance issues
 * for local debugging
 */

import { Injectable } from '@nestjs/common';
import { StorageService } from '../services/storage.service.js';
import type {
  Detection,
  TraceSummary,
  LayoutThrashDetection,
  GPUStallDetection,
  LongTaskDetection,
  HeavyPaintDetection,
} from '../shared/types/index.js';
import type {
  IReplayHarnessService,
  ReplayHarnessOptions,
  ReplayHarnessResult,
  IssueReproduction,
} from './interfaces/index.js';

@Injectable()
export class ReplayHarnessService implements IReplayHarnessService {
  constructor(private readonly storageService: StorageService) {}

  /**
   * Generate a replay harness from detections
   */
  generateHarness(
    detections: Detection[],
    summary: TraceSummary,
    options: ReplayHarnessOptions,
  ): ReplayHarnessResult {
    const detectionsToInclude = options.includeAllDetections
      ? detections
      : detections.slice(0, 1);

    if (detectionsToInclude.length === 0) {
      return {
        html: this.generateEmptyHarness(summary, options),
        includedDetectionTypes: [],
        summary: 'No detections to reproduce',
      };
    }

    const reproductions = detectionsToInclude.map((d) =>
      this.generateReproduction(d),
    );
    const html = this.buildHarnessHtml(reproductions, summary, options);
    const includedTypes = [...new Set(reproductions.map((r) => r.type))];

    return {
      html,
      includedDetectionTypes: includedTypes,
      summary: this.buildSummaryText(reproductions, summary),
    };
  }

  /**
   * Generate and save a replay harness to disk
   */
  async generateAndSaveHarness(
    detections: Detection[],
    summary: TraceSummary,
    options: ReplayHarnessOptions,
  ): Promise<ReplayHarnessResult> {
    const result = this.generateHarness(detections, summary, options);

    // Save to the reports directory with a harness prefix
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `harness-${options.name}-${timestamp}`;
    const filePath = await this.storageService.writeReport(
      fileName,
      result.html,
    );

    return {
      ...result,
      filePath,
    };
  }

  /**
   * Generate reproduction code for a specific detection
   */
  generateReproduction(detection: Detection): IssueReproduction {
    switch (detection.type) {
      case 'layout_thrashing':
        return this.generateLayoutThrashReproduction(
          detection as LayoutThrashDetection,
        );
      case 'gpu_stall':
        return this.generateGPUStallReproduction(
          detection as GPUStallDetection,
        );
      case 'long_task':
        return this.generateLongTaskReproduction(
          detection as LongTaskDetection,
        );
      case 'heavy_paint':
        return this.generateHeavyPaintReproduction(
          detection as HeavyPaintDetection,
        );
      default:
        return this.generateGenericReproduction(detection);
    }
  }

  /**
   * Generate layout thrash reproduction
   */
  private generateLayoutThrashReproduction(
    detection: LayoutThrashDetection,
  ): IssueReproduction {
    const selector = detection.selector || '.element';
    const occurrences = detection.occurrences || 10;

    return {
      type: 'layout_thrashing',
      description: `Layout thrashing detected on "${selector}" with ${detection.reflowCostMs}ms reflow cost`,
      styles: `
    /* Styles that contribute to layout thrashing */
    ${selector} {
      width: 100%;
      padding: 20px;
      margin: 10px;
      box-sizing: border-box;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
    }`,
      markup: `
    <div class="container">
      <div class="${selector.replace('.', '')}" id="target">Target Element</div>
      <div class="${selector.replace('.', '')}">Element 2</div>
      <div class="${selector.replace('.', '')}">Element 3</div>
    </div>`,
      script: `
    // Layout thrashing reproduction
    // This pattern reads and writes DOM properties in a way that forces
    // synchronous layout recalculations (reflows)
    
    function thrashLayout() {
      const elements = document.querySelectorAll('${selector}');
      elements.forEach((el, index) => {
        // READ: This triggers layout calculation
        const width = el.offsetWidth;
        
        // WRITE: This invalidates the layout
        el.style.width = (width + index) + 'px';
        
        // READ AGAIN: Forces synchronous layout (THRASHING!)
        const newWidth = el.offsetWidth;
        
        // WRITE AGAIN: More invalidation
        el.style.padding = (20 + (newWidth % 5)) + 'px';
      });
    }

    // Run the thrashing pattern ${occurrences} times
    let count = 0;
    function animate() {
      thrashLayout();
      count++;
      if (count < ${occurrences}) {
        requestAnimationFrame(animate);
      } else {
        console.log('Layout thrashing reproduction complete');
        if (window.performance && window.performance.mark) {
          window.performance.mark('thrash-complete');
        }
      }
    }

    // Start after page load
    window.addEventListener('load', () => {
      console.log('Starting layout thrashing reproduction...');
      if (window.performance && window.performance.mark) {
        window.performance.mark('thrash-start');
      }
      requestAnimationFrame(animate);
    });`,
      comments: [
        `Original selector: ${selector}`,
        `Reflow cost: ${detection.reflowCostMs}ms`,
        `Occurrences: ${detection.occurrences}`,
        `Affected nodes: ${detection.affectedNodes}`,
        'This reproduction demonstrates the read-write-read pattern that causes forced synchronous layouts',
      ],
    };
  }

  /**
   * Generate GPU stall reproduction
   */
  private generateGPUStallReproduction(
    detection: GPUStallDetection,
  ): IssueReproduction {
    const element = detection.element || 'svg';
    const stallType = detection.stallType || 'sync';

    return {
      type: 'gpu_stall',
      description: `GPU stall (${stallType}) detected on "${element}" with ${detection.stallMs}ms stall time`,
      styles: `
    /* Styles that contribute to GPU stalls */
    body {
      margin: 0;
      overflow: hidden;
    }
    #svg-container {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
    }
    .gpu-heavy {
      will-change: transform;
    }`,
      markup: `
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
      <rect id="heavy-rect" width="100%" height="100%" fill="url(#gradient)" class="gpu-heavy"/>
      <circle id="circle1" cx="500" cy="500" r="200" fill="rgba(255,255,0,0.5)" filter="url(#blur)" class="gpu-heavy"/>
      <circle id="circle2" cx="1000" cy="500" r="200" fill="rgba(0,255,255,0.5)" filter="url(#blur)" class="gpu-heavy"/>
    </svg>
    <canvas id="canvas" width="2000" height="2000"></canvas>`,
      script: `
    // GPU stall reproduction
    // This pattern creates heavy GPU work that can cause main thread stalls
    
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const rect = document.getElementById('heavy-rect');
    const circles = [
      document.getElementById('circle1'),
      document.getElementById('circle2')
    ];

    let angle = 0;
    let frameCount = 0;
    const maxFrames = ${detection.occurrences || 50};

    function heavyGPUWork() {
      angle += 2;
      
      // Heavy SVG transforms causing GPU work
      rect.style.transform = 'rotate(' + angle + 'deg) scale(' + (1 + Math.sin(angle * 0.01) * 0.1) + ')';
      
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
      if (frameCount < maxFrames) {
        requestAnimationFrame(heavyGPUWork);
      } else {
        console.log('GPU stall reproduction complete');
        if (window.performance && window.performance.mark) {
          window.performance.mark('gpu-complete');
        }
      }
    }

    window.addEventListener('load', () => {
      console.log('Starting GPU stall reproduction...');
      if (window.performance && window.performance.mark) {
        window.performance.mark('gpu-start');
      }
      requestAnimationFrame(heavyGPUWork);
    });`,
      comments: [
        `Original element: ${element}`,
        `Stall type: ${stallType}`,
        `Stall duration: ${detection.stallMs}ms`,
        `Occurrences: ${detection.occurrences}`,
        'This reproduction demonstrates heavy GPU operations that can block the main thread',
      ],
    };
  }

  /**
   * Generate long task reproduction
   */
  private generateLongTaskReproduction(
    detection: LongTaskDetection,
  ): IssueReproduction {
    const functionName = detection.functionName || 'heavyComputation';
    const cpuMs = detection.cpuMs || 100;

    return {
      type: 'long_task',
      description: `Long task detected in "${functionName}" taking ${cpuMs}ms`,
      styles: `
    /* Minimal styles for long task reproduction */
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
    }`,
      markup: `
    <h1>Long Task Reproduction</h1>
    <p>This page runs heavy computations that block the main thread for ~${cpuMs}ms.</p>
    <p>Original function: <code>${functionName}</code></p>
    <p>Original file: <code>${detection.file || 'unknown'}:${detection.line || 0}</code></p>
    <div id="output"></div>`,
      script: `
    // Long task reproduction
    // This simulates a heavy computation that blocks the main thread
    
    const output = document.getElementById('output');

    // Heavy computation that takes approximately ${cpuMs}ms
    function ${functionName}(targetDurationMs) {
      const startTime = performance.now();
      let result = 0;
      const data = [];
      
      // Create and manipulate data until we hit the target duration
      while (performance.now() - startTime < targetDurationMs) {
        // Create array chunk
        for (let i = 0; i < 1000; i++) {
          data.push(Math.random());
        }
        
        // Sort (expensive operation)
        if (data.length > 5000) {
          data.sort((a, b) => a - b);
          data.length = 1000; // Trim to prevent memory issues
        }
        
        // Complex calculation
        result = data.reduce((acc, val, idx) => {
          return acc + Math.sin(val) * Math.cos(idx) * Math.tan(val + idx);
        }, result);
      }
      
      return { result, actualDuration: performance.now() - startTime };
    }

    function runTask() {
      const startTime = performance.now();
      
      if (window.performance && window.performance.mark) {
        window.performance.mark('task-start');
      }
      
      const { result, actualDuration } = ${functionName}(${cpuMs});
      
      if (window.performance && window.performance.mark) {
        window.performance.mark('task-end');
        window.performance.measure('long-task', 'task-start', 'task-end');
      }
      
      const div = document.createElement('div');
      div.className = 'result';
      div.textContent = 'Task took ' + actualDuration.toFixed(2) + 'ms (target: ${cpuMs}ms), result: ' + result.toFixed(4);
      output.appendChild(div);
      
      console.log('Long task completed in ' + actualDuration.toFixed(2) + 'ms');
    }

    // Run multiple long tasks to match original occurrences
    let taskCount = 0;
    const maxTasks = ${detection.occurrences || 5};
    
    function runLongTasks() {
      runTask();
      taskCount++;
      
      if (taskCount < maxTasks) {
        // Schedule next task with minimal delay
        setTimeout(runLongTasks, 50);
      } else {
        console.log('Long task reproduction complete');
      }
    }

    window.addEventListener('load', () => {
      console.log('Starting long task reproduction...');
      setTimeout(runLongTasks, 100);
    });`,
      comments: [
        `Original function: ${functionName}`,
        `Original file: ${detection.file || 'unknown'}`,
        `Original line: ${detection.line || 0}`,
        `CPU time: ${cpuMs}ms`,
        `Occurrences: ${detection.occurrences}`,
        `Correlated frame drops: ${detection.correlatedFrameDrops}`,
        'This reproduction simulates a long-running JavaScript task that blocks the main thread',
      ],
    };
  }

  /**
   * Generate heavy paint reproduction
   */
  private generateHeavyPaintReproduction(
    detection: HeavyPaintDetection,
  ): IssueReproduction {
    return {
      type: 'heavy_paint',
      description: `Heavy paint detected with ${detection.paintTimeMs}ms paint time and ${detection.rasterTimeMs}ms raster time`,
      styles: `
    /* Styles that cause heavy paint operations */
    body {
      margin: 0;
      overflow: hidden;
    }
    .paint-heavy {
      position: absolute;
      border-radius: 50%;
      box-shadow: 0 0 20px rgba(0,0,0,0.5), inset 0 0 20px rgba(255,255,255,0.5);
      background: linear-gradient(45deg, #ff6b6b, #4ecdc4, #45b7d1, #96ceb4);
      background-size: 400% 400%;
      animation: gradient 2s ease infinite;
    }
    @keyframes gradient {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
    .container {
      position: relative;
      width: 100vw;
      height: 100vh;
    }`,
      markup: `
    <div class="container" id="container">
      <!-- Elements will be generated by script -->
    </div>`,
      script: `
    // Heavy paint reproduction
    // This creates many elements with expensive paint operations
    
    const container = document.getElementById('container');
    const layerCount = ${detection.layerCount || 20};

    // Create multiple layers with expensive paint properties
    for (let i = 0; i < layerCount; i++) {
      const el = document.createElement('div');
      el.className = 'paint-heavy';
      el.style.width = (50 + Math.random() * 100) + 'px';
      el.style.height = el.style.width;
      el.style.left = (Math.random() * 80) + '%';
      el.style.top = (Math.random() * 80) + '%';
      el.style.animationDelay = (Math.random() * 2) + 's';
      container.appendChild(el);
    }

    let frameCount = 0;
    const maxFrames = 100;

    function triggerPaint() {
      // Force paint by modifying visual properties
      const elements = document.querySelectorAll('.paint-heavy');
      elements.forEach((el, i) => {
        const scale = 1 + Math.sin(frameCount * 0.1 + i) * 0.1;
        el.style.transform = 'scale(' + scale + ') rotate(' + (frameCount + i * 10) + 'deg)';
      });

      frameCount++;
      if (frameCount < maxFrames) {
        requestAnimationFrame(triggerPaint);
      } else {
        console.log('Heavy paint reproduction complete');
        if (window.performance && window.performance.mark) {
          window.performance.mark('paint-complete');
        }
      }
    }

    window.addEventListener('load', () => {
      console.log('Starting heavy paint reproduction...');
      if (window.performance && window.performance.mark) {
        window.performance.mark('paint-start');
      }
      requestAnimationFrame(triggerPaint);
    });`,
      comments: [
        `Paint time: ${detection.paintTimeMs}ms`,
        `Raster time: ${detection.rasterTimeMs}ms`,
        `Layer count: ${detection.layerCount}`,
        'This reproduction creates multiple elements with expensive paint operations like gradients, shadows, and animations',
      ],
    };
  }

  /**
   * Generate generic reproduction for unknown detection types
   */
  private generateGenericReproduction(detection: Detection): IssueReproduction {
    return {
      type: detection.type as IssueReproduction['type'],
      description: detection.description,
      styles: `
    /* Generic styles */
    body {
      font-family: Arial, sans-serif;
      padding: 20px;
    }
    .info {
      background: #f0f0f0;
      padding: 20px;
      border-radius: 5px;
    }`,
      markup: `
    <div class="info">
      <h1>Performance Issue Reproduction</h1>
      <p><strong>Type:</strong> ${detection.type}</p>
      <p><strong>Severity:</strong> ${detection.severity}</p>
      <p><strong>Description:</strong> ${detection.description}</p>
      <p><strong>Duration:</strong> ${detection.metrics.durationMs}ms</p>
      <p><strong>Occurrences:</strong> ${detection.metrics.occurrences}</p>
    </div>`,
      script: `
    // Generic reproduction placeholder
    console.log('Detection type: ${detection.type}');
    console.log('This is a placeholder reproduction for an unrecognized detection type.');
    console.log('Please refer to the detection details for manual reproduction.');`,
      comments: [
        `Detection type: ${detection.type}`,
        `Severity: ${detection.severity}`,
        `Duration: ${detection.metrics.durationMs}ms`,
        `Occurrences: ${detection.metrics.occurrences}`,
        'This is a generic reproduction template for an unrecognized detection type',
      ],
    };
  }

  /**
   * Build the complete HTML harness from reproductions
   */
  private buildHarnessHtml(
    reproductions: IssueReproduction[],
    summary: TraceSummary,
    options: ReplayHarnessOptions,
  ): string {
    const title = options.title || `Replay Harness: ${options.name}`;
    const combinedStyles = reproductions.map((r) => r.styles).join('\n');
    const combinedMarkup = reproductions.map((r) => r.markup).join('\n');
    const combinedScripts = reproductions.map((r) => r.script).join('\n\n');
    const allComments = reproductions.flatMap((r) => r.comments);

    const performanceMeasurement = options.includePerformanceMeasurement
      ? this.getPerformanceMeasurementScript()
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(title)}</title>
  <style>
    /* Base styles */
    * {
      box-sizing: border-box;
    }
    
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    }
    
    /* Harness info panel */
    #harness-info {
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 15px;
      border-radius: 8px;
      font-size: 12px;
      max-width: 300px;
      z-index: 10000;
    }
    
    #harness-info h3 {
      margin: 0 0 10px 0;
      font-size: 14px;
    }
    
    #harness-info .meta {
      margin: 5px 0;
      opacity: 0.8;
    }
    
    #harness-info .issues {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid rgba(255,255,255,0.2);
    }
    
    #harness-info .issue {
      margin: 5px 0;
      padding: 5px;
      background: rgba(255,255,255,0.1);
      border-radius: 4px;
    }
    
    #harness-info .toggle-btn {
      position: absolute;
      top: 5px;
      right: 5px;
      background: none;
      border: none;
      color: white;
      cursor: pointer;
      font-size: 16px;
    }
    
    #harness-info.collapsed .content {
      display: none;
    }
    
    ${combinedStyles}
  </style>
</head>
<body>
  <!-- Harness Info Panel -->
  <div id="harness-info">
    <button class="toggle-btn" onclick="toggleInfo()">−</button>
    <div class="content">
      <h3>🔍 Replay Harness</h3>
      <div class="meta">
        <div><strong>Name:</strong> ${this.escapeHtml(options.name)}</div>
        <div><strong>URL:</strong> ${this.escapeHtml(summary.url)}</div>
        <div><strong>Duration:</strong> ${summary.duration_ms.toFixed(0)}ms</div>
        <div><strong>Frames:</strong> ${summary.frames.total} (${summary.frames.dropped} dropped)</div>
        <div><strong>Avg FPS:</strong> ${summary.frames.avg_fps}</div>
      </div>
      <div class="issues">
        <strong>Reproduced Issues:</strong>
        ${reproductions
          .map(
            (r) => `
        <div class="issue">
          <strong>${r.type}</strong><br>
          ${this.escapeHtml(r.description.substring(0, 100))}${r.description.length > 100 ? '...' : ''}
        </div>`,
          )
          .join('')}
      </div>
    </div>
  </div>

  <!-- Reproduction Content -->
  ${combinedMarkup}

  <script>
    // Harness info toggle
    function toggleInfo() {
      const info = document.getElementById('harness-info');
      const btn = info.querySelector('.toggle-btn');
      info.classList.toggle('collapsed');
      btn.textContent = info.classList.contains('collapsed') ? '+' : '−';
    }

    // Console logging for debugging
    console.log('='.repeat(60));
    console.log('RENDER DEBUGGER - REPLAY HARNESS');
    console.log('='.repeat(60));
    console.log('Name:', '${this.escapeJs(options.name)}');
    console.log('Generated:', '${new Date().toISOString()}');
    console.log('');
    console.log('REPRODUCTION DETAILS:');
    ${allComments.map((c) => `console.log('  - ${this.escapeJs(c)}');`).join('\n    ')}
    console.log('');
    console.log('Open DevTools Performance tab and record to analyze this reproduction.');
    console.log('='.repeat(60));

    ${performanceMeasurement}

    // Reproduction scripts
    ${combinedScripts}
  </script>
</body>
</html>`;
  }

  /**
   * Generate an empty harness when no detections are available
   */
  private generateEmptyHarness(
    summary: TraceSummary,
    options: ReplayHarnessOptions,
  ): string {
    const title = options.title || `Replay Harness: ${options.name}`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(title)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 50px auto;
      padding: 20px;
      text-align: center;
    }
    .info-box {
      background: #f0f0f0;
      padding: 30px;
      border-radius: 10px;
      margin-top: 30px;
    }
    h1 {
      color: #333;
    }
    .success {
      color: #28a745;
      font-size: 48px;
    }
  </style>
</head>
<body>
  <div class="success">✓</div>
  <h1>No Performance Issues Detected</h1>
  <p>The analysis did not find any significant performance issues to reproduce.</p>
  <div class="info-box">
    <h3>Analysis Summary</h3>
    <p><strong>Name:</strong> ${this.escapeHtml(options.name)}</p>
    <p><strong>URL:</strong> ${this.escapeHtml(summary.url)}</p>
    <p><strong>Duration:</strong> ${summary.duration_ms.toFixed(0)}ms</p>
    <p><strong>Total Frames:</strong> ${summary.frames.total}</p>
    <p><strong>Dropped Frames:</strong> ${summary.frames.dropped}</p>
    <p><strong>Average FPS:</strong> ${summary.frames.avg_fps}</p>
  </div>
</body>
</html>`;
  }

  /**
   * Get performance measurement script
   */
  private getPerformanceMeasurementScript(): string {
    return `
    // Performance measurement utilities
    const perfObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'longtask') {
          console.warn('Long Task detected:', entry.duration.toFixed(2) + 'ms');
        } else if (entry.entryType === 'measure') {
          console.log('Measure:', entry.name, entry.duration.toFixed(2) + 'ms');
        }
      }
    });

    try {
      perfObserver.observe({ entryTypes: ['longtask', 'measure'] });
    } catch (e) {
      console.log('PerformanceObserver not fully supported');
    }

    // Frame timing
    let lastFrameTime = performance.now();
    let frameCount = 0;
    let droppedFrames = 0;
    const frameBudget = 16.67; // 60 FPS

    function measureFrame() {
      const now = performance.now();
      const frameDuration = now - lastFrameTime;
      
      if (frameDuration > frameBudget * 1.5) {
        droppedFrames++;
        console.warn('Frame drop detected:', frameDuration.toFixed(2) + 'ms');
      }
      
      frameCount++;
      lastFrameTime = now;
      
      if (frameCount % 60 === 0) {
        console.log('Frame stats - Count:', frameCount, 'Dropped:', droppedFrames);
      }
      
      requestAnimationFrame(measureFrame);
    }

    requestAnimationFrame(measureFrame);
    `;
  }

  /**
   * Build summary text for the harness result
   */
  private buildSummaryText(
    reproductions: IssueReproduction[],
    summary: TraceSummary,
  ): string {
    const types = reproductions.map((r) => r.type);
    const uniqueTypes = [...new Set(types)];

    return `Replay harness for "${summary.name}" reproducing ${reproductions.length} issue(s): ${uniqueTypes.join(', ')}`;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Escape JavaScript string special characters
   */
  private escapeJs(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
  }
}
