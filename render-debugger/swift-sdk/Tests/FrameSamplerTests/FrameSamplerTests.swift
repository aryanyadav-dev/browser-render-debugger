/**
 * FrameSampler Tests
 *
 * Unit tests for the FrameSampler Swift SDK.
 */

import XCTest
@testable import FrameSampler

final class FrameSamplerTests: XCTestCase {
    
    // MARK: - FrameSampler Tests
    
    func testFrameSamplerInitialization() {
        let config = FrameSamplerConfig(fpsTarget: 60)
        let sampler = FrameSampler(config: config)
        
        XCTAssertEqual(sampler.config.fpsTarget, 60)
        XCTAssertEqual(sampler.config.frameBudgetMs, 1000.0 / 60.0, accuracy: 0.001)
        XCTAssertFalse(sampler.isRunning)
        XCTAssertTrue(sampler.collectedFrames.isEmpty)
    }
    
    func testFrameSamplerConfig120fps() {
        let config = FrameSamplerConfig.default120fps
        
        XCTAssertEqual(config.fpsTarget, 120)
        XCTAssertEqual(config.frameBudgetMs, 1000.0 / 120.0, accuracy: 0.001)
    }
    
    func testFrameSamplerStartStop() {
        let sampler = FrameSampler(config: .default60fps)
        
        XCTAssertFalse(sampler.isRunning)
        
        sampler.start()
        XCTAssertTrue(sampler.isRunning)
        
        sampler.stop()
        XCTAssertFalse(sampler.isRunning)
    }
    
    func testFrameSamplerReset() {
        let sampler = FrameSampler(config: .default60fps)
        sampler.start()
        
        // Wait a bit to collect some frames
        let expectation = XCTestExpectation(description: "Collect frames")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            sampler.stop()
            sampler.reset()
            
            XCTAssertTrue(sampler.collectedFrames.isEmpty)
            XCTAssertEqual(sampler.totalFrames, 0)
            XCTAssertEqual(sampler.droppedFrames, 0)
            
            expectation.fulfill()
        }
        
        wait(for: [expectation], timeout: 1.0)
    }
    
    func testFrameTimingStructure() {
        let frame = FrameTiming(
            frameId: 1,
            startTimestamp: 0,
            endTimestamp: 16667,
            durationMs: 16.667,
            dropped: false,
            targetTimestamp: 16667,
            actualPresentationTimestamp: 16667
        )
        
        XCTAssertEqual(frame.frameId, 1)
        XCTAssertEqual(frame.durationMs, 16.667, accuracy: 0.001)
        XCTAssertFalse(frame.dropped)
    }
    
    // MARK: - LongTaskDetector Tests
    
    func testLongTaskDetectorInitialization() {
        let config = LongTaskDetectorConfig(thresholdMs: 50.0)
        let detector = LongTaskDetector(config: config)
        
        XCTAssertEqual(detector.config.thresholdMs, 50.0)
        XCTAssertFalse(detector.isRunning)
        XCTAssertTrue(detector.detectedTasks.isEmpty)
    }
    
    func testLongTaskDetectorStartStop() {
        let detector = LongTaskDetector(config: .default)
        
        XCTAssertFalse(detector.isRunning)
        
        detector.start()
        XCTAssertTrue(detector.isRunning)
        
        detector.stop()
        XCTAssertFalse(detector.isRunning)
    }
    
    func testLongTaskStructure() {
        let task = LongTask(
            startTimestamp: 1000000,
            durationMs: 75.0,
            name: "heavyComputation",
            category: "Processing",
            source: .native,
            functionName: "processData",
            file: "DataProcessor.swift",
            line: 42,
            column: 10
        )
        
        XCTAssertEqual(task.startTimestamp, 1000000)
        XCTAssertEqual(task.durationMs, 75.0)
        XCTAssertEqual(task.name, "heavyComputation")
        XCTAssertEqual(task.source, .native)
    }
    
    func testLongTaskMeasure() {
        let detector = LongTaskDetector(config: LongTaskDetectorConfig(thresholdMs: 10.0))
        detector.start()
        
        // Measure a task that should be detected as long
        let result = detector.measure(name: "testTask") {
            // Simulate work
            Thread.sleep(forTimeInterval: 0.02) // 20ms
            return 42
        }
        
        XCTAssertEqual(result, 42)
        
        detector.stop()
        
        // Should have detected the long task
        let tasks = detector.getTasks()
        XCTAssertFalse(tasks.isEmpty)
        XCTAssertEqual(tasks.first?.name, "testTask")
        XCTAssertGreaterThanOrEqual(tasks.first?.durationMs ?? 0, 10.0)
    }
    
    // MARK: - TraceEmitter Tests
    
    func testTraceEmitterConfig() {
        let config = TraceEmitterConfig.default
        
        XCTAssertTrue(config.sanitizeUrls)
        XCTAssertTrue(config.includeBundleId)
        XCTAssertFalse(config.prettyPrint)
    }
    
    func testDOMSignalStructure() {
        let signal = DOMSignal(
            type: .layout,
            timestamp: 5000000,
            durationMs: 5.0,
            affectedNodes: 10,
            selector: ".card"
        )
        
        XCTAssertEqual(signal.type, .layout)
        XCTAssertEqual(signal.timestamp, 5000000)
        XCTAssertEqual(signal.durationMs, 5.0)
    }
    
    func testTraceMetadataStructure() {
        let metadata = TraceMetadata(
            bundleId: "com.example.app",
            appVersion: "1.0.0",
            osVersion: "17.0",
            deviceModel: "iPhone15,2",
            screenSize: TraceMetadata.ScreenSize(width: 390, height: 844),
            scale: 3.0,
            timestamp: "2024-01-01T00:00:00Z",
            fpsTarget: 60,
            url: "https://example.com",
            scenario: "scroll-heavy",
            sdkVersion: "1.0.0",
            sampled: false,
            samplingRate: 1.0
        )
        
        XCTAssertEqual(metadata.bundleId, "com.example.app")
        XCTAssertEqual(metadata.fpsTarget, 60)
        XCTAssertEqual(metadata.screenSize?.width, 390)
    }
    
    // MARK: - TraceSession Tests
    
    func testTraceSessionConfigDevelopment() {
        let config = TraceSessionConfig.development
        
        XCTAssertEqual(config.samplingRate, 1.0)
        XCTAssertTrue(config.isDevelopment)
        XCTAssertEqual(config.maxDurationSeconds, 15.0)
    }
    
    func testTraceSessionConfigProduction() {
        let config = TraceSessionConfig.production
        
        XCTAssertEqual(config.samplingRate, 0.1)
        XCTAssertFalse(config.isDevelopment)
    }
    
    func testTraceSessionConfigClamping() {
        // Test that duration is clamped to 5-15s range
        let config1 = TraceSessionConfig(maxDurationSeconds: 3.0)
        XCTAssertEqual(config1.maxDurationSeconds, 5.0)
        
        let config2 = TraceSessionConfig(maxDurationSeconds: 30.0)
        XCTAssertEqual(config2.maxDurationSeconds, 15.0)
        
        // Test that sampling rate is clamped to 0-1 range
        let config3 = TraceSessionConfig(samplingRate: -0.5)
        XCTAssertEqual(config3.samplingRate, 0.0)
        
        let config4 = TraceSessionConfig(samplingRate: 1.5)
        XCTAssertEqual(config4.samplingRate, 1.0)
    }
    
    func testTraceSessionInitialization() {
        let session = TraceSession(config: .development)
        
        XCTAssertNil(session.currentSessionId)
        XCTAssertFalse(session.isAdminUser)
    }
    
    func testTraceSessionAdminRequired() {
        let session = TraceSession(config: .production)
        session.isAdminUser = false
        
        let expectation = XCTestExpectation(description: "Admin required error")
        
        session.start(name: "test") { result in
            XCTAssertFalse(result.success)
            if case TraceSessionError.adminRequired = result.error as? TraceSessionError {
                expectation.fulfill()
            }
        }
        
        wait(for: [expectation], timeout: 1.0)
    }
    
    func testTraceSessionResultStructure() {
        let result = TraceSessionResult(
            success: true,
            traceURL: URL(fileURLWithPath: "/tmp/trace.json"),
            durationSeconds: 10.0,
            frameCount: 600,
            droppedFrameCount: 5,
            longTaskCount: 2,
            wasSampled: true
        )
        
        XCTAssertTrue(result.success)
        XCTAssertEqual(result.frameCount, 600)
        XCTAssertEqual(result.droppedFrameCount, 5)
        XCTAssertTrue(result.wasSampled)
    }
    
    func testAutomaticTriggerThreshold() {
        let threshold = AutomaticTriggerThreshold(
            droppedFramePercentage: 15.0,
            minFramesToObserve: 120,
            cooldownSeconds: 120.0
        )
        
        XCTAssertEqual(threshold.droppedFramePercentage, 15.0)
        XCTAssertEqual(threshold.minFramesToObserve, 120)
        XCTAssertEqual(threshold.cooldownSeconds, 120.0)
    }
    
    // MARK: - Codable Tests
    
    func testFrameTimingCodable() throws {
        let frame = FrameTiming(
            frameId: 1,
            startTimestamp: 0,
            endTimestamp: 16667,
            durationMs: 16.667,
            dropped: false
        )
        
        let encoder = JSONEncoder()
        let data = try encoder.encode(frame)
        
        let decoder = JSONDecoder()
        let decoded = try decoder.decode(FrameTiming.self, from: data)
        
        XCTAssertEqual(decoded.frameId, frame.frameId)
        XCTAssertEqual(decoded.durationMs, frame.durationMs, accuracy: 0.001)
    }
    
    func testLongTaskCodable() throws {
        let task = LongTask(
            startTimestamp: 1000000,
            durationMs: 75.0,
            name: "test",
            source: .native
        )
        
        let encoder = JSONEncoder()
        let data = try encoder.encode(task)
        
        let decoder = JSONDecoder()
        let decoded = try decoder.decode(LongTask.self, from: data)
        
        XCTAssertEqual(decoded.startTimestamp, task.startTimestamp)
        XCTAssertEqual(decoded.source, .native)
    }
    
    func testNativeTraceCodable() throws {
        let trace = NativeTrace(
            version: "1.0",
            traceId: "test-id",
            name: "test-trace",
            durationMs: 1000.0,
            frames: [],
            longTasks: [],
            domSignals: [],
            metadata: TraceMetadata(
                osVersion: "17.0",
                deviceModel: "iPhone15,2",
                timestamp: "2024-01-01T00:00:00Z",
                fpsTarget: 60,
                sdkVersion: "1.0.0"
            )
        )
        
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let data = try encoder.encode(trace)
        
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let decoded = try decoder.decode(NativeTrace.self, from: data)
        
        XCTAssertEqual(decoded.version, "1.0")
        XCTAssertEqual(decoded.traceId, "test-id")
        XCTAssertEqual(decoded.metadata.fpsTarget, 60)
    }
}
