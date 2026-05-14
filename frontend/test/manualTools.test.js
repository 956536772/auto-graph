import assert from 'node:assert/strict';
import test from 'node:test';

import { ShapeRegistry } from '../src/lib/ShapeRegistry.js';
import {
  buildEllipseDefinition,
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

test('buildEllipseDefinition constrains circles when Shift is held', () => {
  const ellipse = buildEllipseDefinition({ x: 0, y: 0 }, { x: 6, y: 2 }, true);

  assert.equal(ellipse.valid, true);
  assert.equal(ellipse.rx, 3);
  assert.equal(ellipse.ry, 3);
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
