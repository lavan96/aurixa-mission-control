/**
 * YggdrasilNodePanel — a slide-in panel showing details about a
 * selected clone node on the tree, with lineage breadcrumb.
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { X, GitBranch, ExternalLink, Github, ChevronRight, TreePine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/status-pill";
import type { TreeNode } from "./use-tree-layout";

interface Props {
  node: TreeNode;
  allNodes: TreeNode[];
  onClose: () => void;
}

/** Walk from node up to trunk, building a breadcrumb path */
function buildLineage(node: TreeNode, allNodes: TreeNode[]): TreeNode[] {
  const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
  const path: TreeNode[] = [node];
  let current = node;
  while (current.parentId) {
    const parent = nodeMap.get(current.parentId);
    if (!parent) break;
    path.unshift(parent);
    current = parent;
  }
  return path;
}

export function YggdrasilNodePanel({ node, allNodes, onClose }: Props) {
  const lineage = useMemo(() => buildLineage(node, allNodes), [node, allNodes]);

  return (
    <motion.div
      className="absolute bottom-4 right-4 z-40 w-80 rounded-xl border border-border/60 bg-card/95 p-5 shadow-2xl backdrop-blur-xl"
      initial={{ opacity: 0, x: 40, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold">{node.name}</h3>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            {node.githubOwner}/{node.githubRepo}
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Lineage breadcrumb */}
      <div className="mt-3 flex items-center gap-1 overflow-x-auto rounded-md bg-muted/40 px-2 py-1.5">
        {lineage.map((n, i) => (
          <span key={n.id} className="flex shrink-0 items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
            {n.id === "__trunk__" ? (
              <span className="flex items-center gap-1 font-mono text-[10px] font-semibold text-primary">
                <TreePine className="h-3 w-3" /> PRIME
              </span>
            ) : (
              <span
                className={`font-mono text-[10px] ${
                  n.id === node.id ? "font-semibold text-foreground" : "text-muted-foreground"
                }`}
              >
                {n.name}
              </span>
            )}
          </span>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex items-center gap-2">
          <StatusPill status={node.syncStatus as "in_sync" | "behind" | "failed" | "unknown" | "cascading"} behind={node.commitsBehind} />
          {node.commitsBehind > 0 && (
            <span className="font-mono text-xs text-warning">
              {node.commitsBehind} commit{node.commitsBehind === 1 ? "" : "s"} behind
            </span>
          )}
        </div>

        {node.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {node.tags.map((t) => (
              <Badge key={t} variant="outline" className="font-mono text-[10px]">
                #{t}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
          <GitBranch className="h-3 w-3" />
          Depth {node.depth} in tree hierarchy
        </div>

        <div className="flex gap-2 pt-2">
          <Link to="/clones/$cloneId" params={{ cloneId: node.id }}>
            <Button size="sm" variant="outline" className="font-mono text-xs">
              <ExternalLink className="mr-1.5 h-3 w-3" /> View clone
            </Button>
          </Link>
          <a
            href={`https://github.com/${node.githubOwner}/${node.githubRepo}`}
            target="_blank"
            rel="noreferrer"
          >
            <Button size="sm" variant="ghost" className="font-mono text-xs">
              <Github className="mr-1.5 h-3 w-3" /> Repo
            </Button>
          </a>
        </div>
      </div>
    </motion.div>
  );
}
