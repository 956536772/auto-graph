export class ShapeRegistry {
    constructor() {
        this.shapes = new Map();
        this.history = []; // 记录操作历史用于撤销
    }
    register(id, jxgObject) {
        if (!jxgObject) return;
        this.shapes.set(id, jxgObject);
        this.history.push(id);
        jxgObject.registryId = id; // 将 ID 反向绑定到对象上
    }
    undo(board) {
        if (this.history.length === 0) return null;
        const lastId = this.history.pop();
        const obj = this.shapes.get(lastId);
        if (obj) {
            try {
                board.removeObject(obj);
            } catch(e) {
                console.error('移除对象失败:', e);
            }
            this.shapes.delete(lastId);
        }
        return lastId;
    }
    get(id) { return this.shapes.get(id); }
    exists(id) { return this.shapes.has(id); }
    clear() { this.shapes.clear(); this.history = []; }
    serialize() {
        const state = [];
        this.shapes.forEach((obj, id) => {
            const data = { id, type: obj.elType };
            if (obj.elType === 'point' || obj.elType === 'glider') {
                data.coords = [obj.X(), obj.Y()];
            }
            if (obj.name) data.label = obj.name;
            state.push(data);
        });
        return state;
    }
}
