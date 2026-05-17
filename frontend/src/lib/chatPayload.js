export const INITIAL_AI_MESSAGE = {
  role: 'ai',
  text: '你好！我是你的几何助手。你可以让我画三角形、作外接圆/内切圆、过圆上一点作切线，或求两圆交点。'
};

export function buildChatRequestPayload({ text, registry, image = null }) {
  const payload = {
    text,
    context: registry?.serialize?.() || []
  };

  if (image) {
    payload.image = {
      mediaType: image.mediaType,
      data: image.data,
      name: image.name
    };
  }

  return payload;
}
