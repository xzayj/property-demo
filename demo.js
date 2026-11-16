/**
 * demo.js — 津田沼 物件マップ 静的デモ版
 *
 * 集計済みの ./data.json を読んで描画するだけ。APIやサーバーへのアクセスは行わない
 * （外部通信は MapLibre のCDNと背景地図タイルのみ）。
 * data.json は scripts/build_demo_data.js が本体と同じ取得条件・集計ロジックで生成する。
 * areas.json（エリア表示・試作）は scripts/analysis/build_demo_areas.py が生成する。
 * 描画部分（ポップアップ・マーカー・凡例・地図設定）は js/app.js と同じ内容。
 */

const TSUDANUMA = { lng: 140.0197, lat: 35.6913 };
const DATA_URL = './data.json';
const AREAS_URL = './areas.json';

// エリアの色。エリアIDに固定で割り当てる（エリア数が変わっても同じIDは同じ色）。
// 色覚特性によっては緑と赤が近く見えるため、マーカーと凡例にはエリア記号の文字も必ず出す。
const AREA_STYLE = {
  A: { bg: '#2a78d6', ink: '#fff' },
  B: { bg: '#e34948', ink: '#fff' },
  C: { bg: '#1baf7a', ink: '#10231c' },
  D: { bg: '#eda100', ink: '#2b1f00' },
  E: { bg: '#6250d6', ink: '#fff' },
  F: { bg: '#e87ba4', ink: '#2b0f1a' },
};
const FALLBACK_AREA_STYLE = { bg: '#777', ink: '#fff' };
const areaStyle = (id) => AREA_STYLE[id] || FALLBACK_AREA_STYLE;

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

const VERDICT_MARK = { match: '✓ 一致', mismatch: '✗ 不一致', unsupported: '✗ 規則なし' };

// エリアの説明パネルの中身。照合結果は areas.json の内容をそのまま出す（不一致も隠さない）。
function buildAreaPanelHtml(areasDoc, area, district) {
  const st = areaStyle(area.id);
  const v = area.verification;
  const allMatch = v.n_match === v.n_claims;
  const claims = v.claims.map((c) => `
    <li class="${esc(c.verdict)}">
      <span class="mark">${VERDICT_MARK[c.verdict] || esc(c.verdict)}</span>
      <span>${esc(c.label)}<small>実際: ${esc(c.observed)}／規則: ${esc(c.rule)}</small></span>
    </li>`).join('');
  const rows = areasDoc.index_variables.map((iv) => `
    <tr>
      <td>${esc(iv.label)}</td>
      <td>${area.index[iv.key].toFixed(1)}</td>
      <td>${area.values[iv.key].toFixed(1)} ${esc(iv.unit)}</td>
      <td>${areasDoc.overall[iv.key].toFixed(1)} ${esc(iv.unit)}</td>
    </tr>`).join('');
  const picked = district
    ? `<div class="picked-district">選択した地区: ${esc(district.name)}（㎡単価中央値 ${district.unit_price_median.toFixed(1)}万円/㎡・${district.n}件）</div>`
    : '';
  return `
    <span class="panel-proto">${esc(areasDoc.status)}</span>
    <h3><span class="area-chip" style="background:${st.bg};color:${st.ink}">${esc(area.id)}</span>エリア${esc(area.id)}
      <small>${area.n_districts}地区・取引${area.n_records}件</small></h3>
    ${picked}
    <p class="area-text">${esc(area.text)}</p>
    <div class="check-summary ${allMatch ? 'all-match' : 'has-mismatch'}">
      <span aria-hidden="true">${allMatch ? '✓' : '⚠'}</span>
      データ照合: ${v.n_claims}件中${v.n_match}件一致
    </div>
    <details${allMatch ? '' : ' open'}>
      <summary>照合の内訳（説明文が依拠する主張 ${v.n_claims}件）</summary>
      <ul class="claim-list">${claims}</ul>
    </details>
    <details>
      <summary>指標スコア（全体＝100）</summary>
      <table>
        <tr><th></th><th>指標</th><th>エリア中央値</th><th>全体中央値</th></tr>
        ${rows}
      </table>
    </details>
    <details>
      <summary>所属地区（${area.n_districts}）</summary>
      <p class="member-list">${area.districts.map(esc).join('、')}</p>
    </details>
    <p class="panel-foot">
      説明文は ${esc(areasDoc.generation.model)} が ${esc(areasDoc.generation.date)} に生成。
      照合は規則ベースのスクリプトによる（照合しているのは説明文から取り出した主張リストで、文そのものではありません）。
      エリアの分け方・説明文・照合規則はいずれも検討中のものです。
    </p>`;
}

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
      let currentType = 'all';

      // 種別を切り替えるたびに、集計済みデータから色分け・凡例・マーカーを作り直す
      const render = (viewKey) => {
        currentType = viewKey;
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

      // ---- エリア表示（試作） ----
      // areas.json が読めなくても地区表示はそのまま使えるよう、失敗時は切替ボタンを無効のままにする。
      const modeButtons = document.querySelectorAll('#mode-toggle button');
      const areaButton = document.querySelector('#mode-toggle button[data-mode="area"]');
      const panel = document.getElementById('area-panel');
      const panelBody = document.getElementById('area-panel-body');
      const legendTitle = document.getElementById('legend-title');
      const legendNote = document.getElementById('area-legend-note');
      const typeFilter = document.getElementById('type-filter');
      const districtLegendTitle = legendTitle.textContent;
      let areasDoc = null;
      let areaMarkerEls = [];

      // 指定した地区群が画面に収まるよう地図を動かす（スマホでは下のパネル・凡例の分だけ余白を広くとる）
      const fitToDistricts = (districts) => {
        const bounds = new maplibregl.LngLatBounds();
        districts.forEach((d) => bounds.extend([d.lng, d.lat]));
        const narrow = window.innerWidth <= 600;
        map.fitBounds(bounds, {
          padding: narrow
            ? { top: 60, bottom: Math.round(map.getContainer().clientHeight * 0.55), left: 30, right: 30 }
            : { top: 70, bottom: 60, left: 380, right: 60 },
          maxZoom: 14,
          duration: 500,
        });
      };

      const selectArea = (areaId, district = null) => {
        const area = areasDoc.areas.find((a) => a.id === areaId);
        // 凡例から選んだときは、そのエリア全体が見える位置へ移動する
        if (district === null) fitToDistricts(areasDoc.districts.filter((d) => d.area_id === areaId));
        panelBody.innerHTML = buildAreaPanelHtml(areasDoc, area, district);
        panel.hidden = false;
        panel.scrollTop = 0;
        areaMarkerEls.forEach(({ el, d }) => {
          el.classList.toggle('dimmed', d.area_id !== areaId);
          el.classList.toggle('picked', district !== null && d.name === district.name);
        });
        document.querySelectorAll('.area-legend-row').forEach((row) => {
          row.setAttribute('aria-pressed', String(row.dataset.area === areaId));
        });
      };
      const clearArea = () => {
        panel.hidden = true;
        areaMarkerEls.forEach(({ el }) => el.classList.remove('dimmed', 'picked'));
        document.querySelectorAll('.area-legend-row').forEach((row) => row.setAttribute('aria-pressed', 'false'));
      };
      document.getElementById('area-panel-close').addEventListener('click', clearArea);

      const renderAreas = () => {
        currentMarkers.forEach((m) => m.remove());
        areaMarkerEls = [];
        currentMarkers = areasDoc.districts.map((d) => {
          const st = areaStyle(d.area_id);
          const el = document.createElement('div');
          el.className = 'area-marker';
          el.style.backgroundColor = st.bg;
          el.style.color = st.ink;
          el.textContent = d.area_id;
          el.title = `${d.name}（エリア${d.area_id}）`;
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            selectArea(d.area_id, d);
          });
          areaMarkerEls.push({ el, d });
          return new maplibregl.Marker({ element: el }).setLngLat([d.lng, d.lat]).addTo(map);
        });

        fitToDistricts(areasDoc.districts);

        legendTitle.textContent = 'エリア（試作）';
        const container = document.getElementById('legend-items');
        container.innerHTML = '';
        areasDoc.areas.forEach((a) => {
          const st = areaStyle(a.id);
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'area-legend-row';
          row.dataset.area = a.id;
          row.setAttribute('aria-pressed', 'false');
          row.innerHTML = `<span class="area-chip" style="background:${st.bg};color:${st.ink}">${esc(a.id)}</span>エリア${esc(a.id)}（${a.n_districts}地区）`;
          row.addEventListener('click', () => selectArea(a.id));
          container.appendChild(row);
        });
        const s = areasDoc.verification_summary;
        legendNote.innerHTML = `<strong>${esc(areasDoc.status)}</strong><br>`
          + `対象: ${esc(areasDoc.data.type)}の取引が${areasDoc.data.min_records_per_district}件以上ある${areasDoc.data.n_districts}地区。`
          + `エリアをクリックすると説明文を表示します。<br>`
          + `データ照合（全エリア計）: ${s.n_claims}件中${s.n_match}件一致`;
        legendNote.hidden = false;
        typeFilter.hidden = true;
        document.getElementById('count').textContent =
          `${areasDoc.districts.length}地区・${areasDoc.areas.length}エリア 表示中（試作）`;
      };

      const setMode = (mode) => {
        modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
        clearArea();
        if (mode === 'area') {
          renderAreas();
        } else {
          legendTitle.textContent = districtLegendTitle;
          legendNote.hidden = true;
          typeFilter.hidden = false;
          render(currentType);
        }
      };
      modeButtons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

      try {
        const areasRes = await fetch(AREAS_URL);
        if (!areasRes.ok) throw new Error(`areas.json: HTTP ${areasRes.status}`);
        areasDoc = await areasRes.json();
        areaButton.disabled = false;
      } catch (err) {
        console.error('エリアデータ読み込みエラー:', err);
        areaButton.title = 'エリアデータを読み込めませんでした';
      }
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
