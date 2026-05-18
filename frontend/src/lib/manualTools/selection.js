export const POINT_TYPES = new Set(['point', 'glider', 'midpoint', 'intersection', 'otherintersection', 'circumcenter']);
export const LINE_TYPES = ['segment', 'line', 'parallel', 'perpendicular', 'bisector', 'tangent'];
const CIRCLE_PATH_TYPES = new Set(['circle', 'circumcircle', 'incircle']);
export const PATH_TYPES = new Set([...LINE_TYPES, ...CIRCLE_PATH_TYPES, 'ellipse', 'functiongraph']);
export const SELECTABLE_TYPES = new Set([...POINT_TYPES, ...LINE_TYPES, ...CIRCLE_PATH_TYPES, 'ellipse', 'functiongraph', 'polygon', 'angle']);

export const PATH_SNAP_RADIUS_PX = 6;
export const PATH_SELECT_RADIUS_PX = 12;

export function isRegisteredSelectableElement(element, registry) {
  return Boolean(
    element &&
    element.visProp?.visible !== false &&
    registry?.idForObject(element)
  );
}

export function classifySelectableElement(element) {
  if (!element) {
    return null;
  }
  if (POINT_TYPES.has(element.elType)) {
    return 'point';
  }
  if (PATH_TYPES.has(element.elType)) {
    return 'path';
  }
  if (SELECTABLE_TYPES.has(element.elType)) {
    return 'shape';
  }
  return null;
}

export function isCirclePathElement(element) {
  return CIRCLE_PATH_TYPES.has(element?.elType);
}

export function chooseTargetFromElements(elements, registry, options = {}) {
  const registeredElements = (elements || []).filter((element) => isRegisteredSelectableElement(element, registry));
  const point = registeredElements.find((element) => POINT_TYPES.has(element.elType));
  if (point) {
    return { type: 'point', obj: point };
  }

  const path = registeredElements.find((element) => PATH_TYPES.has(element.elType));
  if (path) {
    return { type: 'path', obj: path };
  }

  if (options.includeShapes) {
    const shape = registeredElements.find((element) => SELECTABLE_TYPES.has(element.elType));
    if (shape) {
      return { type: classifySelectableElement(shape), obj: shape };
    }
  }

  return null;
}

export function preferPointSnapTarget(current, candidate) {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }
  if (candidate.type === 'point' && current.type !== 'point') {
    return candidate;
  }
  if (candidate.type === current.type && candidate.distance < current.distance) {
    return candidate;
  }
  return current;
}

export function shouldUseSnapping(event) {
  return event?.shiftKey !== true;
}

export function isWithinSnapRadius(distance, radius) {
  return Number.isFinite(distance) && distance <= radius;
}

export function getCircleSnapDistancePx(circle, mouse, toScreenCoords) {
  if (!isCirclePathElement(circle) || typeof toScreenCoords !== 'function') {
    return Number.POSITIVE_INFINITY;
  }
  if (!circle.center || typeof circle.center.X !== 'function' || typeof circle.center.Y !== 'function') {
    return Number.POSITIVE_INFINITY;
  }
  if (typeof circle.Radius !== 'function') {
    return Number.POSITIVE_INFINITY;
  }

  const center = { x: circle.center.X(), y: circle.center.Y() };
  const radius = circle.Radius();
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y) || !Number.isFinite(radius) || radius <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  const mouseScreen = toScreenCoords(mouse);
  const centerScreen = toScreenCoords(center);
  const edgeScreen = toScreenCoords({ x: center.x + radius, y: center.y });
  const screenRadius = Math.hypot(edgeScreen.x - centerScreen.x, edgeScreen.y - centerScreen.y);
  const mouseDistance = Math.hypot(mouseScreen.x - centerScreen.x, mouseScreen.y - centerScreen.y);

  return Math.abs(mouseDistance - screenRadius);
}
