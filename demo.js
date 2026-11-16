/**
 * demo.js — 津田沼 物件マップ 静的デモ版
 *
 * 集計済みの ./data.json を読んで描画するだけ。APIやサーバーへのアクセスは行わない
 * （外部通信は MapLibre のCDNと背景地図タイルのみ）。
 * data.json は scripts/build_demo_data.js が本体と同じ取得条件・集計ロジックで生成する。
 * 描画部分（ポップアップ・マーカー・凡例・地図設定）は js/app.js と同じ内容。
 */

const TSUDANUMA = { lng: 140.0197, lat: 35.6913 };
const DATA_URL = './data.json';

// ポップアップ HTML 生成
function buildPopupHtml(p) {
  return `
    <div class="popup-content">
      <h3>${p.name}</h3>
      <table>
        <tr><th>取引価格（中央値）</th><td><strong>${p.trade_price_man_yen_median.toLocaleString()} 万円</strong></td></tr>
        <tr><th>価格レンジ</th><td>${p.trade_price_man_yen_min.toLocaleString()} 〜 ${p.trade_price_man_yen_max.toLocaleString()} 万円</td></tr>
        <tr><th>面積（中央値）</th><td>${p.area_m2_median ?? '不明'} m²</td></tr>
        <tr><th>主な構造</th><td>${p.structure_mode ?? '不明'}</td></tr>
        <tr><th>取引件数</th><td>${p.transaction_count} 件</td></tr>
      </table>
    </div>
  `;
}

// マーカーを地図上に描画し、あとで消せるようマーカー配列を返す
function plotMarkers(map, properties, colorFor) {
  return properties.map((p) => {
    const el = document.createElement('div');
    el.className = 'property-marker';
    el.style.backgroundColor = colorFor(p.trade_price_man_yen_median);
    el.title = `${p.name} 中央値${p.trade_price_man_yen_median}万円`;

    const popup = new maplibregl.Popup({ offset: 12 }).setHTML(buildPopupHtml(p));

    return new maplibregl.Marker({ element: el })
      .setLngLat([p.point.lng, p.point.lat])
      .setPopup(popup)
      .addTo(map);
  });
}

// 凡例を動的生成（実データの4分位に基づく）
function buildLegend(breakpoints, colors) {
  const items = [
    { color: colors[0], label: `〜${breakpoints[0].toLocaleString()}万円` },
    { color: colors[1], label: `${breakpoints[0].toLocaleString()}〜${breakpoints[1].toLocaleString()}万円` },
    { color: colors[2], label: `${breakpoints[1].toLocaleString()}〜${breakpoints[2].toLocaleString()}万円` },
    { color: colors[3], label: `${breakpoints[2].toLocaleString()}万円〜` },
  ];
  const container = document.getElementById('legend-items');
  container.innerHTML = '';
  items.forEach(({ color, label }) => {
    const row = document.createElement('div');
    row.className = 'legend-row';
    row.innerHTML = `<span class="legend-dot" style="background:${color}"></span>${label}`;
    container.appendChild(row);
  });
}

// エントリポイント
async function main() {
  const map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        // 国土地理院 地理院タイル（淡色地図）。出典明示のみで申請不要（リアルタイム読み込み利用）。
        // 出典は「地理院タイル」と記載し、地理院タイル一覧ページへリンクする決まり。
        // https://maps.gsi.go.jp/development/ichiran.html
        gsi_pale: {
          type: 'raster',
          tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
          maxzoom: 18,
        },
      },
      layers: [{ id: 'gsi_pale', type: 'raster', source: 'gsi_pale' }],
    },
    // 淡色地図のズーム8以下は別途の出所明示（海岸線データ VMAP0）が必要になるため、
    // 追加表記が不要なズーム9以上に制限する。
    minZoom: 9,
    // 出典を常時表示する（狭い画面でも「i」ボタンに畳まない）
    attributionControl: { compact: false },
    center: [TSUDANUMA.lng, TSUDANUMA.lat],
    zoom: 14,
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  // 津田沼駅マーカー（基準点）
  const stationEl = document.createElement('div');
  stationEl.className = 'station-marker';
  stationEl.textContent = '🚉';
  new maplibregl.Marker({ element: stationEl })
    .setLngLat([TSUDANUMA.lng, TSUDANUMA.lat])
    .setPopup(new maplibregl.Popup().setText('津田沼駅'))
    .addTo(map);

  map.on('load', async () => {
    try {
      const res = await fetch(DATA_URL);
      if (!res.ok) throw new Error(`data.json: HTTP ${res.status}`);
      const data = await res.json();
      document.getElementById('fetched-date').textContent = data.fetchedDate;
      let currentMarkers = [];

      // 種別を切り替えるたびに、集計済みデータから色分け・凡例・マーカーを作り直す
      const render = (viewKey) => {
        currentMarkers.forEach((m) => m.remove());

        const { properties, breakpoints, colors, skippedNoCoord } = data.views[viewKey];
        const colorFor = (price) => {
          if (price < breakpoints[0]) return colors[0];
          if (price < breakpoints[1]) return colors[1];
          if (price < breakpoints[2]) return colors[2];
          return colors[3];
        };
        currentMarkers = plotMarkers(map, properties, colorFor);
        buildLegend(breakpoints, colors);

        const note = skippedNoCoord > 0 ? `（座標未登録の地区 ${skippedNoCoord}件は非表示）` : '';
        document.getElementById('count').textContent = `${properties.length}地区 表示中${note}`;
      };

      // ラジオボタンの value（all / 中古マンション等）が data.views のキーに対応する
      document.querySelectorAll('input[name="type-filter"]').forEach((radio) => {
        radio.addEventListener('change', (e) => render(e.target.value));
      });

      render('all');
    } catch (err) {
      console.error('デモデータ読み込みエラー:', err);
      document.getElementById('count').textContent = 'データ読み込み失敗';
    }
  });
}

// 「このデモについて」パネル。初回表示時だけ自動で開き、以降はヘッダーのボタンで再表示する。
function setupAbout() {
  const overlay = document.getElementById('about-overlay');
  const panel = document.getElementById('about-panel');
  const openBtn = document.getElementById('about-open');
  const SEEN_KEY = 'property-demo:about-seen';

  const open = () => {
    overlay.hidden = false;
    panel.focus();
  };
  const close = () => {
    overlay.hidden = true;
    // localStorage が使えない環境（プライベートブラウズ等）では毎回開くだけで、動作は妨げない
    try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* 無視 */ }
    openBtn.focus();
  };

  openBtn.addEventListener('click', open);
  document.getElementById('about-close').addEventListener('click', close);
  document.getElementById('about-ok').addEventListener('click', close);
  // 背景（パネルの外側）のクリックでも閉じる
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) close();
  });

  let seen = false;
  try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { /* 無視 */ }
  if (!seen) open();
}

setupAbout();
main();
