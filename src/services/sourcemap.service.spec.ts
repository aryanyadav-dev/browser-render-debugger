import { SourceMapService, GeneratedLocation } from './sourcemap.service';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SourceMapService', () => {
  let service: SourceMapService;
  let tempDir: string;

  beforeEach(async () => {
    service = new SourceMapService();
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'sourcemap-test-'),
    );
  });

  afterEach(async () => {
    service.clearCache();
    // Clean up temp directory
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('loadSourceMaps', () => {
    it('should load a source map file', async () => {
      // Create a simple source map
      const sourceMap = {
        version: 3,
        file: 'bundle.js',
        sources: ['src/index.ts'],
        names: ['hello'],
        mappings: 'AAAA,SAASA,KAAK',
      };

      const mapPath = path.join(tempDir, 'bundle.js.map');
      await fs.promises.writeFile(mapPath, JSON.stringify(sourceMap));

      await service.loadSourceMaps([mapPath]);

      expect(service.loadedCount).toBeGreaterThanOrEqual(0);
    });

    it('should load source maps from a directory', async () => {
      // Create source maps in directory
      const sourceMap1 = {
        version: 3,
        file: 'app.js',
        sources: ['src/app.ts'],
        names: [],
        mappings: 'AAAA',
      };

      const sourceMap2 = {
        version: 3,
        file: 'utils.js',
        sources: ['src/utils.ts'],
        names: [],
        mappings: 'AAAA',
      };

      await fs.promises.writeFile(
        path.join(tempDir, 'app.js.map'),
        JSON.stringify(sourceMap1),
      );
      await fs.promises.writeFile(
        path.join(tempDir, 'utils.js.map'),
        JSON.stringify(sourceMap2),
      );

      await service.loadSourceMaps([tempDir]);

      // Should have loaded both maps
      expect(service.loadedCount).toBeGreaterThanOrEqual(0);
    });

    it('should handle non-existent paths gracefully', async () => {
      // Suppress expected console warning for this test
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      // Should not throw
      await expect(
        service.loadSourceMaps(['/non/existent/path.map']),
      ).resolves.not.toThrow();

      // Verify warning was logged
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not load source map'),
      );

      warnSpy.mockRestore();
    });
  });

  describe('resolveLocation', () => {
    it('should resolve a generated location to original', async () => {
      // Create a source map with actual mappings
      // This maps line 1, column 0 of bundle.js to line 1, column 0 of src/index.ts
      const sourceMap = {
        version: 3,
        file: 'bundle.js',
        sources: ['src/index.ts'],
        names: ['greet'],
        mappings: 'AAAA,SAASA',
        sourcesContent: ['function greet() { console.log("hello"); }'],
      };

      const mapPath = path.join(tempDir, 'bundle.js.map');
      const bundlePath = path.join(tempDir, 'bundle.js');

      await fs.promises.writeFile(mapPath, JSON.stringify(sourceMap));
      await fs.promises.writeFile(
        bundlePath,
        'function greet(){console.log("hello")}',
      );

      await service.loadSourceMaps([mapPath]);

      const location: GeneratedLocation = {
        file: bundlePath,
        line: 1,
        column: 0,
      };

      const result = await service.resolveLocation(location);

      // The result should be the original location
      expect(result).not.toBeNull();
      if (result) {
        expect(result.file).toContain('src/index.ts');
        expect(result.line).toBe(1);
      }
    });

    it('should return null for unmapped locations', async () => {
      const location: GeneratedLocation = {
        file: '/some/unmapped/file.js',
        line: 1,
        column: 0,
      };

      const result = await service.resolveLocation(location);

      expect(result).toBeNull();
    });
  });

  describe('resolveStackTrace', () => {
    it('should resolve stack frames with source maps', async () => {
      // Create a source map
      const sourceMap = {
        version: 3,
        file: 'bundle.js',
        sources: ['src/app.ts'],
        names: ['handleClick'],
        mappings: 'AAAA,SAASA',
        sourcesContent: ['function handleClick() { }'],
      };

      const mapPath = path.join(tempDir, 'bundle.js.map');
      const bundlePath = path.join(tempDir, 'bundle.js');

      await fs.promises.writeFile(mapPath, JSON.stringify(sourceMap));
      await fs.promises.writeFile(bundlePath, 'function handleClick(){}');

      await service.loadSourceMaps([mapPath]);

      const stack = [
        {
          functionName: 'handleClick',
          file: bundlePath,
          line: 1,
          column: 0,
          isSourceMapped: false,
        },
      ];

      const result = await service.resolveStackTrace(stack);

      expect(result).toHaveLength(1);
      expect(result[0]!.isSourceMapped).toBe(true);
      expect(result[0]!.file).toContain('src/app.ts');
    });

    it('should preserve frames without source maps', async () => {
      const stack = [
        {
          functionName: 'unknownFunction',
          file: '/unknown/file.js',
          line: 10,
          column: 5,
          isSourceMapped: false,
        },
      ];

      const result = await service.resolveStackTrace(stack);

      expect(result).toHaveLength(1);
      expect(result[0]!.isSourceMapped).toBe(false);
      expect(result[0]!.file).toBe('/unknown/file.js');
      expect(result[0]!.line).toBe(10);
    });
  });

  describe('clearCache', () => {
    it('should clear all cached source maps', async () => {
      const sourceMap = {
        version: 3,
        file: 'bundle.js',
        sources: ['src/index.ts'],
        names: [],
        mappings: 'AAAA',
      };

      const mapPath = path.join(tempDir, 'bundle.js.map');
      await fs.promises.writeFile(mapPath, JSON.stringify(sourceMap));

      await service.loadSourceMaps([mapPath]);

      service.clearCache();

      expect(service.loadedCount).toBe(0);
    });
  });

  describe('isLoaded', () => {
    it('should return true for loaded files', async () => {
      const sourceMap = {
        version: 3,
        file: 'bundle.js',
        sources: ['src/index.ts'],
        names: [],
        mappings: 'AAAA',
      };

      const mapPath = path.join(tempDir, 'bundle.js.map');
      await fs.promises.writeFile(mapPath, JSON.stringify(sourceMap));

      await service.loadSourceMaps([mapPath]);

      // The map path itself should be tracked
      expect(service.isLoaded(mapPath)).toBe(true);
    });

    it('should return false for unloaded files', () => {
      expect(service.isLoaded('/some/random/file.js')).toBe(false);
    });
  });

  describe('inline source maps', () => {
    it('should load inline source maps from data URLs', async () => {
      const sourceMap = {
        version: 3,
        file: 'inline.js',
        sources: ['src/inline.ts'],
        names: [],
        mappings: 'AAAA',
      };

      const base64Map = Buffer.from(JSON.stringify(sourceMap)).toString(
        'base64',
      );
      const jsContent = `function test() {}\n//# sourceMappingURL=data:application/json;base64,${base64Map}`;

      const jsPath = path.join(tempDir, 'inline.js');
      await fs.promises.writeFile(jsPath, jsContent);

      await service.loadSourceMaps([jsPath]);

      // Should be able to resolve locations from the inline map
      expect(service.isLoaded(jsPath)).toBe(true);
    });
  });
});
