import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildChatRequestPayload
} from '../src/lib/chatPayload.js';

test('buildChatRequestPayload sends only current canvas context', () => {
  const registry = {
    serialize() {
      return [{ id: 'A', type: 'point', label: 'A', coords: [1, 2] }];
    }
  };

  const payload = buildChatRequestPayload({
    text: '继续作AB中点',
    registry
  });

  assert.equal(payload.text, '继续作AB中点');
  assert.deepEqual(payload.context, [{ id: 'A', type: 'point', label: 'A', coords: [1, 2] }]);
  assert.equal(Object.hasOwn(payload, 'history'), false);
});

test('buildChatRequestPayload sends empty context after clear', () => {
  const payload = buildChatRequestPayload({
    text: '画一个三角形',
    registry: { serialize: () => [] }
  });

  assert.deepEqual(payload.context, []);
  assert.equal(Object.hasOwn(payload, 'history'), false);
});

test('buildChatRequestPayload includes optional image payload', () => {
  const payload = buildChatRequestPayload({
    text: '根据图片画图',
    registry: { serialize: () => [] },
    image: {
      mediaType: 'image/png',
      data: 'abc123',
      name: 'diagram.png'
    }
  });

  assert.deepEqual(payload.image, {
    mediaType: 'image/png',
    data: 'abc123',
    name: 'diagram.png'
  });
});
