import Foundation
import SwiftUI

public enum AuralisBrand {
    public static let productName = "Auralis"
    public static let tagline = "Hear it. Know it."

    // Hex constants from CONTRACT.md
    public static let midnightBgHex = "#060A14"
    public static let deepSurfaceHex = "#0B1220"
    public static let charcoalElevatedHex = "#121A2B"
    public static let lineBorderHex = "#1E2A40"
    public static let primaryTextHex = "#EAF2FF"
    public static let mutedTextHex = "#8A9BB8"
    public static let electricBlueHex = "#2F6BFF"
    public static let cyanHex = "#22D3EE"
    public static let tealHex = "#14B8A6"
    public static let dangerHex = "#FF5A6E"
    public static let warningHex = "#FFB547"

    // SwiftUI Colors
    public static let midnightBg = Color(red: 0x06 / 255.0, green: 0x0A / 255.0, blue: 0x14 / 255.0)
    public static let deepSurface = Color(red: 0x0B / 255.0, green: 0x12 / 255.0, blue: 0x20 / 255.0)
    public static let charcoalElevated = Color(red: 0x12 / 255.0, green: 0x1A / 255.0, blue: 0x2B / 255.0)
    public static let lineBorder = Color(red: 0x1E / 255.0, green: 0x2A / 255.0, blue: 0x40 / 255.0)
    public static let primaryText = Color(red: 0xEA / 255.0, green: 0xF2 / 255.0, blue: 0xFF / 255.0)
    public static let mutedText = Color(red: 0x8A / 255.0, green: 0x9B / 255.0, blue: 0xB8 / 255.0)
    public static let electricBlue = Color(red: 0x2F / 255.0, green: 0x6B / 255.0, blue: 0xFF / 255.0)
    public static let cyan = Color(red: 0x22 / 255.0, green: 0xD3 / 255.0, blue: 0xEE / 255.0)
    public static let teal = Color(red: 0x14 / 255.0, green: 0xB8 / 255.0, blue: 0xA6 / 255.0)
    public static let danger = Color(red: 0xFF / 255.0, green: 0x5A / 255.0, blue: 0x6E / 255.0)
    public static let warning = Color(red: 0xFF / 255.0, green: 0xB5 / 255.0, blue: 0x47 / 255.0)

    /// Signature gradient: linear(135deg, #2F6BFF → #22D3EE → #14B8A6)
    public static var signatureGradient: LinearGradient {
        LinearGradient(
            colors: [electricBlue, cyan, teal],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    /// Subtle dark backdrop gradient
    public static var backgroundGradient: LinearGradient {
        LinearGradient(
            colors: [midnightBg, deepSurface, midnightBg],
            startPoint: .top,
            endPoint: .bottom
        )
    }
}
