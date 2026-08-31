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

    var reg = timeReg(history); // time-based regression
    var forecast7 = Math.round(reg.slope * (reg.tLast + 24 * 7) + reg.intercept);
    el("stat-forecast").textContent = fmt(forecast7);
    el("chart-note").textContent = "Trend " + (perDay >= 0 ? "+" : "") + perDay.toFixed(0) + "/day \u00b7 " + history.length + " polls \u00b7 R\u00b2 " + reg.r2.toFixed(3);

    drawMain(history, reg);
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
    return { slope: slope, intercept: intercept, r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot, t0: t0, tLast: tLast };
  }

  function drawMain(history, reg) {
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

    if (reg) {
      // green forecast is straight continuation from last actual point
      var forecast = [];
      forecast.push({ x: actual[actual.length - 1].x, y: actual[actual.length - 1].y });
      for (var d = 1; d <= 7; d++) {
        var x = actual[actual.length - 1].x + d * 86400000;
        var t = reg.tLast + d * 24;
        var y = Math.round(reg.slope * t + reg.intercept);
        forecast.push({ x: x, y: y });
      }
      datasets.push({
        label: "7-day forecast",
        data: forecast,
        borderColor: "rgba(63,185,80,0.95)",
        backgroundColor: "transparent",
        borderDash: [7, 5],
        fill: false,
        tension: 0,
        pointRadius: 0,
        borderWidth: 2,
        spanGaps: true
      });
    }

    // Y range with padding so points aren't at edge
    var allY = actual.map(function (p) { return p.y; });
    if (reg) {
      var lastF = datasets[1].data[datasets[1].data.length - 1].y;
      allY.push(lastF);
    }
    var yMin = Math.min.apply(null, allY), yMax = Math.max.apply(null, allY);
    var pad = Math.max(120, (yMax - yMin) * 0.18);
    yMin = Math.floor((yMin - pad) / 50) * 50;
    yMax = Math.ceil((yMax + pad) / 50) * 50;

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
            ticks: {
              color: "#52525b",
              maxTicksLimit: 7,
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

  document.addEventListener("DOMContentLoaded", function () { fetchData(); setInterval(fetchData, 5 * 60 * 1000); });
})();
