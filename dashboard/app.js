(function () {
  var DATA_URL = "data/members.json";
  var FORECAST_POINTS = 42; // 7 days at 7 points per day for smooth line
  var mainChart = null;
  var growthChart = null;

  function el(id) { return document.getElementById(id); }
  function fmt(n) { return n == null ? "\u2014" : n.toLocaleString("en-US"); }

  function shortDate(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " +
           d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  }

  function fetchData() {
    fetch(DATA_URL + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.statusText); return r.json(); })
      .then(render)
      .catch(function (e) {
        console.error(e);
        el("last-updated").textContent = "Failed to load data";
      });
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
      document.getElementById("chart-note").textContent = "Need at least 2 data points for forecast.";
      drawMain(history, null);
      drawGrowth(history);
      return;
    }

    // simple change
    var first = history[0];
    var last = history[history.length - 1];
    var days = (new Date(last.timestamp) - new Date(first.timestamp)) / 86400000;
    var totalChange = last.memberCount - first.memberCount;
    var perDay = days > 0 ? totalChange / days : 0;
    var changeEl = el("stat-change");
    changeEl.textContent = (perDay >= 0 ? "+" : "") + perDay.toFixed(1) + "/day";
    changeEl.style.color = perDay >= 0 ? "#3fb950" : "#f85149";
    if (history.length >= 2) {
      var lastDelta = history[history.length - 1].memberCount - history[history.length - 2].memberCount;
      changeEl.title = "Last interval: " + (lastDelta >= 0 ? "+" : "") + lastDelta;
    }

    // linear regression for forecast
    var reg = linReg(history.map(function (p) { return p.memberCount; }));
    // forecast 7 days ahead: extend by 168 hours
    // reg.slope is per-poll interval; convert to per-hour
    var avgHoursPerPoll = days * 24 / (history.length - 1);
    if (!isFinite(avgHoursPerPoll) || avgHoursPerPoll <= 0) avgHoursPerPoll = 1 / 6; // fallback 10 min
    var slopePerHour = reg.slope / avgHoursPerPoll;

    var lastCount = last.memberCount;
    var forecast7 = Math.round(lastCount + slopePerHour * 24 * 7);
    el("stat-forecast").textContent = fmt(forecast7);

    var r2El = document.getElementById("chart-note");
    if (r2El) r2El.textContent = "Trend: " + (perDay >= 0 ? "growing" : "shrinking") + " ~" + Math.abs(perDay).toFixed(1) + "/day  \u00b7  R\u00b2 " + reg.r2.toFixed(3) + (reg.r2 < 0.5 ? " (noisy)" : "");

    drawMain(history, reg);
    drawGrowth(history);
  }

  function linReg(values) {
    var n = values.length;
    var sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (var i = 0; i < n; i++) { sumX += i; sumY += values[i]; sumXY += i * values[i]; sumXX += i * i; }
    var denom = n * sumXX - sumX * sumX;
    var slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
    var intercept = (sumY - slope * sumX) / n;
    var mean = sumY / n;
    var ssRes = 0, ssTot = 0;
    for (var j = 0; j < n; j++) {
      var pred = slope * j + intercept;
      ssRes += (values[j] - pred) * (values[j] - pred);
      ssTot += (values[j] - mean) * (values[j] - mean);
    }
    var r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
    return { slope: slope, intercept: intercept, r2: r2 };
  }

  function drawMain(history, reg) {
    var canvas = el("mainChart");
    if (!canvas) return;
    if (mainChart) { try { mainChart.destroy(); } catch (_) {} }

    var labels = history.map(function (p) { return shortDate(p.timestamp); });
    var actual = history.map(function (p) { return p.memberCount; });

    var datasets = [{
      label: "Members",
      data: actual,
      borderColor: "#5865F2",
      backgroundColor: "rgba(88,101,242,0.08)",
      fill: true,
      tension: 0.35,
      pointRadius: history.length < 80 ? 3 : 0,
      pointBackgroundColor: "#5865F2",
      borderWidth: 2
    }];

    if (reg && history.length >= 2) {
      // build forecast labels and data
      var lastTs = new Date(history[history.length - 1].timestamp).getTime();
      var avgMs = (lastTs - new Date(history[0].timestamp).getTime()) / (history.length - 1);
      if (!isFinite(avgMs) || avgMs <= 0) avgMs = 10 * 60 * 1000;
      var forecastLabels = [];
      var forecastData = [];
      // pad with nulls to align, last actual point connects
      for (var i = 0; i < history.length - 1; i++) forecastData.push(null);
      forecastData.push(actual[actual.length - 1]);
      for (var k = 1; k <= FORECAST_POINTS; k++) {
        var t = lastTs + (k * 24 * 7 * 3600000 / FORECAST_POINTS);
        forecastLabels.push(
          new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        );
        forecastData.push(Math.round(reg.slope * (history.length - 1 + k * (24*7*3600000/FORECAST_POINTS)/avgMs) + reg.intercept));
        labels.push(forecastLabels[forecastLabels.length - 1]);
      }
      // extend labels array was already mutated; need to keep original labels length
      // Instead rebuild properly:
      var allLabels = history.map(function (p) { return shortDate(p.timestamp); });
      var fData = new Array(history.length - 1).fill(null);
      fData.push(actual[actual.length - 1]);
      for (var f = 1; f <= FORECAST_POINTS; f++) {
        var ft = lastTs + f * 24 * 7 * 3600000 / FORECAST_POINTS;
        allLabels.push(new Date(ft).toLocaleDateString("en-US", { month: "short", day: "numeric" }));
        fData.push(Math.round(reg.slope * (history.length - 1 + f * (24*7*3600000/FORECAST_POINTS)/avgMs) + reg.intercept));
      }
      labels = allLabels;
      datasets = [
        {
          label: "Members",
          data: (function () {
            var d = actual.slice();
            for (var p = 0; p < FORECAST_POINTS; p++) d.push(null);
            return d;
          })(),
          borderColor: "#5865F2",
          backgroundColor: "rgba(88,101,242,0.08)",
          fill: true,
          tension: 0.35,
          pointRadius: history.length < 80 ? 3 : 0,
          pointBackgroundColor: "#5865F2",
          borderWidth: 2
        },
        {
          label: "Forecast",
          data: fData,
          borderColor: "rgba(63,185,80,0.9)",
          backgroundColor: "transparent",
          borderDash: [6, 4],
          fill: false,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
          spanGaps: true
        }
      ];
    }

    mainChart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
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
          x: { ticks: { color: "#52525b", maxTicksLimit: 9, font: { size: 10, family: "JetBrains Mono" }, maxRotation: 0 }, grid: { color: "rgba(30,30,30,0.9)" } },
          y: { ticks: { color: "#71717a", font: { size: 10, family: "JetBrains Mono" }, callback: function (v) { return fmt(v); } }, grid: { color: "rgba(30,30,30,0.9)" } }
        }
      }
    });
  }

  function drawGrowth(history) {
    var canvas = el("growthChart");
    if (!canvas) return;
    if (growthChart) { try { growthChart.destroy(); } catch (_) {} }
    if (history.length < 2) {
      growthChart = new Chart(canvas.getContext("2d"), {
        type: "bar",
        data: { labels: [], datasets: [{ data: [] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
      });
      return;
    }
    var labels = [];
    var deltas = [];
    for (var i = 1; i < history.length; i++) {
      labels.push(shortDate(history[i].timestamp));
      deltas.push(history[i].memberCount - history[i - 1].memberCount);
    }
    growthChart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          label: "Change",
          data: deltas,
          backgroundColor: deltas.map(function (v) { return v >= 0 ? "rgba(63,185,80,0.7)" : "rgba(248,81,73,0.7)"; }),
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
          x: { ticks: { color: "#52525b", maxTicksLimit: 10, font: { size: 10, family: "JetBrains Mono" }, maxRotation: 0 }, grid: { display: false } },
          y: { ticks: { color: "#71717a", font: { size: 10, family: "JetBrains Mono" }, callback: function (v) { return (v > 0 ? "+" : "") + v; } }, grid: { color: "rgba(30,30,30,0.9)" } }
        }
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    fetchData();
    setInterval(fetchData, 5 * 60 * 1000);
  });
})();
