function enableLinkSorting(options) {
  const { container, itemSelector, onSort, onSortError } = options;
  if (!container) {
    return;
  }
  if (container.sortableCleanup) {
    container.sortableCleanup();
  }

  let drag = null;
  let suppressClick = false;

  const sortableItems = () => Array.from(container.querySelectorAll(itemSelector));
  const visibleIds = () => sortableItems().map((item) => Number(item.dataset.linkId)).filter(Number.isFinite);

  const cleanupDrag = () => {
    if (!drag) {
      return;
    }
    drag.item.classList.remove("is-dragging");
    container.classList.remove("is-sorting");
    drag = null;
  };

  const closestSlot = (x, y, draggedItem) => {
    let closest = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    sortableItems().forEach((item) => {
      if (item === draggedItem) {
        return;
      }
      const rect = item.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distance = Math.hypot(x - centerX, y - centerY);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = { item, rect, centerX, centerY };
      }
    });
    return closest;
  };

  const moveDraggedItem = (event) => {
    const slot = closestSlot(event.clientX, event.clientY, drag.item);
    if (!slot) {
      return;
    }
    const before = event.clientY < slot.centerY || (Math.abs(event.clientY - slot.centerY) < slot.rect.height / 3 && event.clientX < slot.centerX);
    const next = before ? slot.item : slot.item.nextElementSibling;
    if (next !== drag.item) {
      container.insertBefore(drag.item, next);
    }
  };

  const onPointerDown = (event) => {
    if (event.button !== 0 || event.target.closest("button, input, select, textarea")) {
      return;
    }
    const item = event.target.closest(itemSelector);
    if (!item || !container.contains(item)) {
      return;
    }
    drag = {
      item,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    item.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.active && distance < 6) {
      return;
    }
    if (!drag.active) {
      drag.active = true;
      drag.item.classList.add("is-dragging");
      container.classList.add("is-sorting");
    }
    event.preventDefault();
    moveDraggedItem(event);
  };

  const finishSort = async (event) => {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    const didSort = drag.active;
    drag.item.releasePointerCapture?.(event.pointerId);
    cleanupDrag();
    if (!didSort) {
      return;
    }
    suppressClick = true;
    window.setTimeout(() => {
      suppressClick = false;
    }, 0);
    try {
      await onSort(visibleIds());
    } catch (error) {
      if (onSortError) {
        onSortError(error);
      }
    }
  };

  const cancelSort = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    drag.item.releasePointerCapture?.(event.pointerId);
    cleanupDrag();
  };

  const onClick = (event) => {
    if (!suppressClick) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", finishSort);
  container.addEventListener("pointercancel", cancelSort);
  container.addEventListener("click", onClick, true);

  sortableItems().forEach((item) => {
    item.draggable = false;
  });

  container.sortableCleanup = () => {
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerup", finishSort);
    container.removeEventListener("pointercancel", cancelSort);
    container.removeEventListener("click", onClick, true);
    cleanupDrag();
    delete container.sortableCleanup;
  };
}
