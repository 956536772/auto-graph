const EXAM_POINT_MARKER_RADIUS = '3';
const EXAM_GEOMETRY_STROKE_WIDTH = '2';

export class SVGProcessor {
  constructor(svgString) {
    const parser = new DOMParser();
    this.doc = parser.parseFromString(svgString, 'image/svg+xml');
    this.svg = this.doc.documentElement;
    if (this.svg?.nodeName === 'parsererror' || this.doc.querySelector('parsererror')) {
      throw new Error('画布 SVG 解析失败');
    }
  }

  processForExam({ xmin, xmax, ymin, ymax, board, pointIds = [], circleCenterIds = [], circlePointIds = [], explicitPointIds = [], pointLabels = [] }) {
    if (!Number.isFinite(xmin) || !Number.isFinite(xmax) || !Number.isFinite(ymin) || !Number.isFinite(ymax)) {
      throw new Error('预览选区坐标无效');
    }
    if (!board) {
      throw new Error('画布还未准备好');
    }

    const left = Math.min(xmin, xmax);
    const right = Math.max(xmin, xmax);
    const bottom = Math.min(ymin, ymax);
    const top = Math.max(ymin, ymax);

    // 1. Remove background, grid, axes, logo, navigation and infobox
    const selectorsToRemove = [
      '.JXGgrid',
      '.JXGticks',
      '.jxg-axis',
      '.jxg-ticks',
      '.JXGlogo',
      '.JXGnavigation',
      '.JXGinfobox',
      '.jxgbox_navigationbutton',
      '.jxgbox_copyright',
      'foreignObject',
      'rect[class*="background"]'
    ];

    selectorsToRemove.forEach(selector => {
      this.svg.querySelectorAll(selector).forEach(el => el.remove());
    });

    // Remove elements by common ID patterns (Axes, navigation, license, points)
    const allElems = Array.from(this.svg.querySelectorAll('*'));
    allElems.forEach(el => {
      const id = el.getAttribute('id') || '';

      // Remove system elements
      if (id.includes('Axis') || id.includes('license') || id.includes('navigation') || id.includes('copyright')) {
        el.remove();
        return;
      }

      // Handle points
      // JSXGraph SVG IDs are usually boardID_elementID
      const pidMatch = pointIds.find(pid => id === pid || id.endsWith('_' + pid));
      if (pidMatch) {
        if (el.tagName.toLowerCase() !== 'text') {
          // Keep explicit user/AI points in the exam preview while hiding unregistered auxiliary points.
          const isCircleCenter = circleCenterIds.includes(pidMatch);
          const isCirclePoint = circlePointIds.includes(pidMatch);
          const isExplicitPoint = explicitPointIds.includes(pidMatch);
          if (isCircleCenter || isCirclePoint || isExplicitPoint) {
            el.setAttribute('fill', 'black');
            el.setAttribute('stroke', 'black');
            el.setAttribute('stroke-width', '0');
            const tagName = el.tagName.toLowerCase();
            if (tagName === 'circle') {
              el.setAttribute('r', EXAM_POINT_MARKER_RADIUS);
            } else if (tagName === 'ellipse') {
              el.setAttribute('rx', EXAM_POINT_MARKER_RADIUS);
              el.setAttribute('ry', EXAM_POINT_MARKER_RADIUS);
            }
          } else {
            // Remove other points
            el.remove();
          }
          return;
        }
      }

      // Also remove elements with very light stroke (typical for grids)
      const stroke = el.getAttribute('stroke')?.toLowerCase();
      if (stroke === '#cccccc' || stroke === '#eeeeee' || stroke === '#dcdcdc') {
        el.remove();
      }
    });

    // 2. Force all strokes to black and fills to transparent/white
    const allElements = this.svg.querySelectorAll('path, circle, line, polygon, ellipse, text');
    allElements.forEach(el => {
      const tagName = el.tagName.toLowerCase();
      const id = el.getAttribute('id') || '';
      const isCircleCenter = circleCenterIds.some(pid => id === pid || id.endsWith('_' + pid));
      const isCirclePoint = circlePointIds.some(pid => id === pid || id.endsWith('_' + pid));
      const isExplicitPoint = explicitPointIds.some(pid => id === pid || id.endsWith('_' + pid));

      if (tagName === 'text') {
        el.setAttribute('fill', 'black');
        el.setAttribute('stroke', 'none');
        el.style.fontFamily = '"Times New Roman", Times, serif';
        el.style.fontSize = (parseFloat(el.style.fontSize) || 12) + 'px';
        el.style.fontWeight = 'bold';
      } else if (!isCircleCenter && !isCirclePoint && !isExplicitPoint) {
        // Skip restyling if it's a kept point (already styled above)
        const currentStroke = el.getAttribute('stroke');
        if (currentStroke && currentStroke !== 'none') {
          el.setAttribute('stroke', 'black');
          el.setAttribute('stroke-width', EXAM_GEOMETRY_STROKE_WIDTH);
        }

        const currentFill = el.getAttribute('fill');
        if (currentFill && currentFill !== 'none' && currentFill !== 'transparent') {
          // For angles and other filled areas, use a light gray or no fill
          if (el.classList.contains('JXGangle') || el.classList.contains('JXGsector')) {
            el.setAttribute('fill', '#eeeeee');
            el.setAttribute('fill-opacity', '1');
          } else {
            el.setAttribute('fill', 'none');
          }
        }
      }
    });

    // 3. Set viewBox for cropping with a small padding
    const pTopLeft = this.toScreenCoords(board, { x: left, y: top });
    const pBottomRight = this.toScreenCoords(board, { x: right, y: bottom });

    // Screen coordinates in JSXGraph are [1] = x, [2] = y
    let x = pTopLeft.x;
    let y = pTopLeft.y;
    let width = pBottomRight.x - x;
    let height = pBottomRight.y - y;

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 1 || height <= 1) {
      throw new Error('预览选区太小，请重新框选区域');
    }

    // Add 10% padding to accommodate labels which are usually outside the points
    const paddingX = width * 0.1;
    const paddingY = height * 0.1;
    x -= paddingX;
    y -= paddingY;
    width += paddingX * 2;
    height += paddingY * 2;

    const labelsInSelection = this.filterLabelsInSelection(pointLabels, { left, right, bottom, top });
    const expandedBox = this.expandBoxForLabels({ x, y, width, height }, labelsInSelection);
    x = expandedBox.x;
    y = expandedBox.y;
    width = expandedBox.width;
    height = expandedBox.height;

    this.svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
    this.svg.setAttribute('width', width);
    this.svg.setAttribute('height', height);
    this.svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    // Add white background
    const bgRect = this.doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('x', x);
    bgRect.setAttribute('y', y);
    bgRect.setAttribute('width', width);
    bgRect.setAttribute('height', height);
    bgRect.setAttribute('fill', 'white');
    this.svg.insertBefore(bgRect, this.svg.firstChild);

    this.appendPointLabels(labelsInSelection);

    // 4. Force all text to be visible and black
    this.svg.querySelectorAll('text').forEach(el => {
      el.setAttribute('fill', 'black');
      el.setAttribute('stroke', 'none');
      el.setAttribute('visibility', 'visible');
      el.style.visibility = 'visible';
      el.style.display = 'inline';
      el.style.fontFamily = '"Times New Roman", Times, serif';

      // Ensure font size is readable
      const currentSize = parseFloat(el.getAttribute('font-size')) || parseFloat(el.style.fontSize) || 16;
      el.setAttribute('font-size', Math.max(currentSize, 14));
      el.style.fontSize = Math.max(currentSize, 14) + 'px';
      el.style.fontWeight = 'bold';
    });

    return new XMLSerializer().serializeToString(this.svg);
  }

  toScreenCoords(board, coords) {
    if (!board.origin?.scrCoords || !Number.isFinite(board.unitX) || !Number.isFinite(board.unitY)) {
      throw new Error('画布坐标系统未准备好');
    }

    return {
      x: board.origin.scrCoords[1] + coords.x * board.unitX,
      y: board.origin.scrCoords[2] - coords.y * board.unitY
    };
  }

  filterLabelsInSelection(pointLabels, bounds) {
    return (pointLabels || []).filter((label) => {
      if (!label?.text || !Number.isFinite(label.x) || !Number.isFinite(label.y)) {
        return false;
      }
      if (!Number.isFinite(label.anchorX) || !Number.isFinite(label.anchorY)) {
        return true;
      }
      return (
        label.anchorX >= bounds.left &&
        label.anchorX <= bounds.right &&
        label.anchorY >= bounds.bottom &&
        label.anchorY <= bounds.top
      );
    });
  }

  expandBoxForLabels(box, labels) {
    if (!labels.length) {
      return box;
    }

    let minX = box.x;
    let minY = box.y;
    let maxX = box.x + box.width;
    let maxY = box.y + box.height;

    labels.forEach((label) => {
      const fontSize = Number.isFinite(label.fontSize) ? label.fontSize : 16;
      const estimatedWidth = Math.max(12, label.text.length * fontSize * 0.7);
      minX = Math.min(minX, label.x - fontSize * 0.4);
      minY = Math.min(minY, label.y - fontSize * 1.2);
      maxX = Math.max(maxX, label.x + estimatedWidth);
      maxY = Math.max(maxY, label.y + fontSize * 0.6);
    });

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  appendPointLabels(labels) {
    labels.forEach((label) => {
      const text = this.doc.createElementNS('http://www.w3.org/2000/svg', 'text');
      const fontSize = Math.max(Number.isFinite(label.fontSize) ? label.fontSize : 16, 14);

      text.setAttribute('x', label.x);
      text.setAttribute('y', label.y);
      text.setAttribute('fill', 'black');
      text.setAttribute('stroke', 'none');
      text.setAttribute('font-family', '"Times New Roman", Times, serif');
      text.setAttribute('font-size', fontSize);
      text.setAttribute('font-weight', 'bold');
      text.textContent = label.text;

      this.svg.appendChild(text);
    });
  }
}
