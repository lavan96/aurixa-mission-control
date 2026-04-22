/**
 * RunicInscription — subtle Elder Futhark runes that appear along
 * the trunk and major branches, giving the tree its mythological character.
 */

import { motion } from "framer-motion";

// Elder Futhark runes
const RUNES = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛝᛞᛟ";

interface Props {
  x: number;
  y: number;
  count?: number;
  vertical?: boolean;
}

function seededChar(seed: number): string {
  const idx = Math.abs(Math.floor(Math.sin(seed * 91.3) * 1000)) % RUNES.length;
  return RUNES[idx];
}

export function RunicInscription({ x, y, count = 5, vertical = true }: Props) {
  return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const rune = seededChar(x * 7 + y * 13 + i * 31);
        const rx = vertical ? x + (Math.sin(i * 2.3) * 4) : x + i * 14;
        const ry = vertical ? y + i * 16 : y + (Math.sin(i * 1.7) * 4);

        return (
          <motion.text
            key={i}
            x={rx}
            y={ry}
            textAnchor="middle"
            fill="oklch(0.78 0.16 200)"
            fontSize={11}
            fontWeight={300}
            filter="url(#rune-glow)"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.35, 0.15, 0.3, 0] }}
            transition={{
              duration: 6 + i * 0.8,
              delay: 1.5 + i * 0.4,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            {rune}
          </motion.text>
        );
      })}
    </g>
  );
}
