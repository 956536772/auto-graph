import JXG from 'jsxgraph';
import { TOOLS, shouldAutoReturnToSelect } from './constants.js';
import {
  buildCircleDefinition,
  buildIsoscelesTriangleVertices,
  buildPolygonInstructionsFromVertices,
  buildRectangleVertices,
  getToolSwitchStatus,
  sameGeometryObject
} from './geometry.js';
import { getNextPointLabel, openPointLabelEditor } from './labels.js';
import { chooseTargetFromElements, isRegisteredSelectableElement, preferPointSnapTarget } from './selection.js';

const POINT_TYPES = new Set(['point', 'glider']);
const PATH_TYPES = new Set(['segment', 'line', 'circle', 'ellipse']);
const LINEAR_PATH_TYPES = new Set(['segment', 'line']);
const SNAP_RADIUS_PX = 14;
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
    previewKind: null,
    previewShape: null,
    previewPoints: [],
    segmentChainPoints: [],
    segmentIds: [],
    selectedObject: null,
    selectedSnapshot: null,
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
    this.handleDoubleClick = this.handleDoubleClick.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.closeObjectMenu = this.closeObjectMenu.bind(this);

    this.board.on('down', this.handleDown);
    this.board.on('move', this.handleMove);
    this.board.on('up', this.handleUp);
    this.board.on('dblclick', this.handleDoubleClick);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('pointerdown', this.closeObjectMenu);
  }

  destroy() {
    this.resetState();
    this.removeObjectMenu();
    this.board.off('down', this.handleDown);
    this.board.off('move', this.handleMove);
    this.board.off('up', this.handleUp);
    this.board.off('dblclick', this.handleDoubleClick);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('pointerdown', this.closeObjectMenu);
  }

  setActiveTool(tool) {
    if (tool === this.activeTool) {
      return;
    }
    const previousTool = this.activeTool;
    const hadPendingState = this.hasPendingInteraction();
    this.resetState({ discardPendingGroups: true });
    this.activeTool = tool;
    if (hadPendingState) {
      this.onStatusChange(getToolSwitchStatus(previousTool, tool, TOOLS.SELECT));
    }
  }

  resetState(options = {}) {
    if (options.discardPendingGroups) {
      this.discardPendingGroups();
    }
    this.clearPreview();
    this.clearSelection();
    this.closeObjectMenu();
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

  hasPendingInteraction() {
    return Boolean(
      this.state.dragStart ||
      this.state.previewShape ||
      this.state.segmentStart ||
      this.state.pendingUndoGroupCount > 0 ||
      this.state.selectedPoints.length > 0 ||
      this.state.selectedPath
    );
  }

  handleDown(event) {
    switch (this.activeTool) {
      case TOOLS.SELECT:
        this.handleSelectTool(event);
        return;
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
      if (this.activeTool === TOOLS.SEGMENT && this.state.segmentStart && this.state.previewShape) {
        const coords = this.getSnappedPosition(event);
        this.updateSegmentPreview(coords);
      }
      return;
    }

    const end = this.getMousePosition(event);

    if (this.activeTool === TOOLS.CIRCLE) {
      this.updateCirclePreview(buildCircleDefinition(this.state.dragStart, end));
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
      const definition = buildCircleDefinition(this.state.dragStart, end);
      if (definition.valid) {
        this.engine.execute([{
          action: 'circle',
          params: {
            cx: definition.cx,
            cy: definition.cy,
            radius: definition.radius,
            centerLabel: getNextPointLabel(this.registry),
            centerResultId: this.nextId('circle_center')
          },
          result_id: this.nextId('circle')
        }]);
        this.completeAndReturn('圆绘制完成');
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

  handleSelectTool(event) {
    const target = this.getTargetUnderMouse(event, { includeShapes: true }) || this.getNearestSnapTarget(event, { includePath: true });
    if (!target) {
      this.clearSelection();
      this.closeObjectMenu();
      return;
    }

    this.selectObject(target.obj);
    this.onStatusChange('已选中对象，双击可打开操作菜单');
  }

  handleDoubleClick(event) {
    if (this.activeTool !== TOOLS.SELECT) {
      return;
    }

    const target = this.getTargetUnderMouse(event, { includeShapes: true }) || this.getNearestSnapTarget(event, { includePath: true });
    if (!target) {
      this.closeObjectMenu();
      return;
    }

    if (event?.preventDefault) {
      event.preventDefault();
    }
    if (event?.stopPropagation) {
      event.stopPropagation();
    }

    this.selectObject(target.obj);
    this.showObjectMenu(event, target.obj);
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
      this.state.segmentChainPoints = [point];
      this.createSegmentPreview(point);
      this.onStatusChange('已确定起点，点击下一个点继续折线，按 Esc 退出');
      return;
    }

    if (sameGeometryObject(this.state.segmentStart, point)) {
      this.onStatusChange('起点和终点不能相同，请重新选择');
      return;
    }

    const segmentId = this.nextId('segment');
    this.engine.execute([{
      action: 'segment',
      params: {
        p1: this.toReference(this.state.segmentStart),
        p2: this.toReference(point)
      },
      result_id: segmentId
    }]);
    this.state.segmentIds.push(segmentId);

    if (this.isClosingSegmentChain(point)) {
      const polygonId = this.nextId('closed_polygon');
      this.engine.execute([{
        action: 'polygon',
        params: {
          points: this.state.segmentChainPoints.map((chainPoint) => this.toReference(chainPoint))
        },
        result_id: polygonId,
        meta: {
          closedSegmentIds: [...this.state.segmentIds]
        }
      }]);
      this.commitPendingGroups(2);
      this.completeAndReturn('封闭图形已创建：保留边并生成整体图形', { forceSelect: true });
      return;
    }

    this.commitPendingGroups(1);

    this.state.segmentStart = point;
    this.state.segmentChainPoints.push(point);
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
    const instructions = buildPolygonInstructionsFromVertices(vertices, prefix, {
      nextId: (idPrefix) => this.nextId(idPrefix),
      nextLabel: () => {
        const label = this.getNextAvailableLabel(usedLabels);
        usedLabels.add(label);
        return label;
      }
    });
    this.engine.execute(instructions);
  }

  createSegmentPreview(point) {
    const previewShape = this.board.create('curve', [[point.X(), point.X()], [point.Y(), point.Y()]], {
      ...PREVIEW_ATTRS,
      strokeColor: '#1890ff',
      fillColor: 'none'
    });
    this.state.previewKind = 'segment';
    this.state.previewShape = previewShape;
  }

  updateSegmentPreview(end) {
    if (!this.state.previewShape || !this.state.segmentStart) {
      return;
    }

    this.state.previewShape.dataX = [this.state.segmentStart.X(), end.x];
    this.state.previewShape.dataY = [this.state.segmentStart.Y(), end.y];
    this.board.update();
  }

  updateCirclePreview(definition) {
    if (!definition.valid && !this.state.previewShape) {
      return;
    }

    if (!this.state.previewShape) {
      const center = this.board.create('point', [definition.cx, definition.cy], HIDDEN_PREVIEW_POINT_ATTRS);
      const edge = this.board.create('point', [definition.edge.x, definition.edge.y], HIDDEN_PREVIEW_POINT_ATTRS);
      const previewShape = this.board.create('circle', [
        center,
        edge
      ], {
        ...PREVIEW_ATTRS,
        fillColor: 'none'
      });
      this.state.previewPoints = [center, edge];
      this.state.previewShape = previewShape;
    }

    if (!definition.valid) {
      return;
    }

    this.state.previewPoints[0].setPosition(JXG.COORDS_BY_USER, [definition.cx, definition.cy]);
    this.state.previewPoints[1].setPosition(JXG.COORDS_BY_USER, [definition.edge.x, definition.edge.y]);
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
    this.state.previewKind = null;
    this.state.previewPoints = [];
  }

  resolvePointSelection(event, { allowCreate, allowGlider }) {
    const directTarget = this.getTargetUnderMouse(event);
    const snapTarget = directTarget || this.getNearestSnapTarget(event, { includePath: allowGlider });
    const coords = this.getSnappedPosition(event, snapTarget);

    if (snapTarget?.type === 'point') {
      this.selectObject(snapTarget.obj);
      return snapTarget.obj;
    }

    if (allowGlider && snapTarget?.type === 'path') {
      return this.createPointFromInstruction({
        action: 'glider',
        params: {
          x: coords.x,
          y: coords.y,
          path: this.toReference(snapTarget.obj)
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

  isClosingSegmentChain(point) {
    return this.state.segmentChainPoints.length >= 3 && sameGeometryObject(this.state.segmentChainPoints[0], point);
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
        return '按住圆心并拖动半径绘制圆';
      case TOOLS.RECTANGLE:
        return '拖动鼠标绘制矩形，按住 Shift 画正方形';
      case TOOLS.TRIANGLE:
        return '拖动鼠标绘制等腰三角形，按住 Shift 画等边三角形';
      default:
        return '拖动鼠标绘制图形';
    }
  }

  getTargetUnderMouse(event, options = {}) {
    const elements = this.board.getAllObjectsUnderMouse(event) || [];
    return chooseTargetFromElements(elements, this.registry, options);
  }

  getNearestSnapTarget(event, options = {}) {
    const mouse = this.getMousePosition(event);
    let nearest = null;

    this.registry.entries().forEach(([, obj]) => {
      if (!obj || obj.visProp?.visible === false) {
        return;
      }

      if (POINT_TYPES.has(obj.elType)) {
        const distance = this.distanceToPointPx(mouse, obj);
        if (distance <= SNAP_RADIUS_PX) {
          nearest = preferPointSnapTarget(nearest, { type: 'point', obj, distance });
        }
        return;
      }

      if (options.includePath && PATH_TYPES.has(obj.elType) && typeof obj.hasPoint === 'function') {
        const screen = this.toScreenCoords(mouse);
        if (obj.hasPoint(screen.x, screen.y)) {
          nearest = preferPointSnapTarget(nearest, { type: 'path', obj, distance: SNAP_RADIUS_PX });
        }
      }
    });

    return nearest;
  }

  getMousePosition(event) {
    const coords = this.board.getUsrCoordsOfMouse(event);
    return { x: coords[0], y: coords[1] };
  }

  getSnappedPosition(event, snapTarget = null) {
    const target = snapTarget || this.getNearestSnapTarget(event, { includePath: true });
    if (target?.type === 'point') {
      return { x: target.obj.X(), y: target.obj.Y() };
    }
    return this.getMousePosition(event);
  }

  distanceToPointPx(mouse, point) {
    const screen = this.toScreenCoords(mouse);
    const pointScreen = this.toScreenCoords({ x: point.X(), y: point.Y() });
    return Math.hypot(screen.x - pointScreen.x, screen.y - pointScreen.y);
  }

  toScreenCoords(coords) {
    return {
      x: this.board.origin.scrCoords[1] + coords.x * this.board.unitX,
      y: this.board.origin.scrCoords[2] - coords.y * this.board.unitY
    };
  }

  selectObject(obj) {
    if (!this.registry.idForObject(obj)) {
      this.onStatusChange('请选择可编辑的对象');
      return;
    }

    if (!obj || this.state.selectedObject === obj) {
      return;
    }

    this.clearSelection();
    this.state.selectedObject = obj;
    this.state.selectedSnapshot = this.readHighlightSnapshot(obj);
    this.applyHighlight(obj);
    this.board.update();
  }

  clearSelection() {
    if (!this.state.selectedObject) {
      return;
    }

    this.restoreHighlight(this.state.selectedObject, this.state.selectedSnapshot);
    this.state.selectedObject = null;
    this.state.selectedSnapshot = null;
    this.board.update();
  }

  readHighlightSnapshot(obj) {
    return {
      strokeColor: obj.visProp?.strokecolor,
      fillColor: obj.visProp?.fillcolor,
      strokeWidth: obj.visProp?.strokewidth,
      fillOpacity: obj.visProp?.fillopacity
    };
  }

  applyHighlight(obj) {
    obj.setAttribute({
      strokeColor: '#fa8c16',
      strokeWidth: Math.max(Number(obj.visProp?.strokewidth) || 2, 4),
      fillColor: obj.elType === 'point' || obj.elType === 'glider' ? '#fa8c16' : '#fff7e6',
      fillOpacity: obj.elType === 'point' || obj.elType === 'glider' ? 1 : 0.32
    });
  }

  restoreHighlight(obj, snapshot) {
    if (!obj || !snapshot) {
      return;
    }
    obj.setAttribute({
      strokeColor: snapshot.strokeColor,
      strokeWidth: snapshot.strokeWidth,
      fillColor: snapshot.fillColor,
      fillOpacity: snapshot.fillOpacity
    });
  }

  showObjectMenu(event, obj) {
    this.removeObjectMenu();
    const menu = document.createElement('div');
    menu.className = 'object-action-menu';
    menu.innerHTML = '<button type="button">删除</button>';
    menu.style.left = `${event.clientX + 8}px`;
    menu.style.top = `${event.clientY + 8}px`;
    menu.addEventListener('pointerdown', (menuEvent) => {
      menuEvent.stopPropagation();
    });
    menu.querySelector('button').addEventListener('click', () => {
      this.deleteObject(obj);
    });
    document.body.appendChild(menu);
    this.objectMenu = menu;
  }

  closeObjectMenu(event) {
    if (event && this.objectMenu?.contains(event.target)) {
      return;
    }
    this.removeObjectMenu();
  }

  removeObjectMenu() {
    if (this.objectMenu) {
      this.objectMenu.remove();
      this.objectMenu = null;
    }
  }

  deleteObject(obj) {
    const target = obj || this.state.selectedObject;
    const removedId = this.registry.removeObject(this.board, target);
    if (this.state.selectedObject === target) {
      this.state.selectedObject = null;
      this.state.selectedSnapshot = null;
    } else {
      this.clearSelection();
    }
    this.removeObjectMenu();
    this.onStatusChange(removedId ? '对象已删除' : '没有找到可删除对象');
    this.board.update();
  }

  isSelectableElement(element) {
    return isRegisteredSelectableElement(element, this.registry);
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
