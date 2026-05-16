export const TOOLS = {
  SELECT: '选择',
  POINT: '点',
  SEGMENT: '线段',
  CIRCLE: '圆',
  RECTANGLE: '矩形',
  TRIANGLE: '三角形',
  LABEL: '标签',
  ANGLE: '角标记',
  PARALLEL: '平行',
  PERPENDICULAR: '垂直',
  MIDPOINT: '中点',
  ANGLE_BISECTOR: '角平分线',
  UNDO: '撤销',
  REDO: '重做',
  CLEAR: '清空'
};

export const DRAWING_TOOL_SET = new Set([
  TOOLS.POINT,
  TOOLS.SEGMENT,
  TOOLS.CIRCLE,
  TOOLS.RECTANGLE,
  TOOLS.TRIANGLE,
  TOOLS.LABEL,
  TOOLS.ANGLE,
  TOOLS.PARALLEL,
  TOOLS.PERPENDICULAR,
  TOOLS.MIDPOINT,
  TOOLS.ANGLE_BISECTOR
]);

export function shouldAutoReturnToSelect(tool) {
  return tool !== TOOLS.SELECT && tool !== TOOLS.SEGMENT;
}
