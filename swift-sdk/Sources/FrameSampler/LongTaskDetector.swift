/**
 * LongTaskDetector - Detects long-running tasks using os_signpost and JS bridge
 *
 * Features:
 * - Native task detection via os_signpost
 * - WebView task detection via PerformanceObserver JS bridge
 * - Configurable threshold (default 50ms)
 * - Task categorization and naming
 *
 * Requirements: 15.14
 */

import Foundation
import os.signpost

#if os(iOS) || os(tvOS)
import WebKit
#elseif os(macOS)
import WebKit
#endif

/// Long task information
public struct LongTask: Codable, Sendable {
    /// Task start timestamp in microseconds (since trace start)
    public let startTimestamp: Int64
    /// Task duration in milliseconds
    public let durationMs: Double
    /// Task name/label from os_signpost
    public let name: String?
    /// Category from os_signpost
    public let category: String?
    /// Source: 'native' for os_signpost, 'webview' for PerformanceObserver
    public let source: LongTaskSource
    /// Function name if available (from JS bridge)
    public let functionName: String?
    /// File path if available
    public let file: String?
    /// Line number if available
    public let line: Int?
    /// Column number if available
    public let column: Int?
    
    public init(
        startTimestamp: Int64,
        durationMs: Double,
        name: String? = nil,
        category: String? = nil,
        source: LongTaskSource,
        functionName: String? = nil,
        file: String? = nil,
        line: Int? = nil,
        column: Int? = nil
    ) {
        self.startTimestamp = startTimestamp
        self.durationMs = durationMs
        self.name = name
        self.category = category
        self.source = source
        self.functionName = functionName
        self.file = file
        self.line = line
        self.column = column
    }
}

/// Source of the long task
public enum LongTaskSource: String, Codable, Sendable {
    case native = "native"
    case webview = "webview"
}

/// Configuration for LongTaskDetector
public struct LongTaskDetectorConfig: Sendable {
    /// Threshold in milliseconds for considering a task "long" (default 50ms)
    public let thresholdMs: Double
    /// Whether to enable native os_signpost detection
    public let enableNativeDetection: Bool
    /// Whether to enable WebView PerformanceObserver detection
    public let enableWebViewDetection: Bool
    /// Subsystem for os_signpost logging
    public let subsystem: String
    /// Category for os_signpost logging
    public let category: String
    
    public init(
        thresholdMs: Double = 50.0,
        enableNativeDetection: Bool = true,
        enableWebViewDetection: Bool = true,
        subsystem: String = "com.render-debugger.frame-sampler",
        category: String = "LongTasks"
    ) {
        self.thresholdMs = thresholdMs
        self.enableNativeDetection = enableNativeDetection
        self.enableWebViewDetection = enableWebViewDetection
        self.subsystem = subsystem
        self.category = category
    }
    
    /// Default configuration
    public static let `default` = LongTaskDetectorConfig()
}

/// Delegate protocol for receiving long task notifications
public protocol LongTaskDetectorDelegate: AnyObject {
    /// Called when a long task is detected
    func longTaskDetector(_ detector: LongTaskDetector, didDetectTask task: LongTask)
}

/// LongTaskDetector - Detects tasks exceeding the threshold duration
///
/// Usage:
/// ```swift
/// let detector = LongTaskDetector(config: .default)
/// detector.delegate = self
/// detector.start()
///
/// // Mark native tasks
/// detector.beginTask(name: "heavyComputation", category: "Processing")
/// // ... do work
/// detector.endTask(name: "heavyComputation")
///
/// // For WebView, inject the JS bridge
/// detector.injectPerformanceObserver(into: webView)
/// ```
public final class LongTaskDetector: NSObject, @unchecked Sendable {
    
    // MARK: - Properties
    
    /// Configuration for the detector
    public let config: LongTaskDetectorConfig
    
    /// Delegate for receiving long task notifications
    public weak var delegate: LongTaskDetectorDelegate?
    
    /// Whether the detector is currently running
    public private(set) var isRunning: Bool = false
    
    /// Collected long tasks
    public private(set) var detectedTasks: [LongTask] = []
    
    /// Start time of the current detection session
    private var sessionStartTime: CFTimeInterval = 0
    
    /// Active tasks being tracked (name -> start time)
    private var activeTasks: [String: CFTimeInterval] = [:]
    
    /// Lock for thread-safe access
    private let lock = NSLock()
    
    /// os_log handle for signpost logging
    private let signpostLog: OSLog
    
    /// Signpost IDs for active tasks
    private var signpostIDs: [String: OSSignpostID] = [:]
    
    // MARK: - Initialization
    
    /// Initialize a new LongTaskDetector with the given configuration
    /// - Parameter config: Configuration for long task detection
    public init(config: LongTaskDetectorConfig = .default) {
        self.config = config
        self.signpostLog = OSLog(subsystem: config.subsystem, category: config.category)
        super.init()
    }
    
    // MARK: - Public Methods
    
    /// Start detecting long tasks
    public func start() {
        guard !isRunning else { return }
        
        lock.lock()
        defer { lock.unlock() }
        
        detectedTasks.removeAll()
        activeTasks.removeAll()
        signpostIDs.removeAll()
        sessionStartTime = CACurrentMediaTime()
        isRunning = true
    }
    
    /// Stop detecting long tasks
    public func stop() {
        guard isRunning else { return }
        
        lock.lock()
        defer { lock.unlock() }
        
        // End any active tasks
        for (name, _) in activeTasks {
            endTaskInternal(name: name)
        }
        
        isRunning = false
    }
    
    /// Reset the detector, clearing all collected data
    public func reset() {
        lock.lock()
        defer { lock.unlock() }
        
        detectedTasks.removeAll()
        activeTasks.removeAll()
        signpostIDs.removeAll()
    }
    
    /// Get a copy of detected tasks (thread-safe)
    public func getTasks() -> [LongTask] {
        lock.lock()
        defer { lock.unlock() }
        return detectedTasks
    }
    
    // MARK: - Native Task Tracking (os_signpost)
    
    /// Begin tracking a native task
    /// - Parameters:
    ///   - name: Name of the task
    ///   - category: Optional category for the task
    public func beginTask(name: String, category: String? = nil) {
        guard isRunning && config.enableNativeDetection else { return }
        
        lock.lock()
        defer { lock.unlock() }
        
        let startTime = CACurrentMediaTime()
        activeTasks[name] = startTime
        
        // Create signpost
        let signpostID = OSSignpostID(log: signpostLog)
        signpostIDs[name] = signpostID
        
        os_signpost(.begin, log: signpostLog, name: "Task", signpostID: signpostID, "%{public}s", name)
    }
    
    /// End tracking a native task
    /// - Parameter name: Name of the task to end
    public func endTask(name: String) {
        guard isRunning && config.enableNativeDetection else { return }
        
        lock.lock()
        defer { lock.unlock() }
        
        endTaskInternal(name: name)
    }
    
    /// Measure a synchronous block of code
    /// - Parameters:
    ///   - name: Name of the task
    ///   - category: Optional category
    ///   - block: The code block to measure
    /// - Returns: The result of the block
    public func measure<T>(name: String, category: String? = nil, block: () throws -> T) rethrows -> T {
        beginTask(name: name, category: category)
        defer { endTask(name: name) }
        return try block()
    }
    
    /// Measure an async block of code
    /// - Parameters:
    ///   - name: Name of the task
    ///   - category: Optional category
    ///   - block: The async code block to measure
    /// - Returns: The result of the block
    @available(iOS 13.0, macOS 10.15, tvOS 13.0, *)
    public func measureAsync<T>(name: String, category: String? = nil, block: () async throws -> T) async rethrows -> T {
        beginTask(name: name, category: category)
        defer { endTask(name: name) }
        return try await block()
    }
    
    // MARK: - WebView Integration (PerformanceObserver)
    
    #if os(iOS) || os(macOS) || os(tvOS)
    /// Inject PerformanceObserver script into a WKWebView
    /// - Parameter webView: The WKWebView to inject into
    public func injectPerformanceObserver(into webView: WKWebView) {
        guard config.enableWebViewDetection else { return }
        
        let script = createPerformanceObserverScript()
        let userScript = WKUserScript(
            source: script,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        
        webView.configuration.userContentController.addUserScript(userScript)
        webView.configuration.userContentController.add(
            WebViewMessageHandler(detector: self),
            name: "renderDebuggerLongTask"
        )
    }
    
    /// Remove PerformanceObserver from a WKWebView
    /// - Parameter webView: The WKWebView to remove from
    public func removePerformanceObserver(from webView: WKWebView) {
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: "renderDebuggerLongTask"
        )
    }
    #endif
    
    // MARK: - Private Methods
    
    private func endTaskInternal(name: String) {
        guard let startTime = activeTasks.removeValue(forKey: name) else { return }
        
        let endTime = CACurrentMediaTime()
        let durationMs = (endTime - startTime) * 1000.0
        
        // End signpost
        if let signpostID = signpostIDs.removeValue(forKey: name) {
            os_signpost(.end, log: signpostLog, name: "Task", signpostID: signpostID, "%{public}s", name)
        }
        
        // Check if this is a long task
        if durationMs >= config.thresholdMs {
            let startTimestampUs = Int64((startTime - sessionStartTime) * 1_000_000)
            
            let longTask = LongTask(
                startTimestamp: startTimestampUs,
                durationMs: durationMs,
                name: name,
                category: config.category,
                source: .native,
                functionName: nil,
                file: nil,
                line: nil,
                column: nil
            )
            
            detectedTasks.append(longTask)
            
            // Notify delegate (outside lock)
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                self.delegate?.longTaskDetector(self, didDetectTask: longTask)
            }
        }
    }
    
    /// Handle long task from WebView
    internal func handleWebViewLongTask(
        startTimestamp: Int64,
        durationMs: Double,
        name: String?,
        functionName: String?,
        file: String?,
        line: Int?,
        column: Int?
    ) {
        guard isRunning && config.enableWebViewDetection else { return }
        guard durationMs >= config.thresholdMs else { return }
        
        lock.lock()
        
        let longTask = LongTask(
            startTimestamp: startTimestamp,
            durationMs: durationMs,
            name: name,
            category: "WebView",
            source: .webview,
            functionName: functionName,
            file: file,
            line: line,
            column: column
        )
        
        detectedTasks.append(longTask)
        lock.unlock()
        
        // Notify delegate
        delegate?.longTaskDetector(self, didDetectTask: longTask)
    }
    
    private func createPerformanceObserverScript() -> String {
        return """
        (function() {
            'use strict';
            
            // Check if PerformanceObserver is available
            if (typeof PerformanceObserver === 'undefined') {
                console.warn('[render-debugger] PerformanceObserver not available');
                return;
            }
            
            // Track session start time
            const sessionStartTime = performance.now();
            
            // Create observer for long tasks
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry.entryType === 'longtask') {
                        // Calculate timestamp relative to session start (in microseconds)
                        const startTimestamp = Math.round((entry.startTime - sessionStartTime) * 1000);
                        
                        // Extract attribution info if available
                        let functionName = null;
                        let file = null;
                        let line = null;
                        let column = null;
                        
                        if (entry.attribution && entry.attribution.length > 0) {
                            const attr = entry.attribution[0];
                            if (attr.containerSrc) {
                                file = attr.containerSrc;
                            }
                            if (attr.containerName) {
                                functionName = attr.containerName;
                            }
                        }
                        
                        // Send to native
                        window.webkit.messageHandlers.renderDebuggerLongTask.postMessage({
                            startTimestamp: startTimestamp,
                            durationMs: entry.duration,
                            name: entry.name,
                            functionName: functionName,
                            file: file,
                            line: line,
                            column: column
                        });
                    }
                }
            });
            
            // Start observing
            try {
                observer.observe({ type: 'longtask', buffered: true });
                console.log('[render-debugger] PerformanceObserver started');
            } catch (e) {
                console.warn('[render-debugger] Failed to observe longtask:', e);
            }
        })();
        """
    }
}

// MARK: - WebView Message Handler

#if os(iOS) || os(macOS) || os(tvOS)
/// Message handler for receiving long task data from WebView
private class WebViewMessageHandler: NSObject, WKScriptMessageHandler {
    weak var detector: LongTaskDetector?
    
    init(detector: LongTaskDetector) {
        self.detector = detector
        super.init()
    }
    
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any] else { return }
        
        let startTimestamp = body["startTimestamp"] as? Int64 ?? 0
        let durationMs = body["durationMs"] as? Double ?? 0
        let name = body["name"] as? String
        let functionName = body["functionName"] as? String
        let file = body["file"] as? String
        let line = body["line"] as? Int
        let column = body["column"] as? Int
        
        detector?.handleWebViewLongTask(
            startTimestamp: startTimestamp,
            durationMs: durationMs,
            name: name,
            functionName: functionName,
            file: file,
            line: line,
            column: column
        )
    }
}
#endif
