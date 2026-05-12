export class DrawingEngine {
    constructor(board, registry) {
        this.board = board;
        this.registry = registry;
    }
    execute(instructions) {
        this.board.suspendUpdate();
        try {
            instructions.forEach(ins => this.processInstruction(ins));
        } catch (err) {
            console.error('指令执行失败:', err);
        } finally {
            this.board.unsuspendUpdate();
        }
    }
    processInstruction(ins) {
        const { action, params, result_id, label } = ins;
        let obj = null;
        const commonAttr = { name: label || '', withLabel: !!label, size: 3, strokeWidth: 2 };

        try {
            switch (action) {
                case 'place_point':
                    obj = this.board.create('point', [params.x, params.y], commonAttr);
                    break;
                case 'segment':
                    obj = this.board.create('segment', [this.registry.get(params.p1), this.registry.get(params.p2)], {
                        ...commonAttr, draggable: true
                    });
                    this.addHoverCursor(obj);
                    break;
                case 'midpoint':
                    obj = this.board.create('midpoint', [this.registry.get(params.p1), this.registry.get(params.p2)], commonAttr);
                    break;
                case 'perpendicular':
                    obj = this.board.create('perpendicular', [this.registry.get(params.line), this.registry.get(params.point)], commonAttr);
                    break;
                case 'parallel':
                    obj = this.board.create('parallel', [this.registry.get(params.line), this.registry.get(params.point)], commonAttr);
                    break;
                case 'circle': {
                    const center = this.registry.get(params.center);
                    const through = this.registry.get(params.through);
                    obj = this.board.create('circle', [center, through], {
                        ...commonAttr, draggable: true, hasInnerPoints: true,
                        fillColor: '#1890ff', fillOpacity: 0.1
                    });
                    this.addHoverCursor(obj);
                    break;
                }
                case 'circumcircle':
                    obj = this.board.create('circumcircle', [
                        this.registry.get(params.p1),
                        this.registry.get(params.p2),
                        this.registry.get(params.p3)
                    ], {
                        ...commonAttr, draggable: true, hasInnerPoints: true,
                        fillColor: '#1890ff', fillOpacity: 0.1
                    });
                    this.addHoverCursor(obj);
                    break;
                case 'incircle':
                    obj = this.board.create('incircle', [
                        this.registry.get(params.p1),
                        this.registry.get(params.p2),
                        this.registry.get(params.p3)
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
                        obj = this.board.create('circle', [pCenter, rx], {
                            ...commonAttr, draggable: true, hasInnerPoints: true,
                            fillColor: '#1890ff', fillOpacity: 0.1
                        });
                        // 确保移除圆时也移除隐藏的圆心
                        obj.on('remove', () => this.board.removeObject(pCenter));
                    } else {
                        // Linear eccentricity: c^2 = |rx^2 - ry^2|
                        const c = Math.sqrt(Math.abs(rx * rx - ry * ry));
                        let f1, f2, major;
                        if (rx > ry) {
                            f1 = this.board.create('point', [cx - c, cy], { visible: false, name: '' });
                            f2 = this.board.create('point', [cx + c, cy], { visible: false, name: '' });
                            major = 2 * rx;
                        } else {
                            f1 = this.board.create('point', [cx, cy - c], { visible: false, name: '' });
                            f2 = this.board.create('point', [cx, cy + c], { visible: false, name: '' });
                            major = 2 * ry;
                        }
                        obj = this.board.create('ellipse', [f1, f2, major], {
                            ...commonAttr, draggable: true, hasInnerPoints: true,
                            fillColor: '#1890ff', fillOpacity: 0.1
                        });
                        // 确保移除椭圆时也移除隐藏的焦点
                        obj.on('remove', () => {
                            this.board.removeObject(f1);
                            this.board.removeObject(f2);
                        });
                    }
                    this.addHoverCursor(obj);
                    break;
                }
                case 'polygon': {
                    const pts = params.points.map(id => this.registry.get(id));
                    obj = this.board.create('polygon', pts, {
                        ...commonAttr, fillColor: '#1890ff', fillOpacity: 0.2,
                        draggable: true, hasInnerPoints: true
                    });
                    this.addHoverCursor(obj);
                    break;
                }
                case 'glider':
                    obj = this.board.create('glider', [params.x, params.y, this.registry.get(params.path)], {
                        ...commonAttr, strokeColor: '#ff4d4f', fillColor: '#fff'
                    });
                    break;
                case 'intersection': {
                    obj = this.board.create('intersection', [
                        this.registry.get(params.first),
                        this.registry.get(params.second),
                        params.index ?? 0
                    ], commonAttr);
                    break;
                }
                case 'otherintersection': {
                    obj = this.board.create('otherintersection', [
                        this.registry.get(params.first),
                        this.registry.get(params.second),
                        this.registry.get(params.known)
                    ], commonAttr);
                    break;
                }
                case 'tangent':
                    obj = this.board.create('tangent', [
                        this.registry.get(params.circle),
                        this.registry.get(params.point)
                    ], {
                        ...commonAttr, draggable: true
                    });
                    this.addHoverCursor(obj);
                    break;
            }
        } catch (e) {
            console.error('创建形状失败:', e);
        }

        if (obj && result_id) {
            this.registry.register(result_id, obj);
        }
    }
    addHoverCursor(obj) {
        obj.on('over', () => { document.body.style.cursor = 'move'; });
        obj.on('out', () => { document.body.style.cursor = 'default'; });
    }
}
