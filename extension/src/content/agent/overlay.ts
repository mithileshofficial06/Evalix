// A small status badge shown on the page (dry-run: "Evalix would select B …"). It lives in a
// closed shadow root, so its text is invisible to the page model and to the page's own scripts.
import { OVERLAY_TAG } from "../adapters/infer";

const STYLE = `
  :host { all: initial; }
  div { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; max-width: 360px;
        font: 13px/1.4 system-ui, "Segoe UI", sans-serif; color: #fff; background: #1f2937;
        border-left: 4px solid #f59e0b; border-radius: 8px; padding: 10px 12px;
        box-shadow: 0 6px 24px rgba(0,0,0,.25); white-space: pre-line; }
  b { color: #fbbf24; }
`;

export class Overlay {
  private host: HTMLElement | null = null;
  private body: HTMLElement | null = null;

  constructor(private readonly doc: Document) {}

  show(title: string, lines: string[]) {
    if (!this.host || !this.host.isConnected) {
      this.host = this.doc.createElement(OVERLAY_TAG);
      const shadow = this.host.attachShadow({ mode: "closed" });
      const style = this.doc.createElement("style");
      style.textContent = STYLE;
      this.body = this.doc.createElement("div");
      shadow.append(style, this.body);
      this.doc.documentElement.append(this.host);
    }
    const b = this.doc.createElement("b");
    b.textContent = title;
    this.body!.replaceChildren(b, this.doc.createTextNode(lines.length ? `\n${lines.join("\n")}` : ""));
  }

  clear() {
    this.host?.remove();
    this.host = null;
    this.body = null;
  }
}
