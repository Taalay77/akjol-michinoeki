import fs from 'fs';
import path from 'path';

// 国土交通省 国土数値情報（道の駅データ）の公式GitHubミラー / 公開GeoJSONソース
// ※万が一URL変更等で取得失敗した場合はフォールバックデータでビルドを止めない安全設計
const DATA_URL = 'https://raw.githubusercontent.com/niiyz/JapanCityGeoJson/master/michinoeki.json';
const FALLBACK_URL = 'https://raw.githubusercontent.com/geolonia/japanese-admins/master/data/prefectures.json';

async function main() {
  console.log('全国の道の駅データを取得中...');
  const outDir = path.join(process.cwd(), 'assets');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  try {
    // 全国の道の駅オープンデータ（約1,200駅）を取得
    const res = await fetch('https://raw.githubusercontent.com/yuiseki/michinoeki-geojson/main/michinoeki.geojson');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson = await res.json();

    const stations = geojson.features
      .map((f, idx) => {
        const props = f.properties || {};
        const coords = f.geometry?.coordinates || [];
        const name = props.P35_006 || props.name || props['名称'] || '';
        const pref = props.P35_003 || props.pref || props['都道府県'] || '';
        const address = props.P35_004 || props.address || props['所在地'] || '';
        const lng = Number(coords[0]);
        const lat = Number(coords[1]);

        if (!name || isNaN(lat) || isNaN(lng)) return null;
        return {
          id: `m-${idx}-${name}`,
          name: name.startsWith('道の駅') ? name : `道の駅 ${name}`,
          pref,
          address,
          lat: Number(lat.toFixed(5)),
          lng: Number(lng.toFixed(5)),
        };
      })
      .filter(Boolean);

    if (stations.length < 100) {
      throw new Error('取得件数が少なすぎるためフォールバックへ移行');
    }

    fs.writeFileSync(path.join(outDir, 'stations.json'), JSON.stringify(stations));
    console.log(`成功: 全国 ${stations.length} 駅のデータを assets/stations.json に保存しました`);
  } catch (err) {
    console.warn('外部GeoJSON取得エラー、初期データでフォールバックします:', err.message);
    const fallback = [
      { id: 'gifu-ikeda', name: '道の駅 池田温泉', pref: '岐阜県', address: '岐阜県揖斐郡池田町片山1953-1', lat: 35.4419, lng: 136.5564 },
      { id: 'shiga-ibuki', name: '道の駅 伊吹の里', pref: '滋賀県', address: '滋賀県米原市伊吹1732-1', lat: 35.3886, lng: 136.3761 },
      { id: 'gifu-nannou', name: '道の駅 月見の里 南濃', pref: '岐阜県', address: '岐阜県海津市南濃町羽沢673-1', lat: 35.2289, lng: 136.6156 },
    ];
    fs.writeFileSync(path.join(outDir, 'stations.json'), JSON.stringify(fallback));
  }
}

main();
