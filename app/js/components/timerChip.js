// PlanEOS · topbar timer chip (Toggl-style global indicator)
import { h, icon } from '../core/dom.js';
import { to } from '../core/paths.js';
import { onTimer, getRunning, refreshRunning, startTimer, stopTimer, elapsedSeconds } from '../core/timer.js';
import { fmtDuration } from '../core/format.js';
import { toastErr } from '../core/toast.js';

export function timerChip() {
  const time = h('span.timer-widget__time', '0:00:00');
  const btn = h('button.btn.btn--ghost.btn--icon.btn--sm', icon('play'));
  const chip = h('a.timer-widget', { href: to('pages/time/index.html'), title: 'Time Tracking' }, btn, time);

  let tick;
  function paint(r) {
    const on = !!r;
    chip.classList.toggle('timer-widget--running', on);
    btn.replaceChildren(icon(on ? 'square' : 'play'));
    time.textContent = fmtDuration(elapsedSeconds(r));
    clearInterval(tick);
    if (on) tick = setInterval(() => { time.textContent = fmtDuration(elapsedSeconds(r)); }, 1000);
  }
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    try { getRunning() ? await stopTimer() : await startTimer({ description: '' }); } catch (err) { toastErr(err); }
  });
  onTimer(paint);
  refreshRunning().then(paint).catch(() => {});
  return chip;
}
