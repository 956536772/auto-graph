import assert from 'node:assert/strict';
import test from 'node:test';

import { ShapeRegistry } from '../src/lib/ShapeRegistry.js';
import {
  buildCircleDefinition,
  buildIsoscelesTriangleVertices,
  buildRectangleVertices
} from '../src/lib/manualTools/geometry.js';

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
