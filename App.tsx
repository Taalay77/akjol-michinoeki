import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Station = {
  id: string;
  name: string;
  pref: string;
  lat: number;
  lng: number;
  distance?: number;
};

type VisitRecord = {
  visitedAt: string;
  memo: string;
};

// 関ヶ原周辺の主要道の駅データ（テスト＆実用初期データ）
const STATIONS: Station[] = [
  { id: 'gifu-ikeda', name: '道の駅 池田温泉', pref: '岐阜県', lat: 35.4419, lng: 136.5564 },
  { id: 'shiga-ibuki', name: '道の駅 伊吹の里 旬彩の森', pref: '滋賀県', lat: 35.3886, lng: 136.3761 },
  { id: 'gifu-nannou', name: '道の駅 月見の里 南濃', pref: '岐阜県', lat: 35.2289, lng: 136.6156 },
  { id: 'shiga-azai', name: '道の駅 浅井三姉妹の郷', pref: '滋賀県', lat: 35.4483, lng: 136.3144 },
  { id: 'shiga-koura', name: '道の駅 せせらぎの里こうら', pref: '滋賀県', lat: 35.1972, lng: 136.2694 },
  { id: 'gifu-kurohone', name: '道の駅 織部の里もとす', pref: '岐阜県', lat: 35.4856, lng: 136.6639 },
  { id: 'gifu-yoro', name: '道の駅 養老ランド（周辺・養老SAスマートIC付近）', pref: '岐阜県', lat: 35.2917, lng: 136.5514 },
  { id: 'shiga-kohoku', name: '道の駅 湖北みずどりステーション', pref: '滋賀県', lat: 35.4411, lng: 136.2014 },
  { id: 'shiga-hikone', name: '道の駅 彦根港（周辺・東近江あいとうマーガレット）', pref: '滋賀県', lat: 35.1389, lng: 136.2306 },
  { id: 'gifu-tanigumi', name: '道の駅 夢さんさん谷汲', pref: '岐阜県', lat: 35.5186, lng: 136.6053 },
  { id: 'gifu-kremers', name: '道の駅 クレール平田', pref: '岐阜県', lat: 35.2422, lng: 136.6667 },
  { id: 'mie-inabe', name: '道の駅 いなべ（周辺・永源寺渓流の里）', pref: '滋賀県', lat: 35.0844, lng: 136.3264 },
];

const STORAGE_KEY = '@akjol_michinoeki_visits_v1';

// 2点間の直線距離（km）を計算するヒュベニの簡易公式（Haversine）
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
  const [sortedStations, setSortedStations] = useState<Station[]>(STATIONS);
  const [visits, setVisits] = useState<Record<string, VisitRecord>>({});
  const [statusMsg, setStatusMsg] = useState<string>('「現在地から検索」で近い順に並び替えます');
  const [loading, setLoading] = useState<boolean>(false);

  // メモ編集モーダル用
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [memoText, setMemoText] = useState<string>('');

  // 初回起動時に保存済みの訪問履歴を読み込む
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved) setVisits(JSON.parse(saved));
      } catch (e) {
        console.error('履歴読込エラー', e);
      }
    })();
  }, []);

  // バッテリー消費を極限まで抑えた省電力位置取得
  const searchNearby = async () => {
    setLoading(true);
    setStatusMsg('位置情報の権限を確認中...');

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setStatusMsg('エラー: 位置情報の許可が必要です');
        setLoading(false);
        return;
      }

      // 1. まず消費電力ゼロの端末キャッシュ（直近3分以内・精度150m以内）を確認
      let loc = await Location.getLastKnownPositionAsync({
        maxAge: 180000,
        requiredAccuracy: 150,
      });

      let sourceLabel = 'キャッシュ測位（省電力）';

      // 2. キャッシュが古いか無い場合のみ、省電力バランスモード（Balanced）で1回だけ測位
      if (!loc) {
        setStatusMsg('省電力モードで現在地を取得中...');
        loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        sourceLabel = '新規バランス測位（節電）';
      }

      const { latitude, longitude } = loc.coords;

      // 距離計算して近い順にソート
      const withDist = STATIONS.map((st) => ({
        ...st,
        distance: calcDistanceKm(latitude, longitude, st.lat, st.lng),
      })).sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999));

      setSortedStations(withDist);
      setStatusMsg(`更新完了（${sourceLabel}）`);
    } catch (err: any) {
      setStatusMsg(`取得エラー: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 訪問記録の保存
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
            訪問済: {visitedCount} / {STATIONS.length} 駅
          </Text>
        </View>
        <Text style={styles.status}>{statusMsg}</Text>
        <TouchableOpacity style={styles.searchBtn} onPress={searchNearby} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.searchBtnText}>現在地から近い順に検索（省電力）</Text>
          )}
        </TouchableOpacity>
      </View>

      <FlatList
        data={sortedStations}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const visit = visits[item.id];
          return (
            <TouchableOpacity
              style={[styles.card, visit && styles.cardVisited]}
              onPress={() => openVisitModal(item)}
            >
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
          );
        }}
      />

      {/* 訪問チェック・メモ入力モーダル */}
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
  status: { fontSize: 12, color: '#94a3b8', marginTop: 4, marginBottom: 12 },
  searchBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  searchBtnText: { color: '#ffffff', fontWeight: 'bold', fontSize: 15 },
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
