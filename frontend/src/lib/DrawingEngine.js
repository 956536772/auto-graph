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
                case 'circle':
                    const center = this.registry.get(params.center);
                    const through = this.registry.get(params.through);
                    obj = this.board.create('circle', [center, through], {
                        ...commonAttr, draggable: true, hasInnerPoints: true
                    });
                    this.addHoverCursor(obj);
                    break;
                case 'polygon':
                    const pts = params.points.map(id => this.registry.get(id));
                    obj = this.board.create('polygon', pts, {
                        ...commonAttr, fillColor: '#1890ff', fillOpacity: 0.2,
                        draggable: true, hasInnerPoints: true
                    });
                    this.addHoverCursor(obj);
                    break;
                case 'glider':
                    obj = this.board.create('glider', [params.x, params.y, this.registry.get(params.path)], {
                        ...commonAttr, strokeColor: '#ff4d4f', fillColor: '#fff'
                    });
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
