import JXG from 'jsxgraph';
import { TOOLS, shouldAutoReturnToSelect } from './constants.js';
import {
  buildEllipseDefinition,
  buildIsoscelesTriangleVertices,
  buildRectangleVertices,
  sameGeometryObject
} from './geometry.js';
import { getNextPointLabel, openPointLabelEditor } from './labels.js';

const POINT_TYPES = new Set(['point', 'glider']);
const PATH_TYPES = new Set(['segment', 'line', 'circle', 'ellipse']);
const LINEAR_PATH_TYPES = new Set(['segment', 'line']);
const PREVIEW_ATTRS = {
  dash: 2,
  strokeColor: '#999',
  strokeWidth: 1,
  fillColor: '#d9ecff',
  fillOpacity: 0.08,
  highlight: false
};

const HIDDEN_PREVIEW_POINT_ATTRS = {
  name: '',
  withLabel: false,
  size: 0,
  fixed: true,
  strokeOpacity: 0,
  fillOpacity: 0,
  highlight: false,
  showInfobox: false
};

function createInitialState() {
  return {
    dragStart: null,
    pendingUndoGroupCount: 0,
    previewMajorAxis: 0,
    previewShape: null,
    previewPoints: [],
    selectedPoints: [],
    selectedPath: null,
    segmentStart: null
  };
}

export class ManualDrawingController {
  constructor({ board, engine, registry, onStatusChange, onToolChange }) {
    this.board = board;
    this.engine = engine;
    this.registry = registry;
    this.onStatusChange = onStatusChange;
    this.onToolChange = onToolChange;
    this.activeTool = TOOLS.SELECT;
    this.state = createInitialState();
    this.idCounter = 0;

    this.handleDown = this.handleDown.bind(this);
    this.handleMove = this.handleMove.bind(this);
    this.handleUp = this.handleUp.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);

    this.board.on('down', this.handleDown);
    this.board.on('move', this.handleMove);
    this.board.on('up', this.handleUp);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  destroy() {
    this.resetState();
    this.board.off('down', this.handleDown);
    this.board.off('move', this.handleMove);
    this.board.off('up', this.handleUp);
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  setActiveTool(tool) {
    if (tool === this.activeTool) {
      return;
    }
    this.resetState({ discardPendingGroups: true });
    this.activeTool = tool;
  }

  resetState(options = {}) {
    if (options.discardPendingGroups) {
      this.discardPendingGroups();
    }
    this.clearPreview();
    this.state = createInitialState();
  }

  handleKeyDown(event) {
    if (event.key !== 'Escape') {
      return;
    }

    if (this.activeTool === TOOLS.SEGMENT && this.state.segmentStart) {
      event.preventDefault();
      this.completeAndReturn('已退出折线绘制', { discardPendingGroups: true, forceSelect: true });
      return;
    }

    const hasPendingSelection = this.state.selectedPoints.length > 0 || this.state.selectedPath || this.state.dragStart;
    if (hasPendingSelection) {
      event.preventDefault();
      this.completeAndReturn('已取消当前操作', { discardPendingGroups: true });
    }
  }

  handleDown(event) {
    switch (this.activeTool) {
      case TOOLS.POINT:
        this.handlePointTool(event);
        return;
      case TOOLS.SEGMENT:
        this.handleSegmentTool(event);
        return;
      case TOOLS.CIRCLE:
      case TOOLS.RECTANGLE:
      case TOOLS.TRIANGLE:
        this.state.dragStart = this.getMousePosition(event);
        this.onStatusChange(this.getDragStatus());
        return;
      case TOOLS.LABEL:
        this.handleLabelTool(event);
        return;
      case TOOLS.ANGLE:
        this.handlePointSequenceTool(event, 3, '角标记已完成', (points) => {
          this.engine.execute([{
            action: 'angle',
            params: {
              p1: this.toReference(points[0]),
              vertex: this.toReference(points[1]),
              p2: this.toReference(points[2])
            },
            result_id: this.nextId('angle')
          }]);
          this.commitPendingGroups(1);
        });
        return;
      case TOOLS.ANGLE_BISECTOR:
        this.handlePointSequenceTool(event, 3, '角平分线已完成', (points) => {
          this.engine.execute([{
            action: 'bisector',
            params: {
              p1: this.toReference(points[0]),
              vertex: this.toReference(points[1]),
              p2: this.toReference(points[2])
            },
            result_id: this.nextId('bisector')
          }]);
          this.commitPendingGroups(1);
        });
        return;
      case TOOLS.MIDPOINT:
        this.handlePointSequenceTool(event, 2, '中点已创建', (points) => {
          this.engine.execute([{
            action: 'midpoint',
            params: {
              p1: this.toReference(points[0]),
              p2: this.toReference(points[1])
            },
            result_id: this.nextId('midpoint'),
            label: getNextPointLabel(this.registry)
          }]);
          this.commitPendingGroups(1);
        });
        return;
      case TOOLS.PARALLEL:
        this.handleLinePointConstraintTool(event, 'parallel', '平行线已创建');
        return;
      case TOOLS.PERPENDICULAR:
        this.handleLinePointConstraintTool(event, 'perpendicular', '垂线已创建');
        return;
      default:
        return;
    }
  }

  handleMove(event) {
    if (!this.state.dragStart) {
      if (this.activeTool === TOOLS.SEGMENT && this.state.segmentStart && this.state.previewPoints[0]) {
        const coords = this.getMousePosition(event);
        this.state.previewPoints[0].setPosition(JXG.COORDS_BY_USER, [coords.x, coords.y]);
        this.board.update();
      }
      return;
    }

    const end = this.getMousePosition(event);

    if (this.activeTool === TOOLS.CIRCLE) {
      this.updateEllipsePreview(buildEllipseDefinition(this.state.dragStart, end, event.shiftKey));
      return;
    }

    if (this.activeTool === TOOLS.RECTANGLE) {
      this.updatePolygonPreview(buildRectangleVertices(this.state.dragStart, end, event.shiftKey));
      return;
    }

    if (this.activeTool === TOOLS.TRIANGLE) {
      this.updatePolygonPreview(buildIsoscelesTriangleVertices(this.state.dragStart, end, event.shiftKey));
    }
  }

  handleUp(event) {
    if (!this.state.dragStart) {
      return;
    }

    const end = this.getMousePosition(event);

    if (this.activeTool === TOOLS.CIRCLE) {
      const definition = buildEllipseDefinition(this.state.dragStart, end, event.shiftKey);
      if (definition.valid) {
        this.engine.execute([{
          action: 'ellipse',
          params: {
            cx: definition.cx,
            cy: definition.cy,
            rx: definition.rx,
            ry: definition.ry
          },
          result_id: this.nextId('ellipse')
        }]);
        this.completeAndReturn('圆或椭圆绘制完成');
        return;
      }
    }

    if (this.activeTool === TOOLS.RECTANGLE) {
      const definition = buildRectangleVertices(this.state.dragStart, end, event.shiftKey);
      if (definition.valid) {
        this.createPolygonFromVertices(definition.vertices, 'rectangle');
        this.completeAndReturn(event.shiftKey ? '正方形绘制完成' : '矩形绘制完成');
        return;
      }
    }

    if (this.activeTool === TOOLS.TRIANGLE) {
      const definition = buildIsoscelesTriangleVertices(this.state.dragStart, end, event.shiftKey);
      if (definition.valid) {
        this.createPolygonFromVertices(definition.vertices, 'triangle');
        this.completeAndReturn(event.shiftKey ? '等边三角形绘制完成' : '等腰三角形绘制完成');
        return;
      }
    }

    this.resetState();
    this.onStatusChange('拖拽距离过小，未创建图形');
  }

  handlePointTool(event) {
    const point = this.resolvePointSelection(event, { allowCreate: true, allowGlider: true });
    if (!point) {
      return;
    }

    this.completeAndReturn('点已创建');
  }

  handleSegmentTool(event) {
    const point = this.resolvePointSelection(event, { allowCreate: true, allowGlider: true });
    if (!point) {
      return;
    }

    if (!this.state.segmentStart) {
      this.state.segmentStart = point;
      this.createSegmentPreview(point);
      this.onStatusChange('已确定起点，点击下一个点继续折线，按 Esc 退出');
      return;
    }

    if (sameGeometryObject(this.state.segmentStart, point)) {
      this.onStatusChange('起点和终点不能相同，请重新选择');
      return;
    }

    this.engine.execute([{
      action: 'segment',
      params: {
        p1: this.toReference(this.state.segmentStart),
        p2: this.toReference(point)
      },
      result_id: this.nextId('segment')
    }]);
    this.commitPendingGroups(1);

    this.state.segmentStart = point;
    this.clearPreview();
    this.createSegmentPreview(point);
    this.onStatusChange('线段已创建，继续点击下一个点，或按 Esc 退出');
  }

  handleLabelTool(event) {
    const target = this.getTargetUnderMouse(event);
    if (!target || target.type !== 'point') {
      this.onStatusChange('请点击一个点来编辑标签');
      return;
    }

    openPointLabelEditor(target.obj, {
      board: this.board,
      suggestLabel: () => getNextPointLabel(this.registry)
    });
    this.completeAndReturn('点标签已更新');
  }

  handlePointSequenceTool(event, requiredCount, completionStatus, onComplete) {
    const point = this.resolvePointSelection(event, { allowCreate: true, allowGlider: true });
    if (!point) {
      return;
    }

    if (this.state.selectedPoints.some((current) => sameGeometryObject(current, point))) {
      this.onStatusChange('当前步骤不能重复选择同一个点');
      return;
    }

    this.state.selectedPoints.push(point);

    if (this.state.selectedPoints.length < requiredCount) {
      this.onStatusChange(this.getPointSequenceStatus(requiredCount));
      return;
    }

    onComplete(this.state.selectedPoints);
    this.completeAndReturn(completionStatus);
  }

  handleLinePointConstraintTool(event, action, completionStatus) {
    if (!this.state.selectedPath) {
      const target = this.getTargetUnderMouse(event);
      if (!target || target.type !== 'path' || !LINEAR_PATH_TYPES.has(target.obj.elType)) {
        this.onStatusChange('请先选择一条线段或直线');
        return;
      }
      this.state.selectedPath = target.obj;
      this.onStatusChange('已选择参考线，请点击一个点');
      return;
    }

    const point = this.resolvePointSelection(event, { allowCreate: true, allowGlider: false });
    if (!point) {
      return;
    }

    this.engine.execute([{
      action,
      params: {
        line: this.toReference(this.state.selectedPath),
        point: this.toReference(point)
      },
      result_id: this.nextId(action)
    }]);
    this.commitPendingGroups(1);

    this.completeAndReturn(completionStatus);
  }

  createPolygonFromVertices(vertices, prefix) {
    const usedLabels = this.collectUsedPointLabels();
    const pointInstructions = vertices.map((vertex) => {
      const resultId = this.nextId(`${prefix}_point`);
      const label = this.getNextAvailableLabel(usedLabels);
      usedLabels.add(label);
      return {
        action: 'place_point',
        params: { x: vertex.x, y: vertex.y },
        result_id: resultId,
        label
      };
    });

    this.engine.execute([
      ...pointInstructions,
      {
        action: 'polygon',
        params: {
          points: pointInstructions.map((instruction) => instruction.result_id)
        },
        result_id: this.nextId(prefix)
      }
    ]);
  }

  createSegmentPreview(point) {
    // JSXGraph can leave an invalid line object when a segment preview is tied to a hidden point.
    // Keep chained segment creation stable and omit the transient preview for now.
    void point;
    this.state.previewPoints = [];
    this.state.previewShape = null;
  }

  updateEllipsePreview(definition) {
    if (!definition.valid && !this.state.previewShape) {
      return;
    }

    if (!this.state.previewShape) {
      const focus1 = this.board.create('point', [definition.f1.x, definition.f1.y], HIDDEN_PREVIEW_POINT_ATTRS);
      const focus2 = this.board.create('point', [definition.f2.x, definition.f2.y], HIDDEN_PREVIEW_POINT_ATTRS);
      this.state.previewMajorAxis = definition.majorAxis;
      const previewShape = this.board.create('ellipse', [
        focus1,
        focus2,
        () => this.state.previewMajorAxis
      ], {
        ...PREVIEW_ATTRS,
        fillColor: 'none'
      });
      this.state.previewPoints = [focus1, focus2];
      this.state.previewShape = previewShape;
    }

    if (!definition.valid) {
      return;
    }

    this.state.previewMajorAxis = definition.majorAxis;
    this.state.previewPoints[0].setPosition(JXG.COORDS_BY_USER, [definition.f1.x, definition.f1.y]);
    this.state.previewPoints[1].setPosition(JXG.COORDS_BY_USER, [definition.f2.x, definition.f2.y]);
    this.board.update();
  }

  updatePolygonPreview(definition) {
    if (!definition.valid && !this.state.previewShape) {
      return;
    }

    if (!this.state.previewShape) {
      const previewPoints = definition.vertices.map((vertex) => this.board.create('point', [vertex.x, vertex.y], HIDDEN_PREVIEW_POINT_ATTRS));
      const previewShape = this.board.create('polygon', previewPoints, PREVIEW_ATTRS);
      this.state.previewPoints = previewPoints;
      this.state.previewShape = previewShape;
    }

    definition.vertices.forEach((vertex, index) => {
      const previewPoint = this.state.previewPoints[index];
      previewPoint.setPosition(JXG.COORDS_BY_USER, [vertex.x, vertex.y]);
    });
    this.board.update();
  }

  clearPreview() {
    if (this.state.previewShape) {
      try {
        this.board.removeObject(this.state.previewShape);
      } catch (error) {
        console.error('移除预览图形失败:', error);
      }
    }

    this.state.previewPoints.slice().reverse().forEach((point) => {
      try {
        this.board.removeObject(point);
      } catch (error) {
        console.error('移除预览点失败:', error);
      }
    });

    this.state.previewShape = null;
    this.state.previewPoints = [];
  }

  resolvePointSelection(event, { allowCreate, allowGlider }) {
    const target = this.getTargetUnderMouse(event);
    const coords = this.getMousePosition(event);

    if (target?.type === 'point') {
      return target.obj;
    }

    if (allowGlider && target?.type === 'path') {
      return this.createPointFromInstruction({
        action: 'glider',
        params: {
          x: coords.x,
          y: coords.y,
          path: this.toReference(target.obj)
        }
      });
    }

    if (!allowCreate) {
      this.onStatusChange('请点击一个已有点');
      return null;
    }

    return this.createPointFromInstruction({
      action: 'place_point',
      params: {
        x: coords.x,
        y: coords.y
      }
    });
  }

  createPointFromInstruction(instruction) {
    const [result] = this.engine.execute([{
      ...instruction,
      result_id: this.nextId('point'),
      label: getNextPointLabel(this.registry)
    }]);
    if (result?.object) {
      this.state.pendingUndoGroupCount += 1;
    }
    return result?.object || null;
  }

  completeAndReturn(status, options = {}) {
    this.resetState({ discardPendingGroups: options.discardPendingGroups });
    this.onStatusChange(status);
    if (options.forceSelect || shouldAutoReturnToSelect(this.activeTool)) {
      this.activeTool = TOOLS.SELECT;
      this.onToolChange(TOOLS.SELECT);
    }
  }

  commitPendingGroups(currentGroupCount = 0) {
    const totalGroups = this.state.pendingUndoGroupCount + currentGroupCount;
    if (totalGroups > 1) {
      this.registry.mergeLastUndoEntries(totalGroups);
    }
    this.state.pendingUndoGroupCount = 0;
  }

  discardPendingGroups() {
    for (let index = 0; index < this.state.pendingUndoGroupCount; index += 1) {
      this.registry.undo(this.board);
    }
    this.state.pendingUndoGroupCount = 0;
  }

  getPointSequenceStatus(requiredCount) {
    const step = this.state.selectedPoints.length + 1;
    if (requiredCount === 2) {
      return '已选择第一个点，请选择第二个点';
    }
    if (requiredCount === 3) {
      const prompts = ['请先选择角的一侧点', '请再选择顶点', '请最后选择另一侧点'];
      return prompts[step - 1] || `请继续选择第 ${step} 个点`;
    }
    return `请继续选择第 ${step} 个点`;
  }

  getDragStatus() {
    switch (this.activeTool) {
      case TOOLS.CIRCLE:
        return '拖动鼠标绘制圆或椭圆，按住 Shift 画正圆';
      case TOOLS.RECTANGLE:
        return '拖动鼠标绘制矩形，按住 Shift 画正方形';
      case TOOLS.TRIANGLE:
        return '拖动鼠标绘制等腰三角形，按住 Shift 画等边三角形';
      default:
        return '拖动鼠标绘制图形';
    }
  }

  getTargetUnderMouse(event) {
    const elements = this.board.getAllObjectsUnderMouse(event) || [];
    if (elements.length === 0) {
      return null;
    }

    const point = elements.find((element) => POINT_TYPES.has(element.elType) && element.visProp?.visible !== false);
    if (point) {
      return { type: 'point', obj: point };
    }

    const path = elements.find((element) => PATH_TYPES.has(element.elType));
    if (path) {
      return { type: 'path', obj: path };
    }

    return null;
  }

  getMousePosition(event) {
    const coords = this.board.getUsrCoordsOfMouse(event);
    return { x: coords[0], y: coords[1] };
  }

  nextId(prefix) {
    this.idCounter += 1;
    return `${prefix}_${Date.now()}_${this.idCounter}`;
  }

  collectUsedPointLabels() {
    const labels = new Set();
    this.registry.entries().forEach(([, obj]) => {
      if (!obj || (obj.elType !== 'point' && obj.elType !== 'glider')) {
        return;
      }
      if (typeof obj.getName === 'function' && obj.getName()) {
        labels.add(obj.getName());
      }
    });
    return labels;
  }

  getNextAvailableLabel(usedLabels) {
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      if (!usedLabels.has(letter)) {
        return letter;
      }
    }

    let index = 1;
    while (usedLabels.has(`P${index}`)) {
      index += 1;
    }
    return `P${index}`;
  }

  toReference(object) {
    if (!object) {
      return null;
    }
    return object.registryId || object;
  }
}
