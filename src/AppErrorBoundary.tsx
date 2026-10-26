import React from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';

import { reportAppError } from './lib/appErrorReporter';

type Props = { children: React.ReactNode };
type State = { hasError: boolean };

// Catches render failures in the native shell (not inside the WebView page),
// reports them as RENDER_ERROR and shows a retry screen instead of a blank app.
export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportAppError({
      errorType: 'RENDER_ERROR',
      error,
      details: { componentStack: (info.componentStack ?? '').slice(0, 2000) },
    });
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <View style={styles.container}>
        <Text style={styles.title}>문제가 발생했습니다</Text>
        <Text style={styles.description}>잠시 후 다시 시도해주세요.</Text>
        <Button title="다시 시도" onPress={this.handleRetry} />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#ffffff',
  },
  title: {
    marginBottom: 8,
    color: '#111111',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  description: {
    marginBottom: 20,
    color: '#555555',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
});
