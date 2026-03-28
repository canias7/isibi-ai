import React, { useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, Animated, Easing,
} from "react-native";
import { C, F } from "../lib/theme";

interface Props {
  appName: string;
  onConnected: () => void;
}

export default function ConnectingScreen({ appName, onConnected }: Props) {
  const pulseAnim  = useRef(new Animated.Value(0.8)).current;
  const glowAnim   = useRef(new Animated.Value(0)).current;
  const scaleAnim  = useRef(new Animated.Value(0.5)).current;
  const fadeAnim   = useRef(new Animated.Value(0)).current;
  const ring1Anim  = useRef(new Animated.Value(0)).current;
  const ring2Anim  = useRef(new Animated.Value(0)).current;
  const ring3Anim  = useRef(new Animated.Value(0)).current;

  const initial = appName.charAt(0).toUpperCase();

  useEffect(() => {
    // Entrance animation
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();

    // Pulsing orb
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.9, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();

    // Glow rotation
    Animated.loop(
      Animated.timing(glowAnim, {
        toValue: 1,
        duration: 3000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();

    // Expanding rings
    const createRingAnimation = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, { toValue: 1, duration: 1500, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );

    createRingAnimation(ring1Anim, 0).start();
    createRingAnimation(ring2Anim, 500).start();
    createRingAnimation(ring3Anim, 1000).start();

    // Navigate after connection animation
    const timer = setTimeout(onConnected, 1800);
    return () => clearTimeout(timer);
  }, []);

  const ringStyle = (anim: Animated.Value) => ({
    position: "absolute" as const,
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 1,
    borderColor: C.primary,
    opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
    transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.5] }) }],
  });

  return (
    <View style={s.root}>
      {/* Background particles */}
      <View style={s.particleField}>
        {Array.from({ length: 8 }).map((_, i) => (
          <View
            key={i}
            style={[
              s.particle,
              {
                left: `${15 + (i * 11) % 70}%`,
                top: `${20 + (i * 17) % 60}%`,
                width: 2 + (i % 3),
                height: 2 + (i % 3),
                opacity: 0.2 + (i % 4) * 0.1,
              },
            ]}
          />
        ))}
      </View>

      <Animated.View style={[s.centerContent, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
        {/* Expanding rings */}
        <Animated.View style={ringStyle(ring1Anim)} />
        <Animated.View style={ringStyle(ring2Anim)} />
        <Animated.View style={ringStyle(ring3Anim)} />

        {/* Main orb */}
        <Animated.View style={[s.orbOuter, { transform: [{ scale: pulseAnim }] }]}>
          <View style={s.orbGlow} />
          <View style={s.orbInner}>
            <Text style={s.orbText}>{initial}</Text>
          </View>
        </Animated.View>
      </Animated.View>

      {/* Text */}
      <Animated.View style={[s.textWrap, { opacity: fadeAnim }]}>
        <Text style={s.connecting}>Connecting to</Text>
        <Text style={s.appName}>{appName}</Text>
        <View style={s.dotsRow}>
          <View style={[s.dot, { opacity: 0.4 }]} />
          <View style={[s.dot, { opacity: 0.7 }]} />
          <View style={[s.dot, { opacity: 1.0 }]} />
        </View>
      </Animated.View>

      {/* Connection lines */}
      <View style={s.lineContainer}>
        <View style={[s.connectionLine, { top: "30%", transform: [{ rotate: "25deg" }] }]} />
        <View style={[s.connectionLine, { top: "50%", transform: [{ rotate: "-15deg" }] }]} />
        <View style={[s.connectionLine, { top: "70%", transform: [{ rotate: "10deg" }] }]} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  particleField: {
    ...StyleSheet.absoluteFillObject,
  },
  particle: {
    position: "absolute",
    borderRadius: 4,
    backgroundColor: C.primary,
  },
  centerContent: {
    alignItems: "center",
    justifyContent: "center",
    width: 200,
    height: 200,
  },
  orbOuter: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  orbGlow: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: C.primary + "12",
  },
  orbInner: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: C.primary + "25",
    borderWidth: 2,
    borderColor: C.primary + "60",
    alignItems: "center",
    justifyContent: "center",
  },
  orbText: {
    fontSize: 36,
    fontWeight: "800",
    color: C.primary,
  },
  textWrap: {
    alignItems: "center",
    marginTop: 40,
  },
  connecting: {
    fontSize: F.sm,
    color: C.textDim,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  appName: {
    fontSize: F.xxl,
    fontWeight: "800",
    color: C.text,
    letterSpacing: 0.5,
  },
  dotsRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 16,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.primary,
  },
  lineContainer: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  connectionLine: {
    position: "absolute",
    left: -20,
    right: -20,
    height: 1,
    backgroundColor: C.primary + "08",
  },
});
