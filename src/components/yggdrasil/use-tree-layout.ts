/**
 * useTreeLayout — converts a flat list of clones into a hierarchical
 * tree structure with computed (x, y) positions for SVG rendering.
 *
 * The tree grows DOWNWARD (roots into the earth), with the prime repo
 * as the trunk at the top and clones branching below.
 */

import { useMemo } from "react";
import type { Clone } from "@/lib/queries";

export interface TreeNode {
  id: string;
  name: string;
  slug: string;
  tags: string[];
  syncStatus: string;
  githubRepo: string;
  githubOwner: string;
  commitsBehind: number;
  depth: number;
  x: number;
  y: number;
  parentId: string | null;
  children: TreeNode[];
  /** Deterministic hue derived from clone id */
  hue: number;
  /** Branch angle in radians */
  angle: number;
}

export interface TreeBranch {
  from: { x: number; y: number };
  to: { x: number; y: number };
  depth: number;
  hue: number;
  thickness: number;
}

export interface TreeLayout {
  nodes: TreeNode[];
  branches: TreeBranch[];
  width: number;
  height: number;
  trunkNode: TreeNode | null;
}

/** Deterministic hash from string → number [0, 1) */
function hashStr(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h % 10000) / 10000;
}

/** Group clones into a tree based on tags / naming similarity */
function inferHierarchy(clones: Clone[]): Map<string, string[]> {
  // Group by first tag as "branch group"
  const groups = new Map<string, Clone[]>();
  const ungrouped: Clone[] = [];

  for (const c of clones) {
    const tag = c.tags?.[0];
    if (tag) {
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag)!.push(c);
    } else {
      ungrouped.push(c);
    }
  }

  // Build parent→children map
  // Each tag group becomes a sub-branch
  const childMap = new Map<string, string[]>();
  const rootChildren: string[] = [];

  // Ungrouped clones connect directly to trunk
  for (const c of ungrouped) {
    rootChildren.push(c.id);
  }

  // For grouped clones, the first clone is the "group root"
  for (const [, group] of groups) {
    const sorted = [...group].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    rootChildren.push(sorted[0].id);
    if (sorted.length > 1) {
      childMap.set(
        sorted[0].id,
        sorted.slice(1).map((c) => c.id),
      );
    }
  }

  childMap.set("__root__", rootChildren);
  return childMap;
}

export function useTreeLayout(
  clones: Clone[],
  containerWidth: number,
  containerHeight: number,
): TreeLayout {
  return useMemo(() => {
    if (clones.length === 0) {
      return {
        nodes: [],
        branches: [],
        width: containerWidth,
        height: containerHeight,
        trunkNode: null,
      };
    }

    const childMap = inferHierarchy(clones);
    const cloneById = new Map(clones.map((c) => [c.id, c]));

    const allNodes: TreeNode[] = [];
    const allBranches: TreeBranch[] = [];

    const centerX = containerWidth / 2;
    const trunkTopY = 80;
    const levelSpacing = 120;
    const minBranchSpacing = 140;

    // Create trunk (prime repo) node
    const trunkNode: TreeNode = {
      id: "__trunk__",
      name: "PRIME",
      slug: "prime",
      tags: [],
      syncStatus: "in_sync",
      githubRepo: "",
      githubOwner: "",
      commitsBehind: 0,
      depth: 0,
      x: centerX,
      y: trunkTopY,
      parentId: null,
      children: [],
      hue: 200,
      angle: Math.PI / 2, // pointing down
    };
    allNodes.push(trunkNode);

    const rootChildren = childMap.get("__root__") ?? [];
    const totalRoots = rootChildren.length;

    // Spread root children across the width
    const spreadWidth = Math.min(containerWidth - 200, totalRoots * minBranchSpacing);
    const startX = centerX - spreadWidth / 2;

    function layoutNode(
      cloneId: string,
      depth: number,
      parentX: number,
      parentY: number,
      indexInSiblings: number,
      totalSiblings: number,
      parentNode: TreeNode,
    ) {
      const clone = cloneById.get(cloneId);
      if (!clone) return;

      const hash = hashStr(clone.id);
      const hue = (hash * 360) | 0;

      // Calculate position
      let x: number;
      if (depth === 1) {
        // First level: spread evenly
        x =
          totalSiblings === 1
            ? centerX
            : startX + (indexInSiblings / (totalSiblings - 1)) * spreadWidth;
      } else {
        // Deeper levels: offset from parent with some spread
        const offsetRange = Math.max(60, 160 / depth);
        const offset =
          totalSiblings === 1 ? 0 : (indexInSiblings / (totalSiblings - 1) - 0.5) * offsetRange * 2;
        x = parentX + offset;
      }

      // Add organic variation
      const jitterX = (hash - 0.5) * 30;
      const jitterY = (hashStr(clone.id + "y") - 0.5) * 20;
      x += jitterX;
      const y = parentY + levelSpacing + jitterY;

      const angle = Math.atan2(y - parentY, x - parentX);

      const node: TreeNode = {
        id: clone.id,
        name: clone.name,
        slug: clone.slug,
        tags: clone.tags ?? [],
        syncStatus: clone.sync_status,
        githubRepo: clone.github_repo,
        githubOwner: clone.github_owner,
        commitsBehind: clone.commits_behind,
        depth,
        x,
        y,
        parentId: parentNode.id,
        children: [],
        hue,
        angle,
      };

      parentNode.children.push(node);
      allNodes.push(node);

      // Branch from parent to this node
      const thickness = Math.max(1.5, 6 - depth * 1.5);
      allBranches.push({
        from: { x: parentX, y: parentY },
        to: { x, y },
        depth,
        hue,
        thickness,
      });

      // Layout children
      const children = childMap.get(cloneId) ?? [];
      children.forEach((childId, i) => {
        layoutNode(childId, depth + 1, x, y, i, children.length, node);
      });
    }

    rootChildren.forEach((id, i) => {
      layoutNode(id, 1, centerX, trunkTopY, i, totalRoots, trunkNode);
    });

    // Calculate actual bounds
    const maxY = allNodes.reduce((m, n) => Math.max(m, n.y), 0) + 100;
    const height = Math.max(containerHeight, maxY);

    return { nodes: allNodes, branches: allBranches, width: containerWidth, height, trunkNode };
  }, [clones, containerWidth, containerHeight]);
}
