import React from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View
} from 'react-native';

function App(): React.JSX.Element {
  const isDarkMode = useColorScheme() === 'dark';

  const backgroundStyle = {
    backgroundColor: isDarkMode ? '#242424' : '#f0f0f0'
  };

  const textStyle = {
    color: isDarkMode ? '#ffffff' : '#000000'
  };

  return (
    <SafeAreaView style={[styles.container, backgroundStyle]}>
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
        backgroundColor={backgroundStyle.backgroundColor}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={backgroundStyle}>
        <View style={styles.header}>
          <Text style={[styles.title, textStyle]}>🏛️ 在地人 AI 導覽系統</Text>
          <Text style={[styles.subtitle, textStyle]}>Local AI Guide System</Text>
        </View>
        
        <View style={styles.content}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>歡迎使用</Text>
            <Text style={styles.cardText}>
              這是在地人 AI 導覽系統的行動應用程式。
              {'\n\n'}
              透過人工智慧技術，為您提供個人化的在地旅遊體驗。
            </Text>
          </View>
          
          <View style={styles.card}>
            <Text style={styles.cardTitle}>開發狀態</Text>
            <Text style={styles.cardText}>
              ✅ 應用程式已成功啟動
              {'\n'}
              ⚙️ 開發模式運行中
              {'\n'}
              📱 React Native v0.72.3
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  header: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.7,
    textAlign: 'center'
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 12
  },
  cardText: {
    fontSize: 16,
    lineHeight: 24,
    color: '#666666'
  }
});

export default App; 