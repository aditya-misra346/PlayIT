import React, { useEffect, useMemo, useState } from 'react';
import { DOWNLOADS_MANIFEST, SUPPORTED_PLATFORMS } from '../version';

export type PlatformId = 'windows' | 'macos' | 'android' | 'ios' | 'linux';

interface DownloadPageProps {
  onBackToApp?: () => void;
  initialPlatform?: PlatformId;
}

export function detectUserPlatform(): PlatformId {
  if (typeof navigator === 'undefined') return 'windows';
  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator as any).userAgentData?.platform?.toLowerCase() ?? navigator.platform?.toLowerCase() ?? '';

  if (/iphone|ipad|ipod/.test(ua) || (platform.includes('mac') && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }
  if (/android/.test(ua)) {
    return 'android';
  }
  if (/win/.test(ua) || /win/.test(platform)) {
    return 'windows';
  }
  if (/mac/.test(ua) || /mac/.test(platform)) {
    return 'macos';
  }
  if (/linux/.test(ua) || /linux/.test(platform)) {
    return 'linux';
  }
  return 'windows';
}

export const DownloadPage: React.FC<DownloadPageProps> = ({ onBackToApp, initialPlatform }) => {
  const detectedPlatform = useMemo(() => detectUserPlatform(), []);
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformId>(initialPlatform ?? detectedPlatform);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [showPwaModal, setShowPwaModal] = useState<boolean>(false);
  const [showTroubleshooting, setShowTroubleshooting] = useState<boolean>(false);

  // Sync with initialPlatform if provided via props
  useEffect(() => {
    if (initialPlatform) {
      setSelectedPlatform(initialPlatform);
    }
  }, [initialPlatform]);

  const manifest = DOWNLOADS_MANIFEST as any;
  const currentItem = manifest[selectedPlatform] ?? manifest.android;

  const handleCopyChecksum = (sha: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(sha);
      setCopiedHash(sha);
      setTimeout(() => setCopiedHash(null), 2500);
    }
  };

  return (
    <div className="download-page-container">
      {/* Back button header navigation */}
      <div className="download-nav-header">
        {onBackToApp && (
          <button type="button" className="btn-secondary" onClick={onBackToApp} style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
            ← Back to Web App
          </button>
        )}
        <div className="download-badge-free">
          <span className="badge-dot" />
          Free to download · No account required
        </div>
      </div>

      {/* Hero Headline & Subtitle */}
      <section className="download-hero-section">
        <h1 className="download-hero-title">Get PlayIT on all your devices.</h1>
        <p className="download-hero-subtitle">
          One app. All your devices. Download PlayIT for free and enjoy your music recognition experience wherever you go.
        </p>

        {/* Detected Device Banner */}
        <div className="download-detected-pill">
          <span>Detected Device:</span>
          <strong>
            {detectedPlatform === 'ios' && 'iPhone / iPad (iOS)'}
            {detectedPlatform === 'android' && 'Android Device'}
            {detectedPlatform === 'macos' && 'Mac (macOS)'}
            {detectedPlatform === 'windows' && 'Windows PC'}
            {detectedPlatform === 'linux' && 'Linux PC'}
          </strong>
          {selectedPlatform !== detectedPlatform && (
            <button
              type="button"
              className="switch-back-link"
              onClick={() => setSelectedPlatform(detectedPlatform)}
            >
              (Switch to detected)
            </button>
          )}
        </div>
      </section>

      {/* Platform Switcher Tabs */}
      <div className="platform-tabs-grid" role="tablist" aria-label="Select Operating System">
        <button
          type="button"
          role="tab"
          aria-selected={selectedPlatform === 'windows'}
          className={`platform-tab-card ${selectedPlatform === 'windows' ? 'active' : ''}`}
          onClick={() => setSelectedPlatform('windows')}
        >
          <span className="platform-tab-icon">🪟</span>
          <span className="platform-tab-name">Windows</span>
          <span className="platform-tab-sub">10 / 11 (64-bit)</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={selectedPlatform === 'macos'}
          className={`platform-tab-card ${selectedPlatform === 'macos' ? 'active' : ''}`}
          onClick={() => setSelectedPlatform('macos')}
        >
          <span className="platform-tab-icon">🍎</span>
          <span className="platform-tab-name">macOS</span>
          <span className="platform-tab-sub">Apple Silicon & Intel</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={selectedPlatform === 'android'}
          className={`platform-tab-card ${selectedPlatform === 'android' ? 'active' : ''}`}
          onClick={() => setSelectedPlatform('android')}
        >
          <span className="platform-tab-icon">🤖</span>
          <span className="platform-tab-name">Android</span>
          <span className="platform-tab-sub">APK & PWA</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={selectedPlatform === 'ios'}
          className={`platform-tab-card ${selectedPlatform === 'ios' ? 'active' : ''}`}
          onClick={() => setSelectedPlatform('ios')}
        >
          <span className="platform-tab-icon">📱</span>
          <span className="platform-tab-name">iOS & iPadOS</span>
          <span className="platform-tab-sub">Safari Home Screen</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={selectedPlatform === 'linux'}
          className={`platform-tab-card ${selectedPlatform === 'linux' ? 'active' : ''}`}
          onClick={() => setSelectedPlatform('linux')}
        >
          <span className="platform-tab-icon">🐧</span>
          <span className="platform-tab-name">Linux</span>
          <span className="platform-tab-sub">AppImage</span>
        </button>
      </div>

      {/* Main Download Card for Currently Selected Platform */}
      <section className="download-active-card">
        <div className="card-top-row">
          <div>
            <div className="os-badge-chip">{currentItem?.platform ?? 'Universal'}</div>
            <h2 className="card-headline">
              {selectedPlatform === 'ios'
                ? 'Install PlayIT on iPhone & iPad'
                : `PlayIT for ${currentItem?.platform}`}
            </h2>
            <p className="card-subheadline">
              {selectedPlatform === 'ios'
                ? 'Enjoy a full-screen, standalone app experience directly on your iPhone or iPad with zero App Store accounts, Apple ID logins, or subscriptions required.'
                : `Direct, official installation with automatic background updates, audio capture, and song identification.`}
            </p>
          </div>
          <div className="card-version-box">
            <span className="version-number">v{currentItem?.version ?? '1.5.0'}</span>
            <span className="build-tag">Build #{currentItem?.buildNumber ?? 8}</span>
            <span className="size-tag">{currentItem?.sizeDisplay ?? 'Standard'}</span>
          </div>
        </div>

        {/* Primary Action Button */}
        <div className="primary-download-action-area">
          {selectedPlatform === 'ios' ? (
            <button
              type="button"
              className="btn-primary-large"
              onClick={() => setShowPwaModal(true)}
            >
              <span className="btn-icon">📱</span>
              Install on iPhone / iPad (Safari)
            </button>
          ) : (
            <a
              href={currentItem?.url ?? `/api/v1/download/${selectedPlatform}`}
              download
              className="btn-primary-large"
            >
              <span className="btn-icon">⬇</span>
              Download for {currentItem?.platform}
            </a>
          )}

          {/* Secondary zero-install browser PWA link */}
          {onBackToApp && (
            <button
              type="button"
              className="btn-secondary-subtle"
              onClick={onBackToApp}
              title="Launch PlayIT directly inside this browser window with zero installation"
            >
              Prefer no installation? Launch PlayIT in browser →
            </button>
          )}
        </div>

        {/* Key Specifications Grid */}
        <div className="specs-grid">
          <div className="spec-item">
            <span className="spec-label">Package Format</span>
            <strong className="spec-val">{currentItem?.format ?? 'Native Package'}</strong>
          </div>
          <div className="spec-item">
            <span className="spec-label">System Requirement</span>
            <strong className="spec-val">{currentItem?.minOs ?? 'Modern OS'}</strong>
          </div>
          <div className="spec-item">
            <span className="spec-label">Automatic Updates</span>
            <strong className="spec-val">{currentItem?.autoUpdateMethod ?? 'Automatic Background Check'}</strong>
          </div>
          <div className="spec-item">
            <span className="spec-label">Developer Membership</span>
            <strong className="spec-val text-cyan">None Required (100% Free)</strong>
          </div>
        </div>

        {/* Platform-Specific Step-by-Step Instructions */}
        <div className="install-guide-box">
          <h3 className="guide-title">
            <span>📋</span> Quick Installation Guide
          </h3>
          {selectedPlatform === 'ios' ? (
            <ol className="guide-steps-list">
              <li>Open <strong>https://playit.vercel.app</strong> in Safari on your iPhone or iPad.</li>
              <li>Tap the <strong>Share</strong> icon (the square with an arrow pointing upward) in Safari's bottom toolbar.</li>
              <li>Scroll down the share sheet and tap <strong>Add to Home Screen</strong>, then tap <strong>Add</strong> in the top-right corner.</li>
              <li>PlayIT will now appear as an icon on your home screen, launching in an app-like standalone window.</li>
            </ol>
          ) : (
            <p className="guide-text">
              {currentItem?.instructions ?? 'Download the installer and run it to start identifying music instantly.'}
            </p>
          )}

          {/* Security and Transparency Notices (Gatekeeper / SmartScreen) */}
          {currentItem?.securityNotice && (
            <div className="security-notice-alert">
              <span className="notice-icon">🛡️</span>
              <div className="notice-body">
                <strong>Platform Security Notice:</strong>
                <p>{currentItem.securityNotice}</p>
              </div>
            </div>
          )}
        </div>

        {/* Cryptographic SHA-256 Checksum Area */}
        {currentItem?.sha256 && (
          <div className="checksum-container">
            <div className="checksum-header">
              <span className="checksum-label">SHA-256 Checksum (Artifact Integrity):</span>
              <button
                type="button"
                className="btn-copy-hash"
                onClick={() => handleCopyChecksum(currentItem.sha256)}
              >
                {copiedHash === currentItem.sha256 ? '✓ Copied!' : 'Copy Checksum'}
              </button>
            </div>
            <code className="checksum-code">{currentItem.sha256}</code>
          </div>
        )}
      </section>

      {/* Automatic Update Synchronization Explainer Card */}
      <section className="update-sync-card">
        <div className="sync-icon-col">⚡</div>
        <div className="sync-content-col">
          <h3 className="sync-title">Always Synchronised & Up to Date</h3>
          <p className="sync-desc">
            PlayIT uses an integrated cross-platform release synchronization engine. Whether you are using the Web App,
            Android APK, iOS Home Screen PWA, or Desktop applications, your music recognition catalog, library history,
            and features stay updated automatically.
          </p>
          <div className="sync-features-row">
            <div className="sync-feature-pill">✓ Seamless Background Checking</div>
            <div className="sync-feature-pill">✓ Zero Interruption to Active Listening</div>
            <div className="sync-feature-pill">✓ No Third-Party App Store Redirects</div>
          </div>
        </div>
      </section>

      {/* Expandable Technical Details & Troubleshooting Accordion */}
      <div className="troubleshooting-toggle-box">
        <button
          type="button"
          className="btn-toggle-troubleshooting"
          onClick={() => setShowTroubleshooting((prev) => !prev)}
        >
          <span>{showTroubleshooting ? '▲ Hide' : '▼ View'} Supported Platform Matrix & Troubleshooting</span>
        </button>

        {showTroubleshooting && (
          <div className="troubleshooting-details-panel">
            <h4 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '12px' }}>
              Platform Verification & Engine Compatibility
            </h4>
            <div className="platform-table-wrapper">
              <table className="troubleshoot-table">
                <thead>
                  <tr>
                    <th>Platform</th>
                    <th>Version</th>
                    <th>Recognition Capability</th>
                    <th>Distribution Method</th>
                  </tr>
                </thead>
                <tbody>
                  {SUPPORTED_PLATFORMS.map((p) => (
                    <tr key={p.id}>
                      <td><strong>{p.name}</strong></td>
                      <td>{p.version}</td>
                      <td>Microphone + System Audio Capture</td>
                      <td>Zero-Cost Direct HTTPS / PWA</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--muted)', marginTop: '12px' }}>
              PlayIT is independently architected to avoid paywalled developer memberships or account requirements.
              For assistance, feedback, or custom builds, view our open-source repository at{' '}
              <a href="https://github.com/aditya-misra346/PlayIT" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cyan)' }}>
                github.com/aditya-misra346/PlayIT
              </a>.
            </p>
          </div>
        )}
      </div>

      {/* iOS PWA Step-by-Step Modal Sheet */}
      {showPwaModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="ios-pwa-title">
          <div className="modal-card" style={{ maxWidth: '480px' }}>
            <h3 id="ios-pwa-title" style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '8px' }}>
              Install on iPhone or iPad
            </h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--muted)', marginBottom: '18px', lineHeight: 1.5 }}>
              Apple iOS allows any web application to install as a standalone home-screen app directly through Safari without downloading from the App Store.
            </p>

            <div className="pwa-visual-steps">
              <div className="visual-step">
                <div className="step-num-badge">1</div>
                <div className="step-text-content">
                  <strong>Open in Safari</strong>
                  <p>Ensure you are viewing this page in Apple Safari on your iPhone or iPad.</p>
                </div>
              </div>

              <div className="visual-step">
                <div className="step-num-badge">2</div>
                <div className="step-text-content">
                  <strong>Tap the Share Button</strong>
                  <p>Tap the 📤 share icon at the bottom of Safari's screen.</p>
                </div>
              </div>

              <div className="visual-step">
                <div className="step-num-badge">3</div>
                <div className="step-text-content">
                  <strong>Select 'Add to Home Screen'</strong>
                  <p>Scroll down the share sheet and tap <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.</p>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '22px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setShowPwaModal(false)}
                style={{ padding: '9px 20px' }}
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
