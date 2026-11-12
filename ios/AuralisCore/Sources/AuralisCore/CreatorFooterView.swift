import Foundation
import SwiftUI

/**
 * Reusable, centralized Creator Attribution Footer View for iOS / iPadOS SwiftUI screens.
 * Displays the required exact text: "Made by Aditya Misra"
 */
public struct CreatorFooterView: View {
    public init() {}

    public var body: some View {
        VStack(spacing: 8) {
            Divider()
                .overlay(AuralisBrand.lineBorder.opacity(0.45))
                .frame(maxWidth: 240)

            Text("Made by Aditya Misra")
                .font(.system(size: 11.5, weight: .medium, design: .default))
                .foregroundStyle(AuralisBrand.mutedText.opacity(0.85))
                .multilineTextAlignment(.center)
        }
        .padding(.top, 24)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity)
    }
}
