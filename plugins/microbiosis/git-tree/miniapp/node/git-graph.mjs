// SPDX-License-Identifier: Apache-2.0
//
// This file is a JavaScript port of:
//   packages/ui/src/git-graph/layoutAlgorithm.ts
//   packages/ui/src/git-graph/layout.ts
// from the upstream repository https://github.com/zai-org/ZCode (Apache-2.0).
// Original authors: Z.ai / zai-org contributors.
// Modifications: TypeScript → ES module JavaScript; default rowHeight /
// laneGap / lanePadding / topPadding / bottomPadding reduced so the layout
// fits a single-screen commit table on a Mini App surface (upstream uses
// 42 / 18 / 16 / 20 / 18). Curve constants in `buildEdgePath` and every
// algorithm detail (vertex state machine, branch colour reuse, merge-path
// detection, lockedFirst semantics) are kept in lock-step with upstream.

/**
 * @typedef {object} GraphCommit
 * @property {string} hash
 * @property {string[]} parents
 *
 * @typedef {object} GraphPoint
 * @property {number} laneIndex
 * @property {number} rowIndex
 *
 * @typedef {object} BranchLineSeed
 * @property {GraphPoint} from
 * @property {GraphPoint} to
 * @property {number} laneIndex
 * @property {string} sourceHash
 * @property {string} targetHash
 * @property {boolean} lockedFirst
 *
 * @typedef {object} LayoutOptions
 * @property {number} [rowHeight]
 * @property {number} [laneGap]
 * @property {number} [lanePadding]
 * @property {number} [topPadding]
 * @property {number} [bottomPadding]
 */

const MISSING_PARENT_ID = -1;
const DEFAULT_ROW_HEIGHT = 26;
const DEFAULT_LANE_GAP = 14;
const DEFAULT_LANE_PADDING = 12;
const DEFAULT_TOP_PADDING = 0;
const DEFAULT_BOTTOM_PADDING = 0;

class LayoutBranch {
  /** @type {Property<number>} */ colourIndex;
  /** @type {BranchLineSeed[]} */ lines = [];
  endRowIndex = 0;
  constructor(colourIndex) {
    this.colourIndex = colourIndex;
  }
  addLine(from, to, sourceHash, targetHash, lockedFirst) {
    this.lines.push({ from, to, laneIndex: /** @type {number} */ (this.colourIndex), sourceHash, targetHash, lockedFirst });
  }
}

class LayoutVertex {
  /** @type {number} */ id;
  /** @type {string} */ hash;
  /** @type {LayoutVertex[]} */ parents = [];
  nextParentIndex = 0;
  laneIndex = /** @type {number | null} */ (null);
  /** @type {LayoutBranch | null} */ branch = null;
  nextLaneIndex = 0;
  /** @type {Array<{ target: LayoutVertex, branch: LayoutBranch } | undefined>} */ connections = [];
  constructor(id, hash) {
    this.id = id;
    this.hash = hash;
  }
  addParent(vertex) { this.parents.push(vertex); }
  getNextParent() {
    return this.nextParentIndex < this.parents.length ? /** @type {LayoutVertex} */ (this.parents[this.nextParentIndex]) : null;
  }
  registerParentProcessed() { this.nextParentIndex += 1; }
  isMerge() { return this.parents.length > 1; }
  isNotOnBranch() { return this.branch === null || this.laneIndex === null; }
  addToBranch(branch, laneIndex) {
    if (this.branch === null) {
      this.branch = branch;
      this.laneIndex = laneIndex;
    }
  }
  getBranch() { return this.branch; }
  getLaneIndex() { return this.laneIndex ?? 0; }
  getPoint() { return { laneIndex: this.getLaneIndex(), rowIndex: this.id }; }
  getNextPoint() { return { laneIndex: this.nextLaneIndex, rowIndex: this.id }; }
  getPointConnectingTo(target, branch) {
    const idx = this.connections.findIndex((c) => c && c.target === target && c.branch === branch);
    return idx >= 0 ? { laneIndex: idx, rowIndex: this.id } : null;
  }
  reservePoint(laneIndex, target, branch) {
    if (laneIndex === this.nextLaneIndex) {
      this.connections[laneIndex] = { target, branch };
      this.nextLaneIndex = laneIndex + 1;
    }
  }
  getWidthLaneIndex() { return this.nextLaneIndex; }
}

function createVertices(commits) {
  const missingParent = new LayoutVertex(MISSING_PARENT_ID, '__zcode_missing_parent__');
  const vertices = commits.map((c, i) => new LayoutVertex(i, c.hash));
  const vertexByHash = new Map(vertices.map((v) => [v.hash, v]));
  commits.forEach((commit, index) => {
    const vertex = vertices[index];
    for (const parentHash of commit.parents) {
      const parent = vertexByHash.get(parentHash) ?? missingParent;
      vertex.addParent(parent);
    }
  });
  return { missingParent, vertices, vertexByHash };
}

function getAvailableColour(startAt, availableColours) {
  const reusable = availableColours.findIndex((endAt) => startAt > endAt);
  if (reusable >= 0) return reusable;
  availableColours.push(0);
  return availableColours.length - 1;
}

function determineMergePath(startAt, vertices, vertex, parentVertex) {
  const parentBranch = /** @type {LayoutBranch} */ (parentVertex.getBranch());
  let lastPoint = vertex.getPoint();
  let foundConnectionToParent = false;
  for (let rowIndex = startAt + 1; rowIndex < vertices.length; rowIndex += 1) {
    const currentVertex = vertices[rowIndex];
    const existingPoint = currentVertex.getPointConnectingTo(parentVertex, parentBranch);
    const currentPoint = existingPoint ?? currentVertex.getNextPoint();
    foundConnectionToParent = existingPoint !== null;
    parentBranch.addLine(
      lastPoint,
      currentPoint,
      vertex.hash,
      parentVertex.hash,
      !foundConnectionToParent && currentVertex !== parentVertex
        ? lastPoint.laneIndex < currentPoint.laneIndex
        : true,
    );
    currentVertex.reservePoint(currentPoint.laneIndex, parentVertex, parentBranch);
    lastPoint = currentPoint;
    if (foundConnectionToParent) {
      vertex.registerParentProcessed();
      break;
    }
  }
}

function determineNormalPath(params) {
  const { startAt, vertices, branches, availableColours, missingParent } = params;
  let rowIndex = startAt;
  let vertex = vertices[rowIndex];
  let parentVertex = vertex.getNextParent();
  let lastPoint = vertex.isNotOnBranch() ? vertex.getNextPoint() : vertex.getPoint();
  const branch = new LayoutBranch(getAvailableColour(startAt, availableColours));
  vertex.addToBranch(branch, lastPoint.laneIndex);
  vertex.reservePoint(lastPoint.laneIndex, vertex, branch);
  for (rowIndex = startAt + 1; rowIndex < vertices.length; rowIndex += 1) {
    if (parentVertex === null || parentVertex === missingParent) break;
    const currentVertex = vertices[rowIndex];
    const currentPoint =
      parentVertex === currentVertex && !parentVertex.isNotOnBranch()
        ? currentVertex.getPoint()
        : currentVertex.getNextPoint();
    branch.addLine(
      lastPoint,
      currentPoint,
      vertex.hash,
      parentVertex.hash,
      lastPoint.laneIndex < currentPoint.laneIndex,
    );
    currentVertex.reservePoint(currentPoint.laneIndex, parentVertex, branch);
    lastPoint = currentPoint;
    if (parentVertex === currentVertex) {
      vertex.registerParentProcessed();
      const parentWasAlreadyOnBranch = !parentVertex.isNotOnBranch();
      parentVertex.addToBranch(branch, currentPoint.laneIndex);
      vertex = parentVertex;
      parentVertex = vertex.getNextParent();
      if (parentVertex === missingParent) {
        vertex.registerParentProcessed();
        break;
      }
      if (parentVertex === null || parentWasAlreadyOnBranch) break;
    }
  }
  branch.endRowIndex = rowIndex;
  branches.push(branch);
  availableColours[branch.colourIndex] = rowIndex;
}

function determinePath(params) {
  const vertex = params.vertices[params.startAt];
  const parentVertex = vertex.getNextParent();
  if (parentVertex === params.missingParent) {
    vertex.registerParentProcessed();
    return;
  }
  if (
    parentVertex !== null &&
    vertex.isMerge() &&
    !vertex.isNotOnBranch() &&
    !parentVertex.isNotOnBranch()
  ) {
    determineMergePath(params.startAt, params.vertices, vertex, parentVertex);
    return;
  }
  determineNormalPath(params);
}

function createGitGraphLayoutModel(commits) {
  const { missingParent, vertices, vertexByHash } = createVertices(commits);
  const branches = [];
  const availableColours = [];
  let index = 0;
  while (index < vertices.length) {
    const vertex = vertices[index];
    if (vertex.getNextParent() !== null || vertex.isNotOnBranch()) {
      determinePath({ startAt: index, vertices, branches, availableColours, missingParent });
    } else {
      index += 1;
    }
  }
  return {
    vertices,
    vertexByHash,
    branchLines: branches.flatMap((branch) => branch.lines),
  };
}

function buildEdgePath({ fromX, fromY, toX, toY, lockedFirst }) {
  if (fromX === toX) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }
  const curveOffset = Math.max(14, Math.abs(toY - fromY) * 0.38);
  if (lockedFirst === false) {
    return `M ${fromX} ${fromY} C ${fromX} ${toY - curveOffset}, ${toX} ${toY - curveOffset}, ${toX} ${toY}`;
  }
  return `M ${fromX} ${fromY} C ${fromX} ${fromY + curveOffset}, ${toX} ${fromY + curveOffset}, ${toX} ${toY}`;
}

function pointToPixels(point, opts) {
  return {
    x: opts.lanePadding + point.laneIndex * opts.laneGap,
    y: opts.topPadding + point.rowIndex * opts.rowHeight,
  };
}

/**
 * @typedef {object} DetailedRow
 * @property {string} hash
 * @property {number} rowIndex
 * @property {number} laneIndex
 * @property {number} x
 * @property {number} y
 *
 * @typedef {object} DetailedEdge
 * @property {string} id
 * @property {string} fromHash
 * @property {string} toHash
 * @property {number} fromLaneIndex
 * @property {number} toLaneIndex
 * @property {string} path
 * @property {boolean} truncated
 *
 * @typedef {object} DetailedPath
 * @property {string} id
 * @property {number} laneIndex
 * @property {string} path
 * @property {string[]} relatedHashes
 *
 * @typedef {object} DetailedLaneSegment
 * @property {string} id
 * @property {string} hash
 * @property {number} laneIndex
 * @property {string} path
 *
 * @typedef {object} DetailedGraphLayout
 * @property {DetailedRow[]} rows
 * @property {DetailedEdge[]} edges
 * @property {DetailedPath[]} paths
 * @property {DetailedLaneSegment[]} laneSegments
 * @property {number} laneCount
 * @property {number} width
 * @property {number} height
 * @property {number} rowHeight
 * @property {number} laneGap
 */

/**
 * ZCode-aligned wrapper around the algorithm. Returns the rich structure the
 * client needs to render the graph as a single SVG canvas: rows with x/y
 * pixel coordinates, full SVG path strings per edge, the complete set of
 * branch paths for hover highlighting, and vertical-only lane segments.
 *
 * Equivalent to upstream `layoutGitGraph`; renamed so the existing
 * `createGitGraphLayoutModel` export below keeps its original name.
 * @param {GraphCommit[]} commits
 * @param {LayoutOptions} [options]
 * @returns {DetailedGraphLayout}
 */
function layoutGitGraphDetailed(commits, options = {}) {
  const rowHeight = options.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const laneGap = options.laneGap ?? DEFAULT_LANE_GAP;
  const lanePadding = options.lanePadding ?? DEFAULT_LANE_PADDING;
  const topPadding = options.topPadding ?? DEFAULT_TOP_PADDING;
  const bottomPadding = options.bottomPadding ?? DEFAULT_BOTTOM_PADDING;

  const { vertices, vertexByHash, branchLines } = createGitGraphLayoutModel(commits);

  const rows = vertices.map((vertex, rowIndex) => {
    const laneIndex = vertex.getLaneIndex();
    return {
      hash: commits[rowIndex].hash,
      rowIndex,
      laneIndex,
      x: lanePadding + laneIndex * laneGap,
      y: topPadding + rowIndex * rowHeight,
    };
  });

  const rowByHash = new Map(rows.map((row) => [row.hash, row]));
  const pixelOptions = { lanePadding, laneGap, topPadding, rowHeight };

  const maxRowLaneIndex = rows.reduce((max, r) => Math.max(max, r.laneIndex), 0);
  const maxWidthLaneIndex = vertices.reduce(
    (max, vertex) => Math.max(max, vertex.getWidthLaneIndex() - 1),
    0,
  );
  const maxLineLaneIndex = branchLines.reduce(
    (max, line) => Math.max(max, line.from.laneIndex, line.to.laneIndex),
    0,
  );
  const laneCount = Math.max(1, maxRowLaneIndex + 1, maxWidthLaneIndex + 1, maxLineLaneIndex + 1);
  const width = lanePadding * 2 + (laneCount - 1) * laneGap;
  const height = topPadding + Math.max(0, commits.length - 1) * rowHeight + bottomPadding;

  /** @type {DetailedEdge[]} */
  const edges = [];
  for (let rowIndex = 0; rowIndex < commits.length; rowIndex += 1) {
    const commit = commits[rowIndex];
    const fromVertex = vertexByHash.get(commit.hash);
    if (!fromVertex) continue;
    const fromRow = rows[rowIndex];
    for (let parentIndex = 0; parentIndex < commit.parents.length; parentIndex += 1) {
      const parentHash = commit.parents[parentIndex];
      const parentVertex = vertexByHash.get(parentHash);
      const fromLaneIndex = fromVertex.getLaneIndex();
      const toLaneIndex = parentVertex ? parentVertex.getLaneIndex() : fromLaneIndex + parentIndex;
      const toRow = parentHash ? rowByHash.get(parentHash) : null;
      const fromX = lanePadding + fromLaneIndex * laneGap;
      const toX = lanePadding + toLaneIndex * laneGap;
      edges.push({
        id: `${commit.hash}:${parentHash}:${parentIndex}`,
        fromHash: commit.hash,
        toHash: parentHash,
        fromLaneIndex,
        toLaneIndex,
        path: buildEdgePath({
          fromX,
          fromY: fromRow.y,
          toX,
          toY: toRow ? toRow.y : fromRow.y,
          lockedFirst: fromLaneIndex < toLaneIndex,
        }),
        truncated: !toRow,
      });
    }
  }

  /** @type {DetailedPath[]} */
  const paths = branchLines.map((line, index) => {
    const from = pointToPixels(line.from, pixelOptions);
    const to = pointToPixels(line.to, pixelOptions);
    return {
      id: `${line.sourceHash}:${line.targetHash}:${line.from.rowIndex}:${line.to.rowIndex}:${index}:path`,
      laneIndex: line.laneIndex,
      path: buildEdgePath({
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
        lockedFirst: line.lockedFirst,
      }),
      relatedHashes:
        line.sourceHash === line.targetHash
          ? [line.sourceHash]
          : [line.sourceHash, line.targetHash],
    };
  });

  /** @type {DetailedLaneSegment[]} */
  const laneSegments = branchLines
    .filter((line) => line.from.laneIndex === line.to.laneIndex)
    .map((line, index) => {
      const from = pointToPixels(line.from, pixelOptions);
      const to = pointToPixels(line.to, pixelOptions);
      return {
        id: `${line.sourceHash}:${line.targetHash}:${line.from.rowIndex}:${line.to.rowIndex}:${index}:segment`,
        hash: line.targetHash,
        laneIndex: line.to.laneIndex,
        path: buildEdgePath({
          fromX: from.x,
          fromY: from.y,
          toX: to.x,
          toY: to.y,
          lockedFirst: line.lockedFirst,
        }),
      };
    });

  return {
    rows,
    edges,
    paths,
    laneSegments,
    laneCount,
    width,
    height,
    rowHeight,
    laneGap,
  };
}

export {
  createGitGraphLayoutModel,
  layoutGitGraphDetailed,
  DEFAULT_ROW_HEIGHT,
  DEFAULT_LANE_GAP,
  DEFAULT_LANE_PADDING,
};