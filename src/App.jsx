import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { forceY, forceX, forceCollide } from 'd3-force';
import {
  Search,
  Layers,
  GitBranch,
  CheckCircle2,
  BookOpen,
  Award,
  X,
  RotateCcw,
  Activity,
  ZoomIn,
  ZoomOut,
  Sparkles,
  ArrowRight
} from 'lucide-react';
import rawData from './data/cbme-graph.json';

const SUBJECT_COLORS = {
  AN: '#38bdf8',     // Sky Blue
  PY: '#34d399',     // Emerald
  BI: '#fbbf24',     // Amber
  PA: '#f87171',     // Rose
  PH: '#a78bfa',     // Violet
  MI: '#fb923c',     // Orange
  FM: '#e879f9',     // Fuchsia
  CM: '#a3e635',     // Lime
  IM: '#2dd4bf',     // Teal
  SU: '#60a5fa',     // Blue
  OG: '#f43f5e',     // Crimson
  PE: '#38bdf8',     // Light Blue
  AETCOM: '#f472b6'  // Pink
};

const PHASE_BANDS = {
  'Phase-I': { y: 360, label: 'PHASE I (Pre-Clinical)', color: '#38bdf8' },
  'Phase-II': { y: 120, label: 'PHASE II (Para-Clinical)', color: '#a78bfa' },
  'Phase-III-P1': { y: -120, label: 'PHASE III - PART 1', color: '#fbbf24' },
  'Phase-III-P2': { y: -360, label: 'PHASE III - PART 2 (Clinical)', color: '#2dd4bf' }
};

const SYSTEM_KEYWORDS = [
  { id: 'CVS', label: 'Cardiovascular System', regex: /heart|cardiac|coronary|aorta|myocardi|ecg|stemi|angina|blood pressure|vascular|artery|vein/i },
  { id: 'RS', label: 'Respiratory System', regex: /lung|pulmonary|thorax|pleura|bronch|respirat|trachea|mediastin|diaphragm|hypoxia/i },
  { id: 'CNS', label: 'Neurosciences & Special Senses', regex: /brain|nerve|neural|spinal|cerebr|cranial|cortex|mening|eye|ear|retina|cochlea|stroke/i },
  { id: 'GIT', label: 'GI & Hepatobiliary', regex: /stomach|liver|hepat|intestin|colon|pancrea|biliary|abdomen|peritone|esophag|digest|jaundice/i },
  { id: 'MSK', label: 'Musculoskeletal & Limbs', regex: /bone|muscle|joint|limb|brachial|femur|humerus|pelvis|fracture|scapula|osteolog/i },
  { id: 'RENAL', label: 'Renal & Fluid Balance', regex: /kidney|renal|nephron|ureter|bladder|urine|glomerul|acid-base|electrolyte/i },
  { id: 'ENDO', label: 'Endocrine & Reproduction', regex: /thyroid|pituitary|adrenal|insulin|diabetes|ovary|testis|uterus|hormone|pregnan/i },
  { id: 'HEME', label: 'Hematology & Immunology', regex: /blood|anemia|leukemia|platelet|coagul|immun|lymph|spleen|hemoglobin|troponin/i },
  { id: 'GEN', label: 'General Principles & Cell Biology', regex: /cell|enzyme|dna|rna|genetics|histology|embryology|tissue|mitochondr|metabolism/i },
  { id: 'AETCOM', label: 'AETCOM & Ethics', regex: /ethic|communicat|empathy|consent|professional|aetcom|attitude|spikes/i }
];

function inferSystem(node) {
  if (node.system) return node.system;
  if (node.subject === 'AETCOM') return 'AETCOM';
  const text = `${node.code} ${node.title}`;
  for (const sys of SYSTEM_KEYWORDS) {
    if (sys.regex.test(text)) return sys.id;
  }
  return 'OTHER';
}

function getEndpointId(endpoint) {
  return typeof endpoint === 'object' && endpoint !== null ? endpoint.id : endpoint;
}

export default function App() {
  const fgRef = useRef();
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedLink, setSelectedLink] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('ALL');
  const [subjectFilter, setSubjectFilter] = useState('ALL');
  const [systemFilter, setSystemFilter] = useState('ALL');
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight
  });

  useEffect(() => {
    const handleResize = () =>
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const enrichedNodes = useMemo(() => {
    return rawData.nodes.map((n) => ({
      ...n,
      system: inferSystem(n)
    }));
  }, []);

  const graphData = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filteredNodes = enrichedNodes.filter((n) => {
      const matchesPhase = phaseFilter === 'ALL' || n.phase === phaseFilter;
      const matchesSubject = subjectFilter === 'ALL' || n.subject === subjectFilter;
      const matchesSystem = systemFilter === 'ALL' || n.system === systemFilter;
      const matchesSearch =
        !q ||
        n.code.toLowerCase().includes(q) ||
        n.title.toLowerCase().includes(q) ||
        n.subjectName.toLowerCase().includes(q);
      return matchesPhase && matchesSubject && matchesSystem && matchesSearch;
    });

    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredLinks = rawData.links
      .filter((l) => {
        const src = getEndpointId(l.source);
        const tgt = getEndpointId(l.target);
        return nodeIds.has(src) && nodeIds.has(tgt);
      })
      .map((l) => ({ ...l }));

    return {
      nodes: filteredNodes.map((n) => ({ ...n })),
      links: filteredLinks
    };
  }, [enrichedNodes, searchQuery, phaseFilter, subjectFilter, systemFilter]);

 useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    // Disable default center-Y gravity so Phase bands stay locked in their strata
    fg.d3Force('center', null);
    fg.d3Force(
      'y',
      forceY((node) => PHASE_BANDS[node.phase]?.y ?? 0).strength(0.85)
    );
    fg.d3Force('x', forceX(0).strength(0.05));
    fg.d3Force('collide', forceCollide(12));
    const chargeStrength = graphData.nodes.length > 500 ? -45 : -95;
    fg.d3Force('charge').strength(chargeStrength);

    fg.d3ReheatSimulation();
  }, [graphData]);

  const activeFocusNode = selectedNode || hoveredNode;

  // Trace full upstream prerequisites, downstream unlocks, and direct edges for selectedNode
  const lineage = useMemo(() => {
    if (!activeFocusNode) {
      return {
        ancestors: new Set(),
        descendants: new Set(),
        activeLinks: new Set(),
        directIncoming: [],
        directOutgoing: []
      };
    }

    const ancestors = new Set();
    const descendants = new Set();
    const activeLinks = new Set();
    const directIncoming = [];
    const directOutgoing = [];

    rawData.links.forEach((l) => {
      const src = getEndpointId(l.source);
      const tgt = getEndpointId(l.target);
      if (tgt === activeFocusNode.id) {
        const srcNode = enrichedNodes.find((n) => n.id === src);
        if (srcNode) directIncoming.push({ node: srcNode, link: l });
      }
      if (src === activeFocusNode.id) {
        const tgtNode = enrichedNodes.find((n) => n.id === tgt);
        if (tgtNode) directOutgoing.push({ node: tgtNode, link: l });
      }
    });

    const walkUp = (id) => {
      rawData.links.forEach((l) => {
        const src = getEndpointId(l.source);
        const tgt = getEndpointId(l.target);
        if (tgt === id) {
          activeLinks.add(`${src}->${tgt}`);
          if (!ancestors.has(src)) {
            ancestors.add(src);
            walkUp(src);
          }
        }
      });
    };

    const walkDown = (id) => {
      rawData.links.forEach((l) => {
        const src = getEndpointId(l.source);
        const tgt = getEndpointId(l.target);
        if (src === id) {
          activeLinks.add(`${src}->${tgt}`);
          if (!descendants.has(tgt)) {
            descendants.add(tgt);
            walkDown(tgt);
          }
        }
      });
    };

    walkUp(activeFocusNode.id);
    walkDown(activeFocusNode.id);
    return { ancestors, descendants, activeLinks, directIncoming, directOutgoing };
  }, [activeFocusNode, enrichedNodes]);

  const focusNodeOnCanvas = useCallback((node) => {
    if (!node || !fgRef.current) return;
    // Find the live positioned node inside graphData if available
    const liveNode = graphData.nodes.find((n) => n.id === node.id) || node;
    if (typeof liveNode.x === 'number' && typeof liveNode.y === 'number') {
      fgRef.current.centerAt(liveNode.x, liveNode.y, 600);
      fgRef.current.zoom(2.4, 600);
    }
  }, [graphData.nodes]);

  const handleNodeClick = useCallback(
    (node) => {
      setSelectedNode(node);
      setSelectedLink(null);
      focusNodeOnCanvas(node);
    },
    [focusNodeOnCanvas]
  );

  // Clicking a prerequisite or unlocked item highlights that specific edge & shows its rationale
  const handleInspectEdge = (sourceNode, targetNode, linkObj) => {
    setSelectedLink({
      source: sourceNode,
      target: targetNode,
      ...linkObj
    });
  };

  // Clicking an edge directly on the canvas opens its rationale in the drawer
  const handleCanvasLinkClick = useCallback(
    (link) => {
      const srcId = getEndpointId(link.source);
      const tgtId = getEndpointId(link.target);
      const srcNode = enrichedNodes.find((n) => n.id === srcId);
      const tgtNode = enrichedNodes.find((n) => n.id === tgtId);
      if (srcNode && tgtNode) {
        setSelectedNode(tgtNode);
        setSelectedLink({
          source: srcNode,
          target: tgtNode,
          ...link
        });
      }
    },
    [enrichedNodes]
  );

  const resetView = () => {
    setSelectedNode(null);
    setSelectedLink(null);
    setHoveredNode(null);
    setSearchQuery('');
    setPhaseFilter('ALL');
    setSubjectFilter('ALL');
    setSystemFilter('ALL');
    if (fgRef.current) {
      fgRef.current.zoomToFit(500, 90);
    }
  };

  const drawPhaseStrata = useCallback((ctx, globalScale) => {
    const bandWidth = 4000;
    const bandHeight = 210;

    Object.values(PHASE_BANDS).forEach((band) => {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
      ctx.fillRect(-bandWidth / 2, band.y - bandHeight / 2, bandWidth, bandHeight);

      ctx.beginPath();
      ctx.setLineDash([8, 8]);
      ctx.moveTo(-bandWidth / 2, band.y - bandHeight / 2);
      ctx.lineTo(bandWidth / 2, band.y - bandHeight / 2);
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.45)';
      ctx.lineWidth = 1 / globalScale;
      ctx.stroke();
      ctx.setLineDash([]);

      const fontSize = Math.max(13 / globalScale, 9);
      ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(band.label, -620, band.y - bandHeight / 2 + 18);
    });
  }, []);

  const subjects = useMemo(
    () => [...new Set(enrichedNodes.map((n) => n.subject))].sort(),
    [enrichedNodes]
  );

  const activeLinkKey = selectedLink
    ? `${selectedLink.source.id}->${selectedLink.target.id}`
    : null;

  return (
    <div className="relative w-screen h-screen bg-slate-950 font-sans select-none overflow-hidden">
      {/* Top Floating Control Bar */}
      <header className="absolute top-4 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-3 bg-slate-900/90 backdrop-blur-md border border-slate-800 px-4 py-3 rounded-xl shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-teal-500/10 border border-teal-500/30 rounded-lg">
            <GitBranch className="w-5 h-5 text-teal-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm md:text-base font-bold text-white tracking-tight">
                MBBS CBME Competency Explorer
              </h1>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-300 border border-teal-500/30">
                {graphData.nodes.length} nodes · {graphData.links.length} links
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Stratified Phase Progression & Organ-System Integration Graph
            </p>
          </div>
        </div>

        {/* Search & Multi-Axis Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search code (AN22.2) or keyword..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-xs text-slate-100 rounded-lg pl-9 pr-3 py-2 w-52 focus:outline-none focus:border-teal-500"
            />
          </div>

          <div className="relative flex items-center">
            <Activity className="w-3.5 h-3.5 text-teal-400 absolute left-2.5 pointer-events-none" />
            <select
              value={systemFilter}
              onChange={(e) => setSystemFilter(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:border-teal-500"
            >
              <option value="ALL">All Organ Systems</option>
              {SYSTEM_KEYWORDS.map((sys) => (
                <option key={sys.id} value={sys.id}>
                  {sys.label}
                </option>
              ))}
              <option value="OTHER">Other / Unclassified</option>
            </select>
          </div>

          <select
            value={phaseFilter}
            onChange={(e) => setPhaseFilter(e.target.value)}
            className="bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-teal-500"
          >
            <option value="ALL">All Phases (I – III)</option>
            <option value="Phase-I">Phase I (Pre-Clinical)</option>
            <option value="Phase-II">Phase II (Para-Clinical)</option>
            <option value="Phase-III-P1">Phase III - Part 1</option>
            <option value="Phase-III-P2">Phase III - Part 2</option>
          </select>

          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-teal-500"
          >
            <option value="ALL">All Subjects</option>
            {subjects.map((sub) => (
              <option key={sub} value={sub}>
                {sub}
              </option>
            ))}
          </select>

          <button
            onClick={resetView}
            title="Reset Filters & Zoom"
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* High-Performance Canvas Graph */}
      <ForceGraph2D
        ref={fgRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={graphData}
        backgroundColor="#020617"
        cooldownTicks={120}
        warmupTicks={40}
        nodeRelSize={6}
        linkHoverPrecision={6}
        onRenderFramePre={drawPhaseStrata}
        onNodeClick={handleNodeClick}
        onLinkClick={handleCanvasLinkClick}
        onNodeHover={(node) => setHoveredNode(node || null)}
        onBackgroundClick={() => {
          setSelectedNode(null);
          setSelectedLink(null);
        }}
        linkDirectionalArrowLength={(link) => {
          const key = `${getEndpointId(link.source)}->${getEndpointId(link.target)}`;
          if (key === activeLinkKey) return 8;
          return activeFocusNode && lineage.activeLinks.has(key) ? 6 : 0;
        }}
        linkDirectionalArrowRelPos={0.9}
        linkCurvature={0.12}
        linkColor={(link) => {
          const key = `${getEndpointId(link.source)}->${getEndpointId(link.target)}`;
          if (key === activeLinkKey) return '#fbbf24'; // Bright Amber highlight for inspected edge

          if (activeFocusNode) {
            if (!lineage.activeLinks.has(key)) return 'rgba(148, 163, 184, 0.04)';
            return link.type === 'horizontal-integration' ? '#38bdf8' : '#2dd4bf';
          }
          const baseAlpha = graphData.nodes.length > 400 ? 0.14 : 0.35;
          return link.type === 'horizontal-integration'
            ? `rgba(56, 189, 248, ${baseAlpha})`
            : `rgba(148, 163, 184, ${baseAlpha})`;
        }}
        linkWidth={(link) => {
          const key = `${getEndpointId(link.source)}->${getEndpointId(link.target)}`;
          if (key === activeLinkKey) return 3.6;
          return activeFocusNode && lineage.activeLinks.has(key) ? 2.4 : 0.9;
        }}
        linkLineDash={(link) => (link.strength === 'soft' ? [4, 4] : null)}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const isSelected = selectedNode?.id === node.id;
          const isHovered = hoveredNode?.id === node.id;
          const isEdgeEndpoint =
            selectedLink &&
            (selectedLink.source.id === node.id || selectedLink.target.id === node.id);
          const isRelated =
            activeFocusNode &&
            (lineage.ancestors.has(node.id) || lineage.descendants.has(node.id));
          const dimmed =
            activeFocusNode && !isSelected && !isHovered && !isRelated && !isEdgeEndpoint;

          const baseColor = SUBJECT_COLORS[node.subject] || '#94a3b8';
          const radius =
            isSelected || isHovered || isEdgeEndpoint ? 8.5 : node.isCore ? 5.5 : 4.2;

          if (isSelected || isHovered || isRelated || isEdgeEndpoint) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius + 4, 0, 2 * Math.PI, false);
            ctx.fillStyle = isEdgeEndpoint
              ? 'rgba(251, 191, 36, 0.32)'
              : isSelected || isHovered
              ? 'rgba(45, 212, 191, 0.32)'
              : 'rgba(255, 255, 255, 0.14)';
            ctx.fill();
          }

          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
          ctx.fillStyle = dimmed ? 'rgba(71, 85, 105, 0.22)' : baseColor;
          ctx.fill();

          const shouldShowLabel =
            isSelected ||
            isHovered ||
            isRelated ||
            isEdgeEndpoint ||
            (globalScale > 1.5 && !dimmed) ||
            (graphData.nodes.length <= 40 && !dimmed);

          if (shouldShowLabel) {
            const fontSize = Math.max(11 / globalScale, 3.8);
            ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle =
              isSelected || isHovered || isEdgeEndpoint ? '#ffffff' : '#e2e8f0';
            ctx.fillText(node.code, node.x, node.y + radius + 2.5);
          }
        }}
      />

      {/* Zoom Controls */}
      {!selectedNode && (
        <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-1.5 bg-slate-900/90 backdrop-blur-md border border-slate-800 p-1.5 rounded-xl">
          <button
            onClick={() => fgRef.current?.zoom(fgRef.current.zoom() * 1.4, 300)}
            className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg"
            title="Zoom In (Reveals Competency Codes)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => fgRef.current?.zoom(fgRef.current.zoom() / 1.4, 300)}
            className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Bottom Subject & Edge Legend */}
      <div className="absolute bottom-4 left-4 z-20 bg-slate-900/90 backdrop-blur-md border border-slate-800 px-4 py-2.5 rounded-xl flex flex-wrap items-center gap-3 text-xs max-w-[calc(100vw-6rem)]">
        <span className="text-slate-400 font-medium flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-teal-400" /> Subjects:
        </span>
        {Object.entries(SUBJECT_COLORS).map(([code, color]) => (
          <button
            key={code}
            onClick={() => setSubjectFilter(subjectFilter === code ? 'ALL' : code)}
            className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded transition ${
              subjectFilter === code ? 'bg-slate-800 ring-1 ring-teal-400' : 'hover:bg-slate-800/60'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-slate-300 font-medium">{code}</span>
          </button>
        ))}
        <span className="text-slate-700">|</span>
        <span className="text-slate-400">Click any node or edge to inspect rationale</span>
      </div>

      {/* Right Side CBME Competency & Rationale Inspector Drawer */}
      {selectedNode && (
        <aside className="absolute top-24 right-4 bottom-4 w-[26rem] max-w-[calc(100vw-2rem)] z-30 bg-slate-900/95 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl p-5 overflow-y-auto">
          {/* Active Link Clinical Rationale Spotlight Card */}
          {selectedLink && (
            <div className="mb-4 p-3.5 rounded-xl bg-amber-500/10 border border-amber-400/40 shadow-lg">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Verified Integration Rationale
                </span>
                <button
                  onClick={() => setSelectedLink(null)}
                  className="text-amber-300/70 hover:text-amber-200"
                  title="Close Link Rationale"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-1.5 text-xs font-semibold text-white mb-2">
                <span className="px-1.5 py-0.5 rounded bg-slate-950 text-teal-300 border border-slate-700">
                  {selectedLink.source.code}
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="px-1.5 py-0.5 rounded bg-slate-950 text-sky-300 border border-slate-700">
                  {selectedLink.target.code}
                </span>
                <span className="ml-auto text-[10px] uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200">
                  {selectedLink.type?.replace('-', ' ') || 'Prerequisite'}
                </span>
              </div>

              <p className="text-xs text-slate-100 leading-relaxed bg-slate-950/70 p-2.5 rounded-lg border border-amber-500/20">
                {selectedLink.rationale ||
                  'No detailed rationale text recorded for this link yet.'}
              </p>

              <div className="mt-2.5 flex items-center justify-between text-[11px]">
                <span className="text-slate-400">
                  Strength:{' '}
                  <strong className="text-slate-200 uppercase">
                    {selectedLink.strength || 'hard'}
                  </strong>
                </span>
                <button
                  onClick={() => {
                    const nextNode =
                      selectedLink.source.id === selectedNode.id
                        ? selectedLink.target
                        : selectedLink.source;
                    handleNodeClick(nextNode);
                  }}
                  className="text-amber-300 hover:text-amber-200 font-semibold flex items-center gap-1"
                >
                  Jump to{' '}
                  {selectedLink.source.id === selectedNode.id
                    ? selectedLink.target.code
                    : selectedLink.source.code}{' '}
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          {/* Selected Competency Header */}
          <div className="flex items-start justify-between gap-2 pb-4 border-b border-slate-800">
            <div>
              <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                <span
                  className="px-2 py-0.5 text-xs font-bold rounded text-slate-950"
                  style={{
                    backgroundColor: SUBJECT_COLORS[selectedNode.subject] || '#94a3b8'
                  }}
                >
                  {selectedNode.code}
                </span>
                <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  {selectedNode.phase}
                </span>
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded border ${
                    selectedNode.isCore
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  {selectedNode.isCore ? 'Core (Y)' : 'Non-Core (N)'}
                </span>
              </div>
              <h2 className="text-sm font-semibold text-white leading-snug">
                {selectedNode.title}
              </h2>
            </div>
            <button
              onClick={() => {
                setSelectedNode(null);
                setSelectedLink(null);
              }}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* CBME Pedagogical Metadata */}
          <div className="grid grid-cols-2 gap-2.5 my-4 text-xs">
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
              <span className="text-slate-400 block mb-1">Domain (K/S/A/C)</span>
              <span className="font-bold text-slate-100">{selectedNode.domain.join(', ')}</span>
            </div>
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
              <span className="text-slate-400 block mb-1">Miller's Pyramid</span>
              <span className="font-bold text-teal-400">{selectedNode.miller}</span>
            </div>
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 col-span-2">
              <span className="text-slate-400 block mb-1">Teaching-Learning Methods</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {selectedNode.tlm.map((m) => (
                  <span
                    key={m}
                    className="px-2 py-0.5 bg-slate-800 text-slate-200 rounded text-[11px]"
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 col-span-2">
              <span className="text-slate-400 block mb-1">Assessment Methods</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {selectedNode.assessment.map((a) => (
                  <span
                    key={a}
                    className="px-2 py-0.5 bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 rounded text-[11px]"
                  >
                    {a}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Certifiable Logbook Quota */}
          {selectedNode.certifiable && (
            <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-2.5 text-xs text-amber-300">
              <Award className="w-4 h-4 shrink-0" />
              <span>
                Certifiable Skill: Requires minimum <strong>{selectedNode.minQuota}</strong>{' '}
                documented logbook entries.
              </span>
            </div>
          )}

          {/* Direct Upstream Prerequisites (with click-to-inspect rationale) */}
          <div className="mb-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-teal-400" />
              Direct Prerequisites ({lineage.directIncoming.length})
            </h3>
            {lineage.directIncoming.length === 0 ? (
              <p className="text-xs text-slate-500 italic">
                Entry-level foundational competency.
              </p>
            ) : (
              <ul className="space-y-2">
                {lineage.directIncoming.map(({ node: item, link }) => {
                  const isInspected =
                    selectedLink?.source.id === item.id &&
                    selectedLink?.target.id === selectedNode.id;
                  return (
                    <li
                      key={item.id}
                      onClick={() => handleInspectEdge(item, selectedNode, link)}
                      className={`p-2.5 rounded-xl border cursor-pointer transition text-xs ${
                        isInspected
                          ? 'bg-amber-500/15 border-amber-400/60'
                          : 'bg-slate-950 hover:bg-slate-800/90 border-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-teal-400">{item.code}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                          {link.type?.replace('-', ' ') || 'prerequisite'}
                        </span>
                      </div>
                      <p className="text-slate-200 font-medium mb-1.5">{item.title}</p>
                      {link.rationale && (
                        <p className="text-[11px] text-slate-400 italic border-l-2 border-teal-500/40 pl-2">
                          “{link.rationale}”
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Direct Downstream Clinical Unlocks (with click-to-inspect rationale) */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" />
              Unlocks Competencies ({lineage.directOutgoing.length})
            </h3>
            {lineage.directOutgoing.length === 0 ? (
              <p className="text-xs text-slate-500 italic">Terminal clinical competency node.</p>
            ) : (
              <ul className="space-y-2">
                {lineage.directOutgoing.map(({ node: item, link }) => {
                  const isInspected =
                    selectedLink?.source.id === selectedNode.id &&
                    selectedLink?.target.id === item.id;
                  return (
                    <li
                      key={item.id}
                      onClick={() => handleInspectEdge(selectedNode, item, link)}
                      className={`p-2.5 rounded-xl border cursor-pointer transition text-xs ${
                        isInspected
                          ? 'bg-amber-500/15 border-amber-400/60'
                          : 'bg-slate-950 hover:bg-slate-800/90 border-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-sky-400">{item.code}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                          {link.type?.replace('-', ' ') || 'unlocks'}
                        </span>
                      </div>
                      <p className="text-slate-200 font-medium mb-1.5">{item.title}</p>
                      {link.rationale && (
                        <p className="text-[11px] text-slate-400 italic border-l-2 border-sky-500/40 pl-2">
                          “{link.rationale}”
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}