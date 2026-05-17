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
  if (!element || element.hasLabel === false) {
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

export function collectPointLabelOverlays(board) {
  if (!board?.objects) {
    return [];
  }

  return Object.values(board.objects)
    .filter((obj) => (obj?.elType === 'point' || obj?.elType === 'glider') && isVisible(obj) && isVisible(obj.label))
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
    const pointIds = [];
    const circleCenterIds = [];
    for (const id in board.objects) {
      const obj = board.objects[id];
      if (obj.elType === 'point' || obj.elType === 'glider') {
        pointIds.push(obj.id);
        
        // Check if this point is a center of a circle
        const isCenter = Object.values(board.objects).some(o => 
          o.elType === 'circle' && o.center === obj
        );
        if (isCenter) {
          circleCenterIds.push(obj.id);
        }
      }
    }

    const rawSvg = decodeDataUri(board.renderer.dumpToDataURI(true));
    const processor = new SVGProcessor(rawSvg);
    return processor.processForExam({ ...selection, board, pointIds, circleCenterIds, pointLabels });
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
