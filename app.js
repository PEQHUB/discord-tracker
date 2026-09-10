(function () {
  var DATA_URL = "data/members.json";
  var mainChart = null;
  var growthChart = null;

  function el(id) { return document.getElementById(id); }
  function fmt(n) { return n == null ? "\u2014" : n.toLocaleString("en-US"); }

  function fetchData() {
    fetch(DATA_URL + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.statusText); return r.json(); })
      .then(render)
      .catch(function (e) { console.error(e); el("last-updated").textContent = "Failed to load data"; });
  }

  function render(history) {
    if (!history || !history.length) {
      el("last-updated").textContent = "No data yet";
      return;
    }
    var latest = history[history.length - 1];
    el("stat-members").textContent = fmt(latest.memberCount);
    el("stat-online").textContent = fmt(latest.onlineCount);
    el("last-updated").textContent = "Updated " + new Date(latest.timestamp).toLocaleString();

    if (history.length < 2) {
      el("stat-change").textContent = "\u2014";
      el("stat-forecast").textContent = "\u2014";
      el("chart-note").textContent = "Need 2 polls for forecast.";
      drawMain(history, null);
      drawGrowth(history);
      return;
    }

    var first = history[0];
    var days = (new Date(latest.timestamp) - new Date(first.timestamp)) / 86400000;
    var perDay = days > 0 ? (latest.memberCount - first.memberCount) / days : 0;
    var ce = el("stat-change");
    ce.textContent = (perDay >= 0 ? "+" : "") + perDay.toFixed(0) + "/day";
    ce.style.color = perDay >= 0 ? "#3fb950" : "#f85149";

    var model = fitLogistic(history) || timeReg(history); // logistic fit, linear fallback
    var tLast = model.tLast, yLast = latest.memberCount;
    var forecast7 = Math.round(yLast + model.yAt(tLast + 24 * 7) - model.yAt(tLast));
    el("stat-forecast").textContent = fmt(forecast7);
    if (model.kind === "logistic") {
      var nowDay = model.yAt(tLast + 24) - model.yAt(tLast);
      el("chart-note").textContent = "Logistic fit \u00b7 R\u00b2 " + model.r2.toFixed(3) +
        " \u00b7 now " + (nowDay >= 0 ? "+" : "") + Math.round(nowDay) + "/day" +
        " \u00b7 ceiling \u2248 " + fmt(Math.round(model.L)) +
        " \u00b7 " + history.length + " polls";
    } else {
      el("chart-note").textContent = "Trend " + (perDay >= 0 ? "+" : "") + perDay.toFixed(0) + "/day \u00b7 " + history.length + " polls \u00b7 R\u00b2 " + model.r2.toFixed(3);
    }

    drawMain(history, model);
    drawGrowth(history);
  }

  // linear regression on time (hours since first poll) vs count
  function timeReg(history) {
    var t0 = new Date(history[0].timestamp).getTime();
    var n = history.length;
    var sumT = 0, sumY = 0, sumTY = 0, sumTT = 0;
    var pts = [];
    for (var i = 0; i < n; i++) {
      var t = (new Date(history[i].timestamp).getTime() - t0) / 3600000; // hours
      var y = history[i].memberCount;
      pts.push({ t: t, y: y });
      sumT += t; sumY += y; sumTY += t * y; sumTT += t * t;
    }
    var denom = n * sumTT - sumT * sumT;
    var slope = denom === 0 ? 0 : (n * sumTY - sumT * sumY) / denom; // members per hour
    var intercept = (sumY - slope * sumT) / n;
    var mean = sumY / n, ssRes = 0, ssTot = 0;
    for (var j = 0; j < n; j++) {
      var pred = slope * pts[j].t + intercept;
      ssRes += (pts[j].y - pred) * (pts[j].y - pred);
      ssTot += (pts[j].y - mean) * (pts[j].y - mean);
    }
    var tLast = pts[pts.length - 1].t;
    return {
      kind: "linear", slope: slope, intercept: intercept,
      r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot, t0: t0, tLast: tLast,
      yAt: function (t) { return slope * t + intercept; }
    };
  }

  // logistic curve fit: y = L / (1 + e^-(k*t + c)).
  // Models saturating adoption: growth is proportional to remaining headroom below
  // the ceiling L, which matches decelerating member counts far better than a line
  // (R² 0.999 vs 0.966 on current data). For a fixed L the model is linear in
  // logit space, so each candidate L has a closed-form least-squares solution;
  // scan L over a log grid, then golden-section refine the best interval.
  function fitLogistic(history) {
    var t0 = new Date(history[0].timestamp).getTime();
    var n = history.length, yMax = 0, pts = [], i;
    for (i = 0; i < n; i++) {
      var t = (new Date(history[i].timestamp).getTime() - t0) / 3600000;
      var y = history[i].memberCount;
      pts.push({ t: t, y: y });
      if (y > yMax) yMax = y;
    }
    var mean = 0;
    for (i = 0; i < n; i++) mean += pts[i].y;
    mean /= n;
    var ssTot = 0;
    for (i = 0; i < n; i++) ssTot += (pts[i].y - mean) * (pts[i].y - mean);
    if (ssTot === 0) return null;

    function solve(L) { // closed-form logit regression at ceiling L, or null
      var sT = 0, sZ = 0, sTZ = 0, sTT = 0, j, z;
      for (j = 0; j < n; j++) {
        z = Math.log(pts[j].y / (L - pts[j].y));
        if (!isFinite(z)) return null;
        sT += pts[j].t; sZ += z; sTZ += pts[j].t * z; sTT += pts[j].t * pts[j].t;
      }
      var den = n * sTT - sT * sT;
      var k = den === 0 ? 0 : (n * sTZ - sT * sZ) / den;
      var c = (sZ - k * sT) / n;
      if (!isFinite(k) || !isFinite(c)) return null;
      var sse = 0;
      for (j = 0; j < n; j++) {
        var f = L / (1 + Math.exp(-(k * pts[j].t + c)));
        sse += (pts[j].y - f) * (pts[j].y - f);
      }
      return { k: k, c: c, sse: sse };
    }

    var GRID = 400, best = null, ratio = Math.pow(100, 1 / (GRID - 1));
    for (var g = 0; g < GRID; g++) {
      var L = yMax * 1.0001 * Math.pow(100, g / (GRID - 1));
      var r = solve(L);
      if (r && (!best || r.sse < best.sse)) best = { L: L, k: r.k, c: r.c, sse: r.sse };
    }
    if (!best) return null;
    var lo = best.L / ratio, hi = best.L * ratio;
    var gr = (Math.sqrt(5) - 1) / 2;
    var x1 = hi - gr * (hi - lo), x2 = lo + gr * (hi - lo);
    for (var it = 0; it < 100; it++) {
      var s1 = solve(x1), s2 = solve(x2);
      if (s1 && s2 && s1.sse < s2.sse) { hi = x2; x2 = x1; x1 = hi - gr * (hi - lo); }
      else { lo = x1; x1 = x2; x2 = lo + gr * (hi - lo); }
    }
    var Lf = (lo + hi) / 2, rf = solve(Lf);
    if (!rf || !isFinite(Lf)) return null;
    return {
      kind: "logistic", L: Lf,
      r2: 1 - rf.sse / ssTot, t0: t0, tLast: pts[n - 1].t,
      yAt: function (t) { return Lf / (1 + Math.exp(-(rf.k * t + rf.c))); }
    };
  }

  function dayFloor(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }

  function drawMain(history, model) {
    var c = el("mainChart"); if (!c) return;
    if (mainChart) try { mainChart.destroy(); } catch (_) {}

    // ONE X axis (time as ms), ONE Y axis (count)
    var actual = history.map(function (p) {
      return { x: new Date(p.timestamp).getTime(), y: p.memberCount };
    });

    var datasets = [{
      label: "Members",
      data: actual,
      borderColor: "#5865F2",
      backgroundColor: "rgba(88,101,242,0.10)",
      fill: true,
      tension: 0.3,
      pointRadius: 4,
      pointBackgroundColor: "#5865F2",
      borderWidth: 2,
      showLine: true
    }];

    if (model) {
      // forecast follows the fitted curve, pinned to the last actual point so the
      // dashed line joins the data smoothly (a fit line at tLast sits slightly off
      // the latest reading, which would show as a kink)
      var lastPt = actual[actual.length - 1];
      var forecast = [];
      for (var d = 0; d <= 7; d++) {
        forecast.push({
          x: lastPt.x + d * 86400000,
          y: Math.round(lastPt.y + model.yAt(model.tLast + 24 * d) - model.yAt(model.tLast))
        });
      }
      datasets.push({
        label: "7-day forecast",
        data: forecast,
        borderColor: "rgba(63,185,80,0.95)",
        backgroundColor: "transparent",
        borderDash: [7, 5],
        fill: false,
        tension: 0.35,
        cubicInterpolationMode: "monotone",
        pointRadius: 0,
        borderWidth: 2,
        spanGaps: true
      });
    }

    // Y range with padding so points aren't at edge
    var allY = actual.map(function (p) { return p.y; });
    if (model) {
      var lastF = datasets[1].data[datasets[1].data.length - 1].y;
      allY.push(lastF);
    }
    var yMin = Math.min.apply(null, allY), yMax = Math.max.apply(null, allY);
    var pad = Math.max(120, (yMax - yMin) * 0.18);
    yMin = Math.floor((yMin - pad) / 50) * 50;
    yMax = Math.ceil((yMax + pad) / 50) * 50;

    // X range: half a day of padding around the data so the edge day labels aren't clipped
    var xEnd = actual[actual.length - 1].x + (model ? 7 * 86400000 : 0);
    var xMin = dayFloor(actual[0].x) - 43200000;
    var xMax = xEnd + 43200000;

    mainChart = new Chart(c.getContext("2d"), {
      type: "line",
      data: { datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { left: 6, right: 12, top: 4, bottom: 0 } },
        interaction: { mode: "nearest", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#0c0c0c", titleColor: "#f4f4f5", bodyColor: "#a1a1aa",
            borderColor: "#1e1e1e", borderWidth: 1, padding: 10,
            callbacks: {
              title: function (items) {
                if (!items.length) return "";
                return new Date(items[0].parsed.x).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
              },
              label: function (ctx) { return " " + ctx.dataset.label + ": " + fmt(ctx.parsed.y); }
            }
          }
        },
        scales: {
          x: {
            type: "linear",
            min: xMin, max: xMax,
            afterBuildTicks: function (axis) {
              // one tick per calendar day across the chart
              var ticks = [];
              var d = new Date(axis.min);
              d.setHours(0, 0, 0, 0);
              d.setDate(d.getDate() + 1);
              while (d.getTime() < axis.max) {
                ticks.push({ value: d.getTime() });
                d.setDate(d.getDate() + 1);
              }
              axis.ticks = ticks;
            },
            ticks: {
              color: "#52525b",
              autoSkip: true, maxRotation: 0,
              font: { size: 10, family: "JetBrains Mono" },
              callback: function (val) {
                var d = new Date(val);
                return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              }
            },
            grid: { color: "rgba(30,30,30,0.9)" }
          },
          y: {
            min: yMin, max: yMax,
            ticks: { color: "#71717a", font: { size: 10, family: "JetBrains Mono" }, callback: function (v) { return fmt(v); } },
            grid: { color: "rgba(30,30,30,0.9)" }
          }
        }
      }
    });
  }

  function drawGrowth(history) {
    var c = el("growthChart"); if (!c) return;
    if (growthChart) try { growthChart.destroy(); } catch (_) {}
    if (history.length < 2) return;

    var labels = [], deltas = [];
    for (var i = 1; i < history.length; i++) {
      var d = new Date(history[i].timestamp);
      labels.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
      deltas.push(history[i].memberCount - history[i - 1].memberCount);
    }

    growthChart = new Chart(c.getContext("2d"), {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          label: "Change",
          data: deltas,
          backgroundColor: deltas.map(function (v) { return v >= 0 ? "rgba(63,185,80,0.75)" : "rgba(248,81,73,0.75)"; }),
          borderColor: deltas.map(function (v) { return v >= 0 ? "#3fb950" : "#f85149"; }),
          borderWidth: 1, borderRadius: 3
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: "#0c0c0c", borderColor: "#1e1e1e", borderWidth: 1, callbacks: { label: function (c) { return " " + (c.parsed.y >= 0 ? "+" : "") + c.parsed.y; } } }
        },
        scales: {
          x: { ticks: { color: "#52525b", maxTicksLimit: 6, font: { size: 10, family: "JetBrains Mono" }, maxRotation: 0, autoSkip: true }, grid: { display: false } },
          y: { ticks: { color: "#71717a", font: { size: 10, family: "JetBrains Mono" }, callback: function (v) { return (v > 0 ? "+" : "") + v; } }, grid: { color: "rgba(30,30,30,0.9)" } }
        }
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    // Chart.js measures tick labels with canvas font metrics at first render; if the
    // web fonts swap in afterwards, the wider glyphs overflow the reserved axis width
    // and the leading digit gets clipped at the canvas edge. Kick off the font loads
    // explicitly and wait for them (max 2s) before drawing.
    var boot = function () { fetchData(); setInterval(fetchData, 5 * 60 * 1000); };
    var fontsReady = (document.fonts && document.fonts.load)
      ? Promise.all([
          document.fonts.load('400 10px "JetBrains Mono"'),
          document.fonts.load('700 10px "JetBrains Mono"'),
          document.fonts.load('400 12px Inter'),
          document.fonts.load('700 12px Inter')
        ]).catch(function () {})
      : Promise.resolve();
    var timeout = new Promise(function (res) { setTimeout(res, 2000); });
    Promise.race([fontsReady, timeout]).then(boot);
  });
})();
