/**
 * SVG filter definitions for the Yggdrasil tree — volumetric glow,
 * bark texture, runic shimmer, and root-pulse effects.
 */

export const YGGDRASIL_FILTER_DEFS = `
  <defs>
    <!-- Organic branch glow -->
    <filter id="branch-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
      <feColorMatrix in="blur" type="saturate" values="2" result="saturated" />
      <feMerge>
        <feMergeNode in="saturated" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>

    <!-- Intense node glow -->
    <filter id="node-glow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur1" />
      <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur2" />
      <feMerge>
        <feMergeNode in="blur1" />
        <feMergeNode in="blur2" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>

    <!-- Trunk glow — wider, more intense -->
    <filter id="trunk-glow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="blur1" />
      <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur2" />
      <feColorMatrix in="blur1" type="saturate" values="1.5" result="sat" />
      <feMerge>
        <feMergeNode in="sat" />
        <feMergeNode in="blur2" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>

    <!-- Ambient particle glow -->
    <filter id="particle-glow" x="-200%" y="-200%" width="500%" height="500%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>

    <!-- Runic inscription glow -->
    <filter id="rune-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>

    <!-- Radial gradient for trunk -->
    <radialGradient id="trunk-gradient" cx="50%" cy="0%" r="100%">
      <stop offset="0%" stop-color="oklch(0.78 0.16 200)" stop-opacity="1" />
      <stop offset="60%" stop-color="oklch(0.65 0.14 200)" stop-opacity="0.8" />
      <stop offset="100%" stop-color="oklch(0.50 0.10 200)" stop-opacity="0.4" />
    </radialGradient>

    <!-- Ground gradient — representing Niflheim below -->
    <linearGradient id="ground-gradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="oklch(0.16 0.018 250)" stop-opacity="0" />
      <stop offset="40%" stop-color="oklch(0.12 0.02 260)" stop-opacity="0.3" />
      <stop offset="100%" stop-color="oklch(0.08 0.015 270)" stop-opacity="0.7" />
    </linearGradient>
  </defs>
`;
