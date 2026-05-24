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
  const orderedIds = () => sortableItems().map((item) => Number(item.dataset.linkId)).filter(Number.isFinite);

  const clearDragStyles = (item) => {
    item.style.left = "";
    item.style.top = "";
    item.style.width = "";
    item.style.height = "";
    item.style.position = "";
    item.style.pointerEvents = "";
    item.style.zIndex = "";
    item.style.margin = "";
    item.style.transform = "";
  };

  const clearDrag = () => {
    if (!drag) {
      return;
    }
    window.clearInterval(drag.slotTimer);
    drag.item.classList.remove("is-dragging");
    clearDragStyles(drag.item);
    drag.placeholder?.remove();
    container.classList.remove("is-sorting");
    drag = null;
  };

  const sortableLayoutItems = () =>
    Array.from(container.children).filter(
      (child) => (child.matches?.(itemSelector) && !child.classList.contains("is-dragging")) || child.classList?.contains("sort-placeholder")
    );

  const animateReflow = (mutate) => {
    const before = new Map();
    sortableLayoutItems().forEach((item) => {
      before.set(item, item.getBoundingClientRect());
    });
    mutate();
    sortableLayoutItems().forEach((item) => {
      const first = before.get(item);
      if (!first) {
        return;
      }
      const last = item.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (!dx && !dy) {
        return;
      }
      item.style.transition = "none";
      item.style.transform = `translate(${dx}px, ${dy}px)`;
      item.getBoundingClientRect();
      item.style.transition = "transform 120ms ease";
      item.style.transform = "";
      window.setTimeout(() => {
        item.style.transition = "";
      }, 140);
    });
  };

  const closestSlot = (x, y) => {
    let closest = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    sortableItems().forEach((item) => {
      if (item === drag.item) {
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

  const updateFloatingItem = (event) => {
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.item.style.left = `${event.clientX - drag.offsetX}px`;
    drag.item.style.top = `${event.clientY - drag.offsetY}px`;
  };

  const updatePlaceholder = () => {
    if (!drag?.active) {
      return;
    }
    const slot = closestSlot(drag.lastX, drag.lastY);
    if (!slot) {
      return;
    }
    const before = drag.lastY < slot.centerY || (Math.abs(drag.lastY - slot.centerY) < slot.rect.height / 3 && drag.lastX < slot.centerX);
    const next = before ? slot.item : slot.item.nextElementSibling;
    if (next === drag.placeholder || next === drag.item) {
      return;
    }
    animateReflow(() => {
      container.insertBefore(drag.placeholder, next);
    });
  };

  const startDrag = (event) => {
    const rect = drag.item.getBoundingClientRect();
    const placeholder = document.createElement("div");
    placeholder.className = "sort-placeholder";
    placeholder.style.width = `${rect.width}px`;
    placeholder.style.height = `${rect.height}px`;
    container.insertBefore(placeholder, drag.item);

    drag.placeholder = placeholder;
    drag.offsetX = event.clientX - rect.left;
    drag.offsetY = event.clientY - rect.top;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.active = true;
    drag.item.classList.add("is-dragging");
    drag.item.style.width = `${rect.width}px`;
    drag.item.style.height = `${rect.height}px`;
    drag.item.style.position = "fixed";
    drag.item.style.left = `${rect.left}px`;
    drag.item.style.top = `${rect.top}px`;
    drag.item.style.margin = "0";
    drag.item.style.pointerEvents = "none";
    drag.item.style.zIndex = "20";
    container.classList.add("is-sorting");
    drag.slotTimer = window.setInterval(updatePlaceholder, 90);
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
      placeholder: null,
      slotTimer: null,
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
      startDrag(event);
    }
    event.preventDefault();
    updateFloatingItem(event);
  };

  const finishSort = async (event) => {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    const didSort = drag.active;
    drag.item.releasePointerCapture?.(event.pointerId);
    if (!didSort) {
      clearDrag();
      return;
    }
    window.clearInterval(drag.slotTimer);
    updatePlaceholder();
    const placeholder = drag.placeholder;
    const draggedItem = drag.item;
    container.insertBefore(draggedItem, placeholder);
    placeholder.remove();
    draggedItem.classList.remove("is-dragging");
    clearDragStyles(draggedItem);
    container.classList.remove("is-sorting");
    drag = null;

    suppressClick = true;
    window.setTimeout(() => {
      suppressClick = false;
    }, 250);

    try {
      await onSort(orderedIds());
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
    clearDrag();
  };

  const onClick = (event) => {
    if (!suppressClick) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const onDragStart = (event) => {
    event.preventDefault();
  };

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", finishSort);
  container.addEventListener("pointercancel", cancelSort);
  container.addEventListener("click", onClick, true);
  container.addEventListener("dragstart", onDragStart);

  sortableItems().forEach((item) => {
    item.draggable = false;
  });

  container.sortableCleanup = () => {
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerup", finishSort);
    container.removeEventListener("pointercancel", cancelSort);
    container.removeEventListener("click", onClick, true);
    container.removeEventListener("dragstart", onDragStart);
    clearDrag();
    delete container.sortableCleanup;
  };
}
