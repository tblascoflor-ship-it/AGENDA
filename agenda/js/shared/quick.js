// Captura rápida: interpreta una frase en español («Entregar estadística
// jueves 23:59 urgente») y devuelve título, fecha, hora, prioridad, repetición
// y avisos. Funciona con reglas, sin conexión y sin servicios externos.

import * as D from './dates.js';

const WD = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7 };
const WDS = 'lunes|martes|miercoles|jueves|viernes|sabados?|domingos?';
const MES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const MESES = Object.keys(MES).join('|');
const NUM = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, media: 0.5 };
const NUMS = '\\d+(?:[.,]\\d)?|' + Object.keys(NUM).join('|');
const num = (s) => (s in NUM ? NUM[s] : parseFloat(String(s).replace(',', '.')));
const wd = (s) => WD[s] || WD[s.replace(/s$/, '')];
const PERIOD = '(?:\\s*(?:de\\s+la\\s+(tarde|noche|manana|madrugada)|(pm|am)\\b))?';

function clock(h, m, period) {
  h = +h;
  m = +m || 0;
  if (period === 'tarde' || period === 'noche' || period === 'pm') {
    if (h < 12) h += 12;
  } else if (period === 'manana' || period === 'madrugada' || period === 'am') {
    if (h === 12) h = 0;
  } else if (!period && h >= 1 && h <= 6) h += 12; // «a las 5» casi siempre es por la tarde
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

export function parseQuick(input, today, nowHM = '00:00') {
  const text = String(input || '').normalize('NFC');
  // Copia en minúsculas y sin tildes, con las mismas posiciones que el original
  let n = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (n.length !== text.length) n = text.toLowerCase();
  const spans = [];
  const take = (re, fn) => {
    const m = re.exec(n);
    if (!m) return false;
    if (fn(m) === false) return false;
    spans.push([m.index, m.index + m[0].length]);
    n = n.slice(0, m.index) + '\u0000'.repeat(m[0].length) + n.slice(m.index + m[0].length);
    return true;
  };
  const r = { title: '', kind: 'task', date: '', time: '', start: '', end: '', priority: 'medium', repeat: null, reminders: [], found: [] };
  let nextWeek = false;
  let dayPart = '';

  // Avisos: «avísame 15 min antes»
  const remRe = new RegExp(`\\b(?:y\\s+)?(?:avisa(?:me)?|aviso|recuerda(?:me)?(?:lo)?)\\s+(${NUMS})\\s*(min(?:utos?)?|h(?:oras?)?|dias?|semanas?)\\s+antes\\b`);
  while (
    take(remRe, (m) => {
      const unit = m[2][0] === 'm' ? 1 : m[2][0] === 'h' ? 60 : m[2][0] === 'd' ? 1440 : 10080;
      r.reminders.push({ t: 'rel', min: Math.round(num(m[1]) * unit) });
    })
  );

  // Prioridad
  take(/\bprioridad\s+(urgente|alta|media|baja)\b/, (m) => void (r.priority = { urgente: 'urgent', alta: 'high', media: 'medium', baja: 'low' }[m[1]])) ||
    take(/\b(?:muy\s+)?urgente\b|!!!/, () => void (r.priority = 'urgent')) ||
    take(/\b(?:muy\s+)?importante\b|!!/, () => void (r.priority = 'high')) ||
    take(/\bp([1-4])\b/, (m) => void (r.priority = ['urgent', 'high', 'medium', 'low'][m[1] - 1]));
  if (r.priority !== 'medium') r.found.push('priority');

  // Repetición
  take(/\b(?:de\s+)?lunes\s+a\s+viernes\b/, () => void (r.repeat = { freq: 'weekly', interval: 1, days: [1, 2, 3, 4, 5], until: '' })) ||
    take(/\b(?:cada\s+dia|todos\s+los\s+dias|a\s+diario|diariamente)\b/, () => void (r.repeat = { freq: 'daily', interval: 1, until: '' })) ||
    take(new RegExp(`\\b(?:cada|todos\\s+los|los)\\s+(${WDS})((?:(?:\\s*,\\s*|\\s+y\\s+)(?:${WDS}))*)\\b`), (m) => {
      const days = [m[1]].concat((m[2] || '').split(/\s*,\s*|\s+y\s+/).filter(Boolean)).map(wd).filter(Boolean);
      r.repeat = { freq: 'weekly', interval: 1, days: Array.from(new Set(days)).sort(), until: '' };
    }) ||
    take(new RegExp(`\\bcada\\s+(${NUMS})\\s+(dias|semanas|meses)\\b`), (m) => {
      const k = Math.max(1, Math.round(num(m[1])));
      r.repeat = { freq: m[2] === 'dias' ? 'daily' : m[2] === 'semanas' ? 'weekly' : 'monthly', interval: k, until: '' };
    }) ||
    take(/\b(?:cada\s+semana|semanalmente|todas\s+las\s+semanas)\b/, () => void (r.repeat = { freq: 'weekly', interval: 1, until: '' })) ||
    take(/\b(?:cada\s+mes|mensualmente|todos\s+los\s+meses)\b/, () => void (r.repeat = { freq: 'monthly', interval: 1, until: '' }));
  if (r.repeat) r.found.push('repeat');

  // Franja horaria: «de 17 a 19», «17:00-19:30», «17-19h»
  const setRange = (h1, m1, h2, m2, period) => {
    const s = clock(h1, m1, period);
    let e = clock(h2, m2, period);
    if (s == null || e == null) return false;
    if (!period) {
      // sin «de la tarde»: el fin es la primera hora posible después del inicio («de 5 a 7» → 17–19, «de 22 a 6» → noche)
      const raw = +h2 * 60 + (+m2 || 0);
      const later = [raw, +h2 < 12 ? raw + 720 : raw].filter((x) => x > s).sort((a, b) => a - b);
      e = later.length ? later[0] : raw;
    }
    r.start = D.minToHM(s);
    r.end = D.minToHM(e);
  };
  take(new RegExp(`\\bde\\s+(?:las?\\s+)?(\\d{1,2})(?:[:.h](\\d{2}))?\\s*h?\\s*a\\s+(?:las?\\s+)?(\\d{1,2})(?:[:.h](\\d{2}))?\\s*h?\\b${PERIOD}`), (m) => setRange(m[1], m[2], m[3], m[4], m[5] || m[6])) ||
    take(new RegExp(`\\b(\\d{1,2})[:.](\\d{2})\\s*(?:-|–|a)\\s*(\\d{1,2})[:.](\\d{2})\\b${PERIOD}`), (m) => setRange(m[1], m[2], m[3], m[4], m[5] || m[6] || 'x')) ||
    take(/\b(\d{1,2})\s*(?:-|–)\s*(\d{1,2})\s*h\b/, (m) => setRange(m[1], 0, m[2], 0, 'x'));

  // Hora suelta: «a las 17:30», «a las 5 de la tarde», «23:59», «17h»
  if (!r.start) {
    const one = (h, m, period, exact) => {
      const v = clock(h, m, period || (exact ? 'x' : ''));
      if (v == null) return false;
      r.time = D.minToHM(v);
    };
    take(new RegExp(`\\b(?:antes\\s+de|sobre|hasta|a)\\s+las?\\s+(\\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?:[:.h](\\d{2})|\\s+y\\s+(media|cuarto)|\\s+(menos\\s+cuarto))?\\s*(?:h\\b|horas\\b)?${PERIOD}`), (m) => {
      let h = num(m[1]);
      let mm = m[2] ? +m[2] : m[3] === 'media' ? 30 : m[3] === 'cuarto' ? 15 : 0;
      if (m[4]) {
        h -= 1;
        mm = 45;
      }
      return one(h, mm, m[5] || m[6], !!m[2] && h > 12);
    }) ||
      take(new RegExp(`\\b(\\d{1,2}):(\\d{2})\\s*h?\\b${PERIOD}`), (m) => one(m[1], m[2], m[3] || m[4], true)) ||
      take(/\b(\d{1,2})\s*h\b/, (m) => one(m[1], 0, '', true)) ||
      take(/\b(?:al\s+)?mediodia\b/, () => void (r.time = '12:00'));
  }
  // «por la mañana / tarde / noche» (solo fija hora si no hay otra)
  take(/\bpor\s+la\s+(manana|tarde|noche)\b/, (m) => void (dayPart = m[1]));
  if (dayPart && !r.time && !r.start) r.time = { manana: '09:00', tarde: '16:00', noche: '21:00' }[dayPart];
  if (dayPart && r.time && dayPart !== 'manana' && D.hmToMin(r.time) < 720 && !r.start) r.time = D.minToHM(D.hmToMin(r.time) + 720);

  // Duración: «durante 2 horas», «90 min» (solo con hora de inicio)
  if (r.time && !r.start) {
    take(new RegExp(`\\b(?:durante\\s+)?(${NUMS})\\s*(horas?|h|min(?:utos?)?)\\b`), (m) => {
      const mins = Math.round(num(m[1]) * (m[2][0] === 'h' ? 60 : 1));
      if (!(mins > 0 && mins < 1440)) return false;
      r.start = r.time;
      r.end = D.minToHM(D.hmToMin(r.time) + mins);
      r.time = '';
    });
  }
  if (r.time || r.start) r.found.push('time');

  // Fecha
  const PRE = '(?:(?:para|antes\\s+de)\\s+)?';
  const setDate = (d) => (D.isDate(d) && !isNaN(D.toNum(d)) ? void (r.date = d) : false);
  const dom = (day, month, year) => {
    const t = D.parse(today);
    let y = year ? (+year < 100 ? 2000 + +year : +year) : t.y;
    if (day < 1 || day > 31 || month < 1 || month > 12 || day > D.daysInMonth(y, month)) return false;
    let d = D.ymd(y, month, day);
    if (!year && d < today) d = D.ymd(y + 1, month, day);
    return setDate(d);
  };
  take(new RegExp(`\\b${PRE}pasado\\s+manana\\b`), () => setDate(D.addDays(today, 2))) ||
    take(new RegExp(`\\b${PRE}hoy\\b`), () => setDate(today)) ||
    take(new RegExp(`\\b${PRE}manana\\b`), () => setDate(D.addDays(today, 1))) ||
    take(new RegExp(`\\b${PRE}(?:el\\s+)?(?:dia\\s+)?(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?\\b`), (m) => dom(+m[1], +m[2], m[3])) ||
    take(new RegExp(`\\b${PRE}(?:el\\s+)?(?:dia\\s+)?(\\d{1,2})\\s+de\\s+(${MESES})(?:\\s+(?:de\\s+)?(\\d{4}))?\\b`), (m) => dom(+m[1], MES[m[2]], m[3])) ||
    take(new RegExp(`\\b${PRE}(?:el\\s+dia|dia|el)\\s+(\\d{1,2})\\b`), (m) => {
      const t = D.parse(today);
      const day = +m[1];
      if (day < 1 || day > 31) return false;
      for (let k = 0; k < 13; k++) {
        const idx = t.m - 1 + k;
        const y = t.y + Math.floor(idx / 12);
        const mo = (idx % 12) + 1;
        if (day <= D.daysInMonth(y, mo) && D.ymd(y, mo, day) >= today) return setDate(D.ymd(y, mo, day));
      }
      return false;
    }) ||
    take(new RegExp(`\\b(?:en|dentro\\s+de)\\s+(${NUMS})\\s+(dias?|semanas?|mes(?:es)?)\\b`), (m) => {
      const k = Math.round(num(m[1]));
      return setDate(m[2][0] === 'd' ? D.addDays(today, k) : m[2][0] === 's' ? D.addDays(today, 7 * k) : D.addMonths(today, k));
    });
  take(/\b(?:de\s+)?(?:la\s+)?(?:semana\s+que\s+viene|proxima\s+semana|semana\s+proxima)\b/, () => void (nextWeek = true));
  if (!r.date) {
    take(new RegExp(`\\b${PRE}(?:(?:el|este|el\\s+proximo|proximo)\\s+)?(${WDS})\\b(?:\\s+(?:que\\s+viene|proximo))?`), (m) => {
      const target = wd(m[1]);
      if (!target) return false;
      if (nextWeek) return setDate(D.addDays(D.startOfWeek(today), 7 + target - 1));
      let diff = (target - D.dow(today) + 7) % 7;
      if (diff === 0) diff = 7;
      return setDate(D.addDays(today, diff));
    }) || take(/\b(?:este\s+|el\s+)?(?:fin\s+de\s+semana|finde)\b/, () => setDate(D.addDays(today, (6 - D.dow(today) + 7) % 7 || (D.dow(today) === 6 ? 0 : 7))));
  }
  if (!r.date && nextWeek) r.date = D.addDays(D.startOfWeek(today), 7);
  if (r.date) r.found.push('date');

  // Fecha por defecto
  if (!r.date) {
    if (r.repeat && r.repeat.freq === 'weekly' && r.repeat.days && r.repeat.days.length) {
      for (let k = 0; k < 7; k++) {
        const d = D.addDays(today, k);
        if (r.repeat.days.includes(D.dow(d))) {
          r.date = d;
          break;
        }
      }
    } else {
      const t = r.start || r.time;
      r.date = t && t <= nowHM && !r.repeat ? D.addDays(today, 1) : today; // una hora ya pasada es para mañana
    }
  }
  if (r.repeat && r.repeat.freq === 'weekly' && !(r.repeat.days && r.repeat.days.length)) r.repeat.days = [D.dow(r.date)];

  // Tipo
  let hint = false;
  take(/^\s*(?:recordar(?:me)?|recuerdame|recordatorio)\s*:?\s+(?:que\s+)?/, () => void (hint = true));
  if (r.start && r.end) r.kind = 'event';
  else if (hint && r.time) r.kind = 'reminder';

  // Título: lo que queda de la frase
  let title = '';
  let pos = 0;
  for (const [a, b] of spans.sort((x, y) => x[0] - y[0])) {
    title += text.slice(pos, a) + ' ';
    pos = b;
  }
  title += text.slice(pos);
  title = title.replace(/\s+/g, ' ').trim();
  const edge = /^(?:[,;.:·\-–]+\s*)+|(?:\s*[,;.:·\-–]+)+$|\s+(?:para|el|la|a|de|del|al|en|por|y|antes|antes de|hasta)$/i;
  for (let i = 0; i < 6 && edge.test(title); i++) title = title.replace(edge, '').trim();
  r.title = title ? title.charAt(0).toUpperCase() + title.slice(1) : '';
  return r;
}

// Resumen legible de lo entendido: «Tarea · jue 19 nov · 23:59 · Urgente»
export function describeQuick(r, today) {
  const bits = [D.fmtRel(r.date, today)];
  if (r.start) bits.push(`${r.start}–${r.end}`);
  else if (r.time) bits.push(r.time);
  return bits;
}
