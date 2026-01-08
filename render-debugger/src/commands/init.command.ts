import { Command, CommandRunner, Option } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { StorageService } from '../services/storage.service.js';
import { ConfigService } from '../services/config.service.js';
import { BrowserValidationService } from '../services/browser-validation.service.js';
import { BrowserValidationError } from '../errors/error-types.js';

interface InitCommandOptions {
  browserPath: string;
  force?: boolean;
}

@Injectable()
@Command({
  name: 'init',
  description: 'Initialize a render-debugger workspace',
})
export class InitCommand extends CommandRunner {
  constructor(
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    private readonly browserValidationService: BrowserValidationService,
  ) {
    super();
  }

  async run(
    _passedParams: string[],
    options: InitCommandOptions,
  ): Promise<void> {
    try {
      console.log('> Initializing render-debugger workspace...\n');

      // Validate browser path
      console.log(`> Validating browser at: ${options.browserPath}`);
      const validationResult =
        await this.browserValidationService.validateBrowser(
          options.browserPath,
        );
      console.log(
        `✓ Browser validated: ${validationResult.browserName} v${validationResult.version}\n`,
      );

      // Check if already initialized
      const existingConfig = await this.configService.loadConfig();
      if (existingConfig && !options.force) {
        console.log(
          '⚠ Workspace already initialized. Use --force to reinitialize.\n',
        );
        return;
      }

      // Create directory structure
      console.log('> Creating directory structure...');
      await this.storageService.ensureDirectories();
      console.log('   ├── .render-debugger/');
      console.log('   ├── .render-debugger/traces/');
      console.log('   ├── .render-debugger/reports/');
      console.log('   ├── .render-debugger/patches/');
      console.log('   ├── .render-debugger/patches/backups/');
      console.log('   └── .render-debugger/scenarios/\n');

      // Generate default config
      console.log('> Generating default configuration...');
      const config = this.configService.getDefaultConfig(options.browserPath);
      await this.configService.saveConfig(config);
      console.log('   └── config.yaml\n');

      // Generate default rules
      console.log('> Generating default rules...');
      const rules = this.configService.getDefaultRules();
      await this.configService.saveRules(rules);
      console.log('   └── rules.yaml\n');

      // Create sample scenarios
      console.log('> Creating sample scenarios...');
      await this.createSampleScenarios();
      console.log('   ├── scroll-heavy.yaml');
      console.log('   └── animation-heavy.yaml\n');

      console.log('✓ Workspace initialized successfully!\n');
      console.log('Next steps:');
      console.log(
        '  1. Run `render-debugger profile --url "<URL>" --scenario scroll-heavy`',
      );
      console.log(
        '  2. Run `render-debugger analyze <trace.json> --name "my-run"`',
      );
      console.log(
        '  3. Run `render-debugger fix <trace.json>` to generate patches\n',
      );
    } catch (error) {
      if (error instanceof BrowserValidationError) {
        console.error(`\n● Browser validation failed: ${error.message}`);
        console.error(`   Path: ${error.path}`);
        console.error(`   Reason: ${error.reason}\n`);
        process.exit(error.exitCode);
      }
      throw error;
    }
  }

  @Option({
    flags: '-b, --browser-path <path>',
    description: 'Path to Chromium-based browser executable',
    required: true,
  })
  parseBrowserPath(val: string): string {
    return val;
  }

  @Option({
    flags: '-f, --force',
    description: 'Force reinitialization if workspace already exists',
    defaultValue: false,
  })
  parseForce(val: string): boolean {
    return val === 'true' || val === '';
  }

  /**
   * Create sample scenario files for common test cases
   */
  private async createSampleScenarios(): Promise<void> {
    // Scroll-heavy scenario
    const scrollHeavyScenario = `# Scroll-Heavy Test Scenario
# Tests rendering performance during continuous scrolling

name: scroll-heavy
description: Simulates heavy scrolling to test layout and paint performance

steps:
  - type: wait
    params:
      duration: 1000
    description: Wait for page to fully load

  - type: scroll
    params:
      direction: down
      distance: 500
      speed: fast
    duration: 2000
    description: Fast scroll down

  - type: wait
    params:
      duration: 500
    description: Brief pause

  - type: scroll
    params:
      direction: up
      distance: 500
      speed: fast
    duration: 2000
    description: Fast scroll up

  - type: wait
    params:
      duration: 500
    description: Brief pause

  - type: scroll
    params:
      direction: down
      distance: 1000
      speed: slow
    duration: 3000
    description: Slow continuous scroll

  - type: scroll
    params:
      direction: down
      distance: 2000
      speed: fast
    duration: 2000
    description: Rapid scroll to stress test

  - type: wait
    params:
      duration: 1000
    description: Final pause
`;

    // Animation-heavy scenario
    const animationHeavyScenario = `# Animation-Heavy Test Scenario
# Tests rendering performance during CSS animations and transitions

name: animation-heavy
description: Triggers animations to test composite and GPU performance

steps:
  - type: wait
    params:
      duration: 1000
    description: Wait for page to fully load

  - type: animate
    params:
      selector: "*"
      trigger: hover
    duration: 2000
    description: Trigger hover animations

  - type: click
    params:
      selector: "button, .btn, [role='button']"
      multiple: true
      delay: 200
    duration: 3000
    description: Click interactive elements to trigger transitions

  - type: wait
    params:
      duration: 1000
    description: Wait for animations to complete

  - type: scroll
    params:
      direction: down
      distance: 300
      speed: medium
    duration: 1500
    description: Scroll to trigger scroll-based animations

  - type: animate
    params:
      selector: ".animated, [data-animate]"
      trigger: visibility
    duration: 2000
    description: Trigger visibility-based animations

  - type: wait
    params:
      duration: 2000
    description: Wait for all animations to settle
`;

    await this.storageService.writeScenario(
      'scroll-heavy',
      scrollHeavyScenario,
    );
    await this.storageService.writeScenario(
      'animation-heavy',
      animationHeavyScenario,
    );
  }
}
