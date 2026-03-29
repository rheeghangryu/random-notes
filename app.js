const svg = d3.select("#graph");
const graphPane = document.getElementById("graphPane");

const noteTitleEl = document.getElementById("noteTitle");
const noteContentEl = document.getElementById("noteContent");

let width, height;

function resize() {
  width = graphPane.clientWidth;
  height = graphPane.clientHeight;
}
window.addEventListener("resize", () => {
  resize();
  if (window.__graphData) renderGraph(window.__graphData);
});
resize();

async function loadGraph() {
  const res = await fetch("./graph.json");
  return res.json();
}

async function loadNote(path) {
  const res = await fetch(path);
  let md = await res.text();
  // [[note]]를 링크로 바꾸기 (나중에 더 확장 가능)
  md = md.replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => {
    const text = label ?? target;
    return `[${text}](#note:${target.trim()})`;
  });

  // 본문 중간: ::footnotes:: ... ::/footnotes:: → .footnotes 스타일 (list.css / #noteContent .footnotes)
  md = md.replace(
    /(?:^|\n)::footnotes::\n([\s\S]*?)\n::\/footnotes::/g,
    (_, inner) => "\n<div class=\"footnotes\">" + marked.parse(inner.trim()) + "</div>"
  );

  // 문서 끝: ::footnotes:: 이하를 <div class="footnotes">로 감싸기
  const parts = md.split(/\n::footnotes::\n/);
  if (parts.length === 2) {
    const mainHtml = marked.parse(parts[0].trim());
    const footnotesHtml = marked.parse(parts[1].trim());
    return mainHtml + '\n<div class="footnotes">' + footnotesHtml + "</div>";
  }
  return marked.parse(md);
}

const notePane = document.getElementById("notePane");

function showNote() {
  notePane.classList.remove("hidden");
}

function hideNote() {
  notePane.classList.add("hidden");
  noteTitleEl.textContent = "";
  noteContentEl.innerHTML = "";
}

function setNote(title, html) {
  noteTitleEl.textContent = title ?? "";
  noteContentEl.innerHTML = html ?? "";
  showNote();
}

function attachNoteLinkHandler(nodesById) {
  // 노트 내부의 #note:xxx 링크를 클릭하면 해당 노드 열기
  noteContentEl.addEventListener("click", async (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    if (!href.startsWith("#note:")) return;

    e.preventDefault();
    const id = decodeURIComponent(href.slice("#note:".length));
    const node = nodesById.get(id);
    if (node) {
      const html = await loadNote(node.path);
      setNote(node.title, html);
    }
  });
}

function renderGraph(data) {
  // 순번(id)으로 정렬하여 1열 배치. (그래프/force 레이아웃으로 되돌리려면 아래 주석 참고)
  const nodes = data.nodes
    .map(d => ({ ...d }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));

  const nodesById = new Map(nodes.map(n => [n.id, n]));
  attachNoteLinkHandler(nodesById);

  svg.selectAll("*").remove();
  const g = svg.append("g");

  svg.call(
    d3.zoom()
      .scaleExtent([0.5, 3])
      .on("zoom", (event) => g.attr("transform", event.transform))
  );

  const pad = 8;
  const fontSize = 14;
  const gap = 16;
  const marginTop = 24;
  const centerX = width / 2;

  const node = g.append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .style("cursor", "pointer");

  // 노드: 제목 텍스트를 테두리 있는 사각형 박스로 (클릭 시 페이지/노트로 이동)
  node.each(function (d) {
    const gEl = d3.select(this);
    const text = gEl.append("text")
      .text(d.title)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("x", 0)
      .attr("y", 0)
      .attr("fill", "rgb(157, 0, 255)")
      .attr("font-size", fontSize);

    const bbox = text.node().getBBox();
    gEl.insert("rect", "text")
      .attr("x", bbox.x - pad)
      .attr("y", bbox.y - pad)
      .attr("width", bbox.width + pad * 2)
      .attr("height", bbox.height + pad * 2)
      .attr("fill", "none")
      .attr("stroke", "rgb(157, 0, 255)")
      .attr("stroke-width", 1.5);

    d.width = bbox.width + pad * 2;
    d.height = bbox.height + pad * 2;
  });

  // 1열 배치: 위에서부터 순번대로
  let y = marginTop;
  nodes.forEach((d) => {
    d.x = centerX;
    d.y = y + d.height / 2;
    y += d.height + gap;
  });

  const totalHeight = y - gap + marginTop;
  svg.attr("viewBox", `0 0 ${width} ${Math.max(height, totalHeight)}`);

  // 이어지는 선: 연속된 노드 사이
  const linkData = nodes.slice(0, -1).map((_, i) => ({ source: nodes[i], target: nodes[i + 1] }));
  g.insert("g", ":first-child")
    .attr("stroke", "rgb(157, 0, 255)")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "5, 5")
    .selectAll("line")
    .data(linkData)
    .join("line")
    .attr("x1", (d) => d.source.x)
    .attr("y1", (d) => d.source.y + d.source.height / 2)
    .attr("x2", (d) => d.target.x)
    .attr("y2", (d) => d.target.y - d.target.height / 2);

  node.attr("transform", (d) => `translate(${d.x},${d.y})`);

  // 클릭하면 노트 패널 열기
  node.on("click", async (event, d) => {
    const html = await loadNote(d.path);
    setNote(d.title, html);
  });

  notePane.addEventListener("click", (e) => {
    if (!e.target.closest(".note-content")) {
      hideNote();
    }
  });

  /* ---------- 그래프(force) 레이아웃으로 되돌리려면: hub 추가 + force 시뮬레이션 사용 ----------
  const hub = { id: "__hub__", title: "", path: null, isHub: true };
  nodes.unshift(hub);
  const links = nodes.filter(n => n.id !== hub.id).map(n => ({ source: hub.id, target: n.id }));
  const sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(250))
    .force("charge", d3.forceManyBody().strength(-200))
    .force("center", d3.forceCenter(width/2, height/2))
    .force("collide", d => Math.max(d.width, d.height)/2 + 12);
  sim.on("tick", () => { link.attr(...); node.attr("transform", ...); });
  node.call(d3.drag().on("start",...).on("drag",...).on("end",...));
  ---------- */
}

(async function main() {
  const data = await loadGraph();
  window.__graphData = data;
  renderGraph(data);
})();