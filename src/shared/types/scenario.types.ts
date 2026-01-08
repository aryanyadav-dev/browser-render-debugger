/**
 * Scenario types for test execution
 */

export type ScenarioStepType =
  | 'scroll'
  | 'click'
  | 'wait'
  | 'animate'
  | 'custom';

export interface ScrollParams {
  direction: 'up' | 'down' | 'left' | 'right';
  distance: number;
  speed?: 'slow' | 'medium' | 'fast';
}

export interface ClickParams {
  selector: string;
  multiple?: boolean;
  delay?: number;
}

export interface WaitParams {
  duration: number;
}

export interface AnimateParams {
  selector: string;
  trigger: 'hover' | 'visibility' | 'click';
}

export interface CustomParams {
  script: string;
}

export type ScenarioStepParams =
  | ScrollParams
  | ClickParams
  | WaitParams
  | AnimateParams
  | CustomParams
  | Record<string, unknown>;

export interface ScenarioStep {
  type: ScenarioStepType;
  params: ScenarioStepParams;
  duration?: number;
  description?: string;
}

export interface Scenario {
  name: string;
  description: string;
  steps: ScenarioStep[];
}

export interface ScenarioResult {
  scenario: string;
  success: boolean;
  stepsExecuted: number;
  totalSteps: number;
  duration: number;
  errors: string[];
}
