import Foundation
import AVFoundation

// MARK: - Quality Metrics & Gate Verdict

public struct AudioQualityMetrics: Codable, Equatable, Sendable {
    public let rmsDbfs: Double
    public let peak: Double
    public let clippingRatio: Double
    public let silenceRatio: Double

    public init(rmsDbfs: Double, peak: Double, clippingRatio: Double, silenceRatio: Double) {
        self.rmsDbfs = rmsDbfs
        self.peak = peak
        self.clippingRatio = clippingRatio
        self.silenceRatio = silenceRatio
    }
}

public enum QualityGateVerdict: Equatable, Sendable {
    case passed
    case passedWithClippingWarning(hint: String)
    case tooQuiet(message: String)

    public var shouldUpload: Bool {
        switch self {
        case .passed, .passedWithClippingWarning:
            return true
        case .tooQuiet:
            return false
        }
    }

    public var clippingHint: String? {
        if case let .passedWithClippingWarning(hint) = self {
            return hint
        }
        return nil
    }

    public var tooQuietMessage: String? {
        if case let .tooQuiet(message) = self {
            return message
        }
        return nil
    }
}

public struct LiveAudioLevel: Equatable, Sendable {
    /// Normalized 0.0 ... 1.0 mapped from -60 ... 0 dBFS
    public let rmsNormalized: Double
    /// Peak amplitude 0.0 ... 1.0
    public let peak: Double
    /// Raw RMS in dBFS
    public let rmsDbfs: Double

    public init(rmsNormalized: Double, peak: Double, rmsDbfs: Double) {
        self.rmsNormalized = rmsNormalized
        self.peak = peak
        self.rmsDbfs = rmsDbfs
    }

    public static let zero = LiveAudioLevel(rmsNormalized: 0.0, peak: 0.0, rmsDbfs: -100.0)
}

public struct ProcessedAudioPayload: Equatable, Sendable {
    public let wavData: Data
    public let durationMs: Int
    public let sampleRate: Int
    public let metrics: AudioQualityMetrics
    public let verdict: QualityGateVerdict
    public let resampledSamples: [Float]

    public init(
        wavData: Data,
        durationMs: Int,
        sampleRate: Int,
        metrics: AudioQualityMetrics,
        verdict: QualityGateVerdict,
        resampledSamples: [Float]
    ) {
        self.wavData = wavData
        self.durationMs = durationMs
        self.sampleRate = sampleRate
        self.metrics = metrics
        self.verdict = verdict
        self.resampledSamples = resampledSamples
    }
}

// MARK: - Audio DSP & Quality Gate Pipeline

public enum AudioDSP {
    public static let targetSampleRate: Int = 16_000
    public static let targetDurationSeconds: Double = 10.0
    public static let minDurationSeconds: Double = 4.0
    public static let maxDurationSeconds: Double = 12.0

    public static let clippingSampleThreshold: Float = 0.985
    public static let silenceWindowThresholdDbfs: Double = -55.0
    public static let overallTooQuietThresholdDbfs: Double = -50.0
    public static let maxAllowedSilenceRatio: Double = 0.85
    public static let clippingWarningRatioThreshold: Double = 0.05

    public static let tooQuietMessage = "Move closer to the music or turn it up"
    public static let clippingWarningHint = "Input is distorting — lower the volume or move back"

    // MARK: - Stereo / Multi-channel to Mono

    /// Averages interleaved or planar channels into a single mono signal.
    public static func stereoToMono(channels: [[Float]]) -> [Float] {
        guard !channels.isEmpty else { return [] }
        if channels.count == 1 {
            return channels[0]
        }
        let frameCount = channels.map(\.count).min() ?? 0
        guard frameCount > 0 else { return [] }
        let channelCount = Float(channels.count)
        var mono = [Float](repeating: 0, count: frameCount)
        for ch in channels {
            for i in 0..<frameCount {
                mono[i] += ch[i]
            }
        }
        let invCount = 1.0 / channelCount
        for i in 0..<frameCount {
            mono[i] *= invCount
        }
        return mono
    }

    /// Averages interleaved stereo `[L0, R0, L1, R1, ...]` into mono `[M0, M1, ...]`.
    public static func interleavedToMono(samples: [Float], channelCount: Int) -> [Float] {
        guard channelCount > 1 else { return samples }
        let frameCount = samples.count / channelCount
        guard frameCount > 0 else { return [] }
        var mono = [Float](repeating: 0, count: frameCount)
        let invChannels = 1.0 / Float(channelCount)
        for frame in 0..<frameCount {
            var sum: Float = 0
            let base = frame * channelCount
            for ch in 0..<channelCount {
                sum += samples[base + ch]
            }
            mono[frame] = sum * invChannels
        }
        return mono
    }

    /// Extracts mono Float samples from an `AVAudioPCMBuffer`.
    public static func extractMonoSamples(from buffer: AVAudioPCMBuffer) -> [Float] {
        let frameLength = Int(buffer.frameLength)
        let channelCount = Int(buffer.format.channelCount)
        guard frameLength > 0, channelCount > 0 else { return [] }

        if let floatData = buffer.floatChannelData {
            if buffer.format.isInterleaved {
                let ptr = floatData[0]
                let total = frameLength * channelCount
                let raw = Array(UnsafeBufferPointer(start: ptr, count: total))
                return interleavedToMono(samples: raw, channelCount: channelCount)
            } else {
                var channels: [[Float]] = []
                channels.reserveCapacity(channelCount)
                for ch in 0..<channelCount {
                    let ptr = floatData[ch]
                    channels.append(Array(UnsafeBufferPointer(start: ptr, count: frameLength)))
                }
                return stereoToMono(channels: channels)
            }
        } else if let int16Data = buffer.int16ChannelData {
            let scale: Float = 1.0 / 32768.0
            if buffer.format.isInterleaved {
                let ptr = int16Data[0]
                let total = frameLength * channelCount
                var floats = [Float](repeating: 0, count: total)
                for i in 0..<total {
                    floats[i] = Float(ptr[i]) * scale
                }
                return interleavedToMono(samples: floats, channelCount: channelCount)
            } else {
                var channels: [[Float]] = []
                for ch in 0..<channelCount {
                    let ptr = int16Data[ch]
                    var chFloats = [Float](repeating: 0, count: frameLength)
                    for i in 0..<frameLength {
                        chFloats[i] = Float(ptr[i]) * scale
                    }
                    channels.append(chFloats)
                }
                return stereoToMono(channels: channels)
            }
        }
        return []
    }

    // MARK: - DC Offset Removal

    /// Removes DC offset by subtracting the mean sample value.
    public static func removeDCOffset(_ samples: [Float]) -> [Float] {
        guard !samples.isEmpty else { return [] }
        var sum: Double = 0.0
        for sample in samples {
            sum += Double(sample)
        }
        let mean = Float(sum / Double(samples.count))
        guard abs(mean) > 1e-9 else { return samples }
        return samples.map { $0 - mean }
    }

    // MARK: - Live Level Meter (-60..0 dBFS -> 0..1)

    /// Maps a dBFS value in `-60 ... 0` linearly to `0 ... 1`.
    public static func mapDbfsToNormalizedLevel(_ dbfs: Double) -> Double {
        if !dbfs.isFinite || dbfs <= -60.0 {
            return 0.0
        }
        if dbfs >= 0.0 {
            return 1.0
        }
        return (dbfs + 60.0) / 60.0
    }

    /// Computes live audio level on the most recent ~50 ms window of samples.
    public static func computeLiveLevel(samples: [Float], sampleRate: Double) -> LiveAudioLevel {
        guard !samples.isEmpty, sampleRate > 0 else { return .zero }
        let windowSize = max(1, Int((sampleRate * 0.050).rounded()))
        let slice = samples.suffix(windowSize)
        var sumSquares: Double = 0.0
        var peak: Double = 0.0
        for s in slice {
            let v = abs(Double(s))
            if v > peak { peak = v }
            sumSquares += v * v
        }
        let rms = sqrt(sumSquares / Double(slice.count))
        let rmsDbfs = rms > 1e-10 ? 20.0 * log10(rms) : -100.0
        let normalized = mapDbfsToNormalizedLevel(rmsDbfs)
        return LiveAudioLevel(
            rmsNormalized: normalized,
            peak: min(1.0, peak),
            rmsDbfs: rmsDbfs
        )
    }

    // MARK: - Quality Gate Computation

    /// Computes `rmsDbfs`, `peak`, `clippingRatio`, and `silenceRatio` (50 ms windows < -55 dBFS).
    public static func analyzeQualityMetrics(samples: [Float], sampleRate: Int) -> AudioQualityMetrics {
        guard !samples.isEmpty, sampleRate > 0 else {
            return AudioQualityMetrics(rmsDbfs: -100.0, peak: 0.0, clippingRatio: 0.0, silenceRatio: 1.0)
        }

        var sumSquares: Double = 0.0
        var peak: Double = 0.0
        var clippedCount: Int = 0

        for s in samples {
            let absVal = abs(s)
            let d = Double(absVal)
            if d > peak { peak = d }
            if absVal >= clippingSampleThreshold {
                clippedCount += 1
            }
            sumSquares += d * d
        }

        let overallRms = sqrt(sumSquares / Double(samples.count))
        let rmsDbfs = overallRms > 1e-10 ? 20.0 * log10(overallRms) : -100.0
        let clippingRatio = Double(clippedCount) / Double(samples.count)

        // 50 ms windows for silenceRatio
        let windowSamples = max(1, (sampleRate * 50) / 1000)
        var totalWindows = 0
        var silentWindows = 0
        var idx = 0

        while idx < samples.count {
            let end = min(idx + windowSamples, samples.count)
            let count = end - idx
            if count > 0 {
                var winSumSq: Double = 0.0
                for j in idx..<end {
                    let v = Double(samples[j])
                    winSumSq += v * v
                }
                let winRms = sqrt(winSumSq / Double(count))
                let winDbfs = winRms > 1e-10 ? 20.0 * log10(winRms) : -100.0
                totalWindows += 1
                if winDbfs < silenceWindowThresholdDbfs {
                    silentWindows += 1
                }
            }
            idx += windowSamples
        }

        let silenceRatio = totalWindows > 0 ? Double(silentWindows) / Double(totalWindows) : 1.0

        return AudioQualityMetrics(
            rmsDbfs: rmsDbfs,
            peak: peak,
            clippingRatio: clippingRatio,
            silenceRatio: silenceRatio
        )
    }

    /// Evaluates the quality gate rules per CONTRACT.md.
    public static func evaluateQualityGate(metrics: AudioQualityMetrics) -> QualityGateVerdict {
        if metrics.rmsDbfs < overallTooQuietThresholdDbfs || metrics.silenceRatio > maxAllowedSilenceRatio {
            return .tooQuiet(message: tooQuietMessage)
        }
        if metrics.clippingRatio > clippingWarningRatioThreshold {
            return .passedWithClippingWarning(hint: clippingWarningHint)
        }
        return .passed
    }

    // MARK: - Windowed-Sinc Anti-Aliased Resampler to 16 kHz

    /// Resamples a mono signal from `fromRate` to `toRate` using a Blackman-windowed sinc anti-aliasing filter.
    public static func resampleWindowedSinc(
        samples: [Float],
        fromRate: Int,
        toRate: Int = targetSampleRate,
        halfTaps: Int = 16
    ) -> [Float] {
        guard !samples.isEmpty, fromRate > 0, toRate > 0 else { return [] }
        if fromRate == toRate {
            return samples
        }

        let ratio = Double(toRate) / Double(fromRate)
        let outputLength = max(1, Int((Double(samples.count) * ratio).rounded()))
        var output = [Float](repeating: 0, count: outputLength)

        // Anti-aliasing low-pass cutoff relative to input sample rate
        let cutoff = min(1.0, ratio)
        let filterSupport = Double(halfTaps) / cutoff
        let invRatio = Double(fromRate) / Double(toRate)
        let nCount = samples.count

        for outIdx in 0..<outputLength {
            let center = Double(outIdx) * invRatio
            let left = max(0, Int(floor(center - filterSupport)))
            let right = min(nCount - 1, Int(ceil(center + filterSupport)))

            var acc: Double = 0.0
            var weightSum: Double = 0.0

            if left <= right {
                for srcIdx in left...right {
                    let delta = center - Double(srcIdx)
                    let x = delta * cutoff
                    let sincVal: Double
                    if abs(x) < 1e-9 {
                        sincVal = 1.0
                    } else {
                        let piX = Double.pi * x
                        sincVal = sin(piX) / piX
                    }

                    // Blackman window over [-filterSupport, +filterSupport]
                    let normPos = (delta / filterSupport + 1.0) * 0.5 // 0...1
                    if normPos >= 0.0 && normPos <= 1.0 {
                        let twoPi = 2.0 * Double.pi * normPos
                        let window = 0.42 - 0.5 * cos(twoPi) + 0.08 * cos(2.0 * twoPi)
                        let w = sincVal * window * cutoff
                        acc += Double(samples[srcIdx]) * w
                        weightSum += w
                    }
                }
            }

            if abs(weightSum) > 1e-9 {
                output[outIdx] = Float(acc / weightSum)
            } else {
                let nearest = min(max(0, Int(center.rounded())), nCount - 1)
                output[outIdx] = samples[nearest]
            }
        }

        return output
    }

    // MARK: - Gentle Peak Normalization to -1 dBFS (Only if peak < 0.5)

    /// Gentle peak normalization to -1 dBFS (~0.89125) ONLY if peak < 0.5 (per CONTRACT.md).
    public static func normalizePeakIfQuiet(_ samples: [Float]) -> [Float] {
        guard !samples.isEmpty else { return [] }
        var peak: Float = 0.0
        for s in samples {
            let a = abs(s)
            if a > peak { peak = a }
        }
        // Only normalize when peak < 0.5 and non-zero
        guard peak > 1e-6, peak < 0.5 else {
            return samples
        }
        let targetLinearPeak = Float(pow(10.0, -1.0 / 20.0)) // -1 dBFS ≈ 0.8912509
        let gain = targetLinearPeak / peak
        return samples.map { max(-1.0, min(1.0, $0 * gain)) }
    }

    // MARK: - WAV PCM 16-bit Mono Encoder

    /// Encodes normalized float samples (`-1.0 ... 1.0`) into a standard RIFF WAVE 16-bit PCM mono container.
    public static func encodeWAV16BitMono(samples: [Float], sampleRate: Int = targetSampleRate) -> Data {
        let numChannels: UInt16 = 1
        let bitsPerSample: UInt16 = 16
        let bytesPerSample = Int(bitsPerSample / 8)
        let dataByteCount = samples.count * bytesPerSample
        let byteRate = UInt32(sampleRate * Int(numChannels) * bytesPerSample)
        let blockAlign = UInt16(Int(numChannels) * bytesPerSample)
        let chunkSize = UInt32(36 + dataByteCount)

        var data = Data(capacity: 44 + dataByteCount)

        // RIFF header
        data.append(contentsOf: [0x52, 0x49, 0x46, 0x46]) // "RIFF"
        appendUInt32LE(&data, chunkSize)
        data.append(contentsOf: [0x57, 0x41, 0x56, 0x45]) // "WAVE"

        // fmt subchunk
        data.append(contentsOf: [0x66, 0x6D, 0x74, 0x20]) // "fmt "
        appendUInt32LE(&data, 16)                          // Subchunk1Size (16 for PCM)
        appendUInt16LE(&data, 1)                           // AudioFormat (1 = PCM)
        appendUInt16LE(&data, numChannels)                 // NumChannels (1 = mono)
        appendUInt32LE(&data, UInt32(sampleRate))          // SampleRate (16000)
        appendUInt32LE(&data, byteRate)                    // ByteRate
        appendUInt16LE(&data, blockAlign)                  // BlockAlign
        appendUInt16LE(&data, bitsPerSample)               // BitsPerSample (16)

        // data subchunk
        data.append(contentsOf: [0x64, 0x61, 0x74, 0x61]) // "data"
        appendUInt32LE(&data, UInt32(dataByteCount))

        // 16-bit signed little-endian PCM samples
        for sample in samples {
            let clamped = max(-1.0, min(1.0, Double(sample)))
            let scaled = Int(clamped >= 0 ? (clamped * 32767.0).rounded() : (clamped * 32768.0).rounded())
            let pcm16 = Int16(clamping: scaled)
            appendInt16LE(&data, pcm16)
        }

        return data
    }

    // MARK: - Complete Preprocessing Pipeline

    /// Full preprocessing + quality gate pipeline per CONTRACT.md:
    /// 1. DC-offset removal
    /// 2. Quality gate evaluation on mono signal
    /// 3. Windowed-sinc anti-aliased resample to 16,000 Hz
    /// 4. Gentle peak normalization to -1 dBFS ONLY if peak < 0.5
    /// 5. 16-bit mono WAV encoding
    public static func processCapturedMonoSamples(
        _ rawMonoSamples: [Float],
        inputSampleRate: Int
    ) -> ProcessedAudioPayload {
        let dcRemoved = removeDCOffset(rawMonoSamples)
        let metrics = analyzeQualityMetrics(samples: dcRemoved, sampleRate: inputSampleRate)
        let verdict = evaluateQualityGate(metrics: metrics)

        let resampled = resampleWindowedSinc(
            samples: dcRemoved,
            fromRate: inputSampleRate,
            toRate: targetSampleRate
        )
        let normalized = normalizePeakIfQuiet(resampled)
        let wavData = verdict.shouldUpload
            ? encodeWAV16BitMono(samples: normalized, sampleRate: targetSampleRate)
            : Data()
        let durationMs = inputSampleRate > 0
            ? Int((Double(rawMonoSamples.count) / Double(inputSampleRate) * 1000.0).rounded())
            : 0

        return ProcessedAudioPayload(
            wavData: wavData,
            durationMs: durationMs,
            sampleRate: targetSampleRate,
            metrics: metrics,
            verdict: verdict,
            resampledSamples: normalized
        )
    }

    // MARK: - Little-Endian Helpers

    private static func appendUInt16LE(_ data: inout Data, _ value: UInt16) {
        var le = value.littleEndian
        withUnsafeBytes(of: &le) { data.append(contentsOf: $0) }
    }

    private static func appendInt16LE(_ data: inout Data, _ value: Int16) {
        var le = value.littleEndian
        withUnsafeBytes(of: &le) { data.append(contentsOf: $0) }
    }

    private static func appendUInt32LE(_ data: inout Data, _ value: UInt32) {
        var le = value.littleEndian
        withUnsafeBytes(of: &le) { data.append(contentsOf: $0) }
    }
}
