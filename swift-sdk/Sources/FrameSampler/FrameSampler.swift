/**
 * FrameSampler - Swift Instrumentation SDK for render-debugger
 *
 * A lightweight frame timing collection SDK using CADisplayLink.
 * Designed for iOS/macOS apps with WebKit WebViews.
 *
 * Features:
 * - Frame timing collection via CADisplayLink
 * - Dropped frame detection
 * - Frame duration calculation
 * - Configurable FPS target (60/120 Hz)
 *
 * Requirements: 15.12, 15.13
 */

import Foundation
import QuartzCore

#if os(iOS) || os(tvOS)
import UIKit
#elseif os(macOS)
import AppKit
import CoreVideo
#endif

/// Frame timing data collected from CADisplayLink
public struct FrameTiming: Codable, Sendable {
    /// Frame sequence number
    public let frameId: Int
    /// Frame start timestamp in microseconds (since trace start)
    public let startTimestamp: Int64
    /// Frame end timestamp in microseconds
    public let endTimestamp: Int64
    /// Frame duration in milliseconds
    public let durationMs: Double
    /// Whether this frame was dropped (exceeded budget)
    public let dropped: Bool
    /// Target timestamp from CADisplayLink
    public let targetTimestamp: Int64?
    /// Actual presentation timestamp
    public let actualPresentationTimestamp: Int64?
    
    public init(
        frameId: Int,
        startTimestamp: Int64,
        endTimestamp: Int64,
        durationMs: Double,
        dropped: Bool,
        targetTimestamp: Int64? = nil,
        actualPresentationTimestamp: Int64? = nil
    ) {
        self.frameId = frameId
        self.startTimestamp = startTimestamp
        self.endTimestamp = endTimestamp
        self.durationMs = durationMs
        self.dropped = dropped
        self.targetTimestamp = targetTimestamp
        self.actualPresentationTimestamp = actualPresentationTimestamp
    }
}

/// Configuration for FrameSampler
public struct FrameSamplerConfig: Sendable {
    /// Target FPS (60 or 120)
    public let fpsTarget: Int
    /// Frame budget in milliseconds (calculated from fpsTarget)
    public let frameBudgetMs: Double
    /// Whether to automatically detect dropped frames
    public let detectDroppedFrames: Bool
    /// Tolerance factor for dropped frame detection (1.5 = 50% over budget)
    public let droppedFrameTolerance: Double
    
    public init(
        fpsTarget: Int = 60,
        detectDroppedFrames: Bool = true,
        droppedFrameTolerance: Double = 1.5
    ) {
        self.fpsTarget = fpsTarget
        self.frameBudgetMs = 1000.0 / Double(fpsTarget)
        self.detectDroppedFrames = detectDroppedFrames
        self.droppedFrameTolerance = droppedFrameTolerance
    }
    
    /// Default configuration for 60 FPS
    public static let default60fps = FrameSamplerConfig(fpsTarget: 60)
    
    /// Configuration for 120 FPS (ProMotion displays)
    public static let default120fps = FrameSamplerConfig(fpsTarget: 120)
}

/// Delegate protocol for receiving frame timing updates
public protocol FrameSamplerDelegate: AnyObject {
    /// Called when a new frame timing is recorded
    func frameSampler(_ sampler: FrameSampler, didRecordFrame frame: FrameTiming)
    /// Called when a dropped frame is detected
    func frameSampler(_ sampler: FrameSampler, didDetectDroppedFrame frame: FrameTiming)
}

/// FrameSampler - Collects frame timing data using CADisplayLink
///
/// Usage:
/// ```swift
/// let sampler = FrameSampler(config: .default60fps)
/// sampler.delegate = self
/// sampler.start()
/// // ... later
/// sampler.stop()
/// let frames = sampler.collectedFrames
/// ```
public final class FrameSampler: @unchecked Sendable {
    
    // MARK: - Properties
    
    /// Configuration for the sampler
    public let config: FrameSamplerConfig
    
    /// Delegate for receiving frame timing updates
    public weak var delegate: FrameSamplerDelegate?
    
    /// Whether the sampler is currently running
    public private(set) var isRunning: Bool = false
    
    /// Collected frame timings
    public private(set) var collectedFrames: [FrameTiming] = []
    
    /// Start time of the current sampling session (in seconds)
    private var sessionStartTime: CFTimeInterval = 0
    
    /// Previous frame timestamp for duration calculation
    private var previousFrameTimestamp: CFTimeInterval = 0
    
    /// Current frame ID counter
    private var frameIdCounter: Int = 0
    
    #if os(iOS) || os(tvOS)
    /// Display link for frame callbacks (iOS/tvOS)
    private var displayLink: CADisplayLink?
    #elseif os(macOS)
    /// Display link for frame callbacks (macOS)
    private var displayLink: CVDisplayLink?
    /// Timer for macOS fallback when CVDisplayLink is not available
    private var fallbackTimer: Timer?
    #endif
    
    /// Lock for thread-safe access to collected frames
    private let lock = NSLock()
    
    /// Statistics
    public private(set) var totalFrames: Int = 0
    public private(set) var droppedFrames: Int = 0
    
    // MARK: - Initialization
    
    /// Initialize a new FrameSampler with the given configuration
    /// - Parameter config: Configuration for frame sampling
    public init(config: FrameSamplerConfig = .default60fps) {
        self.config = config
    }
    
    deinit {
        stop()
    }
    
    // MARK: - Public Methods
    
    /// Start collecting frame timings
    public func start() {
        guard !isRunning else { return }
        
        lock.lock()
        defer { lock.unlock() }
        
        // Reset state
        collectedFrames.removeAll()
        frameIdCounter = 0
        totalFrames = 0
        droppedFrames = 0
        sessionStartTime = CACurrentMediaTime()
        previousFrameTimestamp = sessionStartTime
        
        #if os(iOS) || os(tvOS)
        // Create and configure display link for iOS/tvOS
        displayLink = CADisplayLink(target: self, selector: #selector(handleDisplayLink(_:)))
        
        if #available(iOS 15.0, tvOS 15.0, *) {
            // Use preferred frame rate range for modern iOS
            displayLink?.preferredFrameRateRange = CAFrameRateRange(
                minimum: Float(config.fpsTarget),
                maximum: Float(config.fpsTarget),
                preferred: Float(config.fpsTarget)
            )
        } else {
            // Fallback for older iOS versions
            displayLink?.preferredFramesPerSecond = config.fpsTarget
        }
        
        displayLink?.add(to: .main, forMode: .common)
        #elseif os(macOS)
        // Use timer-based approach for macOS (CVDisplayLink requires more complex setup)
        let interval = 1.0 / Double(config.fpsTarget)
        fallbackTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            self?.handleTimerTick()
        }
        RunLoop.main.add(fallbackTimer!, forMode: .common)
        #endif
        
        isRunning = true
    }
    
    /// Stop collecting frame timings
    public func stop() {
        guard isRunning else { return }
        
        lock.lock()
        defer { lock.unlock() }
        
        #if os(iOS) || os(tvOS)
        displayLink?.invalidate()
        displayLink = nil
        #elseif os(macOS)
        fallbackTimer?.invalidate()
        fallbackTimer = nil
        if let link = displayLink {
            CVDisplayLinkStop(link)
            displayLink = nil
        }
        #endif
        
        isRunning = false
    }
    
    /// Reset the sampler, clearing all collected data
    public func reset() {
        lock.lock()
        defer { lock.unlock() }
        
        collectedFrames.removeAll()
        frameIdCounter = 0
        totalFrames = 0
        droppedFrames = 0
    }
    
    /// Get a copy of collected frames (thread-safe)
    public func getFrames() -> [FrameTiming] {
        lock.lock()
        defer { lock.unlock() }
        return collectedFrames
    }
    
    /// Calculate average FPS from collected frames
    public func calculateAverageFPS() -> Double {
        lock.lock()
        defer { lock.unlock() }
        
        guard collectedFrames.count > 1 else { return 0 }
        
        let totalDuration = collectedFrames.reduce(0.0) { $0 + $1.durationMs }
        guard totalDuration > 0 else { return 0 }
        
        return Double(collectedFrames.count) / (totalDuration / 1000.0)
    }
    
    /// Calculate dropped frame percentage
    public func calculateDroppedFramePercentage() -> Double {
        guard totalFrames > 0 else { return 0 }
        return Double(droppedFrames) / Double(totalFrames) * 100.0
    }
    
    // MARK: - Private Methods
    
    #if os(iOS) || os(tvOS)
    @objc private func handleDisplayLink(_ displayLink: CADisplayLink) {
        let currentTimestamp = displayLink.timestamp
        let targetTimestamp = displayLink.targetTimestamp
        
        // Calculate frame duration
        let frameDuration = currentTimestamp - previousFrameTimestamp
        let frameDurationMs = frameDuration * 1000.0
        
        // Calculate timestamps relative to session start (in microseconds)
        let startTimestampUs = Int64((previousFrameTimestamp - sessionStartTime) * 1_000_000)
        let endTimestampUs = Int64((currentTimestamp - sessionStartTime) * 1_000_000)
        let targetTimestampUs = Int64((targetTimestamp - sessionStartTime) * 1_000_000)
        
        // Detect dropped frame
        let isDropped = config.detectDroppedFrames && 
                        frameDurationMs > (config.frameBudgetMs * config.droppedFrameTolerance)
        
        // Create frame timing
        let frameTiming = FrameTiming(
            frameId: frameIdCounter,
            startTimestamp: startTimestampUs,
            endTimestamp: endTimestampUs,
            durationMs: frameDurationMs,
            dropped: isDropped,
            targetTimestamp: targetTimestampUs,
            actualPresentationTimestamp: endTimestampUs
        )
        
        recordFrame(frameTiming, currentTimestamp: currentTimestamp)
    }
    #endif
    
    #if os(macOS)
    private func handleTimerTick() {
        let currentTimestamp = CACurrentMediaTime()
        
        // Calculate frame duration
        let frameDuration = currentTimestamp - previousFrameTimestamp
        let frameDurationMs = frameDuration * 1000.0
        
        // Calculate timestamps relative to session start (in microseconds)
        let startTimestampUs = Int64((previousFrameTimestamp - sessionStartTime) * 1_000_000)
        let endTimestampUs = Int64((currentTimestamp - sessionStartTime) * 1_000_000)
        
        // Detect dropped frame
        let isDropped = config.detectDroppedFrames && 
                        frameDurationMs > (config.frameBudgetMs * config.droppedFrameTolerance)
        
        // Create frame timing
        let frameTiming = FrameTiming(
            frameId: frameIdCounter,
            startTimestamp: startTimestampUs,
            endTimestamp: endTimestampUs,
            durationMs: frameDurationMs,
            dropped: isDropped,
            targetTimestamp: nil,
            actualPresentationTimestamp: endTimestampUs
        )
        
        recordFrame(frameTiming, currentTimestamp: currentTimestamp)
    }
    #endif
    
    private func recordFrame(_ frameTiming: FrameTiming, currentTimestamp: CFTimeInterval) {
        // Store frame timing
        lock.lock()
        collectedFrames.append(frameTiming)
        frameIdCounter += 1
        totalFrames += 1
        if frameTiming.dropped {
            droppedFrames += 1
        }
        lock.unlock()
        
        // Update previous timestamp
        previousFrameTimestamp = currentTimestamp
        
        // Notify delegate
        delegate?.frameSampler(self, didRecordFrame: frameTiming)
        if frameTiming.dropped {
            delegate?.frameSampler(self, didDetectDroppedFrame: frameTiming)
        }
    }
}

// MARK: - Frame Statistics

extension FrameSampler {
    
    /// Statistics summary for collected frames
    public struct Statistics: Codable, Sendable {
        public let totalFrames: Int
        public let droppedFrames: Int
        public let droppedFramePercentage: Double
        public let averageFPS: Double
        public let averageFrameDurationMs: Double
        public let minFrameDurationMs: Double
        public let maxFrameDurationMs: Double
        public let p95FrameDurationMs: Double
    }
    
    /// Calculate statistics for collected frames
    public func calculateStatistics() -> Statistics {
        lock.lock()
        let frames = collectedFrames
        lock.unlock()
        
        guard !frames.isEmpty else {
            return Statistics(
                totalFrames: 0,
                droppedFrames: 0,
                droppedFramePercentage: 0,
                averageFPS: 0,
                averageFrameDurationMs: 0,
                minFrameDurationMs: 0,
                maxFrameDurationMs: 0,
                p95FrameDurationMs: 0
            )
        }
        
        let durations = frames.map { $0.durationMs }
        let sortedDurations = durations.sorted()
        
        let totalDuration = durations.reduce(0, +)
        let avgDuration = totalDuration / Double(frames.count)
        let avgFPS = frames.count > 1 ? Double(frames.count) / (totalDuration / 1000.0) : 0
        
        // Calculate P95
        let p95Index = Int(Double(sortedDurations.count) * 0.95)
        let p95Duration = sortedDurations[min(p95Index, sortedDurations.count - 1)]
        
        let droppedCount = frames.filter { $0.dropped }.count
        
        return Statistics(
            totalFrames: frames.count,
            droppedFrames: droppedCount,
            droppedFramePercentage: Double(droppedCount) / Double(frames.count) * 100.0,
            averageFPS: avgFPS,
            averageFrameDurationMs: avgDuration,
            minFrameDurationMs: sortedDurations.first ?? 0,
            maxFrameDurationMs: sortedDurations.last ?? 0,
            p95FrameDurationMs: p95Duration
        )
    }
}
