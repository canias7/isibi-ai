import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert, Dimensions,
} from "react-native";
import { C, F, R } from "../lib/theme";
import { getMyProjects, Project } from "../lib/api";

const { width } = Dimensions.get("window");
const CARD_GAP = 12;
const CARD_WIDTH = (width - 18 * 2 - CARD_GAP) / 2;

// Generate a consistent color from project name
function projectColor(name: string): string {
  const colors = [C.primary, C.blue, C.cyan, C.green, C.amber, "#a855f7", "#f97316", "#14b8a6"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function AppCard({
  project,
  connectedId,
  onConnect,
  onDisconnect,
  entityCount,
}: {
  project: Project;
  connectedId: string | null;
  onConnect: (p: Project) => void;
  onDisconnect: () => void;
  entityCount?: number;
}) {
  const isConnected = connectedId === project.id;
  const color = projectColor(project.name);
  const initial = project.name.charAt(0).toUpperCase();

  const handleLongPress = () => {
    if (!isConnected) return;
    Alert.alert(
      "Disconnect",
      `Disconnect from ${project.name}?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Disconnect", style: "destructive", onPress: onDisconnect },
      ],
    );
  };

  return (
    <TouchableOpacity
      style={[
        s.appCard,
        isConnected && { borderColor: C.primary + "80" },
      ]}
      onPress={() => onConnect(project)}
      onLongPress={handleLongPress}
      activeOpacity={0.7}
    >
      {/* Glow effect when connected */}
      {isConnected && <View style={s.cardGlow} />}

      {/* Icon */}
      <View style={[s.iconCircle, { backgroundColor: color + "20", borderColor: color + "50" }]}>
        <Text style={[s.iconText, { color }]}>{initial}</Text>
      </View>

      {/* Name */}
      <Text style={s.appName} numberOfLines={2}>{project.name}</Text>

      {/* Bottom row: entity count + status */}
      <View style={s.cardBottom}>
        {entityCount !== undefined && (
          <Text style={s.entityCount}>{entityCount} records</Text>
        )}
        <View style={s.statusDotRow}>
          <View style={[s.statusDot, { backgroundColor: isConnected ? C.green : C.textDim }]} />
          <Text style={[s.statusText, { color: isConnected ? C.green : C.textDim }]}>
            {isConnected ? "Connected" : "Ready"}
          </Text>
        </View>
      </View>

      {/* Subtle gradient border effect */}
      <View style={[s.gradientBorder, { borderColor: color + "15" }]} />
    </TouchableOpacity>
  );
}

interface Props {
  connectedProjectId: string | null;
  onConnectToApp: (project: Project) => void;
  onDisconnect: () => void;
}

export default function MyAppsScreen({ connectedProjectId, onConnectToApp, onDisconnect }: Props) {
  const [projects,   setProjects]   = useState<Project[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getMyProjects();
      setProjects(Array.isArray(data) ? data : []);
    } catch {
      // silently fail on load
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={C.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <FlatList
        data={projects}
        keyExtractor={p => p.id}
        numColumns={2}
        columnWrapperStyle={s.row}
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />
        }
        ListHeaderComponent={
          <View style={s.header}>
            <Text style={s.title}>My Apps</Text>
            <Text style={s.sub}>{projects.length} app{projects.length !== 1 ? "s" : ""}</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={s.emptyWrap}>
            <Text style={s.emptyIcon}>{"{ }"}</Text>
            <Text style={s.emptyTitle}>No apps yet</Text>
            <Text style={s.emptyText}>Create an app on isibi.ai to get started</Text>
          </View>
        }
        renderItem={({ item }) => (
          <AppCard
            project={item}
            connectedId={connectedProjectId}
            onConnect={onConnectToApp}
            onDisconnect={onDisconnect}
          />
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: C.bg },
  content: { padding: 18, paddingBottom: 40 },
  center:  { flex: 1, backgroundColor: C.bg, justifyContent: "center", alignItems: "center" },
  row:     { justifyContent: "space-between", marginBottom: CARD_GAP },

  header: { marginBottom: 20, marginTop: 4 },
  title:  { fontSize: F.xl, fontWeight: "800", color: C.text },
  sub:    { fontSize: F.xs, color: C.textDim, marginTop: 2 },

  appCard: {
    width: CARD_WIDTH,
    backgroundColor: C.card,
    borderRadius: R.xl,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    gap: 10,
    overflow: "hidden",
  },
  cardGlow: {
    position: "absolute",
    top: -20,
    right: -20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: C.primary + "15",
  },
  gradientBorder: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    borderTopWidth: 2,
    borderTopLeftRadius: R.xl,
    borderTopRightRadius: R.xl,
  },

  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: { fontSize: F.xl, fontWeight: "800" },

  appName: { fontSize: F.sm, fontWeight: "700", color: C.text, lineHeight: 18 },

  cardBottom: { marginTop: "auto", gap: 4 },
  entityCount: { fontSize: 10, color: C.textDim },
  statusDotRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: "600" },

  emptyWrap: { alignItems: "center", paddingTop: 80 },
  emptyIcon: { fontSize: 40, color: C.textDim, marginBottom: 12 },
  emptyTitle: { fontSize: F.lg, fontWeight: "700", color: C.textMid, marginBottom: 6 },
  emptyText: { fontSize: F.sm, color: C.textDim, textAlign: "center" },
});
