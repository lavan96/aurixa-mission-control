/**
 * TreeBranchPath — an animated SVG path connecting parent → child node.
 * Uses a cubic bezier for organic curvature and animates drawing with
 * strokeDashoffset.
 */

import { motion } from "framer-motion";
import type { TreeBranch } from "./use-tree-layout";

interface Props {
  branch: TreeBranch;
  index: number;
}

export function TreeBranchPath({ branch, index }: Props) {
  const { from, to, depth, hue, thickness } = branch;

  // Create organic cubic bezier
  const midY = (from.y + to.y) / 2;
  const controlOffset = (to.x - from.x) * 0.15;
  const path = `M ${from.x} ${from.y} C ${from.x + controlOffset} ${midY}, ${to.x - controlOffset} ${midY}, ${to.x} ${to.y}`;

  // Approximate path length for dash animation
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const pathLength = Math.sqrt(dx * dx + dy * dy) * 1.3;

  const color = `oklch(0.65 0.14 ${hue})`;
  const glowColor = `oklch(0.75 0.18 ${hue})`;

  return (
    <g>
      {/* Glow layer */}
      <motion.path
        d={path}
        fill="none"
        stroke={glowColor}
        strokeWidth={thickness + 4}
        strokeLinecap="round"
        opacity={0}
        filter="url(#branch-glow)"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.3 }}
        transition={{ delay: 0.3 + index * 0.08, duration: 1.2 }}
      />
      {/* Main branch */}
      <motion.path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={thickness}
        strokeLinecap="round"
        strokeDasharray={pathLength}
        initial={{ strokeDashoffset: pathLength, opacity: 0 }}
        animate={{ strokeDashoffset: 0, opacity: 1 }}
        transition={{
          strokeDashoffset: {
            delay: 0.2 + index * 0.08,
            duration: 1.0 + depth * 0.2,
            ease: "easeOut",
          },
          opacity: { delay: 0.2 + index * 0.08, duration: 0.3 },
        }}
      />
    </g>
  );
}
