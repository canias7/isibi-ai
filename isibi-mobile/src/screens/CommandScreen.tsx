import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, Animated, Easing, KeyboardAvoidingView,
  Platform, Alert, ActivityIndicator,
} from "react-native";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { C, F, R } from "../lib/theme";
import {
  Project, getProjectSpec, listRecords, createRecord,
  deleteRecord, countRecords, CommandResult, aiCommand, ghostStream,
  createScheduledCommand, listScheduledCommands, deleteScheduledCommand,
} from "../lib/api";

// ── Types ────────────────────────────────────────────────────────────────────

type OrbState = "idle" | "listening" | "processing" | "done";

interface ResponseCard {
  id: string;
  icon: string;
  message: string;
  timestamp: number;
}

interface EntityInfo {
  name: string;        // table name for API calls (e.g. "leads")
  displayName: string; // human-readable (e.g. "Lead")
  fields: string[];    // field names
}

// ── Command processing ───────────────────────────────────────────────────────

function buildKnowledgeBase(spec: any): EntityInfo[] {
  if (!spec?.spec?.entities) return [];
  return spec.spec.entities.map((e: any) => ({
    name: e.table || e.name.toLowerCase().replace(/\s+/g, "_"),
    displayName: e.name.replace(/_/g, " "),
    fields: (e.fields ?? []).map((f: any) => typeof f === "string" ? f : f.name),
  }));
}

function findEntity(entities: EntityInfo[], term: string): EntityInfo | null {
  const lower = term.toLowerCase().replace(/s$/, ""); // strip trailing 's'
  return entities.find(e =>
    e.displayName.toLowerCase() === lower ||
    e.displayName.toLowerCase() === lower + "s" ||
    e.name.toLowerCase() === lower ||
    e.name.toLowerCase() === lower + "s" ||
    e.displayName.toLowerCase().includes(lower) ||
    e.name.toLowerCase().includes(lower)
  ) ?? null;
}

function extractNameFromCommand(cmd: string): string | null {
  // "Add a new lead named John Smith" → "John Smith"
  const namedMatch = cmd.match(/named?\s+(.+)/i);
  if (namedMatch) return namedMatch[1].trim();

  // "Add a new lead John Smith" → "John Smith"
  const addMatch = cmd.match(/add\s+(?:a\s+)?(?:new\s+)?\w+\s+(.+)/i);
  if (addMatch) return addMatch[1].trim();

  return null;
}

// ── Schedule parsing ──────────────────────────────────────────────────────────

interface ParsedSchedule {
  schedule_type: string;
  schedule_time: string;
  schedule_day?: string;
  command: string;
  timezone?: string;
}

function parseScheduleCommand(input: string): ParsedSchedule | null {
  const lower = input.toLowerCase().trim();

  // "every day at 5pm, give me income report"
  // "every monday at 9am, show me new leads"
  // "every month on the 1st at 8am, send summary"
  // "schedule daily at 17:00, report of all income"
  const everyDayMatch = lower.match(
    /every\s+day\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)[,:]?\s+(.+)/i
  );
  if (everyDayMatch) {
    return {
      schedule_type: "daily",
      schedule_time: parseTime(everyDayMatch[1]),
      command: everyDayMatch[2].trim(),
    };
  }

  const everyWeekdayMatch = lower.match(
    /every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)[,:]?\s+(.+)/i
  );
  if (everyWeekdayMatch) {
    return {
      schedule_type: "weekly",
      schedule_day: everyWeekdayMatch[1],
      schedule_time: parseTime(everyWeekdayMatch[2]),
      command: everyWeekdayMatch[3].trim(),
    };
  }

  const everyMonthMatch = lower.match(
    /every\s+month\s+(?:on\s+(?:the\s+)?)?(\d{1,2})(?:st|nd|rd|th)?\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)[,:]?\s+(.+)/i
  );
  if (everyMonthMatch) {
    return {
      schedule_type: "monthly",
      schedule_day: everyMonthMatch[1],
      schedule_time: parseTime(everyMonthMatch[2]),
      command: everyMonthMatch[3].trim(),
    };
  }

  // "schedule [command] at [time]"
  const scheduleAtMatch = lower.match(
    /schedule\s+(.+?)\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*$/i
  );
  if (scheduleAtMatch) {
    return {
      schedule_type: "daily",
      schedule_time: parseTime(scheduleAtMatch[2]),
      command: scheduleAtMatch[1].trim(),
    };
  }

  // "at 5pm every day, give me income report"
  const atEveryMatch = lower.match(
    /at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+every\s+day[,:]?\s+(.+)/i
  );
  if (atEveryMatch) {
    return {
      schedule_type: "daily",
      schedule_time: parseTime(atEveryMatch[1]),
      command: atEveryMatch[2].trim(),
    };
  }

  return null;
}

function parseTime(timeStr: string): string {
  const cleaned = timeStr.trim().toLowerCase();
  const match = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return "00:00";

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const period = match[3];

  if (period === "pm" && hours < 12) hours += 12;
  if (period === "am" && hours === 12) hours = 0;

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function formatTime12h(time24: string): string {
  const [hStr, mStr] = time24.split(":");
  let h = parseInt(hStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${mStr} ${period}`;
}

async function processCommand(
  command: string,
  projectId: string,
  entities: EntityInfo[],
  history?: {role: string; content: string}[],
): Promise<CommandResult> {
  const cmd = command.trim();
  const lower = cmd.toLowerCase();

  // === Schedule commands ===
  const schedule = parseScheduleCommand(cmd);
  if (schedule) {
    try {
      await createScheduledCommand(projectId, {
        command: schedule.command,
        schedule_type: schedule.schedule_type,
        schedule_time: schedule.schedule_time,
        schedule_day: schedule.schedule_day,
        timezone: schedule.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      const dayLabel = schedule.schedule_day ? ` on ${schedule.schedule_day}` : "";
      const typeLabel = schedule.schedule_type === "daily" ? "every day"
        : schedule.schedule_type === "weekly" ? `every week${dayLabel}`
        : schedule.schedule_type === "monthly" ? `every month${dayLabel}`
        : "once";
      return {
        success: true,
        message: `Scheduled! I'll "${schedule.command}" ${typeLabel} at ${formatTime12h(schedule.schedule_time)}`,
      };
    } catch (e: any) {
      return { success: false, message: `Failed to create schedule: ${e.message}` };
    }
  }

  // === "show my schedules" / "my schedules" ===
  if (lower === "show my schedules" || lower === "my schedules" || lower === "show schedules" || lower === "list schedules") {
    try {
      const result = await listScheduledCommands(projectId);
      const items = result?.items ?? [];
      if (items.length === 0) {
        return { success: true, message: "You have no scheduled commands." };
      }
      const list = items.map((s: any) => {
        const status = s.enabled ? "active" : "paused";
        const dayLabel = s.schedule_day ? ` (${s.schedule_day})` : "";
        return `- "${s.command}" ${s.schedule_type}${dayLabel} at ${formatTime12h(s.schedule_time)} [${status}]`;
      }).join("\n");
      return { success: true, message: `Your scheduled commands:\n${list}` };
    } catch (e: any) {
      return { success: false, message: `Failed to load schedules: ${e.message}` };
    }
  }

  // === "cancel schedule [name]" ===
  if (lower.startsWith("cancel schedule") || lower.startsWith("remove schedule") || lower.startsWith("delete schedule")) {
    const term = cmd.replace(/^(?:cancel|remove|delete)\s+schedule\s*/i, "").trim().toLowerCase();
    try {
      const result = await listScheduledCommands(projectId);
      const items = result?.items ?? [];
      if (items.length === 0) {
        return { success: true, message: "You have no scheduled commands to cancel." };
      }
      // Find matching command
      const match = items.find((s: any) =>
        s.command.toLowerCase().includes(term) || term === ""
      );
      if (!match) {
        return { success: false, message: `No schedule found matching "${term}". Say "show my schedules" to see all.` };
      }
      await deleteScheduledCommand(projectId, match.id);
      return { success: true, message: `Cancelled schedule: "${match.command}"` };
    } catch (e: any) {
      return { success: false, message: `Failed to cancel schedule: ${e.message}` };
    }
  }

  // === "Add a new [entity]..." ===
  if (lower.startsWith("add") || lower.startsWith("create") || lower.startsWith("new")) {
    for (const entity of entities) {
      const entityLower = entity.displayName.toLowerCase();
      const entitySingle = entityLower.replace(/s$/, "");
      if (lower.includes(entityLower) || lower.includes(entitySingle)) {
        const extractedName = extractNameFromCommand(cmd);
        // If no specific data provided, let AI ask for required fields
        if (!extractedName) {
          try {
            const aiResult = await aiCommand(projectId, cmd, history);
            return { success: true, message: aiResult.message };
          } catch {
            return { success: false, message: `What info do you want for this ${entitySingle}? Try: "add a ${entitySingle} named John"` };
          }
        }
        const data: Record<string, string> = {};
        const nameField = entity.fields.find(f =>
          f.toLowerCase() === "name" || f.toLowerCase() === "title" || f.toLowerCase().includes("name")
        );
        if (nameField) {
          data[nameField] = extractedName;
        } else if (entity.fields.length > 0) {
          const skipFields = ["id", "org_id", "created_at", "updated_at", "deleted_at", "version"];
          const firstField = entity.fields.find(f => !skipFields.includes(f.toLowerCase()));
          if (firstField) {
            data[firstField] = extractedName;
          }
        }
        try {
          await createRecord(projectId, entity.name, data);
          return {
            success: true,
            message: `Created new ${entitySingle}: ${extractedName}`,
          };
        } catch (e: any) {
          return { success: false, message: `Failed to create ${entitySingle}: ${e.message}` };
        }
      }
    }
    return { success: false, message: "I don't recognize that entity. Try one of: " + entities.map(e => e.displayName).join(", ") };
  }

  // === "How many [entity]s" / "Count [entity]s" ===
  if (lower.startsWith("how many") || lower.startsWith("count")) {
    for (const entity of entities) {
      const entityLower = entity.displayName.toLowerCase();
      if (lower.includes(entityLower) || lower.includes(entityLower.replace(/s$/, ""))) {
        try {
          const count = await countRecords(projectId, entity.name);
          return { success: true, message: `You have ${count} ${entity.displayName}` };
        } catch (e: any) {
          return { success: false, message: `Failed to count: ${e.message}` };
        }
      }
    }
    return { success: false, message: "Which entity? I know: " + entities.map(e => e.displayName).join(", ") };
  }

  // === "Show me [entity]s" / "List [entity]s" ===
  if (lower.startsWith("show") || lower.startsWith("list") || lower.startsWith("get")) {
    for (const entity of entities) {
      const entityLower = entity.displayName.toLowerCase();
      if (lower.includes(entityLower) || lower.includes(entityLower.replace(/s$/, ""))) {
        try {
          const records = await listRecords(projectId, entity.name);
          const rows = Array.isArray(records) ? records : (records?.rows ?? []);
          const count = rows.length;
          const preview = rows.slice(0, 3).map((r: any) => {
            const nameField = entity.fields.find(f =>
              f.toLowerCase() === "name" || f.toLowerCase() === "title" || f.toLowerCase().includes("name")
            );
            return nameField ? r[nameField] : JSON.stringify(r).slice(0, 40);
          }).filter(Boolean).join(", ");
          return {
            success: true,
            message: `Found ${count} ${entity.displayName}${preview ? `. Recent: ${preview}` : ""}`,
            data: rows,
          };
        } catch (e: any) {
          return { success: false, message: `Failed to list: ${e.message}` };
        }
      }
    }
    return { success: false, message: "Which entity? I know: " + entities.map(e => e.displayName).join(", ") };
  }

  // === "Delete [entity] named [value]" ===
  if (lower.startsWith("delete") || lower.startsWith("remove")) {
    for (const entity of entities) {
      const entityLower = entity.displayName.toLowerCase();
      const entitySingle = entityLower.replace(/s$/, "");
      if (lower.includes(entityLower) || lower.includes(entitySingle)) {
        const nameToDelete = extractNameFromCommand(cmd);
        if (!nameToDelete) {
          return { success: false, message: `Which ${entitySingle}? Say "Delete ${entitySingle} named [name]"` };
        }
        try {
          const records = await listRecords(projectId, entity.name);
          const rows = Array.isArray(records) ? records : (records?.rows ?? []);
          const nameField = entity.fields.find(f =>
            f.toLowerCase() === "name" || f.toLowerCase() === "title" || f.toLowerCase().includes("name")
          );
          const match = rows.find((r: any) =>
            nameField && String(r[nameField]).toLowerCase().includes(nameToDelete.toLowerCase())
          );
          if (!match) {
            return { success: false, message: `No ${entitySingle} found matching "${nameToDelete}"` };
          }
          await deleteRecord(projectId, entity.name, match.id);
          return {
            success: true,
            message: `Deleted ${entitySingle}: ${nameField ? match[nameField] : nameToDelete}`,
          };
        } catch (e: any) {
          return { success: false, message: `Failed to delete: ${e.message}` };
        }
      }
    }
    return { success: false, message: "Which entity? I know: " + entities.map(e => e.displayName).join(", ") };
  }

  // === "Search for [value]" ===
  if (lower.startsWith("search") || lower.startsWith("find")) {
    const searchTerm = cmd.replace(/^(search|find)\s+(for\s+)?/i, "").trim();
    if (!searchTerm) {
      return { success: false, message: "Search for what?" };
    }
    let totalFound = 0;
    const results: string[] = [];
    for (const entity of entities) {
      try {
        const records = await listRecords(projectId, entity.name);
        const rows = Array.isArray(records) ? records : (records?.rows ?? []);
        const matches = rows.filter((r: any) =>
          JSON.stringify(r).toLowerCase().includes(searchTerm.toLowerCase())
        );
        if (matches.length > 0) {
          totalFound += matches.length;
          results.push(`${matches.length} in ${entity.displayName}`);
        }
      } catch {
        // skip failed tables
      }
    }
    if (totalFound === 0) {
      return { success: true, message: `No results found for "${searchTerm}"` };
    }
    return { success: true, message: `Found ${totalFound} results for "${searchTerm}": ${results.join(", ")}` };
  }

  // === "Help" ===
  if (lower === "help" || lower === "?") {
    const entityNames = entities.map(e => e.displayName).join(", ");
    return {
      success: true,
      message: `Commands: "Add a new [entity]", "Show me [entity]s", "How many [entity]s", "Search for [value]", "Delete [entity] named [name]", "Every day at 5pm, [command]", "Show my schedules", "Cancel schedule [name]", "Disconnect". Your entities: ${entityNames}`,
    };
  }

  // No pattern matched — use AI to understand natural language
  try {
    const aiResult = await aiCommand(projectId, cmd, history);
    return {
      success: aiResult.action !== "chat" || true,
      message: aiResult.message || "I'm not sure what you mean. Try saying something like 'show me contacts' or 'add a new lead named John'.",
    };
  } catch (e: any) {
    return {
      success: false,
      message: `I couldn't process that. Try saying "help" for available commands.`,
    };
  }
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  project: Project;
  onDisconnect: () => void;
  onSwitchApp?: (appName: string) => void;
}

export default function CommandScreen({ project, onDisconnect, onSwitchApp }: Props) {
  const [orbState,  setOrbState]  = useState<OrbState>("idle");
  const [inputText, setInputText] = useState("");
  const [responses, setResponses] = useState<ResponseCard[]>([]);
  const [entities,  setEntities]  = useState<EntityInfo[]>([]);
  const [specLoaded, setSpecLoaded] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [aiHistory, setAiHistory] = useState<{role: string; content: string}[]>([]);

  // Animations
  const orbPulse = useRef(new Animated.Value(1)).current;
  const orbGlow  = useRef(new Animated.Value(0.3)).current;

  // Load spec on mount
  useEffect(() => {
    (async () => {
      try {
        const spec = await getProjectSpec(project.id);
        setEntities(buildKnowledgeBase(spec));
      } catch {
        // If spec load fails, we can still try commands
      } finally {
        setSpecLoaded(true);
      }
    })();
  }, [project.id]);

  // Orb pulse animation
  useEffect(() => {
    const config = {
      idle:       { scale: [1, 1.05],  glow: [0.3, 0.5],  duration: 2000 },
      listening:  { scale: [1, 1.15],  glow: [0.5, 0.9],  duration: 600  },
      processing: { scale: [0.95, 1.1], glow: [0.6, 1.0],  duration: 400  },
      done:       { scale: [1, 1],     glow: [0.8, 0.8],  duration: 1000 },
    }[orbState];

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(orbPulse, { toValue: config.scale[1], duration: config.duration, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(orbPulse, { toValue: config.scale[0], duration: config.duration, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );

    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(orbGlow, { toValue: config.glow[1], duration: config.duration, useNativeDriver: true }),
        Animated.timing(orbGlow, { toValue: config.glow[0], duration: config.duration, useNativeDriver: true }),
      ]),
    );

    pulseLoop.start();
    glowLoop.start();
    return () => { pulseLoop.stop(); glowLoop.stop(); };
  }, [orbState]);

  const addResponse = (icon: string, message: string) => {
    const card: ResponseCard = {
      id: String(Date.now()),
      icon,
      message,
      timestamp: Date.now(),
    };
    setResponses(prev => [card, ...prev].slice(0, 20));
  };

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText("");

    // Handle special commands
    if (text.toLowerCase() === "disconnect") {
      onDisconnect();
      return;
    }
    if (text.toLowerCase().startsWith("switch to ")) {
      const appName = text.replace(/^switch to /i, "").trim();
      if (onSwitchApp) {
        onSwitchApp(appName);
      } else {
        addResponse(">>", `Switch to "${appName}" — use My Apps tab to switch`);
      }
      return;
    }

    setOrbState("processing");

    try {
      const result = await processCommand(text, project.id, entities, aiHistory);
      setOrbState("done");
      addResponse(result.success ? "OK" : "!!", result.message);
      // Update AI conversation history
      setAiHistory(prev => [...prev, {role: "user", content: text}, {role: "assistant", content: result.message}].slice(-20));
    } catch (e: any) {
      setOrbState("done");
      addResponse("!!", e.message ?? "Command failed");
    }

    setTimeout(() => setOrbState("idle"), 1500);
  }, [inputText, project.id, entities, onDisconnect, onSwitchApp, aiHistory]);

  // ── Speech recognition events ──
  useSpeechRecognitionEvent("start", () => {
    setIsListening(true);
    setOrbState("listening");
    setLiveTranscript("");
  });

  useSpeechRecognitionEvent("end", () => {
    setIsListening(false);
    if (orbState === "listening") setOrbState("idle");
  });

  // Throttle ghost stream calls to avoid spamming the API
  const lastStreamRef = useRef(0);

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results?.[0]?.transcript || "";
    if (event.isFinal && transcript) {
      setLiveTranscript("");
      setInputText(transcript);

      // Send final transcript to ghost stream (triggers ghost animation)
      ghostStream(project.id, transcript, true).catch(() => {});

      // Auto-send the voice command
      setTimeout(async () => {
        setOrbState("processing");
        try {
          const result = await processCommand(transcript, project.id, entities, aiHistory);
          setOrbState("done");
          addResponse(result.success ? "OK" : "!!", result.message);
          setAiHistory(prev => [...prev, {role: "user", content: transcript}, {role: "assistant", content: result.message}].slice(-20));
        } catch (e: any) {
          setOrbState("done");
          addResponse("!!", e.message ?? "Command failed");
        }
        setInputText("");
        setTimeout(() => setOrbState("idle"), 1500);
      }, 100);
    } else {
      setLiveTranscript(transcript);

      // Stream interim transcripts to ghost endpoint (throttled to every 1.5s)
      const now = Date.now();
      if (transcript.length > 10 && now - lastStreamRef.current > 1500) {
        lastStreamRef.current = now;
        ghostStream(project.id, transcript, false).catch(() => {});
      }
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    setIsListening(false);
    setOrbState("idle");
    setLiveTranscript("");
    if (event.error !== "no-speech") {
      addResponse("!!", `Voice error: ${event.message || event.error}`);
    }
  });

  const handleMicPress = async () => {
    if (isListening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }

    // Request permissions
    const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!granted) {
      Alert.alert(
        "Permission Required",
        "Enable microphone and speech recognition in Settings to use voice commands.",
      );
      return;
    }

    // Start listening
    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      interimResults: true,
      continuous: false,
    });
  };

  const orbLabel = liveTranscript
    ? `"${liveTranscript}"`
    : {
        idle:       "Tap mic or type a command",
        listening:  "Listening...",
        processing: "Processing...",
        done:       "Done",
      }[orbState];

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.headerIcon}>
            <Text style={s.headerIconText}>
              {project.name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View>
            <Text style={s.headerTitle} numberOfLines={1}>{project.name}</Text>
            <View style={s.connectedBadge}>
              <View style={s.connectedDot} />
              <Text style={s.connectedText}>Connected</Text>
            </View>
          </View>
        </View>
        <TouchableOpacity style={s.disconnectBtn} onPress={onDisconnect} activeOpacity={0.7}>
          <Text style={s.disconnectX}>X</Text>
        </TouchableOpacity>
      </View>

      {/* Spec loading indicator */}
      {!specLoaded && (
        <View style={s.specLoading}>
          <ActivityIndicator color={C.primary} size="small" />
          <Text style={s.specLoadingText}>Loading app schema...</Text>
        </View>
      )}

      {/* Center orb area */}
      <View style={s.orbContainer}>
        <Animated.View style={[s.orbGlow, { opacity: orbGlow, transform: [{ scale: orbPulse }] }]} />
        <Animated.View style={[s.orb, { transform: [{ scale: orbPulse }] }]}>
          <View style={s.orbInner} />
        </Animated.View>
        <Text style={s.orbLabel}>{orbLabel}</Text>
        {entities.length > 0 && orbState === "idle" && (
          <Text style={s.entityHint}>
            {entities.map(e => e.displayName).join(" / ")}
          </Text>
        )}
      </View>

      {/* Response cards */}
      <FlatList
        data={responses}
        keyExtractor={r => r.id}
        style={s.responseList}
        contentContainerStyle={s.responseContent}
        inverted
        renderItem={({ item }) => (
          <View style={[s.responseCard, item.icon === "!!" && s.responseCardError]}>
            <Text style={s.responseIcon}>
              {item.icon === "OK" ? "\u2705" : item.icon === "!!" ? "\u26A0\uFE0F" : item.icon === ">>" ? "\u27A1\uFE0F" : "\u2139\uFE0F"}
            </Text>
            <Text style={s.responseText}>{item.message}</Text>
          </View>
        )}
      />

      {/* Input bar */}
      <View style={s.inputBar}>
        <TextInput
          style={s.textInput}
          placeholder="Type a command..."
          placeholderTextColor={C.textDim}
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={[s.sendBtn, !inputText.trim() && s.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim()}
          activeOpacity={0.7}
        >
          <Text style={s.sendBtnText}>{"\u2191"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.micBtn, isListening && s.micBtnActive]}
          onPress={handleMicPress}
          activeOpacity={0.7}
        >
          <Text style={s.micIcon}>{isListening ? "\u23F9" : "\uD83C\uDFA4"}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.card,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.primary + "25",
    borderWidth: 1,
    borderColor: C.primary + "50",
    alignItems: "center",
    justifyContent: "center",
  },
  headerIconText: { fontSize: F.md, fontWeight: "800", color: C.primary },
  headerTitle: { fontSize: F.md, fontWeight: "700", color: C.text, maxWidth: 200 },
  connectedBadge: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  connectedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green },
  connectedText: { fontSize: 10, color: C.green, fontWeight: "600" },
  disconnectBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.red + "18",
    borderWidth: 1,
    borderColor: C.red + "40",
    alignItems: "center",
    justifyContent: "center",
  },
  disconnectX: { fontSize: 14, fontWeight: "800", color: C.red },

  // Spec loading
  specLoading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 8,
  },
  specLoadingText: { fontSize: F.xs, color: C.textDim },

  // Orb
  orbContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 30,
  },
  orbGlow: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: C.primary + "10",
  },
  orb: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: C.primary + "20",
    borderWidth: 2,
    borderColor: C.primary + "50",
    alignItems: "center",
    justifyContent: "center",
  },
  orbInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: C.primary + "40",
  },
  orbLabel: {
    marginTop: 14,
    fontSize: F.sm,
    color: C.textMid,
    letterSpacing: 0.3,
  },
  entityHint: {
    marginTop: 6,
    fontSize: 10,
    color: C.textDim,
    letterSpacing: 0.3,
    textAlign: "center",
    paddingHorizontal: 40,
  },

  // Responses
  responseList: { flex: 1 },
  responseContent: { padding: 16, gap: 8 },
  responseCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: C.card,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    gap: 10,
    marginBottom: 8,
  },
  responseCardError: {
    borderColor: C.red + "40",
    backgroundColor: C.red + "08",
  },
  responseIcon: { fontSize: 16, marginTop: 1 },
  responseText: { fontSize: F.sm, color: C.text, flex: 1, lineHeight: 20 },

  // Input bar
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.card,
    gap: 8,
  },
  textInput: {
    flex: 1,
    backgroundColor: C.bg,
    borderRadius: R.xl,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: F.sm,
    color: C.text,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { fontSize: 18, fontWeight: "800", color: "#fff" },
  micBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.primary + "25",
    borderWidth: 2,
    borderColor: C.primary + "60",
    alignItems: "center",
    justifyContent: "center",
  },
  micBtnActive: {
    backgroundColor: C.red + "30",
    borderColor: C.red,
  },
  micIcon: { fontSize: 20 },
});
