import AVFoundation
import CoreMedia
import Darwin
import Dispatch
import Foundation
import ScreenCaptureKit

enum HelperExitCode: Int32 {
    case ok = 0
    case invalidArgs = 1
    case permissionDenied = 2
    case noDisplay = 3
    case streamFailed = 4
}

struct CLIOptions {
    var durationSeconds: Double = 12.0
    var sampleRate: Int = 48_000
    var channels: Int = 1
    var probeOnly: Bool = false

    static func parse(args: [String]) -> CLIOptions {
        var opts = CLIOptions()
        var i = 1
        while i < args.count {
            let arg = args[i]
            switch arg {
            case "--duration":
                if i + 1 < args.count, let v = Double(args[i + 1]), v > 0 {
                    opts.durationSeconds = v
                    i += 1
                }
            case "--sample-rate":
                if i + 1 < args.count, let v = Int(args[i + 1]), v > 0 {
                    opts.sampleRate = v
                    i += 1
                }
            case "--channels":
                if i + 1 < args.count, let v = Int(args[i + 1]), v > 0 {
                    opts.channels = v
                    i += 1
                }
            case "--probe":
                opts.probeOnly = true
            default:
                break
            }
            i += 1
        }
        return opts
    }
}

final class AudioStreamReceiver: NSObject, SCStreamOutput, SCStreamDelegate {
    private let writeLock = NSLock()
    var onStopWithError: ((Error) -> Void)?
    var onBrokenPipe: (() -> Void)?

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        onStopWithError?(error)
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard outputType == .audio else { return }
        guard CMSampleBufferIsValid(sampleBuffer), CMSampleBufferDataIsReady(sampleBuffer) else { return }
        guard let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbdPtr = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc)
        else {
            return
        }
        let asbd = asbdPtr.pointee
        let frameCount = CMSampleBufferGetNumSamples(sampleBuffer)
        if frameCount <= 0 { return }

        var blockBuffer: CMBlockBuffer?
        let audioBufferListSize = MemoryLayout<AudioBufferList>.size + 8 * MemoryLayout<AudioBuffer>.size
        let rawPtr = UnsafeMutableRawPointer.allocate(
            byteCount: audioBufferListSize,
            alignment: MemoryLayout<AudioBufferList>.alignment
        )
        defer { rawPtr.deallocate() }
        let audioBufferListPtr = rawPtr.bindMemory(to: AudioBufferList.self, capacity: 1)

        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: audioBufferListPtr,
            bufferListSize: audioBufferListSize,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            blockBufferOut: &blockBuffer
        )
        guard status == noErr else { return }

        let buffers = UnsafeMutableAudioBufferListPointer(audioBufferListPtr)
        if buffers.isEmpty { return }

        let isFloat = (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0
        let isNonInterleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0
        let channels = max(1, Int(asbd.mChannelsPerFrame))

        var monoSamples = [Float](repeating: 0.0, count: frameCount)

        if isFloat && asbd.mBitsPerChannel == 32 {
            if isNonInterleaved {
                let bufCount = min(buffers.count, channels)
                for ch in 0..<bufCount {
                    guard let data = buffers[ch].mData else { continue }
                    let floatPtr = data.assumingMemoryBound(to: Float.self)
                    let available = min(frameCount, Int(buffers[ch].mDataByteSize) / MemoryLayout<Float>.size)
                    for i in 0..<available {
                        monoSamples[i] += floatPtr[i]
                    }
                }
                let inv = 1.0 / Float(max(1, bufCount))
                for i in 0..<frameCount {
                    monoSamples[i] *= inv
                }
            } else {
                guard let data = buffers[0].mData else { return }
                let floatPtr = data.assumingMemoryBound(to: Float.self)
                let totalFloats = Int(buffers[0].mDataByteSize) / MemoryLayout<Float>.size
                let availableFrames = min(frameCount, totalFloats / channels)
                let inv = 1.0 / Float(channels)
                for i in 0..<availableFrames {
                    var sum: Float = 0.0
                    let base = i * channels
                    for ch in 0..<channels {
                        sum += floatPtr[base + ch]
                    }
                    monoSamples[i] = sum * inv
                }
            }
        } else if !isFloat && asbd.mBitsPerChannel == 16 {
            guard let data = buffers[0].mData else { return }
            let intPtr = data.assumingMemoryBound(to: Int16.self)
            let totalInts = Int(buffers[0].mDataByteSize) / MemoryLayout<Int16>.size
            let availableFrames = min(frameCount, totalInts / channels)
            let inv = 1.0 / (Float(channels) * 32768.0)
            for i in 0..<availableFrames {
                var sum: Float = 0.0
                let base = i * channels
                for ch in 0..<channels {
                    sum += Float(intPtr[base + ch])
                }
                monoSamples[i] = sum * inv
            }
        } else {
            return
        }

        writeLock.lock()
        defer { writeLock.unlock() }

        monoSamples.withUnsafeBytes { rawBytes in
            guard let baseAddress = rawBytes.baseAddress else { return }
            var remaining = rawBytes.count
            var offset = 0
            while remaining > 0 {
                let written = Darwin.write(STDOUT_FILENO, baseAddress.advanced(by: offset), remaining)
                if written < 0 {
                    if errno == EINTR { continue }
                    if errno == EPIPE {
                        onBrokenPipe?()
                    }
                    break
                }
                remaining -= written
                offset += written
            }
        }
    }
}

func writeStderr(_ message: String) {
    let line = message.hasSuffix("\n") ? message : (message + "\n")
    if let data = line.data(using: .utf8) {
        FileHandle.standardError.write(data)
    }
}

@main
struct AuralisMacOSAudioHelper {
    static func main() async {
        signal(SIGPIPE, SIG_IGN)
        let options = CLIOptions.parse(args: CommandLine.arguments)

        let shareableContent: SCShareableContent
        do {
            shareableContent = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: false
            )
        } catch {
            writeStderr(
                "PERMISSION_DENIED: Screen & System Audio Recording permission is required to capture macOS system audio (\(error.localizedDescription)). Grant Auralis permission in System Settings > Privacy & Security > Screen & System Audio Recording, or switch to Microphone mode."
            )
            Darwin.exit(HelperExitCode.permissionDenied.rawValue)
        }

        guard let display = shareableContent.displays.first else {
            writeStderr("NO_DISPLAY: No active display found for ScreenCaptureKit system audio capture.")
            Darwin.exit(HelperExitCode.noDisplay.rawValue)
        }

        if options.probeOnly {
            Darwin.exit(HelperExitCode.ok.rawValue)
        }

        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = options.sampleRate
        config.channelCount = options.channels
        // Minimal 2x2 video configuration for macOS 13+ ScreenCaptureKit compatibility
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        config.showsCursor = false

        let receiver = AudioStreamReceiver()
        let stream = SCStream(filter: filter, configuration: config, delegate: receiver)

        let audioQueue = DispatchQueue(label: "app.auralis.desktop.sck.audio", qos: .userInteractive)
        let videoQueue = DispatchQueue(label: "app.auralis.desktop.sck.video", qos: .background)

        do {
            try stream.addStreamOutput(receiver, type: .screen, sampleHandlerQueue: videoQueue)
            try stream.addStreamOutput(receiver, type: .audio, sampleHandlerQueue: audioQueue)
        } catch {
            writeStderr("STREAM_OUTPUT_ERROR: Failed to attach ScreenCaptureKit output: \(error.localizedDescription)")
            Darwin.exit(HelperExitCode.streamFailed.rawValue)
        }

        let stopSemaphore = DispatchSemaphore(value: 0)
        var exitCode: HelperExitCode = .ok

        receiver.onStopWithError = { err in
            writeStderr("PERMISSION_DENIED: ScreenCaptureKit stream stopped with error: \(err.localizedDescription). Check Screen & System Audio Recording permissions or switch to Microphone mode.")
            exitCode = .permissionDenied
            stopSemaphore.signal()
        }

        receiver.onBrokenPipe = {
            exitCode = .ok
            stopSemaphore.signal()
        }

        signal(SIGTERM, SIG_IGN)
        signal(SIGINT, SIG_IGN)
        let sigtermSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
        let sigintSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .global())
        sigtermSource.setEventHandler {
            exitCode = .ok
            stopSemaphore.signal()
        }
        sigintSource.setEventHandler {
            exitCode = .ok
            stopSemaphore.signal()
        }
        sigtermSource.resume()
        sigintSource.resume()

        do {
            try await stream.startCapture()
        } catch {
            writeStderr(
                "PERMISSION_DENIED: Could not start ScreenCaptureKit system audio capture (\(error.localizedDescription)). Grant permission in System Settings > Privacy & Security > Screen & System Audio Recording, or switch to Microphone mode."
            )
            Darwin.exit(HelperExitCode.permissionDenied.rawValue)
        }

        let durationNs = UInt64(max(0.1, options.durationSeconds) * 1_000_000_000)
        DispatchQueue.global().asyncAfter(deadline: .now() + .nanoseconds(Int(durationNs))) {
            exitCode = .ok
            stopSemaphore.signal()
        }

        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            DispatchQueue.global().async {
                stopSemaphore.wait()
                continuation.resume()
            }
        }

        try? await stream.stopCapture()
        Darwin.exit(exitCode.rawValue)
    }
}
