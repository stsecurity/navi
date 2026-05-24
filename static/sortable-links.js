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
    item.style.transition = "";
    item.style.willChange = "";
    item.style.boxSizing = "";
  };

  const clearDrag = () => {
    if (!drag) {
      return;
    }
    window.clearInterval(drag.slotTimer);
    drag.item.classList.remove("is-dragging");
    if (drag.placeholder && drag.returnParent && drag.item.parentElement !== drag.returnParent) {
      drag.returnParent.insertBefore(drag.item, drag.placeholder);
    }
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

  const nextSortableAfter = (item) => {
    let next = item.nextElementSibling;
    while (next && (next === drag.item || next === drag.placeholder)) {
      next = next.nextElementSibling;
    }
    return next;
  };

  const dropReference = (x, y) => {
    const entries = sortableItems()
      .filter((item) => item !== drag.item)
      .map((item) => {
        const rect = item.getBoundingClientRect();
        return {
          item,
          rect,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        };
      })
      .sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX);

    if (!entries.length) {
      return null;
    }

    const rows = [];
    entries.forEach((entry) => {
      const row = rows.find((candidate) => Math.abs(candidate.centerY - entry.centerY) < Math.max(24, entry.rect.height * 0.45));
      if (row) {
        row.items.push(entry);
        row.centerY = row.items.reduce((sum, item) => sum + item.centerY, 0) / row.items.length;
        row.top = Math.min(row.top, entry.rect.top);
        row.bottom = Math.max(row.bottom, entry.rect.bottom);
      } else {
        rows.push({
          centerY: entry.centerY,
          top: entry.rect.top,
          bottom: entry.rect.bottom,
          items: [entry],
        });
      }
    });

    let row = rows.find((candidate) => y >= candidate.top - 10 && y <= candidate.bottom + 10);
    if (!row) {
      row = rows.reduce((closest, candidate) => (Math.abs(y - candidate.centerY) < Math.abs(y - closest.centerY) ? candidate : closest), rows[0]);
    }

    row.items.sort((a, b) => a.centerX - b.centerX);
    for (const entry of row.items) {
      if (x < entry.centerX) {
        return entry.item;
      }
    }
    return nextSortableAfter(row.items[row.items.length - 1].item);
  };

  const updateFloatingItem = (event) => {
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.item.style.left = `${event.clientX - drag.offsetX}px`;
    drag.item.style.top = `${event.clientY - drag.offsetY}px`;
  };

  const commitPlaceholder = () => {
    if (!drag?.active) {
      return;
    }
    const next = drag.pendingReference;
    if (next === drag.placeholder || next === drag.item) {
      return;
    }
    animateReflow(() => {
      container.insertBefore(drag.placeholder, next);
    });
  };

  const updatePlaceholder = () => {
    if (!drag?.active) {
      return;
    }
    const next = dropReference(drag.lastX, drag.lastY);
    if (next === drag.pendingReference) {
      drag.pendingCount += 1;
    } else {
      drag.pendingReference = next;
      drag.pendingCount = 1;
    }
    if (drag.pendingCount >= 2) {
      commitPlaceholder();
    }
  };

  const startDrag = (event) => {
    const rect = drag.item.getBoundingClientRect();
    const placeholder = document.createElement("div");
    placeholder.className = "sort-placeholder";
    placeholder.style.width = `${rect.width}px`;
    placeholder.style.height = `${rect.height}px`;
    container.insertBefore(placeholder, drag.item);

    drag.placeholder = placeholder;
    drag.returnParent = drag.item.parentElement;
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
    drag.item.style.boxSizing = "border-box";
    drag.item.style.transition = "none";
    drag.item.style.willChange = "left, top";
    document.body.appendChild(drag.item);
    container.classList.add("is-sorting");
    updateFloatingItem(event);
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
      returnParent: null,
      slotTimer: null,
      pendingReference: null,
      pendingCount: 0,
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
    drag.pendingReference = dropReference(drag.lastX, drag.lastY);
    commitPlaceholder();
    const placeholder = drag.placeholder;
    const draggedItem = drag.item;
    drag.returnParent.insertBefore(draggedItem, placeholder);
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
