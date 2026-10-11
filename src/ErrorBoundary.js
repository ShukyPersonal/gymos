import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { SHEETS_WEBHOOK } from './storage';
import { log as glog } from './logger';

export async function reportCrash(error, context = '') {
  // Mirror into the session log too — the Crashes tab is a separate private
  // spreadsheet, while the Logs stream is what gets pulled for diagnosis
  // (and survives crashes via syncDanglingSessions).
  try {
    glog('crash', error?.message || String(error), {
      stack: String(error?.stack || '').slice(0, 500),
      context: String(context).slice(0, 200),
    });
  } catch (_) {}
  try {
    await fetch(SHEETS_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'crash',
        error: error?.message || String(error),
        stack: error?.stack || '',
        context,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (_) {}
}

export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportCrash(error, info?.componentStack || '');
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.subtitle}>The error has been reported.</Text>
        <ScrollView style={styles.errorBox}>
          <Text style={styles.errorText}>{this.state.error?.message}</Text>
        </ScrollView>
        <TouchableOpacity style={styles.btn} onPress={() => this.setState({ error: null })}>
          <Text style={styles.btnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 32, justifyContent: 'center', backgroundColor: '#FAFAFA' },
  title: { fontSize: 22, fontWeight: '700', color: '#1A1A1A', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#888', marginBottom: 24 },
  errorBox: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 24, maxHeight: 150 },
  errorText: { fontSize: 13, color: '#c00', fontFamily: 'monospace' },
  btn: { backgroundColor: '#1A1A1A', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
