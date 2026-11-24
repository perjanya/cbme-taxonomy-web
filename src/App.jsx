import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { forceY, forceRadial, forceCollide } from 'd3-force-3d';
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
  Sparkles,
  ArrowRight,
  Play,
  Pause
} from 'lucide-react';
import rawData from './data/cbme-graph.json';

const SUBJECT_COLORS = {
  AN: '#38bdf8',     // Sky Blue
  PY: '#34d399',     // Emerald
  BI: '#fbbf24',     // Amber
  PA: '#f87171',     // Coral Red
  PH: '#a78bfa',     // Violet
  MI: '#fb923c',     // Orange
  FM: '#e879f9',     // Fuchsia
  CM: '#a3e635',     // Lime
  IM: '#2dd4bf',     // Teal
  SU: '#3b82f6',     // Royal Blue
  OG: '#f43f5e',     // Crimson
  PE: '#22d3ee',     // Bright Cyan
  AETCOM: '#f472b6'  // Rose Pink
};

const FUNNEL_STRATA = {
  'Phase-I': { y: -300, radius: 400, label: 'PHASE I · Pre-Clinical', color: '#38bdf8' },
  'Phase-II': { y: -100, radius: 290, label: 'PHASE II · Para-Clinical', color: '#a78bfa' },
  'Phase-III-P1': { y: 100, radius: 195, label: 'PHASE III · Part 1', color: '#fbbf24' },
  'Phase-III-P2': { y: 300, radius: 115, label: 'PHASE III · Part 2 (Clinical)', color: '#2dd4bf' }
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

function makeTextSprite(text, color) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 512;
  canvas.height = 96;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
  ctx.beginPath();
  ctx.roundRect(16, 16, 480, 64, 32);
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.font = 'bold 26px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#f8fafc';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 49);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(220, 42, 1);
  return sprite;
}

export default function App() {
  const fgRef = useRef();
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedLink, setSelectedLink] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [isRotating, setIsRotating] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('ALL');
  const [subjectFilter, setSubjectFilter] = useState('ALL');
  const [systemFilter, setSystemFilter] = useState('ALL');
  const [integrationMode, setIntegrationMode] = useState('ALL'); // 'ALL' | 'VERTICAL' | 'HORIZONTAL'
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
    const degreeMap = {};
    rawData.links.forEach((l) => {
      const s = getEndpointId(l.source);
      const t = getEndpointId(l.target);
      degreeMap[s] = (degreeMap[s] || 0) + 1;
      degreeMap[t] = (degreeMap[t] || 0) + 1;
    });

    return rawData.nodes.map((n) => ({
      ...n,
      system: inferSystem(n),
      degree: degreeMap[n.id] || 0
    }));
  }, []);

  const graphData = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    // 1. Base filter (System + Search)
    const baseNodes = enrichedNodes.filter((n) => {
      const matchesSystem = systemFilter === 'ALL' || n.system === systemFilter;
      const matchesSearch =
        !q ||
        n.code.toLowerCase().includes(q) ||
        n.title.toLowerCase().includes(q) ||
        n.subjectName.toLowerCase().includes(q);
      return matchesSystem && matchesSearch;
    });
    const baseNodeMap = new Map(baseNodes.map((n) => [n.id, n]));

    // 2. Filter links by integration mode (Vertical vs Horizontal vs All)
    const eligibleLinks = rawData.links.filter((l) => {
      const src = getEndpointId(l.source);
      const tgt = getEndpointId(l.target);
      if (!baseNodeMap.has(src) || !baseNodeMap.has(tgt)) return false;

      if (integrationMode === 'VERTICAL') {
        return l.type === 'vertical-integration';
      }
      if (integrationMode === 'HORIZONTAL') {
        return l.type === 'horizontal-integration';
      }
      return true;
    });

    // 3. When a specific Subject is chosen, keep all its nodes PLUS 1-hop integrated partners
    let visibleNodeIds = new Set();
    let finalLinks = [];

    if (subjectFilter === 'ALL') {
      baseNodes.forEach((n) => {
        if (phaseFilter === 'ALL' || n.phase === phaseFilter) {
          visibleNodeIds.add(n.id);
        }
      });
      finalLinks = eligibleLinks
        .filter((l) => {
          const src = getEndpointId(l.source);
          const tgt = getEndpointId(l.target);
          return visibleNodeIds.has(src) && visibleNodeIds.has(tgt);
        })
        .map((l) => ({ ...l }));
    } else {
      const anchorIds = new Set(
        baseNodes
          .filter(
            (n) =>
              n.subject === subjectFilter &&
              (phaseFilter === 'ALL' || n.phase === phaseFilter)
          )
          .map((n) => n.id)
      );

      anchorIds.forEach((id) => visibleNodeIds.add(id));

      // Pull in cross-subject vertical & horizontal neighbors connected to the selected subject
      eligibleLinks.forEach((l) => {
        const src = getEndpointId(l.source);
        const tgt = getEndpointId(l.target);
        if (anchorIds.has(src) || anchorIds.has(tgt)) {
          visibleNodeIds.add(src);
          visibleNodeIds.add(tgt);
          finalLinks.push({ ...l });
        }
      });
    }

    const filteredNodes = baseNodes.filter((n) => visibleNodeIds.has(n.id));

    const seededNodes = filteredNodes.map((n, idx) => {
      const stratum = FUNNEL_STRATA[n.phase] || { y: 0, radius: 250 };
      const angle = idx * 2.39996;
      const r = stratum.radius * (0.65 + 0.35 * ((idx % 10) / 10));
      return {
        ...n,
        x: Math.cos(angle) * r,
        y: stratum.y + ((idx % 5) - 2) * 8,
        z: Math.sin(angle) * r
      };
    });

    return {
      nodes: seededNodes,
      links: finalLinks
    };
  }, [enrichedNodes, searchQuery, phaseFilter, subjectFilter, systemFilter, integrationMode]);

  // Add translucent 3D Funnel Rings & Phase Labels to the Three.js Scene
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    const scene = fg.scene();
    const existingGroup = scene.getObjectByName('cbme-funnel-guides');
    if (existingGroup) scene.remove(existingGroup);

    const guideGroup = new THREE.Group();
    guideGroup.name = 'cbme-funnel-guides';

    const coneGeom = new THREE.CylinderGeometry(115, 415, 620, 48, 1, true);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0x1e293b,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    guideGroup.add(new THREE.Mesh(coneGeom, coneMat));

    Object.values(FUNNEL_STRATA).forEach((stratum) => {
      const ringGeom = new THREE.TorusGeometry(stratum.radius, 1.5, 16, 100);
      const ringMat = new THREE.MeshBasicMaterial({
        color: stratum.color,
        transparent: true,
        opacity: 0.38
      });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = stratum.y;
      guideGroup.add(ring);

      const sprite = makeTextSprite(stratum.label, stratum.color);
      sprite.position.set(stratum.radius + 115, stratum.y, 0);
      guideGroup.add(sprite);
    });

    scene.add(guideGroup);
  }, []);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    fg.d3Force('center', null);
    fg.d3Force(
      'y',
      forceY((node) => FUNNEL_STRATA[node.phase]?.y ?? 0).strength(0.95)
    );
    fg.d3Force(
      'radial',
      forceRadial(
        (node) => FUNNEL_STRATA[node.phase]?.radius ?? 250,
        0,
        0,
        0
      ).strength(0.55)
    );
    fg.d3Force('collide', forceCollide(10));
    fg.d3Force('charge').strength(graphData.nodes.length > 500 ? -22 : -60);

    fg.d3ReheatSimulation();
  }, [graphData]);

  useEffect(() => {
    if (!isRotating) return;

    let angle = 0;
    const distance = 1150;
    const interval = setInterval(() => {
      if (!fgRef.current) return;
      angle += 0.004;
      fgRef.current.cameraPosition({
        x: distance * Math.sin(angle),
        y: 160,
        z: distance * Math.cos(angle)
      });
    }, 25);

    return () => clearInterval(interval);
  }, [isRotating]);

  const activeFocusNode = selectedNode || hoveredNode;

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

  const handleNodeClick = useCallback((node) => {
    setIsRotating(false);
    setSelectedNode(node);
    setSelectedLink(null);

    if (fgRef.current && typeof node.x === 'number') {
      const distRatio = 1 + 260 / Math.hypot(node.x || 1, node.y || 1, node.z || 1);
      fgRef.current.cameraPosition(
        { x: node.x * distRatio, y: node.y + 40, z: node.z * distRatio },
        node,
        900
      );
    }
  }, []);

  const handleInspectEdge = (sourceNode, targetNode, linkObj) => {
    setIsRotating(false);
    setSelectedLink({
      source: sourceNode,
      target: targetNode,
      ...linkObj
    });
  };

  const handleCanvasLinkClick = useCallback(
    (link) => {
      setIsRotating(false);
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
    setIntegrationMode('ALL');
    setIsRotating(true);
  };

  const subjects = useMemo(
    () => [...new Set(enrichedNodes.map((n) => n.subject))].sort(),
    [enrichedNodes]
  );

  // Live count of vertical vs horizontal beams currently rendered
  const linkStats = useMemo(() => {
    let vertical = 0;
    let horizontal = 0;
    graphData.links.forEach((l) => {
      if (l.type === 'vertical-integration') vertical++;
      else if (l.type === 'horizontal-integration') horizontal++;
    });
    return { vertical, horizontal };
  }, [graphData.links]);

  const activeLinkKey = selectedLink
    ? `${selectedLink.source.id}->${selectedLink.target.id}`
    : null;

  return (
    <div
      className="relative w-screen h-screen bg-slate-950 font-sans select-none overflow-hidden"
      onPointerDown={() => {
        if (isRotating) setIsRotating(false);
      }}
    >
      {/* Top Floating Control Bar */}
      <header className="absolute top-4 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-3 bg-slate-900/85 backdrop-blur-md border border-slate-800 px-4 py-3 rounded-xl shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-teal-500/10 border border-teal-500/30 rounded-lg">
            <GitBranch className="w-5 h-5 text-teal-400" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-sm md:text-base font-bold text-white tracking-tight">
                MBBS CBME 3D Competency Funnel
              </h1>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-300 border border-teal-500/30">
                {graphData.nodes.length} nodes · {linkStats.vertical} vertical · {linkStats.horizontal} horizontal
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {subjectFilter === 'ALL'
                ? 'Interactive 3D Conical Curriculum & Vertical Integration Explorer'
                : `Showing ${subjectFilter} competencies + integrated cross-subject partners`}
            </p>
          </div>
        </div>

        {/* Search, Integration Mode, Filters & Auto-Rotate Control */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Integration Type Pill Switcher */}
          <div className="flex items-center bg-slate-950 border border-slate-700 rounded-lg p-0.5 text-[11px]">
            {[
              { id: 'ALL', label: 'All Links' },
              { id: 'VERTICAL', label: 'Vertical', dot: '#2dd4bf' },
              { id: 'HORIZONTAL', label: 'Horizontal', dot: '#38bdf8' }
            ].map((mode) => (
              <button
                key={mode.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setIntegrationMode(mode.id);
                }}
                className={`px-2.5 py-1.5 rounded-md font-medium flex items-center gap-1.5 transition ${
                  integrationMode === mode.id
                    ? 'bg-slate-800 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {mode.dot && (
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: mode.dot }}
                  />
                )}
                {mode.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search code (AN22.2)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-xs text-slate-100 rounded-lg pl-9 pr-3 py-2 w-40 focus:outline-none focus:border-teal-500"
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
            className="bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-teal-500"
          >
            <option value="ALL">All Phases (I – III)</option>
            <option value="Phase-I">Phase I (Base)</option>
            <option value="Phase-II">Phase II (Mid-Lower)</option>
            <option value="Phase-III-P1">Phase III - Part 1</option>
            <option value="Phase-III-P2">Phase III - Part 2 (Apex)</option>
          </select>

          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-teal-500"
          >
            <option value="ALL">All Subjects</option>
            {subjects.map((sub) => (
              <option key={sub} value={sub}>
                {sub} (+ Integrations)
              </option>
            ))}
          </select>

          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsRotating((prev) => !prev);
            }}
            className={`px-2.5 py-2 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition ${
              isRotating
                ? 'bg-teal-500/20 border-teal-500/40 text-teal-300'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
            }`}
            title="Toggle 3D Auto-Rotation"
          >
            {isRotating ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              resetView();
            }}
            title="Reset Filters & Resume Orbit"
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* 3D WebGL Conical Funnel Canvas */}
      <ForceGraph3D
        ref={fgRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={graphData}
        backgroundColor="#020617"
        showNavInfo={false}
        cooldownTicks={90}
        warmupTicks={30}
        nodeResolution={10}
        nodeLabel={(node) =>
          `<div style="background:#0f172a;color:#f8fafc;padding:6px 10px;border-radius:8px;border:1px solid #334155;font-family:sans-serif;font-size:12px;max-width:260px;">
            <strong style="color:${SUBJECT_COLORS[node.subject] || '#38bdf8'}">${node.code}</strong> · ${node.phase}<br/>
            <span>${node.title}</span>
          </div>`
        }
        nodeVal={(node) => {
          const isFocus =
            selectedNode?.id === node.id ||
            hoveredNode?.id === node.id ||
            (selectedLink &&
              (selectedLink.source.id === node.id || selectedLink.target.id === node.id));
          if (isFocus) return 8;
          // Highlight primary subject nodes slightly larger than cross-subject partners
          if (subjectFilter !== 'ALL' && node.subject === subjectFilter) {
            return 2.4 + Math.min(node.degree * 0.45, 5);
          }
          return 1.4 + Math.min(node.degree * 0.35, 4);
        }}
        nodeColor={(node) => {
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

          if (isEdgeEndpoint) return '#fbbf24';
          if (dimmed) return '#1e293b';
          return SUBJECT_COLORS[node.subject] || '#94a3b8';
        }}
        nodeOpacity={0.92}
        onNodeClick={handleNodeClick}
        onLinkClick={handleCanvasLinkClick}
        onNodeHover={(node) => setHoveredNode(node || null)}
        onBackgroundClick={() => {
          setSelectedNode(null);
          setSelectedLink(null);
        }}
        linkColor={(link) => {
          const key = `${getEndpointId(link.source)}->${getEndpointId(link.target)}`;
          if (key === activeLinkKey) return '#fbbf24';

          const isVert = link.type === 'vertical-integration';
          const isHoriz = link.type === 'horizontal-integration';

          if (activeFocusNode) {
            if (!lineage.activeLinks.has(key)) return 'rgba(30, 41, 59, 0.05)';
            return isVert ? '#2dd4bf' : isHoriz ? '#38bdf8' : '#a78bfa';
          }

          // When inspecting a subject, make its vertical & horizontal beams glow brightly
          const opacity = subjectFilter !== 'ALL' ? 0.55 : 0.24;
          if (isVert) return `rgba(45, 212, 191, ${opacity})`;
          if (isHoriz) return `rgba(56, 189, 248, ${opacity})`;
          return `rgba(148, 163, 184, ${opacity * 0.6})`;
        }}
        linkWidth={(link) => {
          const key = `${getEndpointId(link.source)}->${getEndpointId(link.target)}`;
          if (key === activeLinkKey) return 2.8;
          if (activeFocusNode && lineage.activeLinks.has(key)) return 1.8;
          return subjectFilter !== 'ALL' ? 0.9 : 0.4;
        }}
        linkOpacity={0.75}
        linkDirectionalParticles={(link) => {
          const key = `${getEndpointId(link.source)}->${getEndpointId(link.target)}`;
          if (activeFocusNode && lineage.activeLinks.has(key)) return 3;
          // Show subtle upward particle flow on vertical beams when a subject is selected
          if (subjectFilter !== 'ALL' && link.type === 'vertical-integration') return 1;
          return 0;
        }}
        linkDirectionalParticleWidth={2.0}
        linkDirectionalParticleSpeed={0.006}
      />

      {/* Bottom Subject & Link Type Legend */}
      <div className="absolute bottom-4 left-4 z-20 bg-slate-900/85 backdrop-blur-md border border-slate-800 px-4 py-2.5 rounded-xl flex flex-wrap items-center gap-3 text-xs max-w-[calc(100vw-2rem)]">
        <span className="text-slate-400 font-medium flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-teal-400" /> Subjects:
        </span>
        {Object.entries(SUBJECT_COLORS).map(([code, color]) => (
          <button
            key={code}
            onClick={(e) => {
              e.stopPropagation();
              setSubjectFilter(subjectFilter === code ? 'ALL' : code);
            }}
            className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded transition ${
              subjectFilter === code ? 'bg-slate-800 ring-1 ring-teal-400' : 'hover:bg-slate-800/60'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-slate-300 font-medium">{code}</span>
          </button>
        ))}
        <span className="text-slate-700">|</span>
        <span className="flex items-center gap-1.5 text-teal-300">
          <span className="w-3 h-0.5 bg-teal-400 inline-block" /> Vertical
        </span>
        <span className="flex items-center gap-1.5 text-sky-300">
          <span className="w-3 h-0.5 bg-sky-400 inline-block" /> Horizontal
        </span>
      </div>

      {/* Right Side CBME Competency & Rationale Inspector Drawer */}
      {selectedNode && (
        <aside
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-24 right-4 bottom-4 w-[26rem] max-w-[calc(100vw-2rem)] z-30 bg-slate-900/95 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl p-5 overflow-y-auto"
        >
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
                {selectedLink.rationale || 'No detailed rationale text recorded for this link yet.'}
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

          {selectedNode.certifiable && (
            <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-2.5 text-xs text-amber-300">
              <Award className="w-4 h-4 shrink-0" />
              <span>
                Certifiable Skill: Requires minimum <strong>{selectedNode.minQuota}</strong>{' '}
                documented logbook entries.
              </span>
            </div>
          )}

          {/* Direct Upstream Prerequisites */}
          <div className="mb-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-teal-400" />
              Direct Prerequisites ({lineage.directIncoming.length})
            </h3>
            {lineage.directIncoming.length === 0 ? (
              <p className="text-xs text-slate-500 italic">Entry-level foundational competency.</p>
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

          {/* Direct Downstream Clinical Unlocks */}
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