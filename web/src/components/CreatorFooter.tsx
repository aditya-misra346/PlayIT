import React from 'react';

export interface CreatorFooterProps {
  onNavigateDownload?: () => void;
}

/**
 * Reusable, centralized Creator Attribution Footer Component
 * Displays the required exact text: "Made by Aditya Misra"
 * Styled for subtle, premium visual integration across all screen sizes and themes.
 */
export const CreatorFooter: React.FC<CreatorFooterProps> = ({ onNavigateDownload }) => {
  return (
    <footer className="creator-footer" role="contentinfo" aria-label="Creator Attribution">
      <div className="creator-footer-links">
        <a
          href="/download"
          onClick={(e) => {
            if (onNavigateDownload) {
              e.preventDefault();
              onNavigateDownload();
            }
          }}
          className="creator-footer-link"
        >
          Download PlayIT App (Android, iOS, macOS, Windows, Linux)
        </a>
      </div>
      <div className="creator-footer-divider" />
      <p className="creator-footer-text">
        Made by Aditya Misra
      </p>
    </footer>
  );
};
