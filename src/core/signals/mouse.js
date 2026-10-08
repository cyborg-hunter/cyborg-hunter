// src/core/signals/mouse.js
// Mouse tracking (20Hz throttled) and bot metrics computation.
//
// Trial-scoped: mousemove, click, mousedown, mouseup events are recorded
// during each trial. The bot metrics (pathEfficiency, directionChanges,
// speedVariance) are computed at endTrial() time by computeMouseMetrics().

import { pathLength, displacement } from '../../shared/cursor-geometry.js';

/**
 * Attaches trial-scoped mouse tracking listeners.
 * Called from monitor.js at startTrial() time.
 */
export function attachMouseSignals(ctx) {
  var config = ctx.config;
  var trialData = ctx.trialData;

  if (config.signals.mouseTracking) {
    var mouseThrottle = config.thresholds.mouseThrottleMs;
    var mouseMaxEvents = config.thresholds.mouseMaxEvents;
    var lastMoveTime = 0;
    var trialStartTime = trialData.startTime;
    trialData.mouseTrackingCapped = false;
    trialData.mouseTrackingCappedAtMs = null;

    // Throttled mousemove — 20Hz by default, capped at mouseMaxEvents
    ctx.addTrialListener(document, "mousemove", function (e) {
      if (trialData.mouseEvents.length >= mouseMaxEvents) {
        if (!trialData.mouseTrackingCapped) {
          trialData.mouseTrackingCapped = true;
          trialData.mouseTrackingCappedAtMs = Math.round(performance.now() - trialStartTime);
        }
        return;
      }
      var now = performance.now();
      if (now - lastMoveTime < mouseThrottle) return;
      lastMoveTime = now;
      trialData.mouseEvents.push({
        x: Math.round(e.pageX), y: Math.round(e.pageY),
        t: Math.round(now - trialStartTime), type: "move"
      });
    }, { passive: true });

    // Click/mousedown/mouseup — no throttling needed, low frequency.
    // Recorded on the way down, on the window (capture phase), before any
    // listener on the document or below it handles the event: a handler may
    // end the trial (a jsPsych response button, a button whose onclick
    // submits the form, the one-line setup's own data-ch-trial listener on
    // the document) and the next one may start within the same click, which
    // then belongs to the trial it ended (the next trial's listener is not
    // called for it); and a handler that stops the event's propagation no
    // longer hides it.
    function mouseEventHandler(type) {
      return function (e) {
        if (trialData.mouseEvents.length >= mouseMaxEvents) return;
        trialData.mouseEvents.push({
          x: Math.round(e.pageX), y: Math.round(e.pageY),
          t: Math.round(performance.now() - trialStartTime), type: type
        });
      };
    }
    ctx.addTrialListener(window, "click", mouseEventHandler("click"), { passive: true, capture: true });
    ctx.addTrialListener(window, "mousedown", mouseEventHandler("down"), { passive: true, capture: true });
    ctx.addTrialListener(window, "mouseup", mouseEventHandler("up"), { passive: true, capture: true });
  }
}

/**
 * Computes inline mouse metrics from recorded mouse events.
 * Three lightweight O(n) features:
 *   1. pathEfficiency: straight-line distance / total path over the whole
 *      trial (1 for a straight line). The report's cursor section computes
 *      the same ratio per movement; the two are labelled apart.
 *   2. directionChanges: sign reversals in dx/dy. Depends on the sampling
 *      interval (mouseThrottleMs), so compare only within one setting.
 *   3. speedVariance: variance of inter-sample speeds. Also interval-dependent.
 *
 * Called from monitor.js at endTrial() time.
 */
export function computeMouseMetrics(mouseEvents, minEvents) {
  var moveEvents = mouseEvents.filter(function (e) { return e.type === "move"; });
  if (moveEvents.length < minEvents) return null;

  var speeds = [];
  var dxSignChanges = 0, dySignChanges = 0;
  var prevDx = 0, prevDy = 0;

  for (var mi = 1; mi < moveEvents.length; mi++) {
    var dx = moveEvents[mi].x - moveEvents[mi - 1].x;
    var dy = moveEvents[mi].y - moveEvents[mi - 1].y;
    var dist = Math.sqrt(dx * dx + dy * dy);

    // Speed: pixels per millisecond between consecutive samples
    var dt = moveEvents[mi].t - moveEvents[mi - 1].t;
    if (dt > 0) speeds.push(dist / dt);

    // Direction changes: sign reversal in dx or dy
    if (mi > 1) {
      if ((dx > 0 && prevDx < 0) || (dx < 0 && prevDx > 0)) dxSignChanges++;
      if ((dy > 0 && prevDy < 0) || (dy < 0 && prevDy > 0)) dySignChanges++;
    }
    prevDx = dx;
    prevDy = dy;
  }

  var totalDist = pathLength(moveEvents);
  var pathEfficiency = totalDist > 0 ? Math.round((displacement(moveEvents) / totalDist) * 1000) / 1000 : 0;

  // Speed variance using Welford's online algorithm for numerical stability
  var speedMean = 0, speedM2 = 0;
  for (var si = 0; si < speeds.length; si++) {
    var sdelta = speeds[si] - speedMean;
    speedMean += sdelta / (si + 1);
    speedM2 += sdelta * (speeds[si] - speedMean);
  }
  var speedVariance = speeds.length > 1 ? Math.round((speedM2 / (speeds.length - 1)) * 10000) / 10000 : 0;

  return {
    pathEfficiency: pathEfficiency,
    directionChanges: dxSignChanges + dySignChanges,
    speedVariance: speedVariance,
    moveCount: moveEvents.length
  };
}
