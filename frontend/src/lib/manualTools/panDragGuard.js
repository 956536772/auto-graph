const RELEASE_EVENTS = ['pointerup', 'pointercancel', 'mouseup', 'touchend', 'touchcancel', 'blur'];

function getDefaultWindow() {
  return typeof window === 'undefined' ? null : window;
}

export function createBoardPanDragGuard(board, getWindow = getDefaultWindow) {
  let active = false;
  let originalPan = null;

  const removeReleaseListeners = () => {
    const targetWindow = getWindow();
    if (!targetWindow?.removeEventListener) {
      return;
    }
    RELEASE_EVENTS.forEach((eventName) => {
      targetWindow.removeEventListener(eventName, restore);
    });
  };

  function restore() {
    if (!active) {
      return;
    }

    active = false;
    removeReleaseListeners();
    if (originalPan !== null) {
      board?.setAttribute?.({ pan: { enabled: originalPan } });
      originalPan = null;
    }
  }

  const addReleaseListeners = () => {
    const targetWindow = getWindow();
    if (!targetWindow?.addEventListener) {
      return;
    }
    RELEASE_EVENTS.forEach((eventName) => {
      targetWindow.addEventListener(eventName, restore);
    });
  };

  return {
    start() {
      restore();
      active = true;
      originalPan = board?.options?.pan?.enabled ?? null;
      board?.setAttribute?.({ pan: { enabled: false } });
      addReleaseListeners();
    },
    restore
  };
}
