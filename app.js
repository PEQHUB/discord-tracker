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
      el("last-updated").textContent = "No data yet — first poll in ~10 min";
      return;
    }
    var latest = history[history.length - 1];
    el("stat-members").textContent = fmt(latest.memberCount);
    el("stat-online").textContent = fmt(latest.onlineCount);
    el("last-updated").textContent = "Updated " + new Date(latest.timestamp).toLocaleString();

    if (history.length < 2) {
      el("stat-change").textContent = "\u2014";
      el("stat-forecast").textContent = "\u2014";
      el("chart-note").textContent = "Collecting data — forecast appears after 2 polls (~20 min).";
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

    var reg = linReg(history.map(function (p) { return p.memberCount; }));
    var avgMs = (new Date(latest.timestamp) - new Date(first.timestamp)) / (history.length - 1);
    if (!isFinite(avgMs) || avgMs <= 0) avgMs = 10 * 60 * 1000;
    // slope is per-poll, convert to per-day for forecast
    var slopePerDay = reg.slope * (86400000 / avgMs);
    var forecast7 = Math.round(latest.memberCount + slopePerDay * 7);
    el("stat-forecast").textContent = fmt(forecast7);

    el("chart-note").textContent =
      (perDay >= 0 ? "Growing" : "Shrinking") + " ~" + Math.abs(perDay).toFixed(0) + "/day \u00b7 " +
      history.length + " polls \u00b7 R\u00b2 " + reg.r2.toFixed(3);

    drawMain(history, reg);
    drawGrowth(history);
  }

  function linReg(vals) {
    var n = vals.length, sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (var i = 0; i < n; i++) { sx += i; sy += vals[i]; sxy += i * vals[i]; sxx += i * i; }
    var denom = n * sxx - sx * sx;
    var slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
    var intercept = (sy - slope * sx) / n;
    var mean = sy / n, ssRes = 0, ssTot = 0;
    for (var j = 0; j < n; j++) { var p = slope * j + intercept; ssRes += (vals[j] - p) * (vals[j] - p); ssTot += (vals[j] - mean) * (vals[j] - mean); }
    return { slope: slope, intercept: intercept, r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot };
  }

  function drawMain(history, reg) {
    var c = el("mainChart"); if (!c) return;
    if (mainChart) try { mainChart.destroy(); } catch (_) {}

    // build labels: only real points, plus 7 forecast points (one per day)
    var labels = history.map(function (p) {
      var d = new Date(p.timestamp);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    });
    var actual = history.map(function (p) { return p.memberCount; });

    var datasets = [{
      label: "Members",
      data: actual,
      borderColor: "#5865F2",
      backgroundColor: "rgba(88,101,242,0.09)",
      fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: "#5865F2", borderWidth: 2
    }];

    if (reg) {
      var lastTs = new Date(history[history.length - 1].timestamp).getTime();
      var avgMs = (lastTs - new Date(history[0].timestamp).getTime()) / (history.length - 1);
      var fLabels = [], fData = new Array(history.length - 1).fill(null);
      fData.push(actual[actual.length - 1]);
      for (var d = 1; d <= 7; d++) {
        var t = new Date(lastTs + d * 86400000);
        fLabels.push(t.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
        fData.push(Math.round(reg.slope * (history.length - 1 + d * 86400000 / avgMs) + reg.intercept));
      }
      // new labels = history labels + forecast day labels
      var allLabels = labels.concat(fLabels);
      // pad actual with nulls
      var actualPadded = actual.concat(new Array(7).fill(null));
      datasets = [
        {
          label: "Members",
          data: actualPadded,
          borderColor: "#5865F2",
          backgroundColor: "rgba(88,101,242,0.09)",
          fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: "#5865F2", borderWidth: 2
        },
        {
          label: "Forecast",
          data: fData.concat(fData.length < allLabels.length ? new Array(allLabels.length - fData.length).fill(null) : []),
          borderColor: "rgba(63,185,80,0.9)", borderDash: [6, 4], backgroundColor: "transparent",
          fill: false, tension: 0.3, pointRadius: 0, borderWidth: 2, spanGaps: true
        }
      ];
      // fix fData length to match allLabels
      while (fData.length < allLabels.length) fData.push(null);
      datasets[1].data = fData;
      labels = allLabels;
    }

    // compute sane Y range so data isn't crushed at top/bottom
    var allVals = actual.concat(reg ? datasets[1].data.filter(function (v) { return v != null; }) : []);
    var vMin = Math.min.apply(null, allVals), vMax = Math.max.apply(null, allVals);
    var pad = Math.max(200, (vMax - vMin) * 0.25);
    var yMin = Math.floor((vMin - pad) / 100) * 100;
    var yMax = Math.ceil((vMax + pad) / 100) * 100;

    mainChart = new Chart(c.getContext("2d"), {
      type: "line",
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { left: 8, right: 12 } },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#0c0c0c", titleColor: "#f4f4f5", bodyColor: "#a1a1aa",
            borderColor: "#1e1e1e", borderWidth: 1, padding: 10,
            callbacks: { label: function (c) { return " " + c.dataset.label + ": " + fmt(c.parsed.y); } }
          }
        },
        scales: {
          x: {
            ticks: { color: "#52525b", maxTicksLimit: 8, font: { size: 10, family: "JetBrains Mono" }, maxRotation: 0, autoSkip: true },
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
    if (history.length < 2) {
      growthChart = new Chart(c.getContext("2d"), {
        type: "bar",
        data: { labels: [], datasets: [{ data: [] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
      });
      return;
    }
    var labels = [], deltas = [];
    for (var i = 1; i < history.length; i++) {
      var d = new Date(history[i].timestamp);
      labels.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
      deltas.push(history[i].memberCount - history[i - 1].memberCount);
    }
    var maxAbs = Math.max.apply(null, deltas.map(function (v) { return Math.abs(v); }));
    var yPad = Math.max(10, Math.ceil(maxAbs * 0.3));
    var yMin = -yPad, yMax = Math.max.apply(null, deltas) + yPad;
    if (Math.min.apply(null, deltas) >= 0) yMin = 0;

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
          x: { ticks: { color: "#52525b", maxTicksLimit: 8, font: { size: 10, family: "JetBrains Mono" }, maxRotation: 0, autoSkip: true }, grid: { display: false } },
          y: { min: yMin, max: yMax, ticks: { color: "#71717a", font: { size: 10, family: "JetBrains Mono" }, callback: function (v) { return (v > 0 ? "+" : "") + v; } }, grid: { color: "rgba(30,30,30,0.9)" } }
        }
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () { fetchData(); setInterval(fetchData, 5 * 60 * 1000); });
})();
