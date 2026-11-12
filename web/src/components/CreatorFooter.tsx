import React from 'react';

/**
 * Reusable, centralized Creator Attribution Footer Component
 * Displays the required exact text: "Made by Aditya Misra"
 * Styled for subtle, premium visual integration across all screen sizes and themes.
 */
export const CreatorFooter: React.FC = () => {
  return (
    <footer className="creator-footer" role="contentinfo" aria-label="Creator Attribution">
      <div className="creator-footer-divider" />
      <p className="creator-footer-text">
        Made by Aditya Misra
      </p>
    </footer>
  );
};
