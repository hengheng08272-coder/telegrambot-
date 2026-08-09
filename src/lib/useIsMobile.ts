import { useEffect, useState } from 'react';

// Anything at or below this width counts as "mobile" for gating purposes.
// 768px covers phones and most phones-in-landscape while excluding tablets
// in the wider orientation and all desktop/laptop browsers.
const MOBILE_BREAKPOINT = 768;

function computeIsMobile(): boolean {
  if (typeof window === 'undefined') return true;
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(computeIsMobile);

  useEffect(() => {
    const handleResize = () => setIsMobile(computeIsMobile());
    window.addEventListener('resize', handleResize);
    // Orientation changes on real devices don't always fire 'resize' in time.
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  return isMobile;
}
