const container = document.getElementById("listContainer");

async function loadGraph() {
  const res = await fetch("./graph.json");
  return res.json();
}

async function loadNote(path) {
  const res = await fetch(path);
  let md = await res.text();
  md = md.replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => {
    const text = label ?? target;
    return `[${text}](#note:${target.trim()})`;
  });
  md = md.replace(
    /(?:^|\n)::footnotes::\n([\s\S]*?)\n::\/footnotes::/g,
    (_, inner) => "\n<div class=\"footnotes\">" + marked.parse(inner.trim()) + "</div>"
  );
  const parts = md.split(/\n::footnotes::\n/);
  if (parts.length === 2) {
    const mainHtml = marked.parse(parts[0].trim());
    const footnotesHtml = marked.parse(parts[1].trim());
    return mainHtml + '\n<div class="footnotes">' + footnotesHtml + "</div>";
  }
  return marked.parse(md);
}

function attachNoteLinkHandler() {
  container.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    if (!href.startsWith("#note:")) return;
    e.preventDefault();
    const id = decodeURIComponent(href.slice("#note:".length)).trim();
    const el = document.getElementById("note-" + id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

(async function main() {
  attachNoteLinkHandler();
  const data = await loadGraph();
  const nodes = data.nodes
    .filter((n) => n.id && n.path)
    .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));

  container.innerHTML = "";
  container.classList.remove("list-loading");

  for (const node of nodes) {
    const section = document.createElement("article");
    section.id = "note-" + node.id;
    section.className = "list-note";

    const titleEl = document.createElement("h2");
    titleEl.className = "list-note-title";
    titleEl.textContent = node.title;
    section.appendChild(titleEl);

    const bodyEl = document.createElement("div");
    bodyEl.className = "list-note-body";
    try {
      bodyEl.innerHTML = await loadNote(node.path);
    } catch (err) {
      bodyEl.textContent = "내용을 불러올 수 없습니다.";
    }
    section.appendChild(bodyEl);

    container.appendChild(section);
  }
})();
