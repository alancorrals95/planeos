// PlanEOS · formatting helpers
import { getLocale } from './i18n.js';

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

export function fmtDate(d, opts = { month: 'short', day: 'numeric' }) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date)) return '';
  return new Intl.DateTimeFormat(getLocale(), opts).format(date);
}

export function fmtMoney(n, currency = 'USD') {
  if (n == null) return '';
  return new Intl.NumberFormat(getLocale(), { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
}

export function fmtNum(n) {
  if (n == null || n === '') return '';
  return new Intl.NumberFormat(getLocale()).format(n);
}

export function relTime(d) {
  if (!d) return '';
  const date = new Date(d);
  const diff = (date - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 2592000) return rtf.format(Math.round(diff / 86400), 'day');
  return fmtDate(date, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function timeHM(iso) {
  return fmtDate(iso, { hour: '2-digit', minute: '2-digit' });
}

// seconds -> H:MM:SS
export function fmtDuration(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// current quarter string e.g. 2026-Q3
export function currentQuarter() {
  const d = new Date();
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

// Monday of a given date's ISO week
export function weekStart(date = new Date()) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}
export function isoDate(d) { return new Date(d).toISOString().slice(0, 10); }
