export class ShapeRegistry {
    constructor() {
        this.shapes = new Map();
        this.history = []; // 记录创建顺序用于序列化
        this.undoStack = [];
        this.activeUndoBatch = null;
    }
    register(id, jxgObject) {
        if (!jxgObject) return;
        this.shapes.set(id, jxgObject);
        this.history.push(id);
        if (this.activeUndoBatch) {
            this.activeUndoBatch.push(id);
        } else {
            this.undoStack.push([id]);
        }
        jxgObject.registryId = id; // 将 ID 反向绑定到对象上
    }
    idForObject(jxgObject) {
        if (!jxgObject) return null;
        if (jxgObject.registryId && this.shapes.get(jxgObject.registryId) === jxgObject) {
            return jxgObject.registryId;
        }
        for (const [id, obj] of this.shapes.entries()) {
            if (obj === jxgObject) return id;
        }
        return null;
    }
    beginUndoBatch() {
        this.activeUndoBatch = [];
    }
    endUndoBatch() {
        if (!this.activeUndoBatch) return;
        if (this.activeUndoBatch.length > 0) {
            this.undoStack.push(this.activeUndoBatch);
        }
        this.activeUndoBatch = null;
    }
    mergeLastUndoEntries(groupCount) {
        if (groupCount <= 1 || this.undoStack.length < groupCount) {
            return;
        }
        const groups = [];
        for (let index = 0; index < groupCount; index += 1) {
            groups.unshift(this.undoStack.pop());
        }
        this.undoStack.push(groups.flat());
    }
    undo(board) {
        if (this.undoStack.length === 0) return null;
        const ids = this.undoStack.pop();
        const removedIds = [];
        ids.slice().reverse().forEach((id) => {
            const obj = this.shapes.get(id);
            if (obj) {
                try {
                    board.removeObject(obj);
                } catch(e) {
                    console.error('移除对象失败:', e);
                }
                this.shapes.delete(id);
            }
            removedIds.push(id);
        });
        if (removedIds.length > 0) {
            const removedSet = new Set(removedIds);
            this.history = this.history.filter((id) => !removedSet.has(id));
        }
        return removedIds.at(-1) || null;
    }
    removeObject(board, jxgObject) {
        const id = this.idForObject(jxgObject);
        if (!id) return null;
        return this.removeIds(board, this.collectDependentIds([id]));
    }
    collectDependentIds(rootIds) {
        const ids = new Set(rootIds);
        let changed = true;

        while (changed) {
            changed = false;
            for (const [candidateId, obj] of this.shapes.entries()) {
                if (ids.has(candidateId)) continue;
                const dependsOnRemoved = Array.from(ids).some((id) => this.dependsOn(obj, this.shapes.get(id)));
                if (dependsOnRemoved) {
                    ids.add(candidateId);
                    changed = true;
                }
            }
        }

        return Array.from(ids);
    }
    dependsOn(obj, target) {
        if (!obj || !target) return false;
        if (obj.point1 === target || obj.point2 === target || obj.point3 === target) return true;
        if (obj.center === target || obj.radiuspoint === target) return true;
        if (Array.isArray(obj.vertices) && obj.vertices.includes(target)) return true;
        if (Array.isArray(obj.parents) && obj.parents.includes(target)) return true;
        if (Array.isArray(obj.meta?.closedSegmentIds) && obj.meta.closedSegmentIds.includes(target.registryId)) return true;
        return false;
    }
    removeIds(board, ids) {
        const removedIds = [];
        ids.slice().reverse().forEach((id) => {
            const obj = this.shapes.get(id);
            if (obj) {
                try {
                    board.removeObject(obj);
                } catch(e) {
                    console.error('移除对象失败:', e);
                }
                this.shapes.delete(id);
            }
            removedIds.push(id);
        });

        if (removedIds.length > 0) {
            const removedSet = new Set(removedIds);
            this.history = this.history.filter((id) => !removedSet.has(id));
            this.undoStack = this.undoStack
                .map((group) => group.filter((id) => !removedSet.has(id)))
                .filter((group) => group.length > 0);
            if (this.activeUndoBatch) {
                this.activeUndoBatch = this.activeUndoBatch.filter((id) => !removedSet.has(id));
            }
        }

        return removedIds.at(-1) || null;
    }
    get(id) { return this.shapes.get(id); }
    exists(id) { return this.shapes.has(id); }
    entries() { return Array.from(this.shapes.entries()); }
    clear() {
        this.shapes.clear();
        this.history = [];
        this.undoStack = [];
        this.activeUndoBatch = null;
    }
    serialize() {
        return this.history
            .map((id, order) => {
                const obj = this.shapes.get(id);
                if (!obj) return null;
                return this.serializeObject(id, obj, order);
            })
            .filter(Boolean);
    }
    serializeObject(id, obj, order) {
        const data = { id, type: obj.elType, order };
        const label = this.getLabel(obj);
        if (label) data.label = label;

        const anchor = this.getAnchor(obj);
        if (anchor) data.position = anchor;

        if (obj.elType === 'point' || obj.elType === 'glider') {
            data.coords = [obj.X(), obj.Y()];
        }

        if (obj.elType === 'circle' || obj.elType === 'circumcircle' || obj.elType === 'incircle') {
            const center = this.pointCoords(obj.center);
            if (center) data.center = center;
            if (typeof obj.Radius === 'function') data.radius = obj.Radius();
            const centerLabel = this.getLabel(obj.center);
            if (centerLabel) data.centerLabel = centerLabel;
        }

        if (obj.elType === 'ellipse') {
            const center = this.pointCoords(obj.center);
            if (center) data.center = center;
            if (typeof obj.majorAxis === 'function') data.majorAxis = obj.majorAxis();
        }

        if (this.hasEndpoints(obj)) {
            const endpoints = [obj.point1, obj.point2]
                .map(point => point ? { id: point.registryId || null, label: this.getLabel(point) || null, ...this.pointCoords(point) } : null)
                .filter(Boolean);
            if (endpoints.length === 2) {
                data.endpoints = endpoints;
                data.endpointLabels = endpoints.map(point => point.label).filter(Boolean);
            }
        }

        if (obj.elType === 'polygon' && Array.isArray(obj.vertices)) {
            const vertices = obj.vertices
                .map(point => point ? { id: point.registryId || null, label: this.getLabel(point) || null, ...this.pointCoords(point) } : null)
                .filter(Boolean);
            if (vertices.length > 0) {
                data.vertices = vertices;
            }
        }

        if (obj.elType === 'angle' && obj.point1 && obj.point2 && obj.point3) {
            data.points = [obj.point1, obj.point2, obj.point3]
                .map(point => point ? { id: point.registryId || null, label: this.getLabel(point) || null, ...this.pointCoords(point) } : null)
                .filter(Boolean);
        }

        return data;
    }
    getLabel(obj) {
        if (!obj) return '';
        if (typeof obj.getName === 'function') return obj.getName();
        return obj.name || '';
    }
    pointCoords(point) {
        if (!point || typeof point.X !== 'function' || typeof point.Y !== 'function') return null;
        return { x: point.X(), y: point.Y() };
    }
    hasEndpoints(obj) {
        return Boolean(obj && obj.point1 && obj.point2);
    }
    getAnchor(obj) {
        if (!obj) return null;
        if (typeof obj.X === 'function' && typeof obj.Y === 'function') {
            return { x: obj.X(), y: obj.Y() };
        }
        if (obj.center && typeof obj.center.X === 'function' && typeof obj.center.Y === 'function') {
            return { x: obj.center.X(), y: obj.center.Y() };
        }
        if (this.hasEndpoints(obj)) {
            return {
                x: (obj.point1.X() + obj.point2.X()) / 2,
                y: (obj.point1.Y() + obj.point2.Y()) / 2
            };
        }
        if (obj.elType === 'polygon' && Array.isArray(obj.vertices) && obj.vertices.length > 0) {
            const vertices = obj.vertices.filter(point => point && typeof point.X === 'function' && typeof point.Y === 'function');
            if (vertices.length === 0) return null;
            const total = vertices.reduce((acc, point) => ({
                x: acc.x + point.X(),
                y: acc.y + point.Y()
            }), { x: 0, y: 0 });
            return { x: total.x / vertices.length, y: total.y / vertices.length };
        }
        return null;
    }
}
