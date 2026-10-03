// Reading questions without any data-qa-* hooks: the adapter must infer the question, its choices,
// selection state and the Next control from what the elements are.
import { beforeEach, describe, expect, it } from "vitest";
import { isDistinguished } from "../src/content/adapters/infer";
import { SemanticAdapter } from "../src/content/adapters/semantic";
import { observePage } from "../src/content/agent/snapshot";
import { ALL_LAYOUTS, renderQuestion, SAMPLE, setupPage } from "./helpers/site";

const adapter = new SemanticAdapter();

beforeEach(() => setupPage());

describe.each(ALL_LAYOUTS)("no hooks — %s layout", (layout) => {
  it("infers question text, progress and choices", () => {
    renderQuestion(layout, { hooks: false });
    const e = adapter.extract(document)!;
    expect(e).not.toBeNull();
    expect(e.question.text).toBe(SAMPLE.text);
    expect(e.question.options.map((o) => o.text)).toEqual(["Liver", "Heart", "Lungs", "Kidney"]);
    expect([e.question.questionNumber, e.question.totalQuestions]).toEqual([7, 15]);
    expect(e.question.questionId).toBe("n7");
  });

  it("finds the Next control outside the choices", () => {
    renderQuestion(layout, { hooks: false, nav: "link" });
    expect(adapter.findNext(document)?.label).toBe("Continue →");
  });
});

describe("inferred choice kinds and selection", () => {
  it("reads toggle buttons by aria-pressed", () => {
    const { recorded } = renderQuestion("toggle", { hooks: false });
    const e = adapter.extract(document)!;
    expect(e.options[0].kind).toBe("toggle");
    adapter.select(e.options[1]);
    expect(recorded).toEqual(["B"]);
    expect(adapter.isSelected(e.options[1])).toBe(true);
    expect(adapter.isSelected(e.options[0])).toBe(false);
  });

  it("reads unsemantic div tiles and detects selection from their styling", () => {
    renderQuestion("tiles", { hooks: false });
    const e = adapter.extract(document)!;
    expect(e.options.map((o) => o.kind)).toEqual(["generic", "generic", "generic", "generic"]);
    expect(e.options.some((o) => adapter.isSelected(o))).toBe(false);
    // The tiles ignore click(); a real press (mousedown) selects.
    adapter.select(e.options[2]);
    expect(adapter.isSelected(e.options[2])).toBe(false);
    e.options[2].element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(e.options.map((o) => adapter.isSelected(o))).toEqual([false, false, true, false]);
  });

  it("isDistinguished ignores markers every sibling shares and 'false' states", () => {
    document.body.innerHTML = `<div><i class="c" aria-pressed="false">a</i><i class="c" aria-pressed="false">b</i></div>`;
    const [a, b] = [...document.querySelectorAll("i")];
    expect(isDistinguished(a, [a, b])).toBe(false);
    b.classList.add("picked");
    expect([isDistinguished(a, [a, b]), isDistinguished(b, [a, b])]).toEqual([false, true]);
  });

  it("refuses to guess when two answer groups are on the page", () => {
    renderQuestion("radio", { hooks: false });
    const second = document.createElement("fieldset");
    second.innerHTML = `<legend>Another?</legend><label><input type="radio" name="other">x</label><label><input type="radio" name="other">y</label>`;
    document.getElementById("stage")!.append(second);
    expect(adapter.extract(document)).toBeNull();
  });

  it("does not treat the unlabelled icon button as navigation (the AI handles it)", () => {
    renderQuestion("radio", { hooks: false, nav: "icon" });
    expect(adapter.extract(document)).not.toBeNull();
    expect(adapter.findNext(document)).toBeNull();
  });
});

describe("completion without hooks", () => {
  it("recognises a completion heading when no question is shown", () => {
    document.getElementById("stage")!.innerHTML = `<section><h1>Assessment complete</h1><p>Thanks!</p></section>`;
    expect(adapter.isComplete(document)).toBe(true);
  });

  it("is not fooled by the words while a question is still on the page", () => {
    renderQuestion("radio", { hooks: false });
    document.getElementById("stage")!.insertAdjacentHTML("afterbegin", `<h2>Your score will appear here</h2>`);
    expect(adapter.isComplete(document)).toBe(false);
  });
});

describe("observePage (snapshot for the AI)", () => {
  it("lists interactive elements with roles, labels, state and grouping, in page order", () => {
    renderQuestion("radio", { hooks: false });
    (document.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1]).checked = true;
    const { snapshot, registry } = observePage(document);
    const radios = snapshot.elements.filter((e) => e.role === "radio");
    expect(radios.map((r) => r.text)).toEqual(["Liver", "Heart", "Lungs", "Kidney"]);
    expect(radios[1].state).toContain("checked");
    expect(new Set(radios.map((r) => r.group)).size).toBe(1);
    expect(snapshot.elements.find((e) => e.text === "Next")).toMatchObject({ role: "button", state: ["disabled"] });
    expect(registry.get(radios[0].id)).toBe(document.querySelector('input[type="radio"]'));
    expect(snapshot.texts).toContain(SAMPLE.text);
  });

  it("includes unsemantic clickable tiles once each (not their inner spans)", () => {
    renderQuestion("tiles", { hooks: false });
    const tiles = observePage(document).snapshot.elements.filter((e) => e.role === "clickable");
    expect(tiles.map((t) => t.text)).toEqual(["Liver", "Heart", "Lungs", "Kidney"]);
  });

  it("does not modify the page", () => {
    renderQuestion("cards", { hooks: false });
    const before = document.body.innerHTML;
    observePage(document);
    expect(document.body.innerHTML).toBe(before);
  });
});
