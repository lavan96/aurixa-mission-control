/**
 * AmbientParticles — floating motes of light drifting around the tree,
 * evoking the cosmic energy of Norse mythology.
 */

import { motion } from "framer-motion";
import { useMemo } from "react";

interface Props {
  width: number;
  height: number;
  count?: number;
}

function seededRandom(seed: number) {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

export function AmbientParticles({ width, height, count = 40 }: Props) {
  const particles = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const x = seededRandom(i * 3 + 1) * width;
      const y = seededRandom(i * 3 + 2) * height;
      const size = 1 + seededRandom(i * 3 + 3) * 3;
      const duration = 4 + seededRandom(i * 7) * 8;
      const delay = seededRandom(i * 11) * 5;
      const hue = [200, 150, 130, 80, 290][i % 5];
      const driftX = (seededRandom(i * 13) - 0.5) * 60;
      const driftY = (seededRandom(i * 17) - 0.5) * 40;

      return { x, y, size, duration, delay, hue, driftX, driftY };
    });
  }, [width, height, count]);

  return (
    <g>
      {particles.map((p, i) => (
        <motion.circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={p.size}
          fill={`oklch(0.80 0.15 ${p.hue})`}
          filter="url(#particle-glow)"
          initial={{ opacity: 0, cx: p.x, cy: p.y }}
          animate={{
            opacity: [0, 0.6, 0.3, 0.7, 0],
            cx: [p.x, p.x + p.driftX, p.x - p.driftX * 0.5, p.x + p.driftX * 0.3, p.x],
            cy: [p.y, p.y + p.driftY, p.y - p.driftY * 0.5, p.y + p.driftY * 0.3, p.y],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </g>
  );
}
