import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Modal,
  TextInput,
  SafeAreaView,
  Linking,
  Alert,
} from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import stationsData from './assets/stations.json';

type Station = {
  id: string;
  name: string;
  pref: string;
  address?: string;
  lat: number;
  lng: number;
  distance?: number;
};

type VisitRecord = {
  visitedAt: string;
  memo: string;
  auto?: boolean;
};

const ALL_STATIONS: Station[] = stationsData as Station[];
const STORAGE_KEY = '@akjol_michinoeki_visits_v1';
const GEOFENCE_TASK_NAME = 'AKJOL_MICHINOEKI_GEOFENCE_TASK';

// 通知の表示設定（フォアグラウンドでも通知バーに出す）
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// 【バックグラウンドタスク定義】アプリを閉じていてもOSから自動起動される処理
TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data, error }: any) => {
  if (error) {
    console.error('ジオフェンスエラー:', error);
    return;
  }
  if (data?.eventType === Location.GeofencingEventType.Enter) {
    const region = data.region;
    const stationId = region?.identifier;
    if (!stationId) return;

    const station = ALL_STATIONS.find((s) => s.id === stationId);
    if (!station) return;

    try {
      const savedRaw = await AsyncStorage.getItem(STORAGE_KEY);
      const visits: Record<string, VisitRecord> = savedRaw ? JSON.parse(savedRaw) : {};

      // 未訪問の道の駅であれば自動チェックイン＆通知を発行
      if (!visits[stationId]) {
        const today = new Date().toISOString().split('T')[0];
        visits[stationId] = {
          visitedAt: today,
          memo: '（自動チェックイン）',
          auto: true,
        };
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(visits));

        await Notifications.scheduleNotificationAsync({
          content: {
            title: `🚗 ${station.name} に到着！`,
            body: `${station.pref}の道の駅に自動チェックインしました。`,
          },
          trigger: null,
        });
      }
    } catch (e) {
      console.error('自動チェックイン保存エラー:', e);
    }
  }
});

function calcDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function App() {
  const [stations, setStations] = useState<Station[]>(ALL_STATIONS);
  const [visits, setVisits] = useState<Record<string, VisitRecord>>({});
  const [statusMsg, setStatusMsg] = useState<string>(`全国 ${ALL_STATIONS.length} 駅内蔵済`);
  const [loading, setLoading] = useState<boolean>(false);
  const [geofenceActive, setGeofenceActive] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [onlyVisited, setOnlyVisited] = useState<boolean>(false);

  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [memoText, setMemoText] = useState<string>('');

  const loadVisits = async () => {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) setVisits(JSON.parse(saved));
    } catch (e) {
      console.error('履歴読込エラー', e);
    }
  };

  useEffect(() => {
    loadVisits();
    (async () => {
      const isRunning = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME);
      setGeofenceActive(isRunning);
    })();
  }, []);

  // 周囲60駅のジオフェンスをOSに登録する省電力監視セットアップ
  const registerNearbyGeofences = async (lat: number, lng: number, sortedList: Station[]) => {
    try {
      const { status: notifStatus } = await Notifications.requestPermissionsAsync();
      if (notifStatus !== 'granted') {
        Alert.alert('通知権限', '自動チェックイン時に通知を受け取るには通知を許可してください。');
      }

      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus !== 'granted') {
        Alert.alert(
          'バックグラウンド位置情報',
          'アプリを閉じた状態で自動チェックインするには、位置情報設定で「常に許可」を選択してください。'
        );
        return false;
      }

      // Androidの上限（100件）以内に収めるため、現在地から近い上位60駅のみ登録（半径300m）
      const targets = sortedList.slice(0, 60).map((st) => ({
        identifier: st.id,
        latitude: st.lat,
        longitude: st.lng,
        radius: 300,
        notifyOnEnter: true,
        notifyOnExit: false,
      }));

      await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, targets);
      setGeofenceActive(true);
      return true;
    } catch (e: any) {
      console.error('ジオフェンス登録エラー:', e);
      return false;
    }
  };

  const toggleGeofence = async () => {
    if (geofenceActive) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME);
      setGeofenceActive(false);
      setStatusMsg('自動チェックイン監視を停止しました');
    } else {
      await searchNearbyAndSyncGeofence(true);
    }
  };

  const searchNearbyAndSyncGeofence = async (forceEnableGeofence = false) => {
    setLoading(true);
    setStatusMsg('位置情報の権限を確認中...');

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setStatusMsg('エラー: 位置情報の許可が必要です');
        setLoading(false);
        return;
      }

      // 最新の履歴も再読込（バックグラウンド自動チェックイン分を反映）
      await loadVisits();

      let loc = await Location.getLastKnownPositionAsync({
        maxAge: 180000,
        requiredAccuracy: 150,
      });

      let sourceLabel = 'キャッシュ測位';
      if (!loc) {
        setStatusMsg('省電力モードで現在地を取得中...');
        loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        sourceLabel = '新規バランス測位';
      }

      const { latitude, longitude } = loc.coords;

      const withDist = ALL_STATIONS.map((st) => ({
        ...st,
        distance: calcDistanceKm(latitude, longitude, st.lat, st.lng),
      })).sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999));

      setStations(withDist);
      setSearchQuery('');
      setOnlyVisited(false);

      if (geofenceActive || forceEnableGeofence) {
        const ok = await registerNearbyGeofences(latitude, longitude, withDist);
        if (ok) {
          setStatusMsg(`更新完了（${sourceLabel}・周囲60駅を自動監視中）`);
        } else {
          setStatusMsg(`更新完了（${sourceLabel}・自動監視は未許可）`);
        }
      } else {
        setStatusMsg(`更新完了（${sourceLabel}）`);
      }
    } catch (err: any) {
      setStatusMsg(`取得エラー: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const displayedStations = useMemo(() => {
    let list = stations;
    if (onlyVisited) {
      list = list.filter((st) => !!visits[st.id]);
    }
    if (searchQuery.trim() !== '') {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (st) =>
          st.name.toLowerCase().includes(q) ||
          st.pref.toLowerCase().includes(q) ||
          (st.address && st.address.toLowerCase().includes(q))
      );
    }
    return list.slice(0, 60);
  }, [stations, visits, searchQuery, onlyVisited]);

  const openGoogleMaps = (st: Station) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${st.lat},${st.lng}`;
    Linking.openURL(url);
  };

  const openVisitModal = (station: Station) => {
    setSelectedStation(station);
    setMemoText(visits[station.id]?.memo || '');
  };

  const saveVisit = async () => {
    if (!selectedStation) return;
    const today = new Date().toISOString().split('T')[0];
    const updated: Record<string, VisitRecord> = {
      ...visits,
      [selectedStation.id]: {
        visitedAt: visits[selectedStation.id]?.visitedAt || today,
        memo: memoText.trim(),
      },
    };
    setVisits(updated);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setSelectedStation(null);
  };

  const removeVisit = async () => {
    if (!selectedStation) return;
    const updated = { ...visits };
    delete updated[selectedStation.id];
    setVisits(updated);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setSelectedStation(null);
  };

  const visitedCount = Object.keys(visits).length;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.title}>AKJOL 道の駅ログ</Text>
          <Text style={styles.counter}>
            制覇: {visitedCount} / {ALL_STATIONS.length} 駅
          </Text>
        </View>
        <Text style={styles.status}>{statusMsg}</Text>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.searchBtn, { flex: 1 }]}
            onPress={() => searchNearbyAndSyncGeofence(false)}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.searchBtnText}>現在地から検索</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.geoBtn, geofenceActive && styles.geoBtnActive]}
            onPress={toggleGeofence}
            disabled={loading}
          >
            <Text style={styles.geoBtnText}>
              {geofenceActive ? '自動監視: ON' : '自動監視: OFF'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.filterRow}>
          <TextInput
            style={styles.filterInput}
            placeholder="駅名・都道府県で検索（例：岐阜、群馬）"
            placeholderTextColor="#94a3b8"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <TouchableOpacity
            style={[styles.visitedFilterBtn, onlyVisited && styles.visitedFilterBtnActive]}
            onPress={() => setOnlyVisited(!onlyVisited)}
          >
            <Text style={styles.visitedFilterText}>{onlyVisited ? '訪問済のみ' : 'すべて'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={displayedStations}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const visit = visits[item.id];
          return (
            <View style={[styles.card, visit && styles.cardVisited]}>
              <TouchableOpacity style={{ flex: 1 }} onPress={() => openVisitModal(item)}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pref}>{item.pref}</Text>
                    <Text style={styles.stationName}>{item.name}</Text>
                  </View>
                  {item.distance !== undefined && (
                    <View style={styles.distBadge}>
                      <Text style={styles.distText}>{item.distance.toFixed(1)} km</Text>
                    </View>
                  )}
                </View>

                {visit ? (
                  <View style={styles.visitBox}>
                    <Text style={styles.visitDate}>✓ 訪問日: {visit.visitedAt}</Text>
                    {visit.memo ? <Text style={styles.visitMemo}>{visit.memo}</Text> : null}
                  </View>
                ) : (
                  <Text style={styles.unvisitedText}>タップして訪問記録・車中泊メモを追加</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.navBtn} onPress={() => openGoogleMaps(item)}>
                <Text style={styles.navBtnText}>Googleマップで経路案内</Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />

      <Modal visible={!!selectedStation} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>{selectedStation?.name}</Text>
            <Text style={styles.modalLabel}>車中泊・駐車場・温泉などのメモ:</Text>
            <TextInput
              style={styles.input}
              placeholder="例：駐車場フラットで静か。トイレ綺麗。温泉併設。"
              value={memoText}
              onChangeText={setMemoText}
              multiline
            />
            <View style={styles.modalButtons}>
              {selectedStation && visits[selectedStation.id] && (
                <TouchableOpacity style={styles.delBtn} onPress={removeVisit}>
                  <Text style={styles.delBtnText}>記録削除</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setSelectedStation(null)}>
                <Text style={styles.cancelBtnText}>閉じる</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveVisit}>
                <Text style={styles.saveBtnText}>訪問済で保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  header: { backgroundColor: '#0f172a', padding: 16, paddingTop: 40 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#ffffff' },
  counter: { fontSize: 13, color: '#38bdf8', fontWeight: 'bold' },
  status: { fontSize: 12, color: '#94a3b8', marginTop: 4, marginBottom: 10 },
  actionRow: { flexDirection: 'row', gap: 8 },
  searchBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: 'center',
  },
  searchBtnText: { color: '#ffffff', fontWeight: 'bold', fontSize: 14 },
  geoBtn: {
    backgroundColor: '#475569',
    paddingHorizontal: 14,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  geoBtnActive: { backgroundColor: '#059669' },
  geoBtnText: { color: '#ffffff', fontWeight: 'bold', fontSize: 13 },
  filterRow: { flexDirection: 'row', marginTop: 10, gap: 8 },
  filterInput: {
    flex: 1,
    backgroundColor: '#1e293b',
    color: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    fontSize: 13,
  },
  visitedFilterBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: 8,
  },
  visitedFilterBtnActive: { backgroundColor: '#10b981' },
  visitedFilterText: { color: '#ffffff', fontSize: 12, fontWeight: 'bold' },
  listContent: { padding: 12 },
  card: {
    backgroundColor: '#ffffff',
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#cbd5e1',
    elevation: 1,
  },
  cardVisited: { borderLeftColor: '#10b981', backgroundColor: '#f0fdf4' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  pref: { fontSize: 11, color: '#64748b' },
  stationName: { fontSize: 16, fontWeight: 'bold', color: '#1e293b', marginTop: 2 },
  distBadge: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginLeft: 8,
  },
  distText: { fontSize: 13, fontWeight: 'bold', color: '#0f172a' },
  visitBox: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#dcfce7' },
  visitDate: { fontSize: 12, fontWeight: 'bold', color: '#059669' },
  visitMemo: { fontSize: 13, color: '#334155', marginTop: 4 },
  unvisitedText: { fontSize: 12, color: '#94a3b8', marginTop: 8 },
  navBtn: {
    marginTop: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  navBtnText: { fontSize: 12, fontWeight: 'bold', color: '#2563eb' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalBox: { backgroundColor: '#ffffff', borderRadius: 12, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#0f172a', marginBottom: 12 },
  modalLabel: { fontSize: 13, color: '#475569', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 10,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  saveBtn: { backgroundColor: '#10b981', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6 },
  saveBtnText: { color: '#ffffff', fontWeight: 'bold' },
  cancelBtn: { backgroundColor: '#e2e8f0', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 6 },
  cancelBtnText: { color: '#334155', fontWeight: 'bold' },
  delBtn: { backgroundColor: '#fee2e2', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 6, marginRight: 'auto' },
  delBtnText: { color: '#dc2626', fontWeight: 'bold' },
});
