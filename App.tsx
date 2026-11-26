import React, { useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';

export default function App() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('ボタンを押して現在地を取得');
  const [loading, setLoading] = useState<boolean>(false);

  const getCurrentLocation = async () => {
    setLoading(true);
    setStatusMsg('位置情報の権限を確認中...');

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setStatusMsg('エラー: 位置情報の許可が拒否されました');
        setLoading(false);
        return;
      }

      setStatusMsg('GPS測位中...');
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      setLocation(current);
      setStatusMsg('取得成功！');
    } catch (error: any) {
      setStatusMsg(`取得エラー: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>AKJOL 道の駅ログ</Text>
      <Text style={styles.status}>{statusMsg}</Text>

      {loading && <ActivityIndicator size="large" color="#0f172a" style={{ marginVertical: 16 }} />}

      {location && (
        <View style={styles.card}>
          <Text style={styles.coord}>緯度: {location.coords.latitude.toFixed(6)}</Text>
          <Text style={styles.coord}>経度: {location.coords.longitude.toFixed(6)}</Text>
          <Text style={styles.sub}>精度: 約 {Math.round(location.coords.accuracy || 0)}m</Text>
        </View>
      )}

      <TouchableOpacity style={styles.button} onPress={getCurrentLocation} disabled={loading}>
        <Text style={styles.buttonText}>現在地を取得する</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#0f172a', marginBottom: 12 },
  status: { fontSize: 14, color: '#475569', marginBottom: 20, textAlign: 'center' },
  card: { backgroundColor: '#ffffff', padding: 20, borderRadius: 12, width: '100%', marginBottom: 24, elevation: 2 },
  coord: { fontSize: 18, fontWeight: '600', color: '#1e293b', marginBottom: 6 },
  sub: { fontSize: 13, color: '#64748b', marginTop: 4 },
  button: { backgroundColor: '#0f172a', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 8 },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: 'bold' },
});
