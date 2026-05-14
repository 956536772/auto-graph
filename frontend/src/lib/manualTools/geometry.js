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

export function buildEllipseDefinition(start, end, forceCircle = false) {
  let dx = end.x - start.x;
  let dy = end.y - start.y;

  if (forceCircle) {
    const radius = Math.max(Math.abs(dx), Math.abs(dy));
    dx = signWithFallback(dx) * radius;
    dy = signWithFallback(dy, -1) * radius;
  }

  const rx = Math.abs(dx) / 2;
  const ry = Math.abs(dy) / 2;
  const cx = start.x + dx / 2;
  const cy = start.y + dy / 2;
  const horizontalMajorAxis = rx >= ry;
  const focusOffset = Math.sqrt(Math.max(horizontalMajorAxis ? rx * rx - ry * ry : ry * ry - rx * rx, 0));
  const f1 = horizontalMajorAxis ? { x: cx - focusOffset, y: cy } : { x: cx, y: cy - focusOffset };
  const f2 = horizontalMajorAxis ? { x: cx + focusOffset, y: cy } : { x: cx, y: cy + focusOffset };

  return {
    cx,
    cy,
    rx,
    ry,
    majorAxis: horizontalMajorAxis ? 2 * rx : 2 * ry,
    f1,
    f2,
    valid: isValidSize(rx) && isValidSize(ry)
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
