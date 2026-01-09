import { Command, CommandRunner, Option } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import {
  RecorderService,
  ProfileOptions,
} from '../recorder/recorder.service.js';
import { ConfigService } from '../services/config.service.js';
import { SamplingService } from '../services/sampling.service.js';
import { TraceLifecycleService } from '../services/trace-lifecycle.service.js';
import { PrivacyService } from '../services/privacy.service.js';
import {
  InvalidURLError,
  CDPConnectionError,
  HarnessError,
  ScenarioNotFoundError,
} from '../errors/error-types.js';

interface ProfileCommandOptions {
  url: string;
  scenario: string;
  browserPath?: string;
  profileDuration?: number;
  headless?: boolean;
  fpsTarget?: number;
  cdpPort?: number;
  cdpHost?: string;
  adapter?: string;
  out?: string;
  samplingRate?: number;
  adminTrigger?: boolean;
  adminToken?: string;
  noTelemetry?: boolean;
  remoteStorage?: string;
}

@Injectable()
@Command({
  name: 'profile',
  aliases: ['p'],
  description: 'Profile a web page under a specific scenario',
})
export class ProfileCommand extends CommandRunner {
  constructor(
    private readonly recorderService: RecorderService,
    private readonly configService: ConfigService,
    private readonly samplingService: SamplingService,
    private readonly traceLifecycleService: TraceLifecycleService,
    private readonly privacyService: PrivacyService,
  ) {
    super();
  }

  async run(
    _passedParams: string[],
    options: ProfileCommandOptions,
  ): Promise<void> {
    try {
      // Configure privacy settings
      // --no-telemetry is the default (true), so telemetry is disabled unless explicitly enabled
      if (options.noTelemetry !== false) {
        this.privacyService.disableTelemetry();
      } else {
        this.privacyService.enableTelemetry();
      }

      // Remote storage is disabled by default
      if (options.remoteStorage) {
        this.privacyService.enableRemoteStorage(options.remoteStorage);
      } else {
        this.privacyService.disableRemoteStorage();
      }

      // Configure sampling if specified
      if (options.samplingRate !== undefined) {
        this.samplingService.setSamplingRate(options.samplingRate);
      }

      if (options.adminTrigger) {
        this.samplingService.enableAdminTriggerMode(options.adminToken);
      }

      // Check sampling decision
      const samplingDecision = this.samplingService.shouldSample(
        options.adminToken,
      );
      if (!samplingDecision.shouldSample) {
        console.log(`- Skipping profile: ${samplingDecision.reason}`);
        process.exit(0);
      }

      // Validate and configure trace duration
      const requestedDuration = options.profileDuration ?? 15;
      const durationValidation =
        this.traceLifecycleService.validateDuration(requestedDuration);
      if (!durationValidation.valid && durationValidation.message) {
        console.log(`⚠ ${durationValidation.message}`);
      }
      const effectiveDuration = durationValidation.clampedValue;

      console.log('> Starting performance profile...\n');
      console.log(`   URL: ${options.url}`);
      console.log(`   Scenario: ${options.scenario}`);
      console.log(`   Duration: ${effectiveDuration}s`);
      console.log(`   Headless: ${options.headless ?? true}`);
      console.log(`   FPS Target: ${options.fpsTarget ?? 60}`);
      if (options.samplingRate !== undefined) {
        console.log(
          `   Sampling Rate: ${(options.samplingRate * 100).toFixed(1)}%`,
        );
      }
      if (options.adminTrigger) {
        console.log(`   Admin Trigger: enabled`);
      }
      if (options.adapter) {
        console.log(`   Adapter: ${options.adapter}`);
      }
      if (options.cdpHost) {
        console.log(`   CDP Host: ${options.cdpHost}`);
      }
      if (options.cdpPort) {
        console.log(`   CDP Port: ${options.cdpPort}`);
      }
      console.log('');

      // Load config for defaults
      const config = await this.configService.loadConfig();

      const profileOptions: ProfileOptions = {
        url: options.url,
        scenario: options.scenario,
        browserPath: options.browserPath ?? config?.browser.path,
        duration: effectiveDuration,
        headless: options.headless ?? config?.browser.defaultHeadless ?? true,
        fpsTarget:
          options.fpsTarget ?? config?.profiling.defaultFpsTarget ?? 60,
        cdpPort: options.cdpPort ?? config?.browser.defaultCdpPort,
        outputPath: options.out,
      };

      console.log('> Connecting to browser...');
      const result = await this.recorderService.profile(profileOptions);

      console.log('\n✓ Profile complete!\n');
      console.log('> Summary:');
      console.log(`   Total frames: ${result.summary.frames.total}`);
      console.log(`   Dropped frames: ${result.summary.frames.dropped}`);
      console.log(`   Average FPS: ${result.summary.frames.avg_fps}`);
      console.log(
        `   Frame budget: ${result.summary.frames.frame_budget_ms}ms\n`,
      );

      console.log('> Phase breakdown:');
      console.log(
        `   Style recalc: ${result.summary.phase_breakdown.style_recalc_ms}ms`,
      );
      console.log(`   Layout: ${result.summary.phase_breakdown.layout_ms}ms`);
      console.log(`   Paint: ${result.summary.phase_breakdown.paint_ms}ms`);
      console.log(
        `   Composite: ${result.summary.phase_breakdown.composite_ms}ms`,
      );
      console.log(`   GPU: ${result.summary.phase_breakdown.gpu_ms}ms\n`);

      console.log('> Artifacts:');
      console.log(`   Trace: ${result.tracePath}`);
      console.log(`   Summary: ${result.summaryPath}\n`);

      if (result.scenarioResult.errors.length > 0) {
        console.log('⚠ Scenario warnings:');
        for (const error of result.scenarioResult.errors) {
          console.log(`   - ${error}`);
        }
        console.log('');
      }

      console.log('Next steps:');
      console.log(
        `  1. Run \`render-debugger analyze ${result.tracePath} --name "my-run"\``,
      );
      console.log(
        '  2. Review the analysis report for optimization suggestions\n',
      );

      process.exit(0);
    } catch (error) {
      this.handleError(error);
    }
  }

  private handleError(error: unknown): never {
    if (error instanceof InvalidURLError) {
      console.error(`\n● Invalid URL: ${error.url}`);
      console.error(
        '   Please provide a valid URL (e.g., https://example.com)\n',
      );
      process.exit(error.exitCode);
    }

    if (error instanceof CDPConnectionError) {
      console.error(`\n● Failed to connect to browser`);
      console.error(`   Browser path: ${error.browserPath}`);
      console.error(`   CDP port: ${error.port}`);
      console.error('\n   Make sure:');
      console.error('   - The browser path is correct');
      console.error('   - No other process is using the CDP port');
      console.error('   - The browser supports remote debugging\n');
      process.exit(error.exitCode);
    }

    if (error instanceof ScenarioNotFoundError) {
      console.error(`\n● Scenario not found: ${error.scenario}`);
      console.error(
        '   Available scenarios are in .render-debugger/scenarios/',
      );
      console.error(
        '   Run `render-debugger init` to create sample scenarios\n',
      );
      process.exit(error.exitCode);
    }

    if (error instanceof HarnessError) {
      console.error(`\n● Scenario harness crashed: ${error.scenario}`);
      if (error.cause) {
        console.error(`   Cause: ${error.cause.message}`);
      }
      console.error(
        '\n   The scenario may have encountered an error during execution\n',
      );
      process.exit(error.exitCode);
    }

    // Unknown error
    console.error('\n● An unexpected error occurred');
    if (error instanceof Error) {
      console.error(`   ${error.message}\n`);
    }
    process.exit(1);
  }

  @Option({
    flags: '-u, --url <url>',
    description: 'URL to profile',
    required: true,
  })
  parseUrl(val: string): string {
    return val;
  }

  @Option({
    flags: '-s, --scenario <scenario>',
    description: 'Scenario name to run (from .render-debugger/scenarios/)',
    required: true,
  })
  parseScenario(val: string): string {
    return val;
  }

  @Option({
    flags: '-b, --browser-path <path>',
    description: 'Path to Chromium-based browser executable',
  })
  parseBrowserPath(val: string): string {
    return val;
  }

  @Option({
    flags: '-d, --profile-duration <seconds>',
    description: 'Profile duration in seconds (default: 15)',
    defaultValue: 15,
  })
  parseProfileDuration(val: string): number {
    return parseInt(val, 10);
  }

  @Option({
    flags: '--headless',
    description: 'Run browser in headless mode (default: true)',
    defaultValue: true,
  })
  parseHeadless(val: string): boolean {
    return val !== 'false';
  }

  @Option({
    flags: '--no-headless',
    description: 'Run browser with visible window',
  })
  parseNoHeadless(): boolean {
    return false;
  }

  @Option({
    flags: '-f, --fps-target <fps>',
    description: 'Target FPS for analysis (default: 60)',
    defaultValue: 60,
  })
  parseFpsTarget(val: string): number {
    return parseInt(val, 10);
  }

  @Option({
    flags: '-p, --cdp-port <port>',
    description: 'CDP port to connect to',
  })
  parseCdpPort(val: string): number {
    return parseInt(val, 10);
  }

  @Option({
    flags: '--cdp-host <host>',
    description: 'CDP host to connect to (default: localhost)',
  })
  parseCdpHost(val: string): string {
    return val;
  }

  @Option({
    flags: '--adapter <type>',
    description: 'Browser adapter to use (chromium-cdp, webkit-native)',
  })
  parseAdapter(val: string): string {
    return val;
  }

  @Option({
    flags: '-o, --out <path>',
    description: 'Output path for trace file',
  })
  parseOut(val: string): string {
    return val;
  }

  @Option({
    flags: '--sampling-rate <rate>',
    description: 'Sampling rate for production (0.0-1.0, default: 1.0)',
  })
  parseSamplingRate(val: string): number {
    return parseFloat(val);
  }

  @Option({
    flags: '--admin-trigger',
    description: 'Enable admin-only trigger mode',
    defaultValue: false,
  })
  parseAdminTrigger(): boolean {
    return true;
  }

  @Option({
    flags: '--admin-token <token>',
    description: 'Admin token for admin-trigger mode',
  })
  parseAdminToken(val: string): string {
    return val;
  }

  @Option({
    flags: '--no-telemetry',
    description: 'Disable telemetry (default: true - no telemetry)',
    defaultValue: true,
  })
  parseNoTelemetry(): boolean {
    return true;
  }

  @Option({
    flags: '--telemetry',
    description: 'Enable telemetry (opt-in)',
  })
  parseTelemetry(): boolean {
    return false; // This sets noTelemetry to false
  }

  @Option({
    flags: '--remote-storage <endpoint>',
    description:
      'Enable remote storage and specify endpoint (default: local only)',
  })
  parseRemoteStorage(val: string): string {
    return val;
  }
}
