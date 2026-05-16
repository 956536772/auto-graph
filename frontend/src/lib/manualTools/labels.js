function normalizePointLabel(rawValue) {
  return typeof rawValue === 'string' ? rawValue.trim() : '';
}

function readPointLabel(point) {
  if (!point) {
    return '';
  }
  if (typeof point.getName === 'function') {
    return point.getName() || '';
  }
  return point.name || '';
}

function attachLabelListener(point, handler) {
  if (!point || !point.label || point.__labelDblClickAttached) {
    return;
  }
  if (typeof point.label.on === 'function') {
    point.label.on('dblclick', handler);
    point.__labelDblClickAttached = true;
  }
}

function makePointLabelMovable(point) {
  if (!point || !point.label) {
    return;
  }

  point.label.setAttribute({
    fixed: false,
    highlight: true
  });
}

export function setPointLabel(point, label) {
  if (!point) {
    return '';
  }

  const normalized = normalizePointLabel(label);
  point.setAttribute({
    name: normalized,
    withLabel: Boolean(normalized)
  });

  makePointLabelMovable(point);

  if (point.__openLabelEditor) {
    attachLabelListener(point, point.__openLabelEditor);
  }

  return normalized;
}

export function getNextPointLabel(registry) {
  const usedLabels = new Set();

  if (registry && typeof registry.entries === 'function') {
    registry.entries().forEach(([, obj]) => {
      if (!obj || (obj.elType !== 'point' && obj.elType !== 'glider')) {
        return;
      }
      const label = readPointLabel(obj);
      if (label) {
        usedLabels.add(label);
      }
    });
  }

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

export function ensurePointLabelEditor(point, { board, suggestLabel, onBeforeLabelEdit, onLabelEdit } = {}) {
  if (!point) {
    return null;
  }

  point.__labelEditorOptions = {
    ...(point.__labelEditorOptions || {}),
    ...(board ? { board } : {}),
    ...(suggestLabel ? { suggestLabel } : {}),
    ...(onBeforeLabelEdit ? { onBeforeLabelEdit } : {}),
    ...(onLabelEdit ? { onLabelEdit } : {})
  };

  makePointLabelMovable(point);

  if (point.__openLabelEditor) {
    attachLabelListener(point, point.__openLabelEditor);
    return point.__openLabelEditor;
  }

  const openEditor = () => {
    const options = point.__labelEditorOptions || {};
    const fallback = typeof options.suggestLabel === 'function' ? options.suggestLabel(point) : '';
    const currentLabel = readPointLabel(point);
    const beforeState = options.onBeforeLabelEdit?.(point);
    const nextLabel = window.prompt('输入点标签', currentLabel || fallback);

    if (nextLabel === null) {
      return currentLabel;
    }

    const normalized = setPointLabel(point, nextLabel);
    if (options.board) {
      options.board.update();
    }
    if (normalized !== currentLabel) {
      options.onLabelEdit?.({
        point,
        beforeState,
        previousLabel: currentLabel,
        nextLabel: normalized
      });
    }
    attachLabelListener(point, openEditor);
    return normalized;
  };

  point.__openLabelEditor = openEditor;

  attachLabelListener(point, openEditor);
  makePointLabelMovable(point);

  return openEditor;
}

export function openPointLabelEditor(point, options) {
  const openEditor = ensurePointLabelEditor(point, options);
  if (!openEditor) {
    return '';
  }
  return openEditor();
}
