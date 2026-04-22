/**
 * YggdrasilTree — the main SVG canvas that renders the entire
 * world tree visualization with all its layers.
 * Supports pan & zoom via mouse drag + wheel.
 */

import { useRef, useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Clone } from "@/lib/queries";
import { useTreeLayout, type TreeNode } from "./use-tree-layout";
import { TreeBranchPath } from "./tree-branch";
import { TreeNodeCircle } from "./tree-node";
import { AmbientParticles } from "./ambient-particles";
import { RunicInscription } from "./runic-inscription";
import { YGGDRASIL_FILTER_DEFS } from "./tree-filters";
import { YggdrasilNodePanel } from "./node-detail-panel";

interface Props {
  clones: Clone[];
  primeName?: string;
  highlightId?: string | null;
  zoom: number;
  pan: { x: number; y: number };
  onPanChange: (pan: { x: number; y: number }) => void;
}

export function YggdrasilTree({ clones, primeName, highlightId, zoom, pan, onPanChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 1000, height: 700 });
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const obs = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect;
      const height = Math.max(600, width * 0.65);
      setDimensions({ width, height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const layout = useTreeLayout(clones, dimensions.width, dimensions.height);

  // Pan handlers
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("button, a, foreignObject")) return;
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [pan],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      onPanChange({
        x: dragStart.current.panX + (e.clientX - dragStart.current.x),
        y: dragStart.current.panY + (e.clientY - dragStart.current.y),
      });
    },
    [dragging, onPanChange],
  );
  const onPointerUp = useCallback(() => setDragging(false), []);

  // Wheel zoom
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      // Prevent page scroll
      e.stopPropagation();
      // We don't call e.preventDefault() here because it's a passive handler
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-xl border border-border/40 bg-background"
      style={{ cursor: dragging ? "grabbing" : "grab" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onWheel={onWheel}
    >
      {/* Atmospheric background gradient */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 60% 40% at 50% 15%, oklch(0.78 0.16 200 / 0.06), transparent),
            radial-gradient(ellipse 80% 50% at 50% 80%, oklch(0.10 0.02 270 / 0.5), transparent),
            linear-gradient(180deg, oklch(0.16 0.018 250) 0%, oklch(0.10 0.015 260) 100%)
          `,
        }}
      />

      <svg
        width={dimensions.width}
        height={dimensions.height}
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        className="relative z-10"
        style={{ display: "block" }}
        dangerouslySetInnerHTML={{ __html: YGGDRASIL_FILTER_DEFS }}
      />

      {/* Actual SVG content on top */}
      <svg
        width={dimensions.width}
        height={dimensions.height}
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        className="absolute inset-0 z-20"
        style={{ display: "block" }}
      >
        <g
          transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}
          style={{ transformOrigin: `${dimensions.width / 2}px ${dimensions.height / 2}px` }}
        >
          {/* Ambient particles */}
          <AmbientParticles
            width={dimensions.width}
            height={dimensions.height}
            count={clones.length > 0 ? 30 + clones.length * 3 : 20}
          />

          {/* Ground fog */}
          <motion.rect
            x={0}
            y={dimensions.height * 0.6}
            width={dimensions.width}
            height={dimensions.height * 0.4}
            fill="url(#ground-gradient)"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 2 }}
          />

          {/* Runic inscriptions along trunk */}
          {layout.trunkNode && (
            <>
              <RunicInscription
                x={layout.trunkNode.x - 30}
                y={layout.trunkNode.y + 30}
                count={4}
              />
              <RunicInscription
                x={layout.trunkNode.x + 30}
                y={layout.trunkNode.y + 40}
                count={3}
              />
            </>
          )}

          {/* Trunk line */}
          {layout.trunkNode && (
            <motion.line
              x1={layout.trunkNode.x}
              y1={0}
              x2={layout.trunkNode.x}
              y2={layout.trunkNode.y}
              stroke="oklch(0.60 0.12 200)"
              strokeWidth={5}
              strokeLinecap="round"
              filter="url(#branch-glow)"
              initial={{ y2: 0 }}
              animate={{ y2: layout.trunkNode.y }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          )}

          {/* Branches */}
          {layout.branches.map((branch, i) => (
            <TreeBranchPath key={i} branch={branch} index={i} />
          ))}

          {/* Nodes */}
          {layout.nodes.map((node, i) => (
            <TreeNodeCircle
              key={node.id}
              node={node}
              index={i}
              highlighted={highlightId === node.id}
              onSelect={(n) => setSelectedNode(n.id === "__trunk__" ? null : n)}
            />
          ))}

          {/* Title inscription at top */}
          <motion.text
            x={dimensions.width / 2}
            y={30}
            textAnchor="middle"
            fill="oklch(0.78 0.16 200)"
            fontSize={10}
            fontFamily="var(--font-mono)"
            fontWeight={400}
            letterSpacing="0.3em"
            filter="url(#rune-glow)"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            transition={{ delay: 1.5, duration: 1.5 }}
          >
            {primeName ? `— ${primeName.toUpperCase()} —` : "— THE WORLD TREE —"}
          </motion.text>
        </g>
      </svg>

      {/* Empty state overlay */}
      {clones.length === 0 && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center">
          <motion.div
            className="text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 2, duration: 0.8 }}
          >
            <p className="font-mono text-lg text-muted-foreground">
              The tree awaits its first roots.
            </p>
            <p className="mt-2 font-mono text-xs text-muted-foreground/60">
              Add clones to watch Yggdrasil grow.
            </p>
          </motion.div>
        </div>
      )}

      {/* Node detail panel */}
      <AnimatePresence>
        {selectedNode && (
          <YggdrasilNodePanel
            node={selectedNode}
            allNodes={layout.nodes}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
