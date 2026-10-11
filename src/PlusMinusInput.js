import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';

export default function PlusMinusInput({ value, onChange, step = 1, placeholder, autoFocus, compact = false }) {
  function adjust(delta) {
    const current = parseFloat(value) || 0;
    const next = Math.max(0, parseFloat((current + delta).toFixed(1)));
    onChange(String(next));
  }

  const btnStyle = compact ? styles.btnCompact : styles.btn;
  const inputStyle = compact ? styles.inputCompact : styles.input;

  return (
    <View style={styles.row}>
      <TouchableOpacity style={btnStyle} onPress={() => adjust(-step)}>
        <Text style={compact ? styles.btnTextCompact : styles.btnText}>−</Text>
      </TouchableOpacity>
      <TextInput
        style={inputStyle}
        keyboardType="decimal-pad"
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        returnKeyType="done"
      />
      <TouchableOpacity style={btnStyle} onPress={() => adjust(step)}>
        <Text style={compact ? styles.btnTextCompact : styles.btnText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 8 },
  btnCompact: {
    width: 38, height: 56,
    borderRadius: 10, borderWidth: 1.5, borderColor: '#E8E8E8',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff',
  },
  btnTextCompact: { fontSize: 20, fontWeight: '600', color: '#1A1A1A', lineHeight: 24 },
  inputCompact: {
    flex: 1, height: 56,
    borderWidth: 1.5, borderColor: '#E8E8E8', borderRadius: 10,
    fontSize: 28, fontWeight: '700', color: '#1A1A1A',
    textAlign: 'center', backgroundColor: '#FAFAFA',
    includeFontPadding: false,
    paddingHorizontal: 0,
  },
  btn: {
    width: 52, height: 72,
    borderRadius: 12, borderWidth: 1.5, borderColor: '#E8E8E8',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff',
  },
  btnText: { fontSize: 24, fontWeight: '600', color: '#1A1A1A', lineHeight: 28 },
  input: {
    flex: 1, height: 72,
    borderWidth: 1.5, borderColor: '#E8E8E8', borderRadius: 10,
    fontSize: 36, fontWeight: '700', color: '#1A1A1A',
    textAlign: 'center', backgroundColor: '#FAFAFA',
    includeFontPadding: false,
  },
});
