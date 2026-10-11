import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

const SIZE = 160;
const STROKE = 10;
const R = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

export default function CircularTimer({ totalSecs, secsLeft, onSkip }) {
  const progress = totalSecs > 0 ? secsLeft / totalSecs : 0;
  const strokeDashoffset = CIRCUMFERENCE * (1 - progress);

  return (
    <View style={styles.container}>
      <Svg width={SIZE} height={SIZE} style={styles.svg}>
        {/* background ring */}
        <Circle
          cx={SIZE / 2} cy={SIZE / 2} r={R}
          stroke="#E8E8E8" strokeWidth={STROKE} fill="none"
        />
        {/* progress ring */}
        <Circle
          cx={SIZE / 2} cy={SIZE / 2} r={R}
          stroke="#2D7DD2" strokeWidth={STROKE} fill="none"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${SIZE / 2}, ${SIZE / 2}`}
        />
      </Svg>
      <View style={styles.center}>
        <Text style={styles.seconds}>{secsLeft}</Text>
        <Text style={styles.label}>sec</Text>
      </View>
      <TouchableOpacity onPress={onSkip} style={styles.skipBtn}>
        <Text style={styles.skipText}>Skip rest →</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: 8 },
  svg: {},
  center: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seconds: { fontSize: 48, fontWeight: '800', color: '#1A1A1A' },
  label: { fontSize: 13, color: '#888', marginTop: -4 },
  skipBtn: { marginTop: 12 },
  skipText: { color: '#2D7DD2', fontSize: 15, fontWeight: '600' },
});
