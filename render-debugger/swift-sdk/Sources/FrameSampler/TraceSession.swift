/**
 * TraceSession - Manages trace collection sessions with sampling and trigger controls
 *
 * Features:
 * - Sampling rate configuration (default 100% dev, configurable prod)
 * - Admin-only trigger mode
 * - Short-lived trace sessions (5-15s max)
 * - Automatic session lifecycle management
 *
 * Requirements: 15.17, 15.18
 */

import Foundation

/// Trigger mode for trace sessions
public enum TraceTriggerMode: Sendable {
    /// Anyone can trigger a trace session
    case open
    /// Only admin users can trigger trace sessions
    case adminOnly
    /// Automatic triggering based on performance thresholds
    case automatic(threshold: AutomaticTriggerThreshold)
}

/// Threshold configuration for automatic triggering
public struct AutomaticTriggerThreshold: Sendable {
    /// Dropped frame percentage threshold to trigger trace
    public let droppedFramePercentage: Double
    /// Minimum frames to observe before triggering
    public let minFramesToObserve: Int
    /// Cooldown period between automatic traces (seconds)
    public let cooldownSeconds: TimeInterval
    
    public init(
        droppedFramePercentage: Double = 10.0,
        minFramesToObserve: Int = 60,
        cooldownSeconds: TimeInterval = 60.0
    ) {
        self.droppedFramePercentage = droppedFramePercentage
        self.minFramesToObserve = minFramesToObserve
        self.cooldownSeconds = cooldownSeconds
    }
    
    public static let `default` = AutomaticTriggerThreshold()
}

/// Configuration for TraceSession
public struct TraceSessionConfig: Sendable {
    /// Sampling rate (0.0 - 1.0). 1.0 = 100% of sessions are recorded
    public let samplingRate: Double
    /// Trigger mode for starting sessions
    public let triggerMode: TraceTriggerMode
    /// Maximum session duration in seconds (5-15s recommended)
    public let maxDurationSeconds: TimeInterval
    /// Minimum session duration in seconds
    public let minDurationSeconds: TimeInterval
    /// Whether this is a development build (affects defaults)
    public let isDevelopment: Bool
    /// Frame sampler configuration
    public let frameSamplerConfig: FrameSamplerConfig
    /// Long task detector configuration
    public let longTaskDetectorConfig: LongTaskDetectorConfig
    /// Trace emitter configuration
    public let traceEmitterConfig: TraceEmitterConfig
    
    public init(
        samplingRate: Double = 1.0,
        triggerMode: TraceTriggerMode = .open,
        maxDurationSeconds: TimeInterval = 15.0,
        minDurationSeconds: TimeInterval = 5.0,
        isDevelopment: Bool = true,
        frameSamplerConfig: FrameSamplerConfig = .default60fps,
        longTaskDetectorConfig: LongTaskDetectorConfig = .default,
        traceEmitterConfig: TraceEmitterConfig = .default
    ) {
        // Clamp sampling rate to valid range
        self.samplingRate = max(0.0, min(1.0, samplingRate))
        self.triggerMode = triggerMode
        // Clamp duration to 5-15s range
        self.maxDurationSeconds = max(5.0, min(15.0, maxDurationSeconds))
        self.minDurationSeconds = max(1.0, min(maxDurationSeconds, minDurationSeconds))
        self.isDevelopment = isDevelopment
        self.frameSamplerConfig = frameSamplerConfig
        self.longTaskDetectorConfig = longTaskDetectorConfig
        self.traceEmitterConfig = traceEmitterConfig
    }
    
    /// Development configuration (100% sampling, open trigger)
    public static let development = TraceSessionConfig(
        samplingRate: 1.0,
        triggerMode: .open,
        maxDurationSeconds: 15.0,
        isDevelopment: true
    )
    
    /// Production configuration (10% sampling, admin-only trigger)
    public static let production = TraceSessionConfig(
        samplingRate: 0.1,
        triggerMode: .adminOnly,
        maxDurationSeconds: 10.0,
        isDevelopment: false
    )
    
    /// Production configuration with automatic triggering
    public static func productionAutomatic(
        samplingRate: Double = 0.1,
        threshold: AutomaticTriggerThreshold = .default
    ) -> TraceSessionConfig {
        return TraceSessionConfig(
            samplingRate: samplingRate,
            triggerMode: .automatic(threshold: threshold),
            maxDurationSeconds: 10.0,
            isDevelopment: false
        )
    }
}

/// Session state
public enum TraceSessionState: Sendable {
    case idle
    case running
    case stopping
    case completed
    case failed(Error)
}

/// Result of a trace session
public struct TraceSessionResult: Sendable {
    /// Whether the session was successful
    public let success: Bool
    /// URL of the trace file (if successful)
    public let traceURL: URL?
    /// Duration of the session in seconds
    public let durationSeconds: TimeInterval
    /// Number of frames collected
    public let frameCount: Int
    /// Number of dropped frames
    public let droppedFrameCount: Int
    /// Number of long tasks detected
    public let longTaskCount: Int
    /// Error if session failed
    public let error: Error?
    /// Whether this session was sampled (vs skipped due to sampling rate)
    public let wasSampled: Bool
    
    public init(
        success: Bool,
        traceURL: URL? = nil,
        durationSeconds: TimeInterval = 0,
        frameCount: Int = 0,
        droppedFrameCount: Int = 0,
        longTaskCount: Int = 0,
        error: Error? = nil,
        wasSampled: Bool = true
    ) {
        self.success = success
        self.traceURL = traceURL
        self.durationSeconds = durationSeconds
        self.frameCount = frameCount
        self.droppedFrameCount = droppedFrameCount
        self.longTaskCount = longTaskCount
        self.error = error
        self.wasSampled = wasSampled
    }
}

/// Delegate protocol for trace session events
public protocol TraceSessionDelegate: AnyObject {
    /// Called when a session starts
    func traceSession(_ session: TraceSession, didStartWithId sessionId: String)
    /// Called when a session completes
    func traceSession(_ session: TraceSession, didCompleteWithResult result: TraceSessionResult)
    /// Called when session state changes
    func traceSession(_ session: TraceSession, didChangeState state: TraceSessionState)
    /// Called when automatic trigger threshold is exceeded
    func traceSessionDidExceedAutomaticThreshold(_ session: TraceSession)
}

/// Optional delegate methods
public extension TraceSessionDelegate {
    func traceSession(_ session: TraceSession, didStartWithId sessionId: String) {}
    func traceSession(_ session: TraceSession, didChangeState state: TraceSessionState) {}
    func traceSessionDidExceedAutomaticThreshold(_ session: TraceSession) {}
}

/// TraceSession - Manages a complete trace collection session
///
/// Usage:
/// ```swift
/// let session = TraceSession(config: .development)
/// session.delegate = self
///
/// // Start a session
/// session.start(name: "scroll-test", url: "https://example.com") { result in
///     if result.success {
///         print("Trace saved to: \(result.traceURL!)")
///     }
/// }
///
/// // Or with async/await
/// let result = try await session.startAsync(name: "scroll-test")
/// ```
public final class TraceSession: @unchecked Sendable {
    
    // MARK: - Properties
    
    /// Configuration for the session
    public let config: TraceSessionConfig
    
    /// Delegate for session events
    public weak var delegate: TraceSessionDelegate?
    
    /// Current session state
    public private(set) var state: TraceSessionState = .idle {
        didSet {
            delegate?.traceSession(self, didChangeState: state)
        }
    }
    
    /// Current session ID
    public private(set) var currentSessionId: String?
    
    /// Whether the current user is an admin (for admin-only trigger mode)
    public var isAdminUser: Bool = false
    
    /// Frame sampler instance
    private var frameSampler: FrameSampler?
    
    /// Long task detector instance
    private var longTaskDetector: LongTaskDetector?
    
    /// Trace emitter instance
    private let traceEmitter: TraceEmitter
    
    /// Session start time
    private var sessionStartTime: Date?
    
    /// Session timer for max duration
    private var sessionTimer: Timer?
    
    /// Automatic trigger monitoring timer
    private var monitoringTimer: Timer?
    
    /// Last automatic trigger time (for cooldown)
    private var lastAutomaticTriggerTime: Date?
    
    /// Completion handler for current session
    private var completionHandler: ((TraceSessionResult) -> Void)?
    
    /// Lock for thread-safe operations
    private let lock = NSLock()
    
    /// Session metadata
    private var sessionName: String = ""
    private var sessionUrl: String?
    private var sessionScenario: String?
    
    // MARK: - Initialization
    
    /// Initialize a new TraceSession with the given configuration
    /// - Parameter config: Configuration for the session
    public init(config: TraceSessionConfig = .development) {
        self.config = config
        self.traceEmitter = TraceEmitter(config: config.traceEmitterConfig)
    }
    
    deinit {
        stop()
        stopAutomaticMonitoring()
    }
    
    // MARK: - Public Methods
    
    /// Start a trace session
    /// - Parameters:
    ///   - name: Name for the trace
    ///   - url: URL being profiled (optional)
    ///   - scenario: Scenario name (optional)
    ///   - completion: Completion handler called when session ends
    /// - Returns: Whether the session was started (may be false due to sampling)
    @discardableResult
    public func start(
        name: String,
        url: String? = nil,
        scenario: String? = nil,
        completion: @escaping (TraceSessionResult) -> Void
    ) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        
        // Check if already running
        guard case .idle = state else {
            completion(TraceSessionResult(
                success: false,
                error: TraceSessionError.alreadyRunning
            ))
            return false
        }
        
        // Check trigger mode
        if case .adminOnly = config.triggerMode, !isAdminUser {
            completion(TraceSessionResult(
                success: false,
                error: TraceSessionError.adminRequired
            ))
            return false
        }
        
        // Apply sampling
        if !shouldSample() {
            completion(TraceSessionResult(
                success: true,
                wasSampled: false
            ))
            return false
        }
        
        // Start session
        return startSessionInternal(
            name: name,
            url: url,
            scenario: scenario,
            completion: completion
        )
    }
    
    /// Start a trace session (async version)
    /// - Parameters:
    ///   - name: Name for the trace
    ///   - url: URL being profiled (optional)
    ///   - scenario: Scenario name (optional)
    /// - Returns: Session result
    @available(iOS 13.0, macOS 10.15, tvOS 13.0, *)
    public func startAsync(
        name: String,
        url: String? = nil,
        scenario: String? = nil
    ) async -> TraceSessionResult {
        await withCheckedContinuation { continuation in
            start(name: name, url: url, scenario: scenario) { result in
                continuation.resume(returning: result)
            }
        }
    }
    
    /// Stop the current session early
    public func stop() {
        lock.lock()
        defer { lock.unlock() }
        
        guard case .running = state else { return }
        
        stopSessionInternal()
    }
    
    /// Start automatic monitoring for performance threshold triggering
    public func startAutomaticMonitoring() {
        guard case .automatic = config.triggerMode else { return }
        
        // Create a lightweight frame sampler for monitoring
        let monitorSampler = FrameSampler(config: config.frameSamplerConfig)
        monitorSampler.start()
        
        // Check periodically
        monitoringTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.checkAutomaticTrigger(sampler: monitorSampler)
        }
    }
    
    /// Stop automatic monitoring
    public func stopAutomaticMonitoring() {
        monitoringTimer?.invalidate()
        monitoringTimer = nil
    }
    
    // MARK: - Private Methods
    
    private func shouldSample() -> Bool {
        // In development, always sample
        if config.isDevelopment && config.samplingRate >= 1.0 {
            return true
        }
        
        // Apply probabilistic sampling
        return Double.random(in: 0.0..<1.0) < config.samplingRate
    }
    
    private func startSessionInternal(
        name: String,
        url: String?,
        scenario: String?,
        completion: @escaping (TraceSessionResult) -> Void
    ) -> Bool {
        // Store session info
        sessionName = name
        sessionUrl = url
        sessionScenario = scenario
        completionHandler = completion
        currentSessionId = UUID().uuidString
        sessionStartTime = Date()
        
        // Create and start frame sampler
        frameSampler = FrameSampler(config: config.frameSamplerConfig)
        frameSampler?.start()
        
        // Create and start long task detector
        longTaskDetector = LongTaskDetector(config: config.longTaskDetectorConfig)
        longTaskDetector?.start()
        
        // Update state
        state = .running
        
        // Notify delegate
        delegate?.traceSession(self, didStartWithId: currentSessionId!)
        
        // Set up max duration timer
        sessionTimer = Timer.scheduledTimer(
            withTimeInterval: config.maxDurationSeconds,
            repeats: false
        ) { [weak self] _ in
            self?.handleMaxDurationReached()
        }
        
        return true
    }
    
    private func stopSessionInternal() {
        state = .stopping
        
        // Cancel timer
        sessionTimer?.invalidate()
        sessionTimer = nil
        
        // Stop collectors
        frameSampler?.stop()
        longTaskDetector?.stop()
        
        // Calculate duration
        let duration = sessionStartTime.map { Date().timeIntervalSince($0) } ?? 0
        
        // Check minimum duration
        if duration < config.minDurationSeconds {
            completeSession(result: TraceSessionResult(
                success: false,
                durationSeconds: duration,
                error: TraceSessionError.sessionTooShort(
                    actual: duration,
                    minimum: config.minDurationSeconds
                )
            ))
            return
        }
        
        // Emit trace
        do {
            let frames = frameSampler?.getFrames() ?? []
            let longTasks = longTaskDetector?.getTasks() ?? []
            
            let traceURL = try traceEmitter.emit(
                name: sessionName,
                frames: frames,
                longTasks: longTasks,
                domSignals: [],
                url: sessionUrl,
                scenario: sessionScenario,
                fpsTarget: config.frameSamplerConfig.fpsTarget,
                sampled: config.samplingRate < 1.0,
                samplingRate: config.samplingRate
            )
            
            let droppedCount = frames.filter { $0.dropped }.count
            
            completeSession(result: TraceSessionResult(
                success: true,
                traceURL: traceURL,
                durationSeconds: duration,
                frameCount: frames.count,
                droppedFrameCount: droppedCount,
                longTaskCount: longTasks.count,
                wasSampled: true
            ))
        } catch {
            completeSession(result: TraceSessionResult(
                success: false,
                durationSeconds: duration,
                error: error
            ))
        }
    }
    
    private func completeSession(result: TraceSessionResult) {
        // Clean up
        frameSampler = nil
        longTaskDetector = nil
        currentSessionId = nil
        sessionStartTime = nil
        
        // Update state
        if result.success {
            state = .completed
        } else {
            state = .failed(result.error ?? TraceSessionError.unknown)
        }
        
        // Call completion handler
        let handler = completionHandler
        completionHandler = nil
        
        // Reset state to idle
        state = .idle
        
        // Notify
        handler?(result)
        delegate?.traceSession(self, didCompleteWithResult: result)
    }
    
    private func handleMaxDurationReached() {
        lock.lock()
        defer { lock.unlock() }
        
        guard case .running = state else { return }
        
        stopSessionInternal()
    }
    
    private func checkAutomaticTrigger(sampler: FrameSampler) {
        guard case .automatic(let threshold) = config.triggerMode else { return }
        guard case .idle = state else { return }
        
        // Check cooldown
        if let lastTrigger = lastAutomaticTriggerTime {
            let elapsed = Date().timeIntervalSince(lastTrigger)
            if elapsed < threshold.cooldownSeconds {
                return
            }
        }
        
        // Check if we have enough frames
        let frames = sampler.getFrames()
        guard frames.count >= threshold.minFramesToObserve else { return }
        
        // Calculate dropped frame percentage
        let droppedCount = frames.filter { $0.dropped }.count
        let droppedPercentage = Double(droppedCount) / Double(frames.count) * 100.0
        
        // Check threshold
        if droppedPercentage >= threshold.droppedFramePercentage {
            lastAutomaticTriggerTime = Date()
            
            // Notify delegate
            delegate?.traceSessionDidExceedAutomaticThreshold(self)
            
            // Start a session
            start(name: "automatic-\(Date().timeIntervalSince1970)", scenario: "automatic") { _ in }
        }
        
        // Reset sampler for next check
        sampler.reset()
    }
}

// MARK: - Errors

/// Errors that can occur during trace sessions
public enum TraceSessionError: Error, LocalizedError, Sendable {
    case alreadyRunning
    case adminRequired
    case sessionTooShort(actual: TimeInterval, minimum: TimeInterval)
    case emitFailed(underlying: Error)
    case unknown
    
    public var errorDescription: String? {
        switch self {
        case .alreadyRunning:
            return "A trace session is already running"
        case .adminRequired:
            return "Admin privileges required to start trace session"
        case .sessionTooShort(let actual, let minimum):
            return "Session too short: \(String(format: "%.1f", actual))s (minimum: \(String(format: "%.1f", minimum))s)"
        case .emitFailed(let underlying):
            return "Failed to emit trace: \(underlying.localizedDescription)"
        case .unknown:
            return "Unknown error occurred"
        }
    }
}
