// Logica pura: lettura testo, conversione coordinate, creazione GPX/KML
(function (root) {
  const MM = 12.452333333; // Monte Mario da Greenwich (12°27'08.4")
  const TOW = {
    roma40: '+ellps=intl +towgs84=-104.1,-49.1,-9.9,0.971,-2.917,0.714,-11.68',
    ed50: '+ellps=intl +towgs84=-87,-98,-121,0,0,0,0',
    wgs84: '+datum=WGS84'
  };

  // Corregge errori tipici dell'OCR dentro i numeri (O→0, l/I→1, S→5, B→8)
  function fixDigits(line) {
    let s = line.replace(/[“”″]/g, '"').replace(/[‘’′`´]/g, "'").replace(/[º˚]/g, '°');
    // lettere scambiate per cifre quando stanno tra cifre
    for (let k = 0; k < 2; k++) {
      s = s.replace(/(\d)[Oo](?=[\d\s.,]|$)/g, '$10')
           .replace(/(\d)[lI|](?=[\d\s.,]|$)/g, '$11')
           .replace(/(\d)S(?=\d)/g, '$15')
           .replace(/(\d)B(?=\d)/g, '$18');
    }
    return s;
  }

  function parseNum(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    let s = String(v).trim();
    const d = dmsToDec(s);
    if (d != null) return d;
    s = s.replace(/\s/g, '');
    if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    s = s.replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  const DMS_RE = /(-)?(\d{1,3})\s*[°o*]\s*(\d{1,2}(?:[.,]\d+)?)\s*'?\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:"|'')?)?\s*([NSEWO])?/g;
  function dmsToDec(s) {
    DMS_RE.lastIndex = 0;
    const m = DMS_RE.exec(s);
    if (!m || m.index !== 0 && s.slice(0, m.index).trim()) return null;
    let d = +m[2] + parseFloat(m[3].replace(',', '.')) / 60 + (m[4] ? parseFloat(m[4].replace(',', '.')) / 3600 : 0);
    if (m[1] || /[SWO]/.test(m[5] || '')) d = -d;
    return d;
  }

  // Estrae i punti da testo (incollato, OCR o PDF)
  function parseText(text) {
    const out = [];
    let pending = '', curZone = '';
    const lines = String(text).split(/\r?\n/);
    for (const raw of lines) {
      let l = fixDigits(raw).replace(/\s+/g, ' ').trim();
      if (!l) continue;
      const zm = l.match(/\b([1-6]\d)\s?([C-HJ-NP-X])\b/);
      let zone = zm ? zm[1] + zm[2].toUpperCase() : '';
      let work = zm ? l.replace(zm[0], ' ') : l;

      let found = null;
      // 1) gradi primi secondi
      const dms = [];
      DMS_RE.lastIndex = 0; let m;
      while ((m = DMS_RE.exec(work))) {
        if (!m[3]) continue;
        let d = +m[2] + parseFloat(m[3].replace(',', '.')) / 60 + (m[4] ? parseFloat(m[4].replace(',', '.')) / 3600 : 0);
        if (m[1] || /[SWO]/.test(m[5] || '')) d = -d;
        dms.push({ v: d, i: m.index, e: m.index + m[0].length, h: m[5] || '' });
      }
      if (dms.length >= 2) {
        let [p, q] = dms;
        let lat = p.v, lon = q.v;
        if (/[EWO]/.test(p.h) || /[NS]/.test(q.h)) [lat, lon] = [lon, lat];
        found = { kind: 'geo', a: +lat.toFixed(8), b: +lon.toFixed(8), i: p.i, e: q.e };
      }
      // 2) metriche (UTM / Gauss-Boaga): numeri da 6-7 cifre
      if (!found) {
        let nums = [...work.matchAll(/(?<![\d.,])\d{6,7}(?:[.,]\d+)?(?![\d])/g)];
        if (nums.length < 2) nums = [...work.matchAll(/(?<![\d])\d{1,4}(?:[ .]\d{3})+(?![\d])/g)]
          .filter(x => { const n = x[0].replace(/[ .]/g, ''); return n.length >= 6 && n.length <= 7; });
        if (nums.length >= 2) {
          const a = nums[0][0].replace(/[ .]/g, '').replace(',', '.'), b = nums[1][0].replace(/[ .]/g, '').replace(',', '.');
          found = { kind: 'proj', a: parseFloat(a), b: parseFloat(b), i: nums[0].index, e: nums[1].index + nums[1][0].length };
        }
      }
      // 3) gradi decimali
      if (!found) {
        const dec = [...work.matchAll(/(?<![\d])-?\d{1,3}[.,]\d{4,}(?![\d])/g)];
        if (dec.length >= 2) found = { kind: 'geo', a: parseFloat(dec[0][0].replace(',', '.')), b: parseFloat(dec[1][0].replace(',', '.')), i: dec[0].index, e: dec[1].index + dec[1][0].length };
      }
      if (zone && !found) curZone = zone;
      if (!found) {
        if (zone) { pending = ''; continue; }
        // riga senza coordinate: può essere il nome del punto successivo
        if (/[A-Za-z]/.test(l) && l.length <= 60) pending = l; else pending = '';
        continue;
      }
      const clean = s => s.replace(/\b(E|N|EST|NORD|LAT|LON|X|Y|UTM|WGS ?84|ED ?50|ROMA ?40)\b[:=]?/gi, ' ')
                          .replace(/^[\s\-–:;,|.]+|[\s\-–:;,|.=]+$/g, '').replace(/\s+/g, ' ').trim();
      let name = clean(work.slice(0, found.i));
      let desc = clean(work.slice(found.e));
      if (!name && pending) name = pending;
      pending = '';
      out.push({ name: name || 'P' + (out.length + 1), desc, kind: found.kind, a: found.a, b: found.b, zone: zone || (found.kind === 'proj' ? curZone : '') });
    }
    return out;
  }

  // Cerca nel testo indicazioni di datum / sistema
  function detectHints(text) {
    const t = String(text).toUpperCase();
    let datum = null, sys = null;
    if (/ROMA ?40|MONTE ?MARIO/.test(t)) datum = 'roma40';
    else if (/ED ?50|EUROPE?A? ?50|EUROPEAN ?1950/.test(t)) datum = 'ed50';
    else if (/WGS ?84/.test(t)) datum = 'wgs84';
    if (/GAUSS|BOAGA/.test(t)) sys = 'gb';
    return { datum, sys };
  }

  // Converte un punto in WGS84. set = {datum, sys, zone, fuso, lonRef}
  function convertPoint(p, set, proj4) {
    const a = parseNum(p.a), b = parseNum(p.b);
    if (a == null || b == null) return { err: 'valori mancanti' };
    const tow = TOW[set.datum];
    try {
      if (p.kind === 'geo') {
        let lat = a, lon = b;
        if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) [lat, lon] = [lon, lat];
        if (set.datum === 'roma40' && set.lonRef === 'mm') lon += MM;
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { err: 'gradi fuori scala' };
        if (set.datum === 'wgs84') return { lat, lon };
        const r = proj4(`+proj=longlat ${tow} +no_defs`, 'WGS84', [lon, lat]);
        return { lat: r[1], lon: r[0] };
      }
      let E = a, N = b;
      if (E > N) [E, N] = [N, E];
      if (set.sys === 'gb' && set.datum === 'roma40') {
        let f = set.fuso === 'auto' ? (E >= 2000000 ? 'E' : 'O') : set.fuso;
        const def = f === 'E'
          ? `+proj=tmerc +lat_0=0 +lon_0=15 +k=0.9996 +x_0=2520000 +y_0=0 ${tow} +units=m +no_defs`
          : `+proj=tmerc +lat_0=0 +lon_0=9 +k=0.9996 +x_0=1500000 +y_0=0 ${tow} +units=m +no_defs`;
        const r = proj4(def, 'WGS84', [E, N]);
        return { lat: r[1], lon: r[0], info: 'GB ' + (f === 'E' ? 'Est' : 'Ovest') };
      }
      if (E >= 1000000) return { err: 'Est troppo grande per UTM: forse è Gauss-Boaga (Roma40)?' };
      if (N < 1000000 || N > 10000000) return { err: 'Nord fuori scala: controlla le cifre' };
      const zone = parseInt(p.zone) || parseInt(set.zone);
      const band = (String(p.zone || '').match(/[A-Za-z]$/) || [''])[0].toUpperCase();
      const south = !!band && band >= 'C' && band <= 'M';
      const def = `+proj=utm +zone=${zone}${south ? ' +south' : ''} ${tow} +units=m +no_defs`;
      const r = proj4(def, 'WGS84', [E, N]);
      return { lat: r[1], lon: r[0], info: 'UTM ' + zone + band };
    } catch (e) { return { err: 'conversione non riuscita' }; }
  }

  const x = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

  function buildGpx(pts, title, src) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Coordinate GPX KML" xmlns="http://www.topografix.com/GPX/1/1">\n` +
      `<metadata><name>${x(title)}</name><desc>${x(src)} → WGS84</desc><time>${new Date().toISOString()}</time></metadata>\n` +
      pts.map(p => `  <wpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><name>${x(p.name)}</name>${p.desc ? `<desc>${x(p.desc)}</desc>` : ''}<sym>Flag, Red</sym></wpt>`).join('\n') +
      '\n</gpx>\n';
  }
  function buildKml(pts, title, src) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n<name>${x(title)}</name>\n<description>${x(src)} → WGS84</description>\n` +
      `<Style id="p"><IconStyle><color>ff0000ff</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/pushpin/red-pushpin.png</href></Icon></IconStyle><LabelStyle><scale>0.9</scale></LabelStyle></Style>\n` +
      pts.map(p => `  <Placemark><name>${x(p.name)}</name>${p.desc ? `<description>${x(p.desc)}</description>` : ''}<styleUrl>#p</styleUrl><Point><coordinates>${p.lon.toFixed(7)},${p.lat.toFixed(7)},0</coordinates></Point></Placemark>`).join('\n') +
      '\n</Document>\n</kml>\n';
  }

  const api = { parseText, detectHints, parseNum, convertPoint, buildGpx, buildKml, fixDigits };
  if (typeof module !== 'undefined') module.exports = api; else root.Core = api;
})(this);
