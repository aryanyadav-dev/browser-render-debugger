/**
 * Synthetic trace fixtures for testing
 * These fixtures exercise layout thrash, long tasks, and GPU stalls
 */

export {
  layoutThrashTrace,
  createLayoutThrashTrace,
} from './layout-thrash.fixture.js';

export { gpuStallTrace, createGPUStallTrace } from './gpu-stall.fixture.js';

export { longTaskTrace, createLongTaskTrace } from './long-task.fixture.js';
