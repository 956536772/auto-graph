import JXG from 'jsxgraph';

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
        const created = [];
        this.registry.beginUndoBatch?.();
        this.board.suspendUpdate();
        try {
            instructions.forEach((ins) => {
                const obj = this.processInstruction(ins);
                if (obj) {
                    created.push({ instruction: ins, object: obj });
                }
            });
        } catch (err) {
            console.error('指令执行失败:', err);
        } finally {
            this.board.unsuspendUpdate();
            this.registry.endUndoBatch?.();
        }
        return created;
    }
    processInstruction(ins) {
        const { action, params, result_id, label, meta } = ins;
        let obj = null;
        const commonAttr = this.getCommonAttributes(label);

        try {
            switch (action) {
                case 'place_point':
                    obj = this.board.create('point', [params.x, params.y], commonAttr);
                    break;
                case 'segment':
                    obj = this.board.create('segment', [this.resolveRef(params.p1), this.resolveRef(params.p2)], {
                        ...commonAttr, draggable: true
                    });
                    this.addHoverCursor(obj);
                    break;
                case 'midpoint':
                    obj = this.board.create('midpoint', [this.resolveRef(params.p1), this.resolveRef(params.p2)], commonAttr);
                    break;
                case 'perpendicular':
                    obj = this.board.create('perpendicular', [this.resolveRef(params.line), this.resolveRef(params.point)], {
                        ...commonAttr, draggable: true
                    });
                    this.addHoverCursor(obj);
                    break;
                case 'parallel':
                    obj = this.board.create('parallel', [this.resolveRef(params.line), this.resolveRef(params.point)], {
                        ...commonAttr, draggable: true
                    });
                    this.addHoverCursor(obj);
                    break;
                case 'circle': {
                    let center;
                    let through;
                    let hiddenControlPoints = null;

                    if (typeof params.cx === 'number' && typeof params.cy === 'number' && typeof params.radius === 'number') {
                        center = this.board.create('point', [params.cx, params.cy], {
                            ...commonAttr,
                            name: params.centerLabel || '',
                            withLabel: Boolean(params.centerLabel),
                            label: { fixed: false },
                            fixed: true,
                            highlight: false,
                            showInfobox: false
                        });
                        through = this.board.create('point', [params.cx + params.radius, params.cy], {
                            visible: false,
                            name: '',
                            fixed: true,
                            highlight: false,
                            showInfobox: false
                        });
                        hiddenControlPoints = [through];
                    } else {
                        center = this.resolveRef(params.center);
                        through = this.resolveRef(params.through);
                    }

                    obj = this.board.create('circle', [center, through], {
                        ...commonAttr, draggable: true, hasInnerPoints: true,
                        fillColor: '#1890ff', fillOpacity: 0.1
                    });
                    if (hiddenControlPoints) {
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
                        this.resolveRef(params.p1),
                        this.resolveRef(params.p2),
                        this.resolveRef(params.p3)
                    ], {
                        ...commonAttr, draggable: true, hasInnerPoints: true,
                        fillColor: '#1890ff', fillOpacity: 0.1
                    });
                    this.addHoverCursor(obj);
                    break;
                case 'incircle':
                    obj = this.board.create('incircle', [
                        this.resolveRef(params.p1),
                        this.resolveRef(params.p2),
                        this.resolveRef(params.p3)
                    ], {
                        ...commonAttr, draggable: true, hasInnerPoints: true,
                        fillColor: '#1890ff', fillOpacity: 0.1
                    });
                    this.addHoverCursor(obj);
                    break;
                case 'ellipse': {
                    const { cx, cy, rx, ry } = params;
                    if (Math.abs(rx - ry) < 0.001) {
                        const pCenter = this.board.create('point', [cx, cy], { visible: false, name: '' });
                        const pThrough = this.board.create('point', [cx + rx, cy], { visible: false, name: '' });
                        obj = this.board.create('circle', [pCenter, pThrough], {
                            ...commonAttr, draggable: true, hasInnerPoints: true,
                            fillColor: '#1890ff', fillOpacity: 0.1
                        });
                        this.attachTranslationDrag(obj, [pCenter, pThrough]);
                        obj.on('remove', () => {
                            this.safeRemoveObject(pCenter);
                            this.safeRemoveObject(pThrough);
                        });
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
                        this.attachTranslationDrag(obj, [f1, f2, pointOnEllipse]);
                        obj.on('remove', () => {
                            this.safeRemoveObject(f1);
                            this.safeRemoveObject(f2);
                            this.safeRemoveObject(pointOnEllipse);
                        });
                    }
                    this.addHoverCursor(obj);
                    break;
                }
                case 'polygon': {
                    const pts = params.points.map(id => this.resolveRef(id));
                    obj = this.board.create('polygon', pts, {
                        ...commonAttr, fillColor: '#1890ff', fillOpacity: 0.2,
                        draggable: true, hasInnerPoints: true
                    });
                    this.addHoverCursor(obj);
                    break;
                }
                case 'glider':
                    obj = this.board.create('glider', [params.x, params.y, this.resolveRef(params.path)], {
                        ...commonAttr, strokeColor: '#ff4d4f', fillColor: '#fff'
                    });
                    break;
                case 'intersection': {
                    obj = this.board.create('intersection', [
                        this.resolveRef(params.first),
                        this.resolveRef(params.second),
                        params.index ?? 0
                    ], commonAttr);
                    break;
                }
                case 'otherintersection': {
                    obj = this.board.create('otherintersection', [
                        this.resolveRef(params.first),
                        this.resolveRef(params.second),
                        this.resolveRef(params.known)
                    ], commonAttr);
                    break;
                }
                case 'tangent':
                    obj = this.board.create('tangent', [
                        this.resolveRef(params.circle),
                        this.resolveRef(params.point)
                    ], {
                        ...commonAttr, draggable: true
                    });
                    this.addHoverCursor(obj);
                    break;
                case 'bisector':
                    obj = this.board.create('bisector', [
                        this.resolveRef(params.p1),
                        this.resolveRef(params.vertex),
                        this.resolveRef(params.p2)
                    ], {
                        ...commonAttr, draggable: true
                    });
                    this.addHoverCursor(obj);
                    break;
                case 'angle':
                    obj = this.board.create('angle', [
                        this.resolveRef(params.p1),
                        this.resolveRef(params.vertex),
                        this.resolveRef(params.p2)
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
                    obj = this.board.create('functiongraph', [new Function('x', `return ${params.expr};`)], {
                        ...commonAttr,
                        strokeColor: '#1890ff',
                        strokeWidth: 2
                    });
                    obj.meta = { ...(obj.meta || {}), expr: params.expr };
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
            }
        } catch (e) {
            console.error('创建形状失败:', e);
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
            this.registerCreatedObject(result_id, obj, ins);
        }

        return obj;
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
        let originalPan = null;

        shape.on('down', (event) => {
            if (event?.preventDefault) {
                event.preventDefault();
            }
            originalPan = this.board.options?.pan?.enabled;
            this.board.setAttribute({ pan: { enabled: false } });
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
            if (originalPan !== null) {
                this.board.setAttribute({ pan: { enabled: originalPan } });
                originalPan = null;
            }
        });
    }
}
