import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Dimensions, Easing } from 'react-native';
import Svg, { Path, G } from 'react-native-svg';

const { width: SCREEN_W } = Dimensions.get('window');
const W = SCREEN_W - 48; // home container has padding 24
const H = 140;
const BG = '#FAFAFA'; // app background, not yellow
const BLACK = '#1A1A1A';
const LINE_W = W * 0.3;

// Flying superhero — line-art SVG ported from svgrepo.com (CC0).
// Head upper-right with arm raised, body diagonal, legs trailing lower-left.
function Body() {
  const stroke = { stroke: BLACK, strokeWidth: 16, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' };
  return (
    <Svg width={170} height={130} viewBox="0 0 400 400">
      <G transform="rotate(60 200 200)">
        <Path d="M261.949 89.0161C236.12 75.5521 207.015 110.001 228.859 136.327C234.952 143.668 242.982 147.851 252.416 145.199C267.223 141.033 285.07 120.643 269.006 100.631" {...stroke} />
        <Path d="M243.401 156.932C245.779 157.558 248.102 158.376 250.49 158.95C252.946 159.553 255.465 159.878 257.957 160.228C260.231 160.409 275.27 161.847 275.333 163.966C275.406 166.355 260.954 196.838 259.139 200.64C255.563 208.111 251.827 215.479 248.208 222.916C247.338 224.687 246.542 226.494 245.746 228.3C245.045 229.882 244.325 231.429 243.124 232.673C241.426 234.459 239.187 235.378 236.81 235.332C233.286 235.289 229.762 235.062 226.281 234.536C221.792 233.864 216.326 233.135 213.003 229.612C209.193 225.575 210.285 219.855 210.256 214.75C210.234 210.308 210.011 205.869 210 201.426C209.989 196.514 210.095 191.589 210.446 186.688C210.87 180.856 211.253 175.021 211.677 169.201C211.965 165.353 211.808 159.201 214.242 156.086C215.763 154.14 220.445 154.451 222.344 154.138C222.92 154.04 223.507 154 224.096 154C226.148 154 228.259 154.482 230.283 154.767C234.712 155.226 239.054 155.795 243.401 156.932Z" {...stroke} />
        <Path d="M276.667 164.667C279.187 160.79 281.797 156.882 284.71 153.286C287.286 150.093 289.874 146.888 292.463 143.684C295.375 140.087 298.284 136.491 301.197 132.884C303.628 129.87 305.881 126.689 308.199 123.578C311.25 119.187 314.302 114.808 317.226 110.34C319.364 107.064 321.66 103.793 323.522 100.323C323.65 98.1902 324.251 96.3092 325.769 94.7054C326.409 94.0365 326.941 93.6277 327.51 93.299C327.675 93.0617 327.845 92.8273 328.013 92.5957C329.225 90.952 331.77 90.0715 333.758 90.0029C333.838 90.0029 333.918 90 334 90" {...stroke} />
        <Path d="M154 263.144C154.259 261.096 155.391 259.157 156.437 257.384C157.469 255.634 158.501 253.918 159.814 252.344C163.239 248.201 169.369 246.627 174.027 249.795C176.07 251.182 177.203 252.356 178.775 254.261C179.381 255.005 179.918 255.799 180.484 256.573C184.108 260.628 188.195 264.335 192.166 268.031C197.77 273.252 202.971 279.006 209.043 283.706C210.236 284.494 211.449 285.248 212.667 286C212.4 280.87 212.109 275.742 211.664 270.623C211.204 265.271 210.543 259.945 210.003 254.593C209.69 251.536 209.443 248.49 209.207 245.43C209.026 242.937 208.937 240.455 208.994 237.965C209.072 233.864 209.802 229.911 211.003 226" {...stroke} />
        <Path d="M140.666 314C141.057 310.708 144.085 308.293 146.481 306.402C148.118 305.112 149.757 303.867 151.528 302.765C152.874 301.942 154.3 301.253 155.637 300.418C157.074 299.527 158.466 298.593 159.838 297.636C162.977 295.455 165.997 293.148 168.988 290.778C173.708 286.808 178.416 282.656 183.54 279.204C188.998 275.522 194.547 271.982 200.139 268.49C205.372 265.21 210.274 261.459 215.13 257.643C219.761 254.029 224.372 250.383 228.92 246.675C232.148 243.865 240.122 238.173 243.333 235.333" {...stroke} />
        <Path d="M167.618 223.333C166.809 221.82 165.989 220.173 166 218.392C166.012 216.289 166.409 214.719 167.252 212.815C167.961 211.222 168.892 209.92 169.921 208.506C170.687 207.458 171.59 206.651 172.614 205.996C172.654 205.853 172.699 205.711 172.75 205.568C173.624 202.975 174.776 200.513 175.984 198.076C177.99 194.058 180.541 190.274 183.111 186.612C186.281 182.112 189.418 177.573 192.965 173.364C195.833 169.97 198.716 166.653 201.973 163.623C207.06 158.916 213.157 154.351 220.327 154.006C220.44 154 220.554 154 220.667 154" {...stroke} />
      </G>
    </Svg>
  );
}

export default function Speeder() {
  const shakeX = useRef(new Animated.Value(0)).current;
  const shakeY = useRef(new Animated.Value(0)).current;
  const rot = useRef(new Animated.Value(0)).current;

  // 4 long speed lines, each starts at a different offset so they're staggered
  const lines = useRef([
    new Animated.Value(W),
    new Animated.Value(W * 0.6),
    new Animated.Value(W * 0.3),
    new Animated.Value(W * 0.1),
  ]).current;

  useEffect(() => {
    // Body shake (~0.4s cycle, mimics the CSS speeder keyframes)
    const shake = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(shakeX, { toValue: 2, duration: 60, useNativeDriver: true }),
          Animated.timing(shakeX, { toValue: -2, duration: 60, useNativeDriver: true }),
          Animated.timing(shakeX, { toValue: 1, duration: 60, useNativeDriver: true }),
          Animated.timing(shakeX, { toValue: 3, duration: 60, useNativeDriver: true }),
          Animated.timing(shakeX, { toValue: -2, duration: 60, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(shakeY, { toValue: -3, duration: 60, useNativeDriver: true }),
          Animated.timing(shakeY, { toValue: 1, duration: 60, useNativeDriver: true }),
          Animated.timing(shakeY, { toValue: -1, duration: 60, useNativeDriver: true }),
          Animated.timing(shakeY, { toValue: 2, duration: 60, useNativeDriver: true }),
          Animated.timing(shakeY, { toValue: -2, duration: 60, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(rot, { toValue: 1, duration: 60, useNativeDriver: true }),
          Animated.timing(rot, { toValue: -1, duration: 60, useNativeDriver: true }),
          Animated.timing(rot, { toValue: 0, duration: 60, useNativeDriver: true }),
          Animated.timing(rot, { toValue: 1, duration: 60, useNativeDriver: true }),
          Animated.timing(rot, { toValue: -1, duration: 60, useNativeDriver: true }),
        ]),
      ])
    );
    shake.start();

    // Long fazers — horizontal speed lines whooshing right→left at different speeds
    const cfgs = [
      { idx: 0, dur: 600 },
      { idx: 1, dur: 800 },
      { idx: 2, dur: 600 },
      { idx: 3, dur: 500 },
    ];
    const animations = cfgs.map(({ idx, dur }) => {
      const anim = Animated.loop(
        Animated.timing(lines[idx], {
          toValue: -LINE_W,
          duration: dur,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      anim.start();
      return anim;
    });

    return () => {
      shake.stop();
      animations.forEach(a => a.stop());
    };
  }, []);

  const rotation = rot.interpolate({ inputRange: [-1, 1], outputRange: ['-1deg', '1deg'] });

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.line, { top: H * 0.20, transform: [{ translateX: lines[0] }] }]} />
      <Animated.View style={[styles.line, { top: H * 0.40, transform: [{ translateX: lines[1] }] }]} />
      <Animated.View style={[styles.line, { top: H * 0.60, transform: [{ translateX: lines[2] }] }]} />
      <Animated.View style={[styles.line, { top: H * 0.80, transform: [{ translateX: lines[3] }] }]} />

      <Animated.View
        style={[
          styles.speeder,
          { transform: [{ translateX: shakeX }, { translateY: shakeY }, { rotate: rotation }] },
        ]}
      >
        <Body />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: W,
    height: H,
    backgroundColor: BG,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: {
    position: 'absolute',
    left: 0,
    height: 2,
    width: LINE_W,
    backgroundColor: BLACK,
  },
  speeder: { position: 'absolute' },
});
