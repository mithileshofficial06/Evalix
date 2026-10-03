// Question layouts. Each uses a different, accessibility-standard markup pattern so the
// extension's extractor must handle real-world variety rather than one fixed structure.
// Every builder returns the question element; `onSelect(letter)` records the answer.

const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") node.textContent = v;
    else if (k === "className") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) node.append(c);
  return node;
};

// 1. Native radio inputs inside <fieldset>/<legend>.
function radioLayout(q, onSelect) {
  const fieldset = el("fieldset", { className: "layout-radio" }, [el("legend", { text: q.text })]);
  const options = q.options.map((o) => {
    const input = el("input", { type: "radio", name: `answer-${q.id}`, value: o.id });
    input.addEventListener("change", () => onSelect(o.id));
    return el("label", { className: "radio-option" }, [input, el("span", { text: o.text })]);
  });
  return { root: fieldset, options };
}

// 2. ARIA radiogroup of clickable cards, with "A." prefixes rendered in the text.
function cardsLayout(q, onSelect) {
  const group = el("div", { role: "radiogroup", className: "cards", "aria-label": "Answer choices" });
  const options = q.options.map((o) => {
    const card = el("div", { role: "radio", "aria-checked": "false", tabindex: "0", className: "card", "data-value": o.id });
    card.textContent = `${o.id}. ${o.text}`;
    const choose = () => {
      group.querySelectorAll('[role="radio"]').forEach((c) => c.setAttribute("aria-checked", "false"));
      card.setAttribute("aria-checked", "true");
      onSelect(o.id);
    };
    card.addEventListener("click", choose);
    card.addEventListener("keydown", (e) => (e.key === " " || e.key === "Enter") && choose());
    return card;
  });
  const root = el("div", { className: "layout-cards" }, [el("h2", { className: "stem", text: q.text }), group]);
  return { root, options, optionParent: group };
}

// 3. Native <select> dropdown with a placeholder option.
function selectLayout(q, onSelect) {
  const id = `select-${q.id}`;
  const select = el("select", { id }, [el("option", { value: "", text: "Choose an answer…" })]);
  select.addEventListener("change", () => select.value && onSelect(select.value));
  const options = q.options.map((o) => el("option", { value: o.id, text: o.text }));
  const root = el("div", { className: "layout-select" }, [el("label", { for: id, text: q.text }), select]);
  return { root, options, optionParent: select };
}

// 4. ARIA listbox with selectable options.
function listboxLayout(q, onSelect) {
  const list = el("ul", { role: "listbox", className: "listbox", "aria-label": "Answer choices" });
  const options = q.options.map((o) => {
    const item = el("li", { role: "option", "aria-selected": "false", "data-value": o.id, text: o.text });
    item.addEventListener("click", () => {
      list.querySelectorAll('[role="option"]').forEach((i) => i.setAttribute("aria-selected", "false"));
      item.setAttribute("aria-selected", "true");
      onSelect(o.id);
    });
    return item;
  });
  const root = el("div", { className: "layout-listbox" }, [el("p", { className: "stem", text: q.text }), list]);
  return { root, options, optionParent: list };
}

// 5. Toggle buttons (aria-pressed) under an <h3> stem.
function toggleLayout(q, onSelect) {
  const group = el("div", { className: "toggles" });
  const options = q.options.map((o) => {
    const b = el("button", { type: "button", className: "toggle", "aria-pressed": "false", text: o.text });
    b.addEventListener("click", () => {
      group.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
      onSelect(o.id);
    });
    return b;
  });
  const root = el("div", { className: "layout-toggle" }, [el("h3", { className: "stem", text: q.text }), group]);
  return { root, options, optionParent: group };
}

// 6. No semantics at all: plain <div> tiles whose selection shows only as a CSS class, a <div>
// stem, and a handler on mousedown (a plain .click() does nothing) - like many custom widgets.
function tilesLayout(q, onSelect) {
  const grid = el("div", { className: "tiles" });
  const options = q.options.map((o) => {
    const tile = el("div", { className: "tile" }, [el("span", { className: "tile-text", text: o.text })]);
    tile.addEventListener("mousedown", () => {
      grid.querySelectorAll(".tile").forEach((t) => t.classList.remove("tile--on"));
      tile.classList.add("tile--on");
      onSelect(o.id);
    });
    return tile;
  });
  const root = el("div", { className: "layout-tiles" }, [el("div", { className: "tile-prompt", text: q.text }), grid]);
  return { root, options, optionParent: grid };
}

export const LAYOUTS = {
  radio: radioLayout,
  cards: cardsLayout,
  select: selectLayout,
  listbox: listboxLayout,
  toggle: toggleLayout,
  tiles: tilesLayout,
};
export const LAYOUT_ORDER = ["radio", "cards", "select", "listbox"];
export const LAYOUT_ALL = [...LAYOUT_ORDER, "toggle", "tiles"];
export { el };
