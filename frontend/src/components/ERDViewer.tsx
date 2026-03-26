/**
 * ERDViewer — renders an Entity Relationship Diagram for a spec.
 * Shows entities as cards with SVG connection lines for foreign key relationships.
 */
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { X, ChevronRight } from "lucide-react";

interface ERDViewerProps {
  spec: any;
}

interface EntityCard {
  name: string;
  tableName: string;
  fields: any[];
  x: number;
  y: number;
  width: number;
  height: number;
  isMain: boolean;
}

interface Relationship {
  from: string;
  to: string;
  label: string;
  fromField: string;
}

const CARD_WIDTH = 200;
const CARD_HEIGHT = 80;
const CARD_GAP_X = 80;
const CARD_GAP_Y = 60;

export function ERDViewer({ spec }: ERDViewerProps) {
  const [hoveredEntity, setHoveredEntity] = useState<string | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Extract entities from spec
  const entities: EntityCard[] = useMemo(() => {
    if (!spec?.modules) return [];
    const allEntities: EntityCard[] = [];
    const cols = Math.max(3, Math.ceil(Math.sqrt(spec.modules.reduce(
      (sum: number, m: any) => sum + (m.entities?.length || 0), 0
    ))));

    let idx = 0;
    for (const mod of spec.modules) {
      for (const entity of mod.entities || []) {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        allEntities.push({
          name: entity.name,
          tableName: entity.table_name || entity.name.toLowerCase() + "s",
          fields: entity.fields || [],
          x: 40 + col * (CARD_WIDTH + CARD_GAP_X),
          y: 40 + row * (CARD_HEIGHT + CARD_GAP_Y),
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          isMain: entity.fields?.length > 4,
        });
        idx++;
      }
    }
    return allEntities;
  }, [spec]);

  // Extract relationships from foreign key fields
  const relationships: Relationship[] = useMemo(() => {
    const rels: Relationship[] = [];
    const entityNames = new Set(entities.map((e) => e.name.toLowerCase()));

    for (const entity of entities) {
      for (const field of entity.fields) {
        // Check for fk_entity reference
        if (field.fk_entity) {
          const targetName = entities.find(
            (e) => e.name.toLowerCase() === field.fk_entity.toLowerCase()
          )?.name;
          if (targetName) {
            rels.push({
              from: entity.name,
              to: targetName,
              label: field.fk_relationship || "belongs to",
              fromField: field.name,
            });
          }
        }
        // Check for _id suffix fields
        else if (field.name.endsWith("_id") && field.name !== "id" && field.name !== "org_id") {
          const refName = field.name.replace(/_id$/, "");
          const target = entities.find(
            (e) => e.name.toLowerCase() === refName || e.tableName === refName + "s"
          );
          if (target) {
            rels.push({
              from: entity.name,
              to: target.name,
              label: "belongs to",
              fromField: field.name,
            });
          }
        }
      }
    }
    return rels;
  }, [entities]);

  // Calculate total canvas size
  const canvasWidth = useMemo(() => {
    if (entities.length === 0) return 600;
    return Math.max(...entities.map((e) => e.x + e.width)) + 80;
  }, [entities]);

  const canvasHeight = useMemo(() => {
    if (entities.length === 0) return 400;
    return Math.max(...entities.map((e) => e.y + e.height)) + 80;
  }, [entities]);

  // Get connected entities for highlighting
  const connectedEntities = useMemo(() => {
    if (!hoveredEntity) return new Set<string>();
    const connected = new Set<string>();
    for (const rel of relationships) {
      if (rel.from === hoveredEntity) connected.add(rel.to);
      if (rel.to === hoveredEntity) connected.add(rel.from);
    }
    return connected;
  }, [hoveredEntity, relationships]);

  const selectedEntityData = useMemo(() => {
    if (!selectedEntity) return null;
    return entities.find((e) => e.name === selectedEntity) || null;
  }, [selectedEntity, entities]);

  // Connection line path between two entity cards
  const getConnectionPath = useCallback(
    (from: EntityCard, to: EntityCard) => {
      const fromCx = from.x + from.width / 2;
      const fromCy = from.y + from.height / 2;
      const toCx = to.x + to.width / 2;
      const toCy = to.y + to.height / 2;

      // Determine exit/entry points based on relative positions
      let x1: number, y1: number, x2: number, y2: number;

      if (Math.abs(fromCx - toCx) > Math.abs(fromCy - toCy)) {
        // Horizontal connection
        if (fromCx < toCx) {
          x1 = from.x + from.width;
          y1 = fromCy;
          x2 = to.x;
          y2 = toCy;
        } else {
          x1 = from.x;
          y1 = fromCy;
          x2 = to.x + to.width;
          y2 = toCy;
        }
      } else {
        // Vertical connection
        if (fromCy < toCy) {
          x1 = fromCx;
          y1 = from.y + from.height;
          x2 = toCx;
          y2 = to.y;
        } else {
          x1 = fromCx;
          y1 = from.y;
          x2 = toCx;
          y2 = to.y + to.height;
        }
      }

      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;

      return { x1, y1, x2, y2, midX, midY, path: `M ${x1} ${y1} Q ${midX} ${y1}, ${midX} ${midY} Q ${midX} ${y2}, ${x2} ${y2}` };
    },
    []
  );

  const typeColor = (type: string) => {
    const t = (type || "").toLowerCase();
    if (t.includes("varchar") || t.includes("text") || t.includes("string")) return "#10b981";
    if (t.includes("int") || t.includes("number") || t.includes("decimal") || t.includes("float")) return "#3b82f6";
    if (t.includes("bool")) return "#f59e0b";
    if (t.includes("date") || t.includes("time")) return "#8b5cf6";
    if (t.includes("enum") || t.includes("select")) return "#ec4899";
    return "#6b7280";
  };

  if (!spec?.modules) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">No spec data to visualize</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-white" ref={containerRef}>
      {/* Main canvas area */}
      <div className="flex-1 overflow-auto">
        <svg
          width={canvasWidth}
          height={canvasHeight}
          className="min-h-full min-w-full"
          style={{ background: "white" }}
        >
          {/* Grid dots background */}
          <defs>
            <pattern id="erd-dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.5" fill="#e5e7eb" />
            </pattern>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#9ca3af" />
            </marker>
            <marker id="arrowhead-pink" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#ec4899" />
            </marker>
          </defs>
          <rect width="100%" height="100%" fill="url(#erd-dots)" />

          {/* Connection lines */}
          {relationships.map((rel, i) => {
            const fromEntity = entities.find((e) => e.name === rel.from);
            const toEntity = entities.find((e) => e.name === rel.to);
            if (!fromEntity || !toEntity) return null;

            const isHighlighted =
              hoveredEntity === rel.from || hoveredEntity === rel.to;
            const isDimmed =
              hoveredEntity !== null && !isHighlighted;
            const conn = getConnectionPath(fromEntity, toEntity);

            return (
              <g key={`rel-${i}`} style={{ opacity: isDimmed ? 0.15 : 1, transition: "opacity 0.2s" }}>
                <path
                  d={conn.path}
                  fill="none"
                  stroke={isHighlighted ? "#ec4899" : "#d1d5db"}
                  strokeWidth={isHighlighted ? 2 : 1.5}
                  markerEnd={isHighlighted ? "url(#arrowhead-pink)" : "url(#arrowhead)"}
                />
                <rect
                  x={conn.midX - 30}
                  y={conn.midY - 8}
                  width={60}
                  height={16}
                  rx={4}
                  fill="white"
                  stroke={isHighlighted ? "#fce7f3" : "#f3f4f6"}
                  strokeWidth={1}
                />
                <text
                  x={conn.midX}
                  y={conn.midY + 4}
                  textAnchor="middle"
                  fontSize={9}
                  fill={isHighlighted ? "#ec4899" : "#9ca3af"}
                  fontFamily="sans-serif"
                >
                  {rel.label}
                </text>
              </g>
            );
          })}

          {/* Entity cards */}
          {entities.map((entity) => {
            const isHovered = hoveredEntity === entity.name;
            const isConnected = connectedEntities.has(entity.name);
            const isDimmed =
              hoveredEntity !== null && !isHovered && !isConnected;
            const isSelected = selectedEntity === entity.name;

            return (
              <g
                key={entity.name}
                style={{
                  cursor: "pointer",
                  opacity: isDimmed ? 0.3 : 1,
                  transition: "opacity 0.2s",
                }}
                onMouseEnter={() => setHoveredEntity(entity.name)}
                onMouseLeave={() => setHoveredEntity(null)}
                onClick={() =>
                  setSelectedEntity(
                    selectedEntity === entity.name ? null : entity.name
                  )
                }
              >
                {/* Card shadow */}
                <rect
                  x={entity.x + 2}
                  y={entity.y + 2}
                  width={entity.width}
                  height={entity.height}
                  rx={12}
                  fill="#f3f4f6"
                />
                {/* Card background */}
                <rect
                  x={entity.x}
                  y={entity.y}
                  width={entity.width}
                  height={entity.height}
                  rx={12}
                  fill="white"
                  stroke={
                    isSelected
                      ? "#ec4899"
                      : isHovered
                      ? "#f472b6"
                      : entity.isMain
                      ? "#fce7f3"
                      : "#e5e7eb"
                  }
                  strokeWidth={isSelected || isHovered ? 2 : 1.5}
                />
                {/* Left accent bar */}
                <rect
                  x={entity.x}
                  y={entity.y + 12}
                  width={4}
                  height={entity.height - 24}
                  rx={2}
                  fill={entity.isMain ? "#ec4899" : "#d1d5db"}
                />
                {/* Entity name */}
                <text
                  x={entity.x + 16}
                  y={entity.y + 30}
                  fontSize={13}
                  fontWeight={600}
                  fill="#111827"
                  fontFamily="sans-serif"
                >
                  {entity.name}
                </text>
                {/* Table name */}
                <text
                  x={entity.x + 16}
                  y={entity.y + 46}
                  fontSize={10}
                  fill="#9ca3af"
                  fontFamily="sans-serif"
                >
                  {entity.tableName}
                </text>
                {/* Field count badge */}
                <rect
                  x={entity.x + entity.width - 52}
                  y={entity.y + 52}
                  width={36}
                  height={18}
                  rx={9}
                  fill={entity.isMain ? "#fce7f3" : "#f3f4f6"}
                />
                <text
                  x={entity.x + entity.width - 34}
                  y={entity.y + 64}
                  fontSize={9}
                  textAnchor="middle"
                  fill={entity.isMain ? "#ec4899" : "#6b7280"}
                  fontFamily="sans-serif"
                >
                  {entity.fields.length} fld
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Sidebar - field details for selected entity */}
      {selectedEntityData && (
        <div className="w-72 border-l border-gray-200 bg-white overflow-y-auto flex-shrink-0">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-black">
                {selectedEntityData.name}
              </h3>
              <p className="text-[10px] text-gray-400">
                {selectedEntityData.tableName}
              </p>
            </div>
            <button
              onClick={() => setSelectedEntity(null)}
              className="rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-black"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="p-3 space-y-1.5">
            {selectedEntityData.fields.map((field: any, i: number) => (
              <div
                key={field.name || i}
                className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50 transition"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-medium text-black truncate">
                    {field.name}
                  </span>
                  {field.required && (
                    <span className="text-[8px] text-pink-500">*</span>
                  )}
                </div>
                <span
                  className="flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium"
                  style={{
                    color: typeColor(field.type || ""),
                    backgroundColor: typeColor(field.type || "") + "15",
                  }}
                >
                  {(field.type || "text").toUpperCase()}
                </span>
              </div>
            ))}
          </div>
          {/* Relationships section */}
          {relationships.filter(
            (r) =>
              r.from === selectedEntityData.name ||
              r.to === selectedEntityData.name
          ).length > 0 && (
            <div className="border-t border-gray-100 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Relationships
              </p>
              {relationships
                .filter(
                  (r) =>
                    r.from === selectedEntityData.name ||
                    r.to === selectedEntityData.name
                )
                .map((rel, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-gray-600 hover:bg-pink-50 transition cursor-pointer"
                    onClick={() =>
                      setSelectedEntity(
                        rel.from === selectedEntityData.name
                          ? rel.to
                          : rel.from
                      )
                    }
                  >
                    <ChevronRight className="h-3 w-3 text-pink-400" />
                    <span className="text-pink-600 font-medium">
                      {rel.from === selectedEntityData.name
                        ? rel.to
                        : rel.from}
                    </span>
                    <span className="text-gray-400">({rel.label})</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
