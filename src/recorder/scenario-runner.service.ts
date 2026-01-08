import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { CDPConnectionService } from '../cdp/cdp-connection.service.js';
import { StorageService } from '../services/storage.service.js';
import { ScenarioNotFoundError, HarnessError } from '../errors/error-types.js';
import type {
  Scenario,
  ScenarioStep,
  ScenarioResult,
  ScrollParams,
  ClickParams,
  WaitParams,
  AnimateParams,
  CustomParams,
} from '../shared/types/index.js';

/**
 * Speed multipliers for scroll operations
 */
const SCROLL_SPEEDS: Record<string, number> = {
  slow: 50,
  medium: 100,
  fast: 200,
};

@Injectable()
export class ScenarioRunnerService {
  constructor(
    private readonly cdpConnection: CDPConnectionService,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Load a scenario from the scenarios directory
   */
  async loadScenario(scenarioName: string): Promise<Scenario> {
    const scenariosDir = this.storageService.getScenariosDir();
    const scenarioPath = path.join(scenariosDir, `${scenarioName}.yaml`);

    try {
      const content = await fs.readFile(scenarioPath, 'utf-8');
      const scenario = yaml.load(content) as Scenario;

      if (!scenario || !scenario.name || !Array.isArray(scenario.steps)) {
        throw new Error('Invalid scenario format');
      }

      return scenario;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ScenarioNotFoundError(scenarioName);
      }
      throw error;
    }
  }

  /**
   * Run a scenario against the current page
   */
  async runScenario(scenario: Scenario): Promise<ScenarioResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let stepsExecuted = 0;

    try {
      for (const step of scenario.steps) {
        try {
          await this.executeStep(step);
          stepsExecuted++;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          errors.push(
            `Step ${stepsExecuted + 1} (${step.type}): ${errorMessage}`,
          );

          // Continue with remaining steps unless it's a critical error
          if (this.isCriticalError(error)) {
            break;
          }
          stepsExecuted++;
        }
      }

      return {
        scenario: scenario.name,
        success: errors.length === 0,
        stepsExecuted,
        totalSteps: scenario.steps.length,
        duration: Date.now() - startTime,
        errors,
      };
    } catch (error) {
      throw new HarnessError(
        scenario.name,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Execute a single scenario step
   */
  private async executeStep(step: ScenarioStep): Promise<void> {
    const client = this.cdpConnection.getClient();
    if (!client) {
      throw new Error('CDP client not connected');
    }

    switch (step.type) {
      case 'scroll':
        await this.executeScroll(step.params as ScrollParams, step.duration);
        break;
      case 'click':
        await this.executeClick(step.params as ClickParams, step.duration);
        break;
      case 'wait':
        await this.executeWait(step.params as WaitParams);
        break;
      case 'animate':
        await this.executeAnimate(step.params as AnimateParams, step.duration);
        break;
      case 'custom':
        await this.executeCustom(step.params as CustomParams);
        break;
      default: {
        const unknownType: string = step.type as string;
        throw new Error(`Unknown step type: ${unknownType}`);
      }
    }
  }

  /**
   * Execute a scroll step
   */
  private async executeScroll(
    params: ScrollParams,
    duration?: number,
  ): Promise<void> {
    const client = this.cdpConnection.getClient();
    if (!client) return;

    const speedKey = params.speed ?? 'medium';
    const speedValue = SCROLL_SPEEDS[speedKey] ?? 100;
    const distance = params.distance;
    const steps = Math.ceil(distance / speedValue);
    const stepDelay = (duration ?? 1000) / steps;

    let deltaX = 0;
    let deltaY = 0;

    switch (params.direction) {
      case 'down':
        deltaY = speedValue;
        break;
      case 'up':
        deltaY = -speedValue;
        break;
      case 'right':
        deltaX = speedValue;
        break;
      case 'left':
        deltaX = -speedValue;
        break;
    }

    for (let i = 0; i < steps; i++) {
      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: 100,
        y: 100,
        deltaX,
        deltaY,
      });
      await this.delay(stepDelay);
    }
  }

  /**
   * Execute a click step
   */
  private async executeClick(
    params: ClickParams,
    duration?: number,
  ): Promise<void> {
    const client = this.cdpConnection.getClient();
    if (!client) return;

    // Find elements matching the selector
    const result = (await client.send('Runtime.evaluate', {
      expression: `
        (function() {
          const elements = document.querySelectorAll('${params.selector}');
          return Array.from(elements).map(el => {
            const rect = el.getBoundingClientRect();
            return {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2
            };
          });
        })()
      `,
      returnByValue: true,
    })) as { result: { value: Array<{ x: number; y: number }> } };

    const elements = result.result?.value ?? [];
    const elementsToClick = params.multiple ? elements : elements.slice(0, 1);
    const clickDelay = params.delay ?? 200;

    for (const element of elementsToClick) {
      // Mouse down
      await client.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: element.x,
        y: element.y,
        button: 'left',
        clickCount: 1,
      });

      // Mouse up
      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: element.x,
        y: element.y,
        button: 'left',
        clickCount: 1,
      });

      await this.delay(clickDelay);
    }

    // Wait for any remaining duration
    if (duration && duration > elementsToClick.length * clickDelay) {
      await this.delay(duration - elementsToClick.length * clickDelay);
    }
  }

  /**
   * Execute a wait step
   */
  private async executeWait(params: WaitParams): Promise<void> {
    await this.delay(params.duration);
  }

  /**
   * Execute an animate step (trigger animations)
   */
  private async executeAnimate(
    params: AnimateParams,
    duration?: number,
  ): Promise<void> {
    const client = this.cdpConnection.getClient();
    if (!client) return;

    switch (params.trigger) {
      case 'hover':
        await this.triggerHoverAnimations(params.selector);
        break;
      case 'visibility':
        await this.triggerVisibilityAnimations(params.selector);
        break;
      case 'click':
        await this.executeClick(
          { selector: params.selector, multiple: true },
          duration,
        );
        return;
    }

    if (duration) {
      await this.delay(duration);
    }
  }

  /**
   * Trigger hover animations on elements
   */
  private async triggerHoverAnimations(selector: string): Promise<void> {
    const client = this.cdpConnection.getClient();
    if (!client) return;

    // Get element positions
    const result = (await client.send('Runtime.evaluate', {
      expression: `
        (function() {
          const elements = document.querySelectorAll('${selector}');
          return Array.from(elements).slice(0, 10).map(el => {
            const rect = el.getBoundingClientRect();
            return {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2
            };
          });
        })()
      `,
      returnByValue: true,
    })) as { result: { value: Array<{ x: number; y: number }> } };

    const elements = result.result?.value ?? [];

    for (const element of elements) {
      // Move mouse to element to trigger hover
      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: element.x,
        y: element.y,
      });
      await this.delay(100);
    }
  }

  /**
   * Trigger visibility-based animations
   */
  private async triggerVisibilityAnimations(selector: string): Promise<void> {
    const client = this.cdpConnection.getClient();
    if (!client) return;

    // Scroll elements into view to trigger visibility animations
    await client.send('Runtime.evaluate', {
      expression: `
        (function() {
          const elements = document.querySelectorAll('${selector}');
          elements.forEach(el => {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        })()
      `,
    });
  }

  /**
   * Execute a custom script step
   */
  private async executeCustom(params: CustomParams): Promise<void> {
    const client = this.cdpConnection.getClient();
    if (!client) return;

    await client.send('Runtime.evaluate', {
      expression: params.script,
      awaitPromise: true,
    });
  }

  /**
   * Check if an error is critical and should stop execution
   */
  private isCriticalError(error: unknown): boolean {
    if (error instanceof Error) {
      // CDP disconnection is critical
      if (
        error.message.includes('disconnected') ||
        error.message.includes('closed')
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
