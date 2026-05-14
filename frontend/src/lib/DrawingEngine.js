import JXG from 'jsxgraph';

export class DrawingEngine {
    constructor(board, registry, options = {}) {
        this.board = board;
        this.registry = registry;
        this.options = options;
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
        const commonAttr = { name: label || '', withLabel: !!label, size: 3, strokeWidth: 2 };

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
                    let auxiliaryPoints = null;

                    if (typeof params.cx === 'number' && typeof params.cy === 'number' && typeof params.radius === 'number') {
                        center = this.board.create('point', [params.cx, params.cy], {
                            ...commonAttr,
                            name: params.centerLabel || '',
                            withLabel: Boolean(params.centerLabel)
                        });
                        through = this.board.create('point', [params.cx + params.radius, params.cy], { visible: false, name: '' });
                        auxiliaryPoints = [center, through];
                    } else {
                        center = this.resolveRef(params.center);
                        through = this.resolveRef(params.through);
                    }

                    obj = this.board.create('circle', [center, through], {
                        ...commonAttr, draggable: true, hasInnerPoints: true,
                        fillColor: '#1890ff', fillOpacity: 0.1
                    });
                    if (auxiliaryPoints) {
                        this.attachTranslationDrag(obj, auxiliaryPoints);
                        obj.on('remove', () => {
                            auxiliaryPoints.forEach((point) => this.safeRemoveObject(point));
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
            }
        } catch (e) {
            console.error('创建形状失败:', e);
        }

        if (obj && result_id) {
            if (meta && typeof meta === 'object') {
                obj.meta = { ...(obj.meta || {}), ...meta };
            }
            this.registry.register(result_id, obj);
        }

        if (obj && typeof this.options.onObjectCreated === 'function') {
            this.options.onObjectCreated(obj, ins);
        }

        return obj;
    }
    addHoverCursor(obj) {
        obj.on('over', () => { document.body.style.cursor = 'move'; });
        obj.on('out', () => { document.body.style.cursor = 'default'; });
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
