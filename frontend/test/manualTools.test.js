import assert from 'node:assert/strict';
import test from 'node:test';

import { ShapeRegistry } from '../src/lib/ShapeRegistry.js';
import { TOOLS } from '../src/lib/manualTools/constants.js';
import {
  buildCircleDefinition,
  buildIsoscelesTriangleVertices,
  buildPolygonInstructionsFromVertices,
  buildRectangleVertices,
  getToolSwitchStatus
} from '../src/lib/manualTools/geometry.js';
import { chooseTargetFromElements, preferPointSnapTarget } from '../src/lib/manualTools/selection.js';

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

test('ShapeRegistry removes an object and cleans history plus undo stack', () => {
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

  assert.equal(registry.undo(board), 'C');
  assert.deepEqual(removed, ['B', 'C']);
  assert.deepEqual(registry.history, ['A']);
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
