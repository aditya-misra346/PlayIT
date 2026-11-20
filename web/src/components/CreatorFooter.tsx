import React from 'react';

/**
 * Reusable, centralized Creator Attribution Footer Component
 * Displays the required exact text: "Made by Aditya Misra"
 */
export const CreatorFooter: React.FC = () => {
  return (
    <footer className="creator-footer" role="contentinfo" aria-label="Creator Attribution">
      <p className="creator-footer-text">
        Made by Aditya Misra
      </p>
    </footer>
  );
};
