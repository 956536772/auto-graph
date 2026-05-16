const POINT_TYPES = new Set(['point', 'glider']);
const LINE_TYPES = ['segment', 'line', 'parallel', 'perpendicular', 'bisector', 'tangent'];
const PATH_TYPES = new Set([...LINE_TYPES, 'circle', 'ellipse']);
const SELECTABLE_TYPES = new Set(['point', 'glider', ...LINE_TYPES, 'circle', 'ellipse', 'polygon', 'angle']);

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
