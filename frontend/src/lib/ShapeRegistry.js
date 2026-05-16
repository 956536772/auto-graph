export class ShapeRegistry {
    constructor() {
        this.shapes = new Map();
        this.history = []; // 记录创建顺序用于序列化
        this.undoStack = [];
        this.redoStack = [];
        this.activeUndoBatch = null;
        this.snapshotFactory = null;
        this.restoreHandler = null;
    }
    setSnapshotFactory(factory) {
        this.snapshotFactory = factory;
    }
    setRestoreHandler(handler) {
        this.restoreHandler = handler;
    }
    register(id, jxgObject) {
        if (!jxgObject) return;
        const before = this.activeUndoBatch ? null : this.snapshot();
        this.shapes.set(id, jxgObject);
        this.history.push(id);
        if (this.activeUndoBatch) {
            this.activeUndoBatch.ids.push(id);
        } else {
            this.commitSnapshotAction('create', before, this.snapshot(), { ids: [id] });
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
        this.activeUndoBatch = {
            ids: [],
            before: this.snapshot()
        };
    }
    endUndoBatch() {
        if (!this.activeUndoBatch) return;
        if (this.activeUndoBatch.ids.length > 0) {
            this.commitSnapshotAction('create', this.activeUndoBatch.before, this.snapshot(), {
                ids: [...this.activeUndoBatch.ids]
            });
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
        const first = groups[0];
        const last = groups.at(-1);
        this.undoStack.push({
            type: last?.type || 'create',
            label: last?.label || 'create',
            before: first?.before || [],
            after: last?.after || [],
            ids: groups.flatMap((group) => group.ids || group)
        });
    }
    commitSnapshotAction(type, before, after, metadata = {}) {
        if (this.snapshotsEqual(before, after)) {
            return null;
        }
        const action = {
            type,
            label: metadata.label || type,
            before: this.cloneSnapshot(before),
            after: this.cloneSnapshot(after),
            ids: metadata.ids || []
        };
        this.undoStack.push(action);
        this.redoStack = [];
        return action;
    }
    undo(board) {
        if (this.undoStack.length === 0) return null;
        const action = this.undoStack.pop();
        this.restoreSnapshot(board, action.before);
        this.redoStack.push(action);
        return this.describeAction(action);
    }
    redo(board) {
        if (this.redoStack.length === 0) return null;
        const action = this.redoStack.pop();
        this.restoreSnapshot(board, action.after);
        this.undoStack.push(action);
        return this.describeAction(action);
    }
    describeAction(action) {
        if (!action) return null;
        return action.ids?.[0] || action.label || action.type || 'history';
    }
    removeObject(board, jxgObject) {
        const id = this.idForObject(jxgObject);
        if (!id) return null;
        const before = this.snapshot();
        const ids = this.collectDependentIds(this.collectOwnedIds([id]));
        const removedId = this.removeIds(board, ids);
        this.commitSnapshotAction('delete', before, this.snapshot(), {
            label: 'delete',
            ids
        });
        return removedId;
    }
    collectOwnedIds(rootIds) {
        const ids = new Set(rootIds);
        let changed = true;

        while (changed) {
            changed = false;
            for (const id of Array.from(ids)) {
                const obj = this.shapes.get(id);
                if (!obj) continue;
                const ownedIds = this.getDirectOwnedIds(obj);
                ownedIds.forEach((ownedId) => {
                    if (!ids.has(ownedId)) {
                        ids.add(ownedId);
                        changed = true;
                    }
                });
            }
        }

        return Array.from(ids);
    }
    getDirectOwnedIds(obj) {
        const ids = [];
        if (!obj) return ids;

        if (obj.elType === 'polygon') {
            if (Array.isArray(obj.meta?.closedSegmentIds)) {
                ids.push(...obj.meta.closedSegmentIds);
            }
            if (Array.isArray(obj.vertices)) {
                obj.vertices.forEach((point) => {
                    if (point?.registryId) ids.push(point.registryId);
                });
            }
        }

        return ids.filter((id) => this.shapes.has(id));
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
                    this.collectOwnedIds([candidateId]).forEach((ownedId) => ids.add(ownedId));
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
        if (Array.isArray(obj.meta?.historyParentIds) && obj.meta.historyParentIds.includes(target.registryId)) return true;
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
            if (this.activeUndoBatch) {
                this.activeUndoBatch.ids = this.activeUndoBatch.ids.filter((id) => !removedSet.has(id));
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
        this.redoStack = [];
        this.activeUndoBatch = null;
    }
    snapshot() {
        return this.history
            .map((id, order) => {
                const obj = this.shapes.get(id);
                if (!obj) return null;
                return this.snapshotObject(id, obj, order);
            })
            .filter(Boolean);
    }
    snapshotObject(id, obj, order) {
        const base = this.serializeObject(id, obj, order);
        base.meta = this.cloneMeta(obj.meta);
        if (obj.meta?.historyAction) {
            base.constructionType = obj.meta.historyAction;
        }

        if (obj.elType === 'glider') {
            const pathId = this.idForObject(obj.slideObject || obj.path || obj.onPolygon);
            if (pathId) base.pathId = pathId;
        }

        if (this.hasEndpoints(obj)) {
            base.endpointIds = [obj.point1, obj.point2]
                .map((point) => this.idForObject(point))
                .filter(Boolean);
        }

        if (obj.elType === 'circle') {
            base.centerId = this.idForObject(obj.center);
            base.radiusPointId = this.idForObject(obj.radiuspoint);
        }

        if (obj.elType === 'polygon' && Array.isArray(obj.vertices)) {
            base.vertexIds = obj.vertices
                .map((point) => this.idForObject(point))
                .filter(Boolean);
        }

        if (obj.elType === 'angle' && obj.point1 && obj.point2 && obj.point3) {
            base.pointIds = [obj.point1, obj.point2, obj.point3]
                .map((point) => this.idForObject(point))
                .filter(Boolean);
        }

        const parentIds = this.getParentIds(obj);
        if (parentIds.length > 0) {
            base.parentIds = parentIds;
        }

        return base;
    }
    getParentIds(obj) {
        if (Array.isArray(obj?.meta?.historyParentIds)) {
            return obj.meta.historyParentIds.filter((id) => this.shapes.has(id));
        }
        if (!Array.isArray(obj?.parents)) {
            return [];
        }
        return obj.parents
            .map((parent) => {
                if (typeof parent === 'string' && this.shapes.has(parent)) {
                    return parent;
                }
                return this.idForObject(parent);
            })
            .filter(Boolean);
    }
    restoreSnapshot(board, snapshot) {
        this.removeCurrentObjects(board);
        this.shapes.clear();
        this.history = [];

        this.cloneSnapshot(snapshot).forEach((entry) => {
            const obj = this.createObjectFromSnapshot(board, entry);
            if (!obj) {
                return;
            }
            if (entry.meta && typeof entry.meta === 'object') {
                obj.meta = { ...(obj.meta || {}), ...entry.meta };
            }
            obj.registryId = entry.id;
            this.shapes.set(entry.id, obj);
            this.history.push(entry.id);
            if (typeof this.restoreHandler === 'function') {
                this.restoreHandler(obj, entry);
            }
        });

        board?.update?.();
    }
    removeCurrentObjects(board) {
        this.history.slice().reverse().forEach((id) => {
            const obj = this.shapes.get(id);
            if (!obj) {
                return;
            }
            try {
                board?.removeObject?.(obj);
            } catch (error) {
                console.error('移除对象失败:', error);
            }
        });
    }
    createObjectFromSnapshot(board, entry) {
        if (this.snapshotFactory) {
            return this.snapshotFactory(entry);
        }
        if (!board || typeof board.create !== 'function') {
            return { id: entry.id, elType: entry.type };
        }
        if (entry.type === 'point' || entry.type === 'glider') {
            const coords = entry.coords || [entry.position?.x || 0, entry.position?.y || 0];
            return board.create('point', coords, { name: entry.label || '', withLabel: Boolean(entry.label) });
        }
        return null;
    }
    cloneSnapshot(snapshot) {
        return JSON.parse(JSON.stringify(snapshot || []));
    }
    cloneMeta(meta) {
        if (!meta || typeof meta !== 'object') {
            return null;
        }
        return JSON.parse(JSON.stringify(meta));
    }
    snapshotsEqual(first, second) {
        return JSON.stringify(first || []) === JSON.stringify(second || []);
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

        if ((obj.elType === 'point' || obj.elType === 'glider') && typeof obj.X === 'function' && typeof obj.Y === 'function') {
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

        if (obj.elType === 'functiongraph' && obj.meta?.expr) {
            data.expr = obj.meta.expr;
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
            const first = this.pointCoords(obj.point1);
            const second = this.pointCoords(obj.point2);
            if (!first || !second) return null;
            return {
                x: (first.x + second.x) / 2,
                y: (first.y + second.y) / 2
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
