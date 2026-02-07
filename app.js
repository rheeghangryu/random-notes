const svg = d3.select("#graph");
const graphPane = document.getElementById("graphPane");

const noteTitleEl = document.getElementById("noteTitle");
const noteContentEl = document.getElementById("noteContent");

let width, height;

function resize() {
  width = graphPane.clientWidth;
  height = graphPane.clientHeight;
  svg.attr("viewBox", `0 0 ${width} ${height}`);
}
window.addEventListener("resize", resize);
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

  // 태그로 구간 나누기: ::footnotes:: 이하를 <div class="footnotes">로 감싸서 다른 스타일 적용
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
  const nodes = data.nodes.map(d => ({ ...d }));

  const hub = { id: "__hub__", title: "", path: null, isHub: true };
  nodes.unshift(hub);

  const links = nodes
    .filter(n => n.id !== hub.id)
    .map(n => ({ source: hub.id, target: n.id }));

  const nodesById = new Map(nodes.map(n => [n.id, n]));
  attachNoteLinkHandler(nodesById);

  svg.selectAll("*").remove();
  const g = svg.append("g");

  svg.call(
    d3.zoom()
      .scaleExtent([0.2, 3])
      .on("zoom", (event) => g.attr("transform", event.transform))
  );

  const link = g.append("g")
    .attr("stroke", "rgb(157, 0, 255)")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "5, 5")
    .selectAll("line")
    .data(links)
    .join("line");

  const node = g.append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .style("cursor", "pointer");

  // 노드: 허브는 원, 나머지는 제목 텍스트를 보더 있는 박스 안에
  const pad = 8;
  const fontSize = 14;

  node.each(function (d) {
    const g = d3.select(this);

    if (d.isHub) {
      g.append("circle")
        .attr("r", 10)
        .attr("fill", "rgb(76, 0, 131)");
      d.width = d.height = 20;
    } else {
      const text = g.append("text")
        .text(d.title)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgb(157, 0, 255)")
        .attr("font-size", fontSize);

      const bbox = text.node().getBBox();
      g.insert("rect", "text")
        .attr("x", bbox.x - pad)
        .attr("y", bbox.y - pad)
        .attr("width", bbox.width + pad * 2)
        .attr("height", bbox.height + pad * 2)
        .attr("fill", "none")
        .attr("stroke", "rgb(157, 0, 255)")
        .attr("stroke-width", 1.5);

      d.width = bbox.width + pad * 2;
      d.height = bbox.height + pad * 2;
    }
  });

  const sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(250))
    .force("charge", d3.forceManyBody().strength(-200))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d => Math.max(d.width, d.height) / 2 + 12);

  // 드래그로 노드 고정
  node.call(
    d3.drag()
      .on("start", (event, d) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x; d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        // 고정 유지하고 싶으면 그대로 두고,
        // 놓고 싶으면 아래 두 줄을 켜면 됨:
        // d.fx = null;
        // d.fy = null;
      })
  );

  // 클릭하면 노트 패널 열기
  node.on("click", async (event, d) => {
    if (d.isHub) return;
    const html = await loadNote(d.path);
    setNote(d.title, html);
  });

  // 노트 밖(백드롭) 클릭 시 닫기
  notePane.addEventListener("click", (e) => {
    if (!e.target.closest(".note-content")) {
      hideNote();
    }
  });

  sim.on("tick", () => {
    link
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);

    node.attr("transform", d => `translate(${d.x},${d.y})`);
  });
}

(async function main() {
  const data = await loadGraph();
  renderGraph(data);
})();