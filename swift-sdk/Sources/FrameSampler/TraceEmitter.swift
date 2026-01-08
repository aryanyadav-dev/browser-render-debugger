/**
 * TraceEmitter - Emits sanitized JSON trace files
 *
 * Features:
 * - JSON trace file output matching NativeTraceFormat schema
 * - Sanitized traces (no DOM content, no user PII)
 * - Configurable output directory
 * - Automatic file naming with timestamps
 *
 * Requirements: 15.15, 15.16
 */

import Foundation

#if os(iOS) || os(tvOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

/// DOM signal types (limited compared to CDP)
public enum DOMSignalType: String, Codable, Sendable {
    case layout = "layout"
    case styleRecalc = "style_recalc"
    case domMutation = "dom_mutation"
}

/// Basic DOM signal from WebView instrumentation
public struct DOMSignal: Codable, Sendable {
    /// Signal type
    public let type: DOMSignalType
    /// Timestamp in microseconds
    public let timestamp: Int64
    /// Duration in milliseconds if applicable
    public let durationMs: Double?
    /// Number of affected nodes (if available)
    public let affectedNodes: Int?
    /// CSS selector hint (if available, sanitized)
    public let selector: String?
    
    public init(
        type: DOMSignalType,
        timestamp: Int64,
        durationMs: Double? = nil,
        affectedNodes: Int? = nil,
        selector: String? = nil
    ) {
        self.type = type
        self.timestamp = timestamp
        self.durationMs = durationMs
        self.affectedNodes = affectedNodes
        self.selector = selector
    }
}

/// Metadata about the trace collection environment
public struct TraceMetadata: Codable, Sendable {
    /// App bundle identifier
    public let bundleId: String?
    /// App version
    public let appVersion: String?
    /// iOS/macOS version
    public let osVersion: String
    /// Device model
    public let deviceModel: String
    /// Screen dimensions
    public let screenSize: ScreenSize?
    /// Device pixel ratio / scale factor
    public let scale: Double?
    /// Trace collection timestamp (ISO 8601)
    public let timestamp: String
    /// Target FPS (typically 60 or 120)
    public let fpsTarget: Int
    /// URL being profiled (if WebView) - sanitized
    public let url: String?
    /// Scenario name if applicable
    public let scenario: String?
    /// SDK version that generated this trace
    public let sdkVersion: String
    /// Whether this is a sampled trace
    public let sampled: Bool?
    /// Sampling rate if sampled (0.0 - 1.0)
    public let samplingRate: Double?
    
    public struct ScreenSize: Codable, Sendable {
        public let width: Int
        public let height: Int
        
        public init(width: Int, height: Int) {
            self.width = width
            self.height = height
        }
    }
    
    public init(
        bundleId: String? = nil,
        appVersion: String? = nil,
        osVersion: String,
        deviceModel: String,
        screenSize: ScreenSize? = nil,
        scale: Double? = nil,
        timestamp: String,
        fpsTarget: Int,
        url: String? = nil,
        scenario: String? = nil,
        sdkVersion: String,
        sampled: Bool? = nil,
        samplingRate: Double? = nil
    ) {
        self.bundleId = bundleId
        self.appVersion = appVersion
        self.osVersion = osVersion
        self.deviceModel = deviceModel
        self.screenSize = screenSize
        self.scale = scale
        self.timestamp = timestamp
        self.fpsTarget = fpsTarget
        self.url = url
        self.scenario = scenario
        self.sdkVersion = sdkVersion
        self.sampled = sampled
        self.samplingRate = samplingRate
    }
}

/// NativeTraceFormat - The JSON schema for Swift SDK trace output
public struct NativeTrace: Codable, Sendable {
    /// Schema version for forward compatibility
    public let version: String
    /// Unique trace identifier
    public let traceId: String
    /// Human-readable name for this trace
    public let name: String
    /// Total trace duration in milliseconds
    public let durationMs: Double
    /// Frame timing data from CADisplayLink
    public let frames: [FrameTiming]
    /// Long tasks detected (> 50ms)
    public let longTasks: [LongTask]
    /// DOM signals from WebView (limited)
    public let domSignals: [DOMSignal]
    /// Trace metadata
    public let metadata: TraceMetadata
    
    public init(
        version: String = "1.0",
        traceId: String,
        name: String,
        durationMs: Double,
        frames: [FrameTiming],
        longTasks: [LongTask],
        domSignals: [DOMSignal],
        metadata: TraceMetadata
    ) {
        self.version = version
        self.traceId = traceId
        self.name = name
        self.durationMs = durationMs
        self.frames = frames
        self.longTasks = longTasks
        self.domSignals = domSignals
        self.metadata = metadata
    }
}

/// Configuration for TraceEmitter
public struct TraceEmitterConfig: Sendable {
    /// Output directory for trace files
    public let outputDirectory: URL
    /// Whether to sanitize URLs (remove query params, fragments)
    public let sanitizeUrls: Bool
    /// Whether to include bundle ID in metadata
    public let includeBundleId: Bool
    /// Whether to pretty-print JSON output
    public let prettyPrint: Bool
    /// File name prefix
    public let fileNamePrefix: String
    
    public init(
        outputDirectory: URL,
        sanitizeUrls: Bool = true,
        includeBundleId: Bool = true,
        prettyPrint: Bool = false,
        fileNamePrefix: String = "trace"
    ) {
        self.outputDirectory = outputDirectory
        self.sanitizeUrls = sanitizeUrls
        self.includeBundleId = includeBundleId
        self.prettyPrint = prettyPrint
        self.fileNamePrefix = fileNamePrefix
    }
    
    /// Default configuration using Documents directory
    public static var `default`: TraceEmitterConfig {
        let documentsPath = FileManager.default.urls(
            for: .documentDirectory,
            in: .userDomainMask
        ).first!
        let tracesDir = documentsPath.appendingPathComponent("render-debugger-traces")
        
        return TraceEmitterConfig(outputDirectory: tracesDir)
    }
}

/// TraceEmitter - Emits sanitized JSON trace files
///
/// Usage:
/// ```swift
/// let emitter = TraceEmitter(config: .default)
///
/// // Collect data from FrameSampler and LongTaskDetector
/// let frames = frameSampler.getFrames()
/// let longTasks = longTaskDetector.getTasks()
///
/// // Emit trace
/// let url = try emitter.emit(
///     name: "scroll-test",
///     frames: frames,
///     longTasks: longTasks,
///     domSignals: [],
///     url: "https://example.com",
///     scenario: "scroll-heavy",
///     fpsTarget: 60
/// )
/// ```
public final class TraceEmitter: @unchecked Sendable {
    
    // MARK: - Properties
    
    /// Configuration for the emitter
    public let config: TraceEmitterConfig
    
    /// SDK version
    public static let sdkVersion = "1.0.0"
    
    /// Lock for thread-safe operations
    private let lock = NSLock()
    
    // MARK: - Initialization
    
    /// Initialize a new TraceEmitter with the given configuration
    /// - Parameter config: Configuration for trace emission
    public init(config: TraceEmitterConfig = .default) {
        self.config = config
    }
    
    // MARK: - Public Methods
    
    /// Emit a trace file
    /// - Parameters:
    ///   - name: Human-readable name for the trace
    ///   - frames: Frame timing data
    ///   - longTasks: Long task data
    ///   - domSignals: DOM signal data
    ///   - url: URL being profiled (will be sanitized)
    ///   - scenario: Scenario name
    ///   - fpsTarget: Target FPS
    ///   - sampled: Whether this is a sampled trace
    ///   - samplingRate: Sampling rate if sampled
    /// - Returns: URL of the written trace file
    public func emit(
        name: String,
        frames: [FrameTiming],
        longTasks: [LongTask],
        domSignals: [DOMSignal] = [],
        url: String? = nil,
        scenario: String? = nil,
        fpsTarget: Int = 60,
        sampled: Bool? = nil,
        samplingRate: Double? = nil
    ) throws -> URL {
        lock.lock()
        defer { lock.unlock() }
        
        // Ensure output directory exists
        try ensureOutputDirectory()
        
        // Calculate duration from frames
        let durationMs = calculateDuration(frames: frames)
        
        // Create metadata
        let metadata = createMetadata(
            url: url,
            scenario: scenario,
            fpsTarget: fpsTarget,
            sampled: sampled,
            samplingRate: samplingRate
        )
        
        // Create trace
        let trace = NativeTrace(
            version: "1.0",
            traceId: UUID().uuidString,
            name: name,
            durationMs: durationMs,
            frames: frames,
            longTasks: longTasks,
            domSignals: domSignals,
            metadata: metadata
        )
        
        // Write to file
        let fileURL = try writeTrace(trace)
        
        return fileURL
    }
    
    /// Emit a trace from FrameSampler and LongTaskDetector
    /// - Parameters:
    ///   - name: Human-readable name for the trace
    ///   - frameSampler: FrameSampler instance
    ///   - longTaskDetector: LongTaskDetector instance
    ///   - domSignals: Optional DOM signals
    ///   - url: URL being profiled
    ///   - scenario: Scenario name
    ///   - sampled: Whether this is a sampled trace
    ///   - samplingRate: Sampling rate if sampled
    /// - Returns: URL of the written trace file
    public func emit(
        name: String,
        frameSampler: FrameSampler,
        longTaskDetector: LongTaskDetector,
        domSignals: [DOMSignal] = [],
        url: String? = nil,
        scenario: String? = nil,
        sampled: Bool? = nil,
        samplingRate: Double? = nil
    ) throws -> URL {
        let frames = frameSampler.getFrames()
        let longTasks = longTaskDetector.getTasks()
        let fpsTarget = frameSampler.config.fpsTarget
        
        return try emit(
            name: name,
            frames: frames,
            longTasks: longTasks,
            domSignals: domSignals,
            url: url,
            scenario: scenario,
            fpsTarget: fpsTarget,
            sampled: sampled,
            samplingRate: samplingRate
        )
    }
    
    /// List all trace files in the output directory
    /// - Returns: Array of trace file URLs
    public func listTraces() throws -> [URL] {
        let fileManager = FileManager.default
        
        guard fileManager.fileExists(atPath: config.outputDirectory.path) else {
            return []
        }
        
        let contents = try fileManager.contentsOfDirectory(
            at: config.outputDirectory,
            includingPropertiesForKeys: [.creationDateKey],
            options: [.skipsHiddenFiles]
        )
        
        return contents.filter { $0.pathExtension == "json" }
            .sorted { url1, url2 in
                let date1 = (try? url1.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? Date.distantPast
                let date2 = (try? url2.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? Date.distantPast
                return date1 > date2
            }
    }
    
    /// Delete a trace file
    /// - Parameter url: URL of the trace file to delete
    public func deleteTrace(at url: URL) throws {
        try FileManager.default.removeItem(at: url)
    }
    
    /// Delete all trace files
    public func deleteAllTraces() throws {
        let traces = try listTraces()
        for trace in traces {
            try deleteTrace(at: trace)
        }
    }
    
    // MARK: - Private Methods
    
    private func ensureOutputDirectory() throws {
        let fileManager = FileManager.default
        
        if !fileManager.fileExists(atPath: config.outputDirectory.path) {
            try fileManager.createDirectory(
                at: config.outputDirectory,
                withIntermediateDirectories: true,
                attributes: nil
            )
        }
    }
    
    private func calculateDuration(frames: [FrameTiming]) -> Double {
        guard let first = frames.first, let last = frames.last else {
            return 0
        }
        
        // Duration in milliseconds
        return Double(last.endTimestamp - first.startTimestamp) / 1000.0
    }
    
    private func createMetadata(
        url: String?,
        scenario: String?,
        fpsTarget: Int,
        sampled: Bool?,
        samplingRate: Double?
    ) -> TraceMetadata {
        let sanitizedUrl = url.flatMap { sanitizeUrl($0) }
        
        return TraceMetadata(
            bundleId: config.includeBundleId ? Bundle.main.bundleIdentifier : nil,
            appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
            osVersion: getOSVersion(),
            deviceModel: getDeviceModel(),
            screenSize: getScreenSize(),
            scale: getScreenScale(),
            timestamp: ISO8601DateFormatter().string(from: Date()),
            fpsTarget: fpsTarget,
            url: sanitizedUrl,
            scenario: scenario,
            sdkVersion: TraceEmitter.sdkVersion,
            sampled: sampled,
            samplingRate: samplingRate
        )
    }
    
    private func sanitizeUrl(_ url: String) -> String? {
        guard config.sanitizeUrls else { return url }
        
        guard var components = URLComponents(string: url) else {
            return nil
        }
        
        // Remove query parameters and fragment
        components.query = nil
        components.fragment = nil
        
        return components.string
    }
    
    private func writeTrace(_ trace: NativeTrace) throws -> URL {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        
        if config.prettyPrint {
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        }
        
        let data = try encoder.encode(trace)
        
        // Generate file name
        let timestamp = ISO8601DateFormatter().string(from: Date())
            .replacingOccurrences(of: ":", with: "-")
        let fileName = "\(config.fileNamePrefix)-\(timestamp).json"
        let fileURL = config.outputDirectory.appendingPathComponent(fileName)
        
        try data.write(to: fileURL)
        
        return fileURL
    }
    
    private func getOSVersion() -> String {
        #if os(iOS) || os(tvOS)
        return UIDevice.current.systemVersion
        #elseif os(macOS)
        let version = ProcessInfo.processInfo.operatingSystemVersion
        return "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
        #else
        return "Unknown"
        #endif
    }
    
    private func getDeviceModel() -> String {
        #if os(iOS) || os(tvOS)
        var systemInfo = utsname()
        uname(&systemInfo)
        let machineMirror = Mirror(reflecting: systemInfo.machine)
        let identifier = machineMirror.children.reduce("") { identifier, element in
            guard let value = element.value as? Int8, value != 0 else { return identifier }
            return identifier + String(UnicodeScalar(UInt8(value)))
        }
        return identifier
        #elseif os(macOS)
        var size = 0
        sysctlbyname("hw.model", nil, &size, nil, 0)
        var model = [CChar](repeating: 0, count: size)
        sysctlbyname("hw.model", &model, &size, nil, 0)
        return String(cString: model)
        #else
        return "Unknown"
        #endif
    }
    
    private func getScreenSize() -> TraceMetadata.ScreenSize? {
        #if os(iOS) || os(tvOS)
        let screen = UIScreen.main
        return TraceMetadata.ScreenSize(
            width: Int(screen.bounds.width),
            height: Int(screen.bounds.height)
        )
        #elseif os(macOS)
        if let screen = NSScreen.main {
            return TraceMetadata.ScreenSize(
                width: Int(screen.frame.width),
                height: Int(screen.frame.height)
            )
        }
        return nil
        #else
        return nil
        #endif
    }
    
    private func getScreenScale() -> Double? {
        #if os(iOS) || os(tvOS)
        return Double(UIScreen.main.scale)
        #elseif os(macOS)
        if let scale = NSScreen.main?.backingScaleFactor {
            return Double(scale)
        }
        return nil
        #else
        return nil
        #endif
    }
}
