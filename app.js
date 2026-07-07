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

  // 윗첨자: ^텍스트^ → <sup>텍스트</sup> (예: 페이지 표기 92^p^, 각주 표시 지성^[1]^)
  md = md.replace(/\^([^\^\n]+)\^/g, (_, text) => `<sup>${text}</sup>`);

  // 본문/인용 사이에 끼워 넣는 태그들: ::이름:: ... ::/이름:: → <div class="이름">
  // (STYLES.md 참고 — 새 스타일을 추가하려면 이 목록에 태그 이름만 더하면 됨)
  for (const tag of ["source", "rheeghang"]) {
    const re = new RegExp(`(?:^|\\n)::${tag}::\\n([\\s\\S]*?)\\n::/${tag}::`, "g");
    md = md.replace(re, (_, inner) => `\n<div class="${tag}">` + marked.parse(inner.trim()) + "</div>");
  }

  // 본문 중간: ::footnotes:: ... ::/footnotes:: → .footnotes 스타일 (#noteContent .footnotes)
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
  const nodes = data.nodes.map(d => ({ ...d }));

  const hub = { id: "__hub__", title: "", path: null, isHub: true, width: 20, height: 20 };
  nodes.unshift(hub);

  const nodesById = new Map(nodes.map(n => [n.id, n]));
  attachNoteLinkHandler(nodesById);

  svg.selectAll("*").remove();
  const g = svg.append("g");

  svg.call(
    d3.zoom()
      .scaleExtent([0.2, 3])
      .on("zoom", (event) => g.attr("transform", event.transform))
  );

  const linkG = g.append("g")
    .attr("stroke", "rgb(157, 0, 255)")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "5, 5");

  const node = g.append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .style("cursor", "pointer");

  // 노드: 허브는 원, 나머지는 제목 텍스트를 테두리 있는 박스 안에
  const pad = 8;
  const fontSize = 14;

  node.each(function (d) {
    const gEl = d3.select(this);

    if (d.isHub) {
      gEl.append("circle")
        .attr("r", 10)
        .attr("fill", "rgb(76, 0, 131)");
    } else {
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
    }
  });

  // 노드 크기를 먼저 잰 다음 거리를 정해야, 글자가 긴 노트가 좁은 거리에 눌려
  // 충돌(collide) 힘과 링크 힘이 서로 못 이기고 계속 떠는 문제가 생기지 않음.
  // collide 반경(자기 자신 + 허브)보다 항상 더 크게, 그 위에 무작위 여유를 얹어 거리를 다양화.
  const EXTRA_MIN = 20;
  const EXTRA_MAX = 90;
  const collideRadius = (d) => Math.max(d.width, d.height) / 2 + 12;
  const links = nodes
    .filter(n => n.id !== hub.id)
    .map(n => {
      const clearance = collideRadius(n) + collideRadius(hub);
      const distance = clearance + EXTRA_MIN + Math.random() * (EXTRA_MAX - EXTRA_MIN);
      return { source: hub.id, target: n.id, distance };
    });

  const link = linkG
    .selectAll("line")
    .data(links)
    .join("line");

  const sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(d => d.distance).strength(0.5))
    .force("charge", d3.forceManyBody().strength(-120))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide(collideRadius).iterations(2))
    .velocityDecay(0.55)
    .alphaDecay(0.04);

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
      })
  );

  // 클릭하면 노트 패널 열기
  node.on("click", async (event, d) => {
    if (d.isHub) return;
    const html = await loadNote(d.path);
    setNote(d.title, html);
  });

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