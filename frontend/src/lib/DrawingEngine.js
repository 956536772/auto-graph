import JXG from 'jsxgraph';
import { getNextPointLabel } from './manualTools/labels.js';
import { createBoardPanDragGuard } from './manualTools/panDragGuard.js';

export class DrawingEngine {
    constructor(board, registry, options = {}) {
        this.board = board;
        this.registry = registry;
        this.options = options;
        this.registry.setSnapshotFactory?.((entry) => this.createObjectFromSnapshot(entry));
        this.registry.setRestoreHandler?.((obj, entry) => {
            this.attachHistoryListeners(obj);
            if (typeof this.options.onObjectCreated === 'function') {
                this.options.onObjectCreated(obj, { restored: true, snapshot: entry });
            }
        });
    }
    execute(instructions) {
        const results = [];
        this.registry.beginUndoBatch?.();
        this.board.suspendUpdate?.();
        try {
            (instructions || []).forEach((ins) => {
                try {
                    const obj = this.processInstruction(ins);
                    results.push({
                        instruction: ins,
                        action: ins?.action || '',
                        object: obj || null,
                        success: true
                    });
                } catch (err) {
                    console.error('指令执行失败:', err);
                    results.push({
                        instruction: ins,
                        action: ins?.action || '',
                        object: null,
                        success: false,
                        error: this.executionErrorMessage(err)
                    });
                }
            });
        } finally {
            this.board.unsuspendUpdate?.();
            this.registry.endUndoBatch?.();
        }
        return this.decorateExecutionResults(results);
    }
    processInstruction(ins) {
        if (!ins || !ins.action) {
            throw new Error('unsupported action');
        }
        const { action, params = {}, result_id, label, meta } = ins;
        let obj = null;
        const commonAttr = this.getCommonAttributes(label);
        const objectlessAction = action === 'show_axis' || action === 'delete_object';
        if (!objectlessAction && !result_id) {
            throw new Error('missing result_id');
        }

        switch (action) {
                case 'place_point':
                    obj = this.board.create('point', [
                        this.requireNumberParam(params, 'x'),
                        this.requireNumberParam(params, 'y')
                    ], commonAttr);
                    break;
                case 'segment':
                    obj = this.board.create('segment', [
                        this.resolveRequiredRef(params.p1, 'p1'),
                        this.resolveRequiredRef(params.p2, 'p2')
                    ], {
                        ...commonAttr, draggable: true
                    });
                    this.addHoverCursor(obj);
                    break;
                case 'line':
                    obj = this.board.create('line', [
                        this.resolveRequiredRef(params.p1, 'p1'),
                        this.resolveRequiredRef(params.p2, 'p2')
                    ], {
                        ...commonAttr, draggable: true
                    });
                    this.addHoverCursor(obj);
                    break;
                case 'midpoint':
                    obj = this.board.create('midpoint', [
                        this.resolveRequiredRef(params.p1, 'p1'),
                        this.resolveRequiredRef(params.p2, 'p2')
                    ], commonAttr);
                    break;
                case 'perpendicular':
                    obj = this.board.create('perpendicular', [
                        this.resolveRequiredRef(params.line, 'line'),
                        this.resolveRequiredRef(params.point, 'point')
                    ], {
                        ...commonAttr, draggable: true
                    });
                    this.addHoverCursor(obj);
                    break;
                case 'parallel':
                    obj = this.board.create('parallel', [
                        this.resolveRequiredRef(params.line, 'line'),
                        this.resolveRequiredRef(params.point, 'point')
                    ], {
                        ...commonAttr, draggable: true
                    });
                    this.addHoverCursor(obj);
                    break;
                case 'circle': {
                    let center;
                    let through;
                    let hiddenControlPoints = null;

                    if (typeof params.cx === 'number' && typeof params.cy === 'number' && typeof params.radius === 'number') {
                        const cx = this.requireNumberParam(params, 'cx');
                        const cy = this.requireNumberParam(params, 'cy');
                        const radius = this.requireNumberParam(params, 'radius');
                        if (radius <= 0) {
                            throw new Error('invalid radius');
                        }
                        center = this.board.create('point', [cx, cy], {
                            ...commonAttr,
                            name: params.centerLabel || '',
                            withLabel: Boolean(params.centerLabel),
                            label: { fixed: false },
                            fixed: true,
                            highlight: false,
                            showInfobox: false
                        });
                        through = this.board.create('point', [cx + radius, cy], {
                            visible: false,
                            name: '',
                            fixed: true,
                            highlight: false,
                            showInfobox: false
                        });
                        hiddenControlPoints = [through];
                    } else {
                        center = this.resolveRequiredRef(params.center, 'center');
                        through = this.resolveRequiredRef(params.through, 'through');
                    }

                    obj = this.board.create('circle', [center, through], {
                        ...commonAttr, draggable: true, hasInnerPoints: true,
                        fillColor: '#1890ff', fillOpacity: 0.1
                    });
                    if (obj && hiddenControlPoints) {
                        this.attachTranslationDrag(obj, [center, ...hiddenControlPoints]);
                        obj.on('remove', () => {
                            hiddenControlPoints.forEach((point) => this.safeRemoveObject(point));
                        });
                    }
                    this.addHoverCursor(obj);
                    break;
                }
                case 'circumcircle':
                    obj = this.board.create('circumcircle', [
                        this.resolveRequiredRef(params.p1, 'p1'),
                        this.resolveRequiredRef(params.p2, 'p2'),
                        this.resolveRequiredRef(params.p3, 'p3')
                    ], {
                        ...commonAttr, draggable: true, hasInnerPoints: true,
                        fillColor: '#1890ff', fillOpacity: 0.1
                    });
                    this.addHoverCursor(obj);
                    break;
                case 'incircle':
                    obj = this.board.create('incircle', [
                        this.resolveRequiredRef(params.p1, 'p1'),
                        this.resolveRequiredRef(params.p2, 'p2'),
                        this.resolveRequiredRef(params.p3, 'p3')
                    ], {
                        ...commonAttr, draggable: true, hasInnerPoints: true,
                        fillColor: '#1890ff', fillOpacity: 0.1
                    });
                    this.addHoverCursor(obj);
                    break;
                case 'ellipse': {
                    const cx = this.requireNumberParam(params, 'cx');
                    const cy = this.requireNumberParam(params, 'cy');
                    const rx = this.requireNumberParam(params, 'rx');
                    const ry = this.requireNumberParam(params, 'ry');
                    if (Math.abs(rx - ry) < 0.001) {
                        const pCenter = this.board.create('point', [cx, cy], { visible: false, name: '' });
                        const pThrough = this.board.create('point', [cx + rx, cy], { visible: false, name: '' });
                        obj = this.board.create('circle', [pCenter, pThrough], {
                            ...commonAttr, draggable: true, hasInnerPoints: true,
                            fillColor: '#1890ff', fillOpacity: 0.1
                        });
                        if (obj) {
                            this.attachTranslationDrag(obj, [pCenter, pThrough]);
                            obj.on('remove', () => {
                                this.safeRemoveObject(pCenter);
                                this.safeRemoveObject(pThrough);
                            });
                        }
                    } else {
                        const c = Math.sqrt(Math.abs(rx * rx - ry * ry));
                        let f1;
                        let f2;
                        let pointOnEllipse;
                        if (rx > ry) {
                            f1 = this.board.create('point', [cx - c, cy], { visible: false, name: '' });
                            f2 = this.board.create('point', [cx + c, cy], { visible: false, name: '' });
                            pointOnEllipse = this.board.create('point', [cx + rx, cy], { visible: false, name: '' });
                        } else {
                            f1 = this.board.create('point', [cx, cy - c], { visible: false, name: '' });
                            f2 = this.board.create('point', [cx, cy + c], { visible: false, name: '' });
                            pointOnEllipse = this.board.create('point', [cx, cy + ry], { visible: false, name: '' });
                        }
                        obj = this.board.create('ellipse', [f1, f2, pointOnEllipse], {
                            ...commonAttr, draggable: true, hasInnerPoints: true,
                            fillColor: '#1890ff', fillOpacity: 0.1
                        });
                        if (obj) {
                            this.attachTranslationDrag(obj, [f1, f2, pointOnEllipse]);
                            obj.on('remove', () => {
                                this.safeRemoveObject(f1);
                                this.safeRemoveObject(f2);
                                this.safeRemoveObject(pointOnEllipse);
                            });
                        }
                    }
                    this.addHoverCursor(obj);
                    break;
                }
                case 'polygon': {
                    if (!Array.isArray(params.points) || params.points.length < 3) {
                        throw new Error('missing points');
                    }
                    const pts = params.points.map((id) => this.resolveRequiredRef(id, 'points'));
                    obj = this.board.create('polygon', pts, {
                        ...commonAttr, fillColor: '#1890ff', fillOpacity: 0.2,
                        draggable: true, hasInnerPoints: true
                    });
                    this.addHoverCursor(obj);
                    break;
                }
                case 'glider':
                    obj = this.board.create('glider', [
                        this.requireNumberParam(params, 'x'),
                        this.requireNumberParam(params, 'y'),
                        this.resolveRequiredRef(params.path, 'path')
                    ], {
                        ...commonAttr, strokeColor: '#ff4d4f', fillColor: '#fff'
                    });
                    break;
                case 'intersection': {
                    obj = this.board.create('intersection', [
                        this.resolveRequiredRef(params.first, 'first'),
                        this.resolveRequiredRef(params.second, 'second'),
                        params.index ?? 0
                    ], commonAttr);
                    break;
                }
                case 'otherintersection': {
                    obj = this.board.create('otherintersection', [
                        this.resolveRequiredRef(params.first, 'first'),
                        this.resolveRequiredRef(params.second, 'second'),
                        this.resolveRequiredRef(params.known, 'known')
                    ], commonAttr);
                    break;
                }
                case 'tangent':
                    obj = this.board.create('tangent', [
                        this.resolveRequiredRef(params.circle, 'circle'),
                        this.resolveRequiredRef(params.point, 'point')
                    ], {
                        ...commonAttr, draggable: true
                    });
                    this.addHoverCursor(obj);
                    break;
                case 'bisector':
                    obj = this.board.create('bisector', [
                        this.resolveRequiredRef(params.p1, 'p1'),
                        this.resolveRequiredRef(params.vertex, 'vertex'),
                        this.resolveRequiredRef(params.p2, 'p2')
                    ], {
                        ...commonAttr, draggable: true
                    });
                    this.addHoverCursor(obj);
                    break;
                case 'angle':
                    obj = this.board.create('angle', [
                        this.resolveRequiredRef(params.p1, 'p1'),
                        this.resolveRequiredRef(params.vertex, 'vertex'),
                        this.resolveRequiredRef(params.p2, 'p2')
                    ], {
                        ...commonAttr,
                        radius: 1,
                        fillColor: '#91caff',
                        fillOpacity: 0.2,
                        strokeColor: '#0958d9',
                        strokeWidth: 2
                    });
                    break;
                case 'function_graph':
                    if (typeof params.expr !== 'string' || !params.expr.trim()) {
                        throw new Error('missing expr');
                    }
                    obj = this.board.create('functiongraph', [new Function('x', `return ${params.expr};`)], {
                        ...commonAttr,
                        strokeColor: '#1890ff',
                        strokeWidth: 2
                    });
                    if (obj) {
                        obj.meta = { ...(obj.meta || {}), expr: params.expr };
                    }
                    break;
                case 'show_axis': {
                    const visible = params.visible !== false;
                    if (this.board.defaultAxes) {
                        if (this.board.defaultAxes.x) this.board.defaultAxes.x.setAttribute({ visible });
                        if (this.board.defaultAxes.y) this.board.defaultAxes.y.setAttribute({ visible });
                    } else if (visible) {
                        this.board.create('axis', [[0, 0], [1, 0]], { name: 'x', withLabel: true, label: { offset: [520, -15] } });
                        this.board.create('axis', [[0, 0], [0, 1]], { name: 'y', withLabel: true, label: { offset: [-15, 260] } });
                    }
                    this.board.update();
                    break;
                }
                case 'delete_object':
                    if (!params.target) {
                        throw new Error('missing target');
                    }
                    if (!this.registry.removeById?.(this.board, params.target)) {
                        throw new Error(`unknown reference: ${params.target}`);
                    }
                    break;
                default:
                    throw new Error(`unsupported action: ${action}`);
            }
        if (!objectlessAction && !obj) {
            throw new Error(`JSXGraph did not create object for action: ${action}`);
        }

        if (obj && result_id) {
            const historyMeta = this.getHistoryMeta(ins);
            if (Object.keys(historyMeta).length > 0) {
                obj.meta = { ...(obj.meta || {}), ...historyMeta };
            }
            if (meta && typeof meta === 'object') {
                obj.meta = { ...(obj.meta || {}), ...meta };
            }
            this.registerCircleCenterIfNeeded(obj, ins);
            const lineDescriptionPoint = this.prepareLineDescriptionPointIfNeeded(obj, ins);
            this.registerCreatedObject(result_id, obj, ins);
            this.registerPreparedLineDescriptionPoint(lineDescriptionPoint);
        }

        return obj;
    }
    decorateExecutionResults(results) {
        results.created = results.filter((result) => result.object);
        results.failed = results.filter((result) => !result.success);
        results.success = results.failed.length === 0;
        return results;
    }
    executionErrorMessage(error) {
        return error instanceof Error ? error.message : String(error);
    }
    requireNumberParam(params, key) {
        const value = params?.[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error(`missing numeric param: ${key}`);
        }
        return value;
    }
    getCommonAttributes(label) {
        return {
            name: label || '',
            withLabel: !!label,
            size: 3,
            strokeWidth: 2,
            label: { fixed: false }
        };
    }
    registerCreatedObject(id, obj, instruction) {
        this.registry.register(id, obj);
        this.attachHistoryListeners(obj);
        if (typeof this.options.onObjectCreated === 'function') {
            this.options.onObjectCreated(obj, instruction);
        }
    }
    registerCircleCenterIfNeeded(circle, instruction) {
        const { action, params = {}, result_id } = instruction;
        if (!result_id || !this.isCircleInstruction(action) || !circle?.center) {
            return;
        }

        const center = circle.center;
        const existingCenterId = this.registry.idForObject(center);
        const centerId = existingCenterId || this.getUniqueResultId(params.centerResultId || `${result_id}_center`);
        const centerLabel = this.getCircleCenterLabel(center, params.centerLabel);

        circle.meta = {
            ...(circle.meta || {}),
            centerPointId: centerId
        };

        if (!existingCenterId) {
            this.ensureVisibleCircleCenter(center, centerLabel);
            center.meta = {
                ...(center.meta || {}),
                generatedCircleCenterFor: result_id
            };
            this.registerCreatedObject(centerId, center, {
                action: 'place_point',
                params: { x: center.X?.(), y: center.Y?.() },
                result_id: centerId,
                label: centerLabel,
                meta: center.meta,
                generatedFor: action
            });
        }
    }
    isCircleInstruction(action) {
        return action === 'circle' || action === 'circumcircle' || action === 'incircle';
    }
    prepareLineDescriptionPointIfNeeded(line, instruction) {
        const { action, params = {}, result_id } = instruction;
        if (!result_id || !this.needsGeneratedLineDescriptionPoint(action, params, line)) {
            return null;
        }

        const pointId = this.getUniqueResultId(params.descriptionPointResultId || `${result_id}_point`);
        const label = params.descriptionPointLabel || getNextPointLabel(this.registry);
        const coords = this.getLineDescriptionPointCoords(line, instruction);

        line.meta = {
            ...(line.meta || {}),
            descriptionPointId: pointId
        };

        return {
            id: pointId,
            label,
            coords,
            lineId: result_id,
            line,
            sourceAction: action
        };
    }
    registerPreparedLineDescriptionPoint(prepared) {
        if (!prepared) {
            return;
        }

        const point = this.board.create('glider', [prepared.coords.x, prepared.coords.y, prepared.line], {
            ...this.getCommonAttributes(prepared.label),
            strokeColor: '#ff4d4f',
            fillColor: '#fff'
        });
        point.meta = {
            ...(point.meta || {}),
            generatedLinePointFor: prepared.lineId
        };
        this.registerCreatedObject(prepared.id, point, {
            action: 'glider',
            params: { x: prepared.coords.x, y: prepared.coords.y, path: prepared.lineId },
            result_id: prepared.id,
            label: prepared.label,
            meta: point.meta,
            generatedFor: prepared.sourceAction
        });
    }
    needsGeneratedLineDescriptionPoint(action, params, line) {
        if (!line) {
            return false;
        }
        if (params?.descriptionPoint === false) {
            return false;
        }
        if (action === 'tangent') {
            return Boolean(params?.descriptionPointLabel || params?.descriptionPointResultId);
        }
        return action === 'parallel' || action === 'perpendicular' || action === 'bisector';
    }
    getLineDescriptionPointCoords(line, instruction) {
        const { action, params = {} } = instruction;
        const anchorRef = this.getLineAnchorRef(action, params);
        const anchor = this.pointCoords(this.resolveRef(anchorRef));
        if (anchor) {
            return { x: anchor.x + 1, y: anchor.y + 1 };
        }

        const first = this.pointCoords(line.point1);
        const second = this.pointCoords(line.point2);
        if (first && second) {
            return {
                x: first.x + (second.x - first.x) * 0.65,
                y: first.y + (second.y - first.y) * 0.65
            };
        }

        return { x: 1, y: 1 };
    }
    getLineAnchorRef(action, params) {
        if (action === 'parallel' || action === 'perpendicular' || action === 'tangent') {
            return params.point;
        }
        if (action === 'bisector') {
            return params.vertex;
        }
        return null;
    }
    pointCoords(point) {
        if (!point || typeof point.X !== 'function' || typeof point.Y !== 'function') {
            return null;
        }
        const x = point.X();
        const y = point.Y();
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    }
    getUniqueResultId(baseId) {
        const base = baseId || `circle_center_${Date.now()}`;
        if (!this.registry.exists(base)) {
            return base;
        }

        let index = 1;
        while (this.registry.exists(`${base}_${index}`)) {
            index += 1;
        }
        return `${base}_${index}`;
    }
    getCircleCenterLabel(center, requestedLabel) {
        const currentLabel = this.readObjectName(center);
        if (currentLabel) {
            return currentLabel;
        }
        if (requestedLabel) {
            return requestedLabel;
        }
        if (!this.isPointLabelUsed('O')) {
            return 'O';
        }

        let index = 1;
        while (this.isPointLabelUsed(`O${index}`)) {
            index += 1;
        }
        return `O${index}`;
    }
    isPointLabelUsed(label) {
        return this.registry.entries().some(([, obj]) => (
            (obj?.elType === 'point' || obj?.elType === 'glider') &&
            this.readObjectName(obj) === label
        ));
    }
    readObjectName(obj) {
        if (!obj) {
            return '';
        }
        if (typeof obj.getName === 'function') {
            return obj.getName() || '';
        }
        return obj.name || '';
    }
    ensureVisibleCircleCenter(center, label) {
        center.setAttribute?.({
            visible: true,
            name: label || '',
            withLabel: Boolean(label),
            size: 3,
            fillColor: '#ff8c00',
            strokeColor: '#d46b08',
            fixed: true,
            highlight: false,
            label: { fixed: false }
        });
        if (typeof center.setName === 'function') {
            center.setName(label || '');
        }
        if (label) {
            center.hasLabel = true;
        }
        center.label?.setAttribute?.({
            visible: Boolean(label),
            fixed: false
        });
    }
    createObjectFromSnapshot(entry) {
        const commonAttr = this.getCommonAttributes(entry.label);
        const type = entry.constructionType || entry.type;
        let obj = null;

        try {
            switch (type) {
                case 'point':
                    obj = this.board.create('point', entry.coords || [entry.position?.x || 0, entry.position?.y || 0], commonAttr);
                    break;
                case 'glider': {
                    const path = this.registry.get(entry.pathId);
                    if (path) {
                        const coords = entry.coords || [entry.position?.x || 0, entry.position?.y || 0];
                        obj = this.board.create('glider', [coords[0], coords[1], path], commonAttr);
                    } else {
                        obj = this.board.create('point', entry.coords || [entry.position?.x || 0, entry.position?.y || 0], commonAttr);
                    }
                    break;
                }
                case 'segment':
                case 'line': {
                    const points = (entry.endpointIds || []).map((id) => this.registry.get(id)).filter(Boolean);
                    if (points.length === 2) {
                        obj = this.board.create(type, points, { ...commonAttr, draggable: true });
                        this.addHoverCursor(obj);
                    }
                    break;
                }
                case 'midpoint': {
                    const points = (entry.parentIds || entry.endpointIds || []).map((id) => this.registry.get(id)).filter(Boolean);
                    if (points.length >= 2) {
                        obj = this.board.create('midpoint', [points[0], points[1]], commonAttr);
                    }
                    break;
                }
                case 'perpendicular':
                case 'parallel': {
                    const parents = (entry.parentIds || []).map((id) => this.registry.get(id)).filter(Boolean);
                    if (parents.length >= 2) {
                        obj = this.board.create(type, [parents[0], parents[1]], { ...commonAttr, draggable: true });
                        this.addHoverCursor(obj);
                    }
                    break;
                }
                case 'circle': {
                    const center = this.registry.get(entry.centerId);
                    const through = this.registry.get(entry.radiusPointId);
                    if (center && through) {
                        obj = this.board.create('circle', [center, through], {
                            ...commonAttr, draggable: true, hasInnerPoints: true,
                            fillColor: '#1890ff', fillOpacity: 0.1
                        });
                    } else if (entry.center && typeof entry.radius === 'number') {
                        const centerPoint = this.board.create('point', [entry.center.x, entry.center.y], {
                            visible: false,
                            name: '',
                            fixed: true,
                            highlight: false,
                            showInfobox: false
                        });
                        const throughPoint = this.board.create('point', [entry.center.x + entry.radius, entry.center.y], {
                            visible: false,
                            name: '',
                            fixed: true,
                            highlight: false,
                            showInfobox: false
                        });
                        obj = this.board.create('circle', [centerPoint, throughPoint], {
                            ...commonAttr, draggable: true, hasInnerPoints: true,
                            fillColor: '#1890ff', fillOpacity: 0.1
                        });
                        this.attachTranslationDrag(obj, [centerPoint, throughPoint]);
                        obj.on('remove', () => {
                            this.safeRemoveObject(centerPoint);
                            this.safeRemoveObject(throughPoint);
                        });
                    } else if (center && typeof entry.radius === 'number') {
                        const throughPoint = this.board.create('point', [center.X() + entry.radius, center.Y()], {
                            visible: false,
                            name: '',
                            fixed: true,
                            highlight: false,
                            showInfobox: false
                        });
                        obj = this.board.create('circle', [center, throughPoint], {
                            ...commonAttr, draggable: true, hasInnerPoints: true,
                            fillColor: '#1890ff', fillOpacity: 0.1
                        });
                        this.attachTranslationDrag(obj, [center, throughPoint]);
                        obj.on('remove', () => this.safeRemoveObject(throughPoint));
                    }
                    if (obj) this.addHoverCursor(obj);
                    break;
                }
                case 'circumcircle':
                case 'incircle': {
                    const parents = (entry.parentIds || entry.pointIds || []).map((id) => this.registry.get(id)).filter(Boolean);
                    if (parents.length >= 3) {
                        obj = this.board.create(type, [parents[0], parents[1], parents[2]], {
                            ...commonAttr, draggable: true, hasInnerPoints: true,
                            fillColor: '#1890ff', fillOpacity: 0.1
                        });
                        this.addHoverCursor(obj);
                    }
                    break;
                }
                case 'polygon': {
                    const points = (entry.vertexIds || []).map((id) => this.registry.get(id)).filter(Boolean);
                    if (points.length >= 3) {
                        obj = this.board.create('polygon', points, {
                            ...commonAttr, fillColor: '#1890ff', fillOpacity: 0.2,
                            draggable: true, hasInnerPoints: true
                        });
                        this.addHoverCursor(obj);
                    }
                    break;
                }
                case 'angle': {
                    const points = (entry.pointIds || entry.parentIds || []).map((id) => this.registry.get(id)).filter(Boolean);
                    if (points.length >= 3) {
                        obj = this.board.create('angle', [points[0], points[1], points[2]], {
                            ...commonAttr,
                            radius: 1,
                            fillColor: '#91caff',
                            fillOpacity: 0.2,
                            strokeColor: '#0958d9',
                            strokeWidth: 2
                        });
                    }
                    break;
                }
                case 'tangent': {
                    const parents = (entry.parentIds || []).map((id) => this.registry.get(id)).filter(Boolean);
                    if (parents.length >= 2) {
                        obj = this.board.create('tangent', [parents[0], parents[1]], { ...commonAttr, draggable: true });
                        this.addHoverCursor(obj);
                    }
                    break;
                }
                case 'bisector': {
                    const parents = (entry.parentIds || entry.pointIds || []).map((id) => this.registry.get(id)).filter(Boolean);
                    if (parents.length >= 3) {
                        obj = this.board.create('bisector', [parents[0], parents[1], parents[2]], { ...commonAttr, draggable: true });
                        this.addHoverCursor(obj);
                    }
                    break;
                }
                default:
                    obj = { id: entry.id, elType: entry.type };
                    break;
            }
        } catch (error) {
            console.error('恢复形状失败:', error);
        }

        return obj;
    }
    getHistoryMeta(instruction) {
        const { action, params = {} } = instruction;
        const parentRefsByAction = {
            segment: [params.p1, params.p2],
            midpoint: [params.p1, params.p2],
            perpendicular: [params.line, params.point],
            parallel: [params.line, params.point],
            tangent: [params.circle, params.point],
            bisector: [params.p1, params.vertex, params.p2],
            angle: [params.p1, params.vertex, params.p2],
            glider: [params.path],
            circumcircle: [params.p1, params.p2, params.p3],
            incircle: [params.p1, params.p2, params.p3],
            intersection: [params.first, params.second],
            otherintersection: [params.first, params.second, params.known]
        };
        const parentIds = (parentRefsByAction[action] || [])
            .map((ref) => this.toRegistryId(ref))
            .filter(Boolean);
        if (parentIds.length === 0) {
            return {};
        }
        return {
            historyAction: action,
            historyParentIds: parentIds
        };
    }
    toRegistryId(ref) {
        if (!ref) {
            return null;
        }
        if (typeof ref === 'string') {
            return this.registry.exists(ref) ? ref : null;
        }
        return this.registry.idForObject(ref);
    }
    addHoverCursor(obj) {
        if (!obj) {
            return;
        }
        obj.on('over', () => { document.body.style.cursor = 'move'; });
        obj.on('out', () => { document.body.style.cursor = 'default'; });
    }
    attachHistoryListeners(obj) {
        if (!obj || typeof obj.on !== 'function' || obj.__historyListenersAttached) {
            return;
        }

        obj.__historyListenersAttached = true;
        let dragStartSnapshot = null;

        obj.on('down', () => {
            dragStartSnapshot = this.registry.snapshot?.() || null;
        });

        obj.on('up', () => {
            if (!dragStartSnapshot) {
                return;
            }
            const after = this.registry.snapshot?.() || [];
            this.registry.commitSnapshotAction?.('move', dragStartSnapshot, after, { label: 'move' });
            dragStartSnapshot = null;
        });
    }
    resolveRef(ref) {
        if (!ref) {
            return null;
        }
        return typeof ref === 'string' ? this.registry.get(ref) : ref;
    }
    resolveRequiredRef(ref, fieldName) {
        const resolved = this.resolveRef(ref);
        if (!resolved) {
            throw new Error(`missing reference: ${fieldName}`);
        }
        return resolved;
    }
    safeRemoveObject(obj) {
        if (!obj) {
            return;
        }
        try {
            this.board.removeObject(obj);
        } catch (error) {
            console.error('移除辅助对象失败:', error);
        }
    }
    attachTranslationDrag(shape, controlPoints) {
        let dragOrigin = null;
        const panDragGuard = createBoardPanDragGuard(this.board);

        shape.on('down', (event) => {
            if (event?.preventDefault) {
                event.preventDefault();
            }
            panDragGuard.start();
            const mouse = this.board.getUsrCoordsOfMouse(event);
            dragOrigin = {
                mouse: { x: mouse[0], y: mouse[1] },
                points: controlPoints.map((point) => ({ point, x: point.X(), y: point.Y() }))
            };
        });

        shape.on('drag', (event) => {
            if (!dragOrigin) {
                return;
            }

            const mouse = this.board.getUsrCoordsOfMouse(event);
            const dx = mouse[0] - dragOrigin.mouse.x;
            const dy = mouse[1] - dragOrigin.mouse.y;

            dragOrigin.points.forEach(({ point, x, y }) => {
                point.setPosition(JXG.COORDS_BY_USER, [x + dx, y + dy]);
            });
            this.board.update();
        });

        shape.on('up', () => {
            dragOrigin = null;
            panDragGuard.restore();
        });

        shape.on('remove', () => {
            dragOrigin = null;
            panDragGuard.restore();
        });
    }
}
