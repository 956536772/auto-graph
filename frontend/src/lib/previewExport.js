import { SVGProcessor } from './SVGProcessor.js';

function decodeDataUri(dataUri) {
  const match = /^data:image\/svg\+xml(?:;charset=[^;,]+)?(?<base64>;base64)?,(?<payload>[\s\S]*)$/i.exec(dataUri);
  if (!match?.groups?.payload) {
    throw new Error('无法读取画布 SVG 数据');
  }

  if (match.groups.base64) {
    const binary = atob(match.groups.payload);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  }

  return decodeURIComponent(match.groups.payload);
}

function readTextDisplay(board) {
  return board?.options?.text?.display ?? 'html';
}

function setTextDisplay(board, display) {
  if (display === undefined) {
    return;
  }
  board.setAttribute({ text: { display } });
}

function isVisible(element) {
  return element?.visPropCalc?.visible ?? element?.visProp?.visible ?? true;
}

function readElementLabel(element) {
  if (!element) {
    return '';
  }
  if (element.hasLabel === false && !isGeneratedCircleCenter(element)) {
    return '';
  }
  if (typeof element.getName === 'function') {
    return element.getName() || '';
  }
  return element.name || element.label?.plaintext || '';
}

function readScreenPosition(element) {
  const screenCoords = element?.coords?.scrCoords;
  if (Array.isArray(screenCoords) && Number.isFinite(screenCoords[1]) && Number.isFinite(screenCoords[2])) {
    return { x: screenCoords[1], y: screenCoords[2] };
  }
  return null;
}

function readLabelScreenPosition(element) {
  const labelPosition = readScreenPosition(element?.label);
  if (labelPosition) {
    return labelPosition;
  }

  const pointPosition = readScreenPosition(element);
  if (!pointPosition) {
    return null;
  }

  return { x: pointPosition.x + 10, y: pointPosition.y - 10 };
}

function hasVisibleLabelText(element) {
  return isVisible(element?.label) && Boolean(readElementLabel(element).trim());
}

const POINT_ELEMENT_TYPES = new Set([
  'point',
  'glider',
  'midpoint',
  'intersection',
  'otherintersection',
  'circumcenter'
]);

function isPointElement(element) {
  return POINT_ELEMENT_TYPES.has(element?.elType) || isGeneratedCircleCenter(element);
}

function getPointExportIds(element) {
  return [element?.id, element?.registryId].filter(Boolean);
}

function isGeneratedCircleCenter(element) {
  return Boolean(element?.meta?.generatedCircleCenterFor);
}

function isCircleLikeElement(element) {
  return element?.elType === 'circle' || element?.elType === 'circumcircle' || element?.elType === 'incircle';
}

function isCircleCenterElement(element, objects) {
  return objects.some((candidate) => isCircleLikeElement(candidate) && candidate.center === element);
}

export function collectVisibleCircleCenterIds(board) {
  if (!board?.objects) {
    return [];
  }

  const objects = Object.values(board.objects);
  return objects
    .filter((obj) => (
      obj.id &&
      hasVisibleLabelText(obj) &&
      isCircleCenterElement(obj, objects)
    ))
    .map((obj) => obj.id);
}

function getGliderPath(glider) {
  return glider?.slideObject || glider?.path || glider?.onPolygon || null;
}

function isCircleLikePath(path) {
  return path?.elType === 'circle' || path?.elType === 'circumcircle' || path?.elType === 'incircle';
}

export function collectVisibleCirclePointIds(board) {
  if (!board?.objects) {
    return [];
  }

  return Object.values(board.objects)
    .filter((obj) => (
      obj?.elType === 'glider' &&
      obj.id &&
      isVisible(obj) &&
      isCircleLikePath(getGliderPath(obj))
    ))
    .map((obj) => obj.id);
}

export function collectVisibleExplicitPointIds(board) {
  if (!board?.objects) {
    return [];
  }

  const objects = Object.values(board.objects);
  return Object.values(board.objects)
    .filter((obj) => (
      isPointElement(obj) &&
      obj.id &&
      obj.registryId &&
      isVisible(obj) &&
      !isClosedShapeVertex(obj, objects)
    ))
    .map((obj) => obj.id);
}

function isClosedShapeVertex(point, objects) {
  return objects.some((candidate) => (
    candidate?.elType === 'polygon' &&
    Array.isArray(candidate.vertices) &&
    candidate.vertices.includes(point)
  ));
}

export function collectPointLabelOverlays(board) {
  if (!board?.objects) {
    return [];
  }

  const objects = Object.values(board.objects);
  return objects
    .filter((obj) => (
      (isPointElement(obj) || isCircleCenterElement(obj, objects)) &&
      isVisible(obj) &&
      isVisible(obj.label)
    ))
    .map((obj) => {
      const text = readElementLabel(obj).trim();
      const screenPosition = readLabelScreenPosition(obj);
      if (!text || !screenPosition || typeof obj.X !== 'function' || typeof obj.Y !== 'function') {
        return null;
      }

      return {
        text,
        x: screenPosition.x,
        y: screenPosition.y,
        anchorX: obj.X(),
        anchorY: obj.Y(),
        fontSize: Number.parseFloat(obj.label?.visProp?.fontsize) || 16
      };
    })
    .filter(Boolean);
}

export function exportBoardPreviewSvg({ board, selection }) {
  if (!board?.renderer?.dumpToDataURI) {
    throw new Error('画布还未准备好');
  }

  const oldTextDisplay = readTextDisplay(board);
  const oldGridsVisible = board.grids ? board.grids.map(g => g.visProp.visible) : [];

  try {
    setTextDisplay(board, 'internal');
    if (board.grids) {
      board.grids.forEach(g => g.setAttribute({ visible: false }));
    }
    board.update();

    const pointLabels = collectPointLabelOverlays(board);

    // Pass true to ignoreTexts to prevent foreignObject tags which taint the canvas
    // Collect all point IDs to remove them in the processor
    const circleCenterIds = collectVisibleCircleCenterIds(board);
    const circlePointIds = collectVisibleCirclePointIds(board);
    const explicitPointIds = collectVisibleExplicitPointIds(board);
    const objects = Object.values(board.objects || {});
    const idAliasesByPrimaryId = new Map();
    for (const obj of objects) {
      if (isPointElement(obj)) {
        idAliasesByPrimaryId.set(obj.id, getPointExportIds(obj));
      }
    }
    const expandIds = (ids) => [...new Set(ids.flatMap((id) => idAliasesByPrimaryId.get(id) || [id]))];
    const expandedCircleCenterIds = expandIds(circleCenterIds);
    const expandedCirclePointIds = expandIds(circlePointIds);
    const expandedExplicitPointIds = expandIds(explicitPointIds);
    const pointIds = [...expandedCircleCenterIds];
    for (const obj of objects) {
      if (isPointElement(obj)) {
        pointIds.push(...getPointExportIds(obj));
      }
    }

    const rawSvg = decodeDataUri(board.renderer.dumpToDataURI(true));
    const processor = new SVGProcessor(rawSvg);
    return processor.processForExam({
      ...selection,
      board,
      pointIds: [...new Set(pointIds)],
      circleCenterIds: expandedCircleCenterIds,
      circlePointIds: expandedCirclePointIds,
      explicitPointIds: expandedExplicitPointIds,
      pointLabels
    });
  } finally {
    setTextDisplay(board, oldTextDisplay);
    if (board.grids) {
      board.grids.forEach((g, i) => g.setAttribute({ visible: oldGridsVisible[i] }));
    }
    board.update();
  }
}

export function svgToObjectUrl(svg) {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  return URL.createObjectURL(blob);
}
