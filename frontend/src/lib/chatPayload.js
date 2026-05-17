export const INITIAL_AI_MESSAGE = {
  role: 'ai',
  text: '你好！我是你的几何助手。你可以让我画三角形、作外接圆/内切圆、过圆上一点作切线，或求两圆交点。'
};

export function buildChatRequestPayload({ text, registry }) {
  return {
    text,
    context: registry?.serialize?.() || []
  };
}
