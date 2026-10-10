import { marked } from "marked";
import DOMPurify from "dompurify";
import type { CitedSource } from "./types";

let titles = new Map<string, string>();
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName !== "A") return;
  node.setAttribute("target", "_blank");
  node.setAttribute("rel", "noopener noreferrer");
  if (/^\[\d+\]$/.test(node.textContent ?? "")) {
    node.classList.add("cite");
    const title = titles.get(node.getAttribute("href") ?? "");
    if (title) node.setAttribute("title", title);
  }
});

export function renderMarkdown(
  md: string,
  sources: CitedSource[] = [],
): string {
  titles = new Map(sources.map((s) => [s.url, s.title]));
  return DOMPurify.sanitize(marked.parse(md, { async: false }));
}
