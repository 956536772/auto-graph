const MIN_SIZE = 0.05;

function signWithFallback(value, fallback = 1) {
  if (value === 0) {
    return fallback;
  }
  return value > 0 ? 1 : -1;
}

export function isValidSize(value) {
  return Math.abs(value) > MIN_SIZE;
}

export function buildCircleDefinition(center, edge) {
  const dx = edge.x - center.x;
  const dy = edge.y - center.y;
  const radius = Math.hypot(dx, dy);

  return {
    cx: center.x,
    cy: center.y,
    radius,
    edge: {
      x: edge.x,
      y: edge.y
    },
    valid: isValidSize(radius)
  };
}

export function buildRectangleVertices(start, end, forceSquare = false) {
  let dx = end.x - start.x;
  let dy = end.y - start.y;

  if (forceSquare) {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    dx = signWithFallback(dx) * size;
    dy = signWithFallback(dy, -1) * size;
  }

  const v2 = { x: start.x + dx, y: start.y };
  const v3 = { x: start.x + dx, y: start.y + dy };
  const v4 = { x: start.x, y: start.y + dy };

  return {
    vertices: [start, v2, v3, v4],
    valid: isValidSize(dx) && isValidSize(dy)
  };
}

export function buildIsoscelesTriangleVertices(start, end, forceEquilateral = false) {
  const baseDx = end.x - start.x;
  const basePoint = { x: end.x, y: start.y };
  let apexY = end.y;

  if (forceEquilateral) {
    const sideLength = Math.abs(baseDx);
    const height = (Math.sqrt(3) * sideLength) / 2;
    apexY = start.y + signWithFallback(end.y - start.y, -1) * height;
  }

  const apex = {
    x: start.x + baseDx / 2,
    y: apexY
  };

  return {
    vertices: [start, basePoint, apex],
    valid: isValidSize(baseDx) && isValidSize(apexY - start.y)
  };
}

export function sameGeometryObject(first, second) {
  if (!first || !second) {
    return false;
  }
  if (first === second) {
    return true;
  }
  if (first.registryId && second.registryId) {
    return first.registryId === second.registryId;
  }
  return false;
}

export function buildPolygonInstructionsFromVertices(vertices, prefix, options) {
  const { nextId, nextLabel } = options;
  const pointInstructions = vertices.map((vertex) => ({
    action: 'place_point',
    params: { x: vertex.x, y: vertex.y },
    result_id: nextId(`${prefix}_point`),
    label: nextLabel()
  }));
  const segmentInstructions = pointInstructions.map((instruction, index) => {
    const nextInstruction = pointInstructions[(index + 1) % pointInstructions.length];
    return {
      action: 'segment',
      params: {
        p1: instruction.result_id,
        p2: nextInstruction.result_id
      },
      result_id: nextId(`${prefix}_segment`)
    };
  });

  return [
    ...pointInstructions,
    ...segmentInstructions,
    {
      action: 'polygon',
      params: {
        points: pointInstructions.map((instruction) => instruction.result_id)
      },
      result_id: nextId(prefix),
      meta: {
        closedSegmentIds: segmentInstructions.map((instruction) => instruction.result_id)
      }
    }
  ];
}

export function getToolSwitchStatus(previousTool, nextTool, selectTool) {
  if (nextTool === selectTool) {
    return `已取消${previousTool}操作，回到选择模式`;
  }
  return `已取消${previousTool}操作，切换到${nextTool}`;
}
