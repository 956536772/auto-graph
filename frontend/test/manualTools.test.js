import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import { ShapeRegistry } from '../src/lib/ShapeRegistry.js';
import { collectPointLabelOverlays, collectVisibleCircleCenterIds, collectVisibleCirclePointIds, collectVisibleExplicitPointIds, exportBoardPreviewSvg } from '../src/lib/previewExport.js';
import { TOOLS } from '../src/lib/manualTools/constants.js';
import {
  buildCircleDefinition,
  buildIsoscelesTriangleVertices,
  buildPolygonInstructionsFromVertices,
  buildRectangleVertices,
  getToolSwitchStatus
} from '../src/lib/manualTools/geometry.js';
import {
  chooseTargetFromElements,
  getCircleSnapDistancePx,
  isCirclePathElement,
  isWithinSnapRadius,
  PATH_SNAP_RADIUS_PX,
  preferPointSnapTarget,
  shouldUseSnapping
} from '../src/lib/manualTools/selection.js';
import { createBoardPanDragGuard } from '../src/lib/manualTools/panDragGuard.js';

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
    const parseAttributes = (attrsText) => Object.fromEntries(
      Array.from(attrsText.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)).map(([, name, value]) => [name, value])
    );

    for (const tagName of ['circle', 'line', 'path', 'polygon', 'ellipse']) {
      const elementMatches = svgString.matchAll(new RegExp(`<${tagName}\\b([^>]*)\\/?>\\s*(?:<\\/${tagName}>)?`, 'g'));
      for (const match of elementMatches) {
        const element = new FakeSvgElement(tagName);
        Object.entries(parseAttributes(match[1])).forEach(([name, value]) => {
          element.setAttribute(name, value);
        });
        root.appendChild(element);
      }
    }

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

function createPoint(label, x = 0, y = 0) {
  return {
    elType: 'point',
    name: label,
    hasLabel: Boolean(label),
    label: { setAttribute() {}, on() {} },
    X: () => x,
    Y: () => y,
    getName() {
      return this.name || '';
    },
    setName(nextName) {
      this.name = nextName || '';
    },
    setAttribute(attrs = {}) {
      if (Object.hasOwn(attrs, 'name')) this.name = attrs.name || '';
      if (Object.hasOwn(attrs, 'withLabel')) this.hasLabel = attrs.withLabel;
    },
    on() {}
  };
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

test('ShapeRegistry removes objects by registry id for AI delete instructions', () => {
  const registry = new ShapeRegistry();
  const object = { elType: 'point' };
  const removed = [];
  const board = {
    removeObject(target) {
      removed.push(target);
    }
  };

  registry.register('A', object);

  assert.equal(registry.removeById(board, 'A'), 'A');
  assert.deepEqual(removed, [object]);
  assert.equal(registry.exists('A'), false);
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

test('ShapeRegistry serializes and deletes generated line description points with their line', () => {
  const registry = new ShapeRegistry();
  const removed = [];
  const board = {
    removeObject(object) {
      removed.push(object.registryId);
    }
  };
  const pointA = createPoint('A', 0, 0);
  const pointB = createPoint('B', 4, 0);
  const pointP = createPoint('P', 1, 2);
  const segment = { elType: 'segment', point1: pointA, point2: pointB, on() {} };
  const parallel = {
    elType: 'parallel',
    parents: [segment, pointP],
    meta: {
      historyAction: 'parallel',
      historyParentIds: ['AB', 'P'],
      descriptionPointId: 'parallel_P_AB_point'
    }
  };
  const descriptionPoint = {
    elType: 'glider',
    slideObject: parallel,
    X: () => 2,
    Y: () => 3,
    getName: () => 'C',
    meta: {
      generatedLinePointFor: 'parallel_P_AB'
    }
  };

  registry.register('A', pointA);
  registry.register('B', pointB);
  registry.register('AB', segment);
  registry.register('P', pointP);
  registry.register('parallel_P_AB', parallel);
  registry.register('parallel_P_AB_point', descriptionPoint);

  assert.equal(parallel.meta.descriptionPointId, 'parallel_P_AB_point');
  assert.equal(descriptionPoint.elType, 'glider');
  assert.equal(descriptionPoint.meta.generatedLinePointFor, 'parallel_P_AB');
  assert.equal(descriptionPoint.slideObject, parallel);
  assert.equal(descriptionPoint.getName(), 'C');

  const serializedPoint = registry.serialize().find((entry) => entry.id === 'parallel_P_AB_point');
  assert.equal(serializedPoint.type, 'glider');
  assert.equal(serializedPoint.label, 'C');
  assert.deepEqual(serializedPoint.coords, [2, 3]);

  assert.equal(registry.removeObject(board, parallel), 'parallel_P_AB');
  assert.equal(registry.exists('parallel_P_AB'), false);
  assert.equal(registry.exists('parallel_P_AB_point'), false);
  assert.deepEqual(new Set(removed), new Set(['parallel_P_AB', 'parallel_P_AB_point']));
});

test('ShapeRegistry does not require generated description points for ordinary tangents', () => {
  const registry = new ShapeRegistry();
  const removed = [];
  const board = {
    removeObject(object) {
      removed.push(object.registryId);
    }
  };
  const circle = { elType: 'circle' };
  const tangentPoint = {
    elType: 'glider',
    slideObject: circle,
    X: () => 1,
    Y: () => 2,
    getName: () => ''
  };
  const tangent = {
    elType: 'tangent',
    parents: [circle, tangentPoint],
    meta: {
      historyAction: 'tangent',
      historyParentIds: ['circle_o', 'touch_1']
    }
  };

  registry.register('circle_o', circle);
  registry.register('touch_1', tangentPoint);
  registry.register('tangent_1', tangent);

  assert.deepEqual(registry.getDirectOwnedIds(tangent), []);
  assert.equal(registry.removeObject(board, tangent), 'tangent_1');
  assert.equal(registry.exists('tangent_1'), false);
  assert.equal(registry.exists('touch_1'), true);
  assert.deepEqual(removed, ['tangent_1']);
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

test('ShapeRegistry deletes AI polygons without removing shared circumcircle geometry', () => {
  const registry = new ShapeRegistry();
  const removed = [];
  const board = {
    removeObject(object) {
      removed.push(object.registryId);
    }
  };
  const pointA = createObject('A');
  const pointB = createObject('B');
  const pointC = createObject('C');
  const polygon = { elType: 'polygon', vertices: [pointA, pointB, pointC] };
  const circumcircle = {
    elType: 'circumcircle',
    point1: pointA,
    point2: pointB,
    point3: pointC
  };

  registry.register('A', pointA);
  registry.register('B', pointB);
  registry.register('C', pointC);
  registry.register('TRIANGLE', polygon);
  registry.register('CIRCUMCIRCLE', circumcircle);

  assert.equal(registry.removeObject(board, polygon), 'TRIANGLE');
  assert.deepEqual(removed, ['TRIANGLE']);
  assert.equal(registry.exists('A'), true);
  assert.equal(registry.exists('B'), true);
  assert.equal(registry.exists('C'), true);
  assert.equal(registry.exists('CIRCUMCIRCLE'), true);
});

test('ShapeRegistry preserves a derived circumcircle as an independent circle when deleting one parent point', () => {
  const registry = new ShapeRegistry();
  const removed = [];
  const board = {
    removeObject(object) {
      removed.push(object.registryId);
    }
  };
  registry.setSnapshotFactory((entry) => ({
    elType: entry.type,
    meta: entry.meta,
    center: entry.center ? { X: () => entry.center.x, Y: () => entry.center.y } : null,
    radiuspoint: entry.center && entry.radius ? { X: () => entry.center.x + entry.radius, Y: () => entry.center.y } : null,
    Radius: () => entry.radius || 0,
    getName: () => entry.label || ''
  }));
  const pointA = createObject('A');
  const pointB = createObject('B');
  const pointC = createObject('C');
  const polygon = { elType: 'polygon', vertices: [pointA, pointB, pointC] };
  const centerPoint = {
    elType: 'point',
    X: () => 1,
    Y: () => 2,
    getName: () => 'O',
    parents: [pointA, pointB, pointC],
    meta: {
      generatedCircleCenterFor: 'CIRCUMCIRCLE'
    }
  };
  const circumcircle = {
    elType: 'circumcircle',
    point1: pointA,
    point2: pointB,
    point3: pointC,
    center: { X: () => 1, Y: () => 2 },
    Radius: () => 5,
    meta: {
      historyAction: 'circumcircle',
      historyParentIds: ['A', 'B', 'C'],
      centerPointId: 'CIRCUMCIRCLE_center'
    }
  };

  registry.register('A', pointA);
  registry.register('B', pointB);
  registry.register('C', pointC);
  registry.register('TRIANGLE', polygon);
  registry.register('CIRCUMCIRCLE_center', centerPoint);
  registry.register('CIRCUMCIRCLE', circumcircle);

  assert.equal(registry.removeObject(board, pointC), 'C');
  assert.equal(registry.exists('C'), false);
  assert.equal(registry.exists('TRIANGLE'), false);
  assert.equal(registry.exists('CIRCUMCIRCLE'), true);
  assert.equal(registry.exists('CIRCUMCIRCLE_center'), true);
  assert.equal(registry.get('CIRCUMCIRCLE').elType, 'circle');
  assert.deepEqual(new Set(removed), new Set(['C', 'TRIANGLE', 'CIRCUMCIRCLE', 'CIRCUMCIRCLE_center']));

  assert.equal(registry.undo(board), 'C');
  assert.equal(registry.exists('C'), true);
  assert.equal(registry.get('CIRCUMCIRCLE').elType, 'circumcircle');
  assert.equal(registry.exists('CIRCUMCIRCLE_center'), true);

  assert.equal(registry.redo(board), 'C');
  assert.equal(registry.exists('C'), false);
  assert.equal(registry.get('CIRCUMCIRCLE').elType, 'circle');
  assert.equal(registry.exists('CIRCUMCIRCLE_center'), true);
});

test('ShapeRegistry deletes generated circle centers without deleting the circle', () => {
  const registry = new ShapeRegistry();
  const removed = [];
  const board = {
    removeObject(object) {
      removed.push(object.registryId);
    }
  };
  const center = {
    elType: 'point',
    meta: {
      generatedCircleCenterFor: 'CIRCLE'
    }
  };
  const circle = {
    elType: 'circle',
    center,
    meta: {
      centerPointId: 'CIRCLE_center'
    }
  };

  registry.register('CIRCLE_center', center);
  registry.register('CIRCLE', circle);

  assert.equal(registry.removeObject(board, center), 'CIRCLE_center');
  assert.deepEqual(removed, ['CIRCLE_center']);
  assert.equal(registry.exists('CIRCLE'), true);
  assert.equal(registry.exists('CIRCLE_center'), false);
});

test('ShapeRegistry keeps compound deletion for manual closed polygons', () => {
  const registry = new ShapeRegistry();
  const removed = [];
  const board = {
    removeObject(object) {
      removed.push(object.registryId);
    }
  };
  const pointA = createObject('A');
  const pointB = createObject('B');
  const pointC = createObject('C');
  const segmentAB = { point1: pointA, point2: pointB };
  const segmentBC = { point1: pointB, point2: pointC };
  const segmentCA = { point1: pointC, point2: pointA };
  const polygon = {
    elType: 'polygon',
    vertices: [pointA, pointB, pointC],
    meta: { closedSegmentIds: ['AB', 'BC', 'CA'] }
  };

  registry.register('A', pointA);
  registry.register('B', pointB);
  registry.register('C', pointC);
  registry.register('AB', segmentAB);
  registry.register('BC', segmentBC);
  registry.register('CA', segmentCA);
  registry.register('TRIANGLE', polygon);

  assert.equal(registry.removeObject(board, polygon), 'TRIANGLE');
  assert.deepEqual(new Set(removed), new Set(['A', 'B', 'C', 'AB', 'BC', 'CA', 'TRIANGLE']));
  assert.deepEqual(registry.history, []);
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

test('ShapeRegistry removes circle gliders when deleting their path circle', () => {
  const registry = new ShapeRegistry();
  const removed = [];
  const board = {
    removeObject(object) {
      removed.push(object.registryId);
    }
  };
  const circle = { elType: 'circle' };
  const glider = { elType: 'glider', slideObject: circle };

  registry.register('CIRCLE', circle);
  registry.register('P', glider);

  assert.equal(registry.removeObject(board, circle), 'CIRCLE');
  assert.deepEqual(removed, ['P', 'CIRCLE']);
  assert.deepEqual(registry.history, []);
});

test('ShapeRegistry serializes generated derived circle centers as reusable points', () => {
  const registry = new ShapeRegistry();
  const center = {
    elType: 'circumcenter',
    meta: { generatedCircleCenterFor: 'circumcircle_ABC' },
    getName: () => 'O',
    X: () => 0.5,
    Y: () => -0.5
  };

  registry.register('circumcircle_ABC_center', center);

  assert.deepEqual(registry.serialize(), [
    {
      id: 'circumcircle_ABC_center',
      type: 'point',
      order: 0,
      label: 'O',
      position: { x: 0.5, y: -0.5 },
      coords: [0.5, -0.5]
    }
  ]);
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

test('chooseTargetFromElements treats AI-generated circles as selectable paths', () => {
  const registry = new ShapeRegistry();
  const circumcircle = {
    elType: 'circumcircle',
    visProp: { visible: true }
  };
  registry.register('CIRCUMCIRCLE', circumcircle);

  const target = chooseTargetFromElements([circumcircle], registry);

  assert.equal(target.type, 'path');
  assert.equal(target.obj, circumcircle);
});

test('chooseTargetFromElements treats AI-generated point constructions as selectable points', () => {
  const registry = new ShapeRegistry();
  const midpoint = {
    elType: 'midpoint',
    visProp: { visible: true }
  };
  registry.register('MIDPOINT', midpoint);

  const target = chooseTargetFromElements([midpoint], registry);

  assert.equal(target.type, 'point');
  assert.equal(target.obj, midpoint);
});

test('chooseTargetFromElements treats AI-generated function graphs as selectable paths', () => {
  const registry = new ShapeRegistry();
  const functionGraph = {
    elType: 'functiongraph',
    visProp: { visible: true }
  };
  registry.register('GRAPH', functionGraph);

  const target = chooseTargetFromElements([functionGraph], registry);

  assert.equal(target.type, 'path');
  assert.equal(target.obj, functionGraph);
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

test('getCircleSnapDistancePx measures distance to circumference instead of circle interior', () => {
  const circle = {
    elType: 'circle',
    center: {
      X: () => 0,
      Y: () => 0
    },
    Radius: () => 5
  };
  const toScreenCoords = (coords) => ({ x: coords.x * 10, y: coords.y * 10 });

  assert.equal(getCircleSnapDistancePx(circle, { x: 0, y: 0 }, toScreenCoords), 50);
  assert.equal(getCircleSnapDistancePx(circle, { x: 5, y: 0 }, toScreenCoords), 0);
  assert.equal(getCircleSnapDistancePx(circle, { x: 5.8, y: 0 }, toScreenCoords), 8);
});

test('getCircleSnapDistancePx supports AI-generated circle path types', () => {
  const circleBase = {
    center: {
      X: () => 0,
      Y: () => 0
    },
    Radius: () => 5
  };
  const toScreenCoords = (coords) => ({ x: coords.x * 10, y: coords.y * 10 });

  assert.equal(isCirclePathElement({ ...circleBase, elType: 'circumcircle' }), true);
  assert.equal(isCirclePathElement({ ...circleBase, elType: 'incircle' }), true);
  assert.equal(getCircleSnapDistancePx({ ...circleBase, elType: 'circumcircle' }, { x: 5, y: 0 }, toScreenCoords), 0);
  assert.equal(getCircleSnapDistancePx({ ...circleBase, elType: 'incircle' }, { x: 5.8, y: 0 }, toScreenCoords), 8);
});

test('shouldUseSnapping disables all snapping while Shift is held', () => {
  assert.equal(shouldUseSnapping({ shiftKey: false }), true);
  assert.equal(shouldUseSnapping({ shiftKey: true }), false);
});

test('isWithinSnapRadius keeps path snapping strict', () => {
  assert.equal(isWithinSnapRadius(6, 6), true);
  assert.equal(isWithinSnapRadius(6.1, 6), false);
  assert.equal(isWithinSnapRadius(Number.POSITIVE_INFINITY, 6), false);
});

test('circle interior hits stay outside path snap radius so inner dragging can remain enabled', () => {
  const circle = {
    elType: 'circle',
    center: {
      X: () => 0,
      Y: () => 0
    },
    Radius: () => 5
  };
  const toScreenCoords = (coords) => ({ x: coords.x * 10, y: coords.y * 10 });
  const interiorDistance = getCircleSnapDistancePx(circle, { x: 0, y: 0 }, toScreenCoords);

  assert.equal(isWithinSnapRadius(interiorDistance, PATH_SNAP_RADIUS_PX), false);
});

test('pan drag guard restores board pan after window-level release events', () => {
  const listeners = new Map();
  const panStates = [];
  const board = {
    options: { pan: { enabled: true } },
    setAttribute(attrs) {
      const nextPan = attrs.pan.enabled;
      panStates.push(nextPan);
      this.options.pan.enabled = nextPan;
    }
  };
  const targetWindow = {
    addEventListener(eventName, listener) {
      listeners.set(eventName, listener);
    },
    removeEventListener(eventName, listener) {
      if (listeners.get(eventName) === listener) {
        listeners.delete(eventName);
      }
    }
  };

  const guard = createBoardPanDragGuard(board, () => targetWindow);
  guard.start();

  assert.equal(board.options.pan.enabled, false);
  assert.equal(typeof listeners.get('pointerup'), 'function');

  listeners.get('pointerup')();

  assert.equal(board.options.pan.enabled, true);
  assert.deepEqual(panStates, [false, true]);
  assert.equal(listeners.size, 0);
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

test('collectVisibleCircleCenterIds only keeps centers with visible label text for preview dots', () => {
  const labeledCenter = {
    id: 'center_labeled',
    elType: 'point',
    hasLabel: true,
    visPropCalc: { visible: true },
    getName: () => 'O',
    label: { visPropCalc: { visible: true } }
  };
  const unlabeledCenter = {
    id: 'center_unlabeled',
    elType: 'point',
    hasLabel: false,
    visPropCalc: { visible: true },
    getName: () => '',
    label: { visPropCalc: { visible: true } }
  };
  const hiddenLabelCenter = {
    id: 'center_hidden_label',
    elType: 'point',
    hasLabel: true,
    visPropCalc: { visible: true },
    getName: () => 'P',
    label: { visPropCalc: { visible: false } }
  };
  const ordinaryPoint = {
    id: 'ordinary_point',
    elType: 'point',
    hasLabel: true,
    visPropCalc: { visible: true },
    getName: () => 'A',
    label: { visPropCalc: { visible: true } }
  };
  const generatedCircumcenter = {
    id: 'circumcenter_labeled',
    elType: 'circumcenter',
    hasLabel: false,
    meta: { generatedCircleCenterFor: 'circumcircle_ABC' },
    visPropCalc: { visible: true },
    getName: () => 'O',
    label: { visPropCalc: { visible: true } }
  };

  const board = {
    objects: {
      labeledCenter,
      unlabeledCenter,
      hiddenLabelCenter,
      ordinaryPoint,
      generatedCircumcenter,
      circleA: { elType: 'circle', center: labeledCenter },
      circleB: { elType: 'circle', center: unlabeledCenter },
      circleC: { elType: 'circle', center: hiddenLabelCenter },
      circumcircleABC: { elType: 'circumcircle', center: generatedCircumcenter }
    }
  };

  assert.deepEqual(collectVisibleCircleCenterIds(board), ['center_labeled', 'circumcenter_labeled']);
});

test('collectPointLabelOverlays captures generated derived circle center labels', () => {
  const generatedCircumcenter = {
    id: 'circumcenter_labeled',
    elType: 'circumcenter',
    hasLabel: false,
    meta: { generatedCircleCenterFor: 'circumcircle_ABC' },
    visPropCalc: { visible: true },
    getName: () => 'O',
    X: () => 0.5,
    Y: () => -0.5,
    label: {
      visPropCalc: { visible: true },
      visProp: { fontsize: '16' },
      coords: { scrCoords: [1, 150, 90] }
    }
  };
  const board = {
    objects: {
      generatedCircumcenter,
      circumcircleABC: { elType: 'circumcircle', center: generatedCircumcenter }
    }
  };

  assert.deepEqual(collectPointLabelOverlays(board), [
    { text: 'O', x: 150, y: 90, anchorX: 0.5, anchorY: -0.5, fontSize: 16 }
  ]);
});

test('collectVisibleCirclePointIds only keeps visible gliders on circle paths', () => {
  const circle = { elType: 'circle' };
  const circumcircle = { elType: 'circumcircle' };
  const segment = { elType: 'segment' };
  const circleGlider = {
    id: 'circle_glider',
    elType: 'glider',
    visPropCalc: { visible: true },
    slideObject: circle
  };
  const circumcircleGlider = {
    id: 'circumcircle_glider',
    elType: 'glider',
    visPropCalc: { visible: true },
    path: circumcircle
  };
  const hiddenCircleGlider = {
    id: 'hidden_circle_glider',
    elType: 'glider',
    visPropCalc: { visible: false },
    slideObject: circle
  };
  const segmentGlider = {
    id: 'segment_glider',
    elType: 'glider',
    visPropCalc: { visible: true },
    slideObject: segment
  };
  const freePoint = {
    id: 'free_point',
    elType: 'point',
    visPropCalc: { visible: true }
  };

  const board = {
    objects: {
      circle,
      circumcircle,
      segment,
      circleGlider,
      circumcircleGlider,
      hiddenCircleGlider,
      segmentGlider,
      freePoint
    }
  };

  assert.deepEqual(collectVisibleCirclePointIds(board), ['circle_glider', 'circumcircle_glider']);
});

test('collectVisibleExplicitPointIds keeps visible registered points for preview markers', () => {
  const polygonVertex = {
    id: 'polygon_vertex',
    registryId: 'V',
    elType: 'point',
    visPropCalc: { visible: true }
  };
  const board = {
    objects: {
      explicitPoint: {
        id: 'explicit_point',
        registryId: 'P',
        elType: 'point',
        visPropCalc: { visible: true }
      },
      explicitGlider: {
        id: 'explicit_glider',
        registryId: 'Q',
        elType: 'glider',
        visPropCalc: { visible: true }
      },
      hiddenPoint: {
        id: 'hidden_point',
        registryId: 'H',
        elType: 'point',
        visPropCalc: { visible: false }
      },
      auxiliaryPoint: {
        id: 'auxiliary_point',
        elType: 'point',
        visPropCalc: { visible: true }
      },
      polygonVertex,
      polygon: {
        elType: 'polygon',
        vertices: [polygonVertex]
      }
    }
  };

  assert.deepEqual(collectVisibleExplicitPointIds(board), ['explicit_point', 'explicit_glider']);
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

test('exportBoardPreviewSvg renders explicit points and circle gliders as small markers', () => {
  const rawSvg = [
    '<svg xmlns="http://www.w3.org/2000/svg">',
    '<circle id="jxg_circle_glider" fill="red" stroke="red" r="5"></circle>',
    '<circle id="jxg_free_point" fill="red" stroke="red" r="5"></circle>',
    '<circle id="jxg_ai_point_result" fill="none" stroke="red" r="5"></circle>',
    '<circle id="jxg_ai_midpoint_result" fill="none" stroke="red" r="5"></circle>',
    '<circle id="jxg_auxiliary_point" fill="red" stroke="red" r="5"></circle>',
    '<circle id="jxg_polygon_vertex" fill="red" stroke="red" r="5"></circle>',
    '</svg>'
  ].join('');
  const circle = { elType: 'circle' };
  const polygonVertex = {
    id: 'polygon_vertex',
    registryId: 'V',
    elType: 'point',
    visPropCalc: { visible: true }
  };
  const board = {
    objects: {
      circle,
      circleGlider: {
        id: 'circle_glider',
        elType: 'glider',
        visPropCalc: { visible: true },
        slideObject: circle
      },
      freePoint: {
        id: 'free_point',
        registryId: 'P',
        elType: 'point',
        visPropCalc: { visible: true }
      },
      aiPoint: {
        id: 'jxg123',
        registryId: 'ai_point_result',
        elType: 'point',
        visPropCalc: { visible: true }
      },
      aiMidpoint: {
        id: 'midpoint_internal',
        registryId: 'ai_midpoint_result',
        elType: 'midpoint',
        visPropCalc: { visible: true }
      },
      auxiliaryPoint: {
        id: 'auxiliary_point',
        elType: 'point',
        visPropCalc: { visible: true }
      },
      polygonVertex,
      polygon: {
        elType: 'polygon',
        vertices: [polygonVertex]
      }
    },
    options: { text: { display: 'html' } },
    origin: { scrCoords: [1, 0, 100] },
    unitX: 10,
    unitY: 10,
    renderer: {
      dumpToDataURI: () => `data:image/svg+xml;base64,${Buffer.from(rawSvg).toString('base64')}`
    },
    setAttribute(attrs) {
      this.options.text.display = attrs.text.display;
    },
    update() {}
  };

  const result = exportBoardPreviewSvg({
    board,
    selection: { xmin: 0, xmax: 10, ymin: 0, ymax: 10 }
  });

  assert.match(result, /id="jxg_circle_glider"/);
  assert.match(result, /id="jxg_circle_glider" fill="black" stroke="black" r="3" stroke-width="0"/);
  assert.match(result, /id="jxg_free_point" fill="black" stroke="black" r="3" stroke-width="0"/);
  assert.match(result, /id="jxg_ai_point_result" fill="black" stroke="black" r="3" stroke-width="0"/);
  assert.match(result, /id="jxg_ai_midpoint_result" fill="black" stroke="black" r="3" stroke-width="0"/);
  assert.doesNotMatch(result, /id="jxg_auxiliary_point"/);
  assert.doesNotMatch(result, /id="jxg_polygon_vertex"/);
});

test('exportBoardPreviewSvg keeps generated circumcircle center marker and label', () => {
  const rawSvg = [
    '<svg xmlns="http://www.w3.org/2000/svg">',
    '<circle id="jxg_circumcenter_labeled" fill="orange" stroke="orange" r="5"></circle>',
    '</svg>'
  ].join('');
  const generatedCircumcenter = {
    id: 'circumcenter_labeled',
    elType: 'circumcenter',
    hasLabel: false,
    meta: { generatedCircleCenterFor: 'circumcircle_ABC' },
    visPropCalc: { visible: true },
    getName: () => 'O',
    X: () => 0.5,
    Y: () => -0.5,
    label: {
      visPropCalc: { visible: true },
      visProp: { fontsize: '16' },
      coords: { scrCoords: [1, 50, 50] }
    }
  };
  const board = {
    objects: {
      generatedCircumcenter,
      circumcircleABC: { elType: 'circumcircle', center: generatedCircumcenter }
    },
    options: { text: { display: 'html' } },
    origin: { scrCoords: [1, 0, 100] },
    unitX: 10,
    unitY: 10,
    renderer: {
      dumpToDataURI: () => `data:image/svg+xml;base64,${Buffer.from(rawSvg).toString('base64')}`
    },
    setAttribute(attrs) {
      this.options.text.display = attrs.text.display;
    },
    update() {}
  };

  const result = exportBoardPreviewSvg({
    board,
    selection: { xmin: 0, xmax: 10, ymin: -2, ymax: 10 }
  });

  assert.match(result, /id="jxg_circumcenter_labeled" fill="black" stroke="black" r="3" stroke-width="0"/);
  assert.match(result, />O<\/text>/);
});

test('exportBoardPreviewSvg normalizes geometry strokes across circles and polygon edges', () => {
  const rawSvg = [
    '<svg xmlns="http://www.w3.org/2000/svg">',
    '<circle id="jxg_circle" fill="none" stroke="red" stroke-width="1" r="40"></circle>',
    '<line id="jxg_triangle_edge" stroke="blue" stroke-width="4"></line>',
    '<path id="jxg_triangle_path" stroke="green" stroke-width="3" fill="none"></path>',
    '</svg>'
  ].join('');
  const board = {
    objects: {
      circle: { id: 'circle', registryId: 'CIRCLE', elType: 'circle' },
      triangleEdge: { id: 'triangle_edge', registryId: 'EDGE', elType: 'segment' },
      trianglePath: { id: 'triangle_path', registryId: 'TRIANGLE', elType: 'polygon' }
    },
    options: { text: { display: 'html' } },
    origin: { scrCoords: [1, 0, 100] },
    unitX: 10,
    unitY: 10,
    renderer: {
      dumpToDataURI: () => `data:image/svg+xml;base64,${Buffer.from(rawSvg).toString('base64')}`
    },
    setAttribute(attrs) {
      this.options.text.display = attrs.text.display;
    },
    update() {}
  };

  const result = exportBoardPreviewSvg({
    board,
    selection: { xmin: 0, xmax: 10, ymin: 0, ymax: 10 }
  });

  assert.match(result, /id="jxg_circle" fill="none" stroke="black" stroke-width="2"/);
  assert.match(result, /id="jxg_triangle_edge" stroke="black" stroke-width="2"/);
  assert.match(result, /id="jxg_triangle_path" stroke="black" stroke-width="2" fill="none"/);
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
