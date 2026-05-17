import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import { ShapeRegistry } from '../src/lib/ShapeRegistry.js';
import { collectPointLabelOverlays, exportBoardPreviewSvg } from '../src/lib/previewExport.js';
import { TOOLS } from '../src/lib/manualTools/constants.js';
import {
  buildCircleDefinition,
  buildIsoscelesTriangleVertices,
  buildPolygonInstructionsFromVertices,
  buildRectangleVertices,
  getToolSwitchStatus
} from '../src/lib/manualTools/geometry.js';
import { chooseTargetFromElements, preferPointSnapTarget } from '../src/lib/manualTools/selection.js';

class FakeSvgElement {
  constructor(tagName, textContent = '') {
    this.tagName = tagName;
    this.nodeName = tagName;
    this.textContent = textContent;
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.removed = false;
    this.classList = {
      contains: () => false
    };
  }

  get firstChild() {
    return this.children.find((child) => !child.removed) || null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  insertBefore(child) {
    this.children.unshift(child);
    return child;
  }

  remove() {
    this.removed = true;
  }

  querySelectorAll(selector) {
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll('*')]);
    const liveDescendants = descendants.filter((child) => !child.removed);

    if (selector === '*') {
      return liveDescendants;
    }

    const tagNames = selector
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => /^[a-z]+$/.test(item));

    if (tagNames.length > 0) {
      return liveDescendants.filter((child) => tagNames.includes(child.tagName.toLowerCase()));
    }

    return [];
  }

  toString() {
    if (this.removed) {
      return '';
    }

    const attrs = Object.entries(this.attributes)
      .map(([key, value]) => `${key}="${value}"`)
      .join(' ');
    const openTag = attrs ? `<${this.tagName} ${attrs}>` : `<${this.tagName}>`;
    const content = `${this.textContent}${this.children.map((child) => child.toString()).join('')}`;
    return `${openTag}${content}</${this.tagName}>`;
  }
}

globalThis.DOMParser = class {
  parseFromString(svgString) {
    const root = new FakeSvgElement('svg');
    const textMatches = svgString.matchAll(/<text[^>]*>(.*?)<\/text>/g);
    for (const match of textMatches) {
      root.appendChild(new FakeSvgElement('text', match[1]));
    }

    return {
      documentElement: root,
      querySelector: () => null,
      createElementNS: (_namespace, tagName) => new FakeSvgElement(tagName)
    };
  }
};

globalThis.XMLSerializer = class {
  serializeToString(node) {
    return node.toString();
  }
};

globalThis.atob = (value) => Buffer.from(value, 'base64').toString('binary');
globalThis.TextDecoder = globalThis.TextDecoder || (await import('node:util')).TextDecoder;

function createObject(id) {
  return { id };
}

test('ShapeRegistry keeps batched registrations in one undo step', () => {
  const registry = new ShapeRegistry();
  const removed = [];
  const board = {
    removeObject(object) {
      removed.push(object.registryId);
    }
  };

  registry.beginUndoBatch();
  registry.register('A', createObject('A'));
  registry.register('B', createObject('B'));
  registry.endUndoBatch();

  assert.deepEqual(registry.history, ['A', 'B']);
  assert.equal(registry.undo(board), 'A');
  assert.deepEqual(removed, ['B', 'A']);
  assert.deepEqual(registry.history, []);

  assert.equal(registry.redo(board), 'A');
  assert.deepEqual(registry.history, ['A', 'B']);
});

test('ShapeRegistry can merge provisional steps into one undo step', () => {
  const registry = new ShapeRegistry();
  const removed = [];
  const board = {
    removeObject(object) {
      removed.push(object.registryId);
    }
  };

  registry.register('P1', createObject('P1'));
  registry.register('P2', createObject('P2'));
  registry.beginUndoBatch();
  registry.register('SEG', createObject('SEG'));
  registry.endUndoBatch();
  registry.mergeLastUndoEntries(3);

  assert.equal(registry.undo(board), 'P1');
  assert.deepEqual(removed, ['SEG', 'P2', 'P1']);
  assert.deepEqual(registry.history, []);
});

test('ShapeRegistry records delete as an undoable and redoable action', () => {
  const registry = new ShapeRegistry();
  const removed = [];
  const board = {
    removeObject(object) {
      removed.push(object.registryId);
    }
  };
  const first = createObject('A');
  const second = createObject('B');
  const third = createObject('C');

  registry.register('A', first);
  registry.register('B', second);
  registry.register('C', third);

  assert.equal(registry.removeObject(board, second), 'B');
  assert.deepEqual(removed, ['B']);
  assert.deepEqual(registry.history, ['A', 'C']);
  assert.equal(registry.exists('B'), false);

  assert.equal(registry.undo(board), 'B');
  assert.deepEqual(registry.history, ['A', 'B', 'C']);
  assert.equal(registry.exists('B'), true);

  assert.equal(registry.redo(board), 'B');
  assert.deepEqual(registry.history, ['A', 'C']);
  assert.equal(registry.exists('B'), false);
});

test('ShapeRegistry snapshot actions support label and move undo redo', () => {
  const registry = new ShapeRegistry();
  const board = {
    removeObject() {},
    create(type, args, attrs) {
      return {
        elType: type,
        X: () => args[0],
        Y: () => args[1],
        getName: () => attrs.name || '',
        name: attrs.name || ''
      };
    },
    update() {}
  };
  let x = 1;
  let y = 2;
  let name = 'A';
  const point = {
    elType: 'point',
    X: () => x,
    Y: () => y,
    getName: () => name,
    name
  };

  registry.register('P', point);

  const beforeLabel = registry.snapshot();
  name = 'B';
  point.name = name;
  registry.commitSnapshotAction('label', beforeLabel, registry.snapshot(), { label: 'label' });

  assert.equal(registry.undo(board), 'label');
  assert.equal(registry.get('P').getName(), 'A');
  assert.equal(registry.redo(board), 'label');
  assert.equal(registry.get('P').getName(), 'B');

  const movedPoint = registry.get('P');
  const beforeMove = registry.snapshot();
  x = 4;
  y = 5;
  movedPoint.X = () => x;
  movedPoint.Y = () => y;
  registry.commitSnapshotAction('move', beforeMove, registry.snapshot(), { label: 'move' });

  assert.equal(registry.undo(board), 'move');
  assert.deepEqual([registry.get('P').X(), registry.get('P').Y()], [1, 2]);
  assert.equal(registry.redo(board), 'move');
  assert.deepEqual([registry.get('P').X(), registry.get('P').Y()], [4, 5]);
});

test('ShapeRegistry snapshots preserve derived line construction parents', () => {
  const registry = new ShapeRegistry();
  const restored = [];
  const board = {
    removeObject() {},
    update() {}
  };
  registry.setSnapshotFactory((entry) => {
    restored.push({
      id: entry.id,
      type: entry.type,
      constructionType: entry.constructionType,
      parentIds: entry.parentIds
    });
    return { elType: entry.type, meta: entry.meta };
  });
  const pointA = createObject('A');
  const pointB = createObject('B');
  const segment = { point1: pointA, point2: pointB };
  const pointC = createObject('C');
  const parallelLine = {
    elType: 'line',
    meta: {
      historyAction: 'parallel',
      historyParentIds: ['SEG', 'C']
    }
  };

  registry.register('A', pointA);
  registry.register('B', pointB);
  registry.register('SEG', segment);
  registry.register('C', pointC);
  registry.register('PAR', parallelLine);

  const parallelSnapshot = registry.snapshot().find((entry) => entry.id === 'PAR');
  assert.equal(parallelSnapshot.type, 'line');
  assert.equal(parallelSnapshot.constructionType, 'parallel');
  assert.deepEqual(parallelSnapshot.parentIds, ['SEG', 'C']);

  assert.equal(registry.undo(board), 'PAR');
  assert.equal(registry.exists('PAR'), false);
  assert.equal(registry.redo(board), 'PAR');
  assert.deepEqual(restored.at(-1), {
    id: 'PAR',
    type: 'line',
    constructionType: 'parallel',
    parentIds: ['SEG', 'C']
  });

  assert.equal(registry.removeObject(board, registry.get('SEG')), 'SEG');
  assert.equal(registry.exists('PAR'), false);
});

test('ShapeRegistry removes dependent geometry when deleting a point', () => {
  const registry = new ShapeRegistry();
  const removed = [];
  const board = {
    removeObject(object) {
      removed.push(object.registryId);
    }
  };
  const pointA = createObject('A');
  const pointB = createObject('B');
  const segment = { point1: pointA, point2: pointB };
  const polygon = { vertices: [pointA, pointB] };

  registry.register('A', pointA);
  registry.register('B', pointB);
  registry.register('SEG', segment);
  registry.register('POLY', polygon);

  assert.equal(registry.removeObject(board, pointA), 'A');
  assert.deepEqual(removed, ['POLY', 'SEG', 'A']);
  assert.deepEqual(registry.history, ['B']);
  assert.equal(registry.exists('SEG'), false);
  assert.equal(registry.exists('POLY'), false);
});

test('ShapeRegistry removes closed polygon affordance when deleting one of its edges', () => {
  const registry = new ShapeRegistry();
  const removed = [];
  const board = {
    removeObject(object) {
      removed.push(object.registryId);
    }
  };
  const segment = createObject('SEG');
  const polygon = { meta: { closedSegmentIds: ['SEG'] } };

  registry.register('SEG', segment);
  registry.register('POLY', polygon);

  assert.equal(registry.removeObject(board, segment), 'SEG');
  assert.deepEqual(removed, ['POLY', 'SEG']);
  assert.deepEqual(registry.history, []);
});

test('ShapeRegistry removes a circle when deleting its registered center point', () => {
  const registry = new ShapeRegistry();
  const removed = [];
  const board = {
    removeObject(object) {
      removed.push(object.registryId);
    }
  };
  const center = createObject('CENTER');
  const circle = { center };

  registry.register('CENTER', center);
  registry.register('CIRCLE', circle);

  assert.equal(registry.removeObject(board, center), 'CENTER');
  assert.deepEqual(removed, ['CIRCLE', 'CENTER']);
  assert.deepEqual(registry.history, []);
});

test('drag-created polygons include the same selectable edge affordances as closed segment chains', () => {
  let idCounter = 0;
  const instructions = buildPolygonInstructionsFromVertices([
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 3 }
  ], 'rectangle', {
    nextId: (prefix) => {
      idCounter += 1;
      return `${prefix}_${idCounter}`;
    },
    nextLabel: () => `P${idCounter + 1}`
  });

  const points = instructions.filter((instruction) => instruction.action === 'place_point');
  const segments = instructions.filter((instruction) => instruction.action === 'segment');
  const polygon = instructions.find((instruction) => instruction.action === 'polygon');

  assert.equal(points.length, 4);
  assert.equal(segments.length, 4);
  assert.deepEqual(
    segments.map((instruction) => [instruction.params.p1, instruction.params.p2]),
    [
      [points[0].result_id, points[1].result_id],
      [points[1].result_id, points[2].result_id],
      [points[2].result_id, points[3].result_id],
      [points[3].result_id, points[0].result_id]
    ]
  );
  assert.deepEqual(polygon.params.points, points.map((instruction) => instruction.result_id));
  assert.deepEqual(polygon.meta.closedSegmentIds, segments.map((instruction) => instruction.result_id));
});

test('tool switch status clarifies cancelled pending interactions', () => {
  assert.equal(
    getToolSwitchStatus(TOOLS.SEGMENT, TOOLS.SELECT, TOOLS.SELECT),
    '已取消线段操作，回到选择模式'
  );
  assert.equal(
    getToolSwitchStatus(TOOLS.SEGMENT, TOOLS.CIRCLE, TOOLS.SELECT),
    '已取消线段操作，切换到圆'
  );
});

test('buildCircleDefinition uses drag distance as radius', () => {
  const circle = buildCircleDefinition({ x: 0, y: 0 }, { x: 6, y: 2 });

  assert.equal(circle.valid, true);
  assert.equal(circle.cx, 0);
  assert.equal(circle.cy, 0);
  assert.ok(Math.abs(circle.radius - Math.sqrt(40)) < 1e-9);
});

test('buildRectangleVertices constrains squares when Shift is held', () => {
  const rectangle = buildRectangleVertices({ x: 1, y: 1 }, { x: 5, y: 3 }, true);

  assert.equal(rectangle.valid, true);
  assert.deepEqual(rectangle.vertices[2], { x: 5, y: 5 });
});

test('buildIsoscelesTriangleVertices constrains equilateral triangles when Shift is held', () => {
  const triangle = buildIsoscelesTriangleVertices({ x: 0, y: 0 }, { x: 4, y: 2 }, true);
  const expectedHeight = Math.sqrt(3) * 2;

  assert.equal(triangle.valid, true);
  assert.equal(triangle.vertices[2].x, 2);
  assert.ok(Math.abs(triangle.vertices[2].y - expectedHeight) < 1e-9);
});

test('chooseTargetFromElements ignores visible unregistered auxiliary points', () => {
  const registry = new ShapeRegistry();
  const auxiliaryPoint = {
    elType: 'point',
    visProp: { visible: true }
  };
  const registeredPoint = {
    elType: 'point',
    visProp: { visible: true }
  };
  registry.register('P1', registeredPoint);

  assert.equal(chooseTargetFromElements([auxiliaryPoint], registry), null);
  assert.equal(chooseTargetFromElements([auxiliaryPoint, registeredPoint], registry).obj, registeredPoint);
});

test('preferPointSnapTarget keeps points ahead of path hits', () => {
  const point = {
    elType: 'point',
    visProp: { visible: true },
    X: () => 1,
    Y: () => 1
  };
  const path = {
    elType: 'segment',
    visProp: { visible: true },
    hasPoint: () => true
  };
  const target = preferPointSnapTarget(
    { type: 'path', obj: path, distance: 14 },
    { type: 'point', obj: point, distance: 8 }
  );

  assert.equal(target.type, 'point');
  assert.equal(target.obj, point);
});

test('collectPointLabelOverlays captures visible point labels for preview export', () => {
  const board = {
    objects: {
      A: {
        elType: 'point',
        hasLabel: true,
        visPropCalc: { visible: true },
        getName: () => 'A',
        X: () => 1,
        Y: () => 2,
        label: {
          visPropCalc: { visible: true },
          visProp: { fontsize: '18' },
          coords: { scrCoords: [1, 120, 80] }
        }
      },
      B: {
        elType: 'point',
        hasLabel: true,
        visPropCalc: { visible: false },
        getName: () => 'B',
        X: () => 3,
        Y: () => 4,
        label: {
          visPropCalc: { visible: true },
          coords: { scrCoords: [1, 200, 90] }
        }
      },
      C: {
        elType: 'point',
        hasLabel: true,
        visPropCalc: { visible: true },
        getName: () => 'C',
        X: () => 5,
        Y: () => 6,
        coords: { scrCoords: [1, 40, 50] },
        label: {
          visPropCalc: { visible: true }
        }
      }
    }
  };

  assert.deepEqual(collectPointLabelOverlays(board), [
    { text: 'A', x: 120, y: 80, anchorX: 1, anchorY: 2, fontSize: 18 },
    { text: 'C', x: 50, y: 40, anchorX: 5, anchorY: 6, fontSize: 16 }
  ]);
});

test('exportBoardPreviewSvg restores board text display after successful export', () => {
  const displays = [];
  const rawSvg = '<svg xmlns="http://www.w3.org/2000/svg"><text>A</text></svg>';
  const board = {
    options: { text: { display: 'html' } },
    origin: { scrCoords: [1, 0, 100] },
    unitX: 10,
    unitY: 10,
    renderer: {
      dumpToDataURI: () => `data:image/svg+xml;base64,${Buffer.from(rawSvg).toString('base64')}`
    },
    setAttribute(attrs) {
      this.options.text.display = attrs.text.display;
      displays.push(attrs.text.display);
    },
    update() {}
  };

  const result = exportBoardPreviewSvg({
    board,
    selection: { xmin: 10, xmax: 0, ymin: 0, ymax: 10 }
  });

  assert.match(result, /<svg/);
  assert.deepEqual(displays, ['internal', 'html']);
  assert.equal(board.options.text.display, 'html');
});

test('exportBoardPreviewSvg restores board text display when SVG export fails', () => {
  const displays = [];
  const board = {
    options: { text: { display: 'html' } },
    origin: { scrCoords: [1, 0, 100] },
    unitX: 10,
    unitY: 10,
    renderer: {
      dumpToDataURI: () => 'not-svg-data'
    },
    setAttribute(attrs) {
      this.options.text.display = attrs.text.display;
      displays.push(attrs.text.display);
    },
    update() {}
  };

  assert.throws(
    () => exportBoardPreviewSvg({
      board,
      selection: { xmin: 0, xmax: 10, ymin: 0, ymax: 10 }
    }),
    /无法读取画布 SVG 数据/
  );
  assert.deepEqual(displays, ['internal', 'html']);
  assert.equal(board.options.text.display, 'html');
});
