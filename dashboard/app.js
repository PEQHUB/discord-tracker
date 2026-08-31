(function () {
  var DATA_URL = "data/members.json";
  var POLL_MS = 5 * 60 * 1000;
  var FORECAST_HOURS = 168;
  var mainChartInstance = null;
  var rateChartInstance = null;

  function el(id) { return document.getElementById(id); }

  function fmt(n) {
    if (n == null || isNaN(n)) return "\u2014";
    return n.toLocaleString("en-US");
  }

  function sign(n) { return n >= 0 ? "+" : ""; }

  function fetchData() {
    fetch(DATA_URL + "?t=" + Date.now())
      .then(function (r) {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
      .then(buildDashboard)
      .catch(function (err) { console.error("Fetch error:", err); });
  }

  function buildDashboard(history) {
    if (!history || history.length < 1) { renderEmpty(); return; }

    var latest = history[history.length - 1];
    el("stat-members").textContent = fmt(latest.memberCount);
    el("stat-online").textContent = fmt(latest.onlineCount);

    var lastUpdated = el("last-updated");
    if (lastUpdated) {
      var d = new Date(latest.timestamp);
      lastUpdated.textContent = "Last updated: " + d.toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
      });
    }

    if (history.length < 2) {
      el("stat-d1").textContent = "\u2014";
      el("stat-d2").textContent = "\u2014";
      el("stat-d3").textContent = "\u2014";
      el("stat-forecast7").textContent = "\u2014";
      el("stat-r2").textContent = "\u2014";
      return;
    }

    var reg = linearRegression(history);
    var derivs = computeDerivatives(history);
    var taylorPts = taylorForecast(history, derivs, FORECAST_HOURS);
    var linearPts = linearForecast(history, reg, FORECAST_HOURS);

    var d1El = el("stat-d1");
    d1El.textContent = sign(derivs.d1) + derivs.d1.toFixed(1) + "/hr";
    d1El.style.color = derivs.d1 >= 0 ? "#3fb950" : "#f85149";

    var d2El = el("stat-d2");
    d2El.textContent = sign(derivs.d2) + derivs.d2.toFixed(2) + "/hr\u00B2";
    d2El.style.color = derivs.d2 >= 0 ? "#3fb950" : "#f85149";

    var d3El = el("stat-d3");
    d3El.textContent = sign(derivs.d3) + derivs.d3.toFixed(3) + "/hr\u00B3";
    d3El.style.color = derivs.d3 >= 0 ? "#3fb950" : "#f85149";

    var forecastVal = taylorPts.length > 0 ? taylorPts[taylorPts.length - 1].y : latest.memberCount;
    el("stat-forecast7").textContent = fmt(forecastVal);
    el("stat-r2").textContent = reg.r2.toFixed(3);

    renderMainChart(history, taylorPts, linearPts);
    renderDerivativeChart(history, derivs);
  }

  function computeDerivatives(history) {
    var n = history.length;
    var dts = [];
    for (var i = 1; i < n; i++) {
      dts.push((new Date(history[i].timestamp) - new Date(history[i - 1].timestamp)) / 3600000);
    }
    var avgDt = dts.reduce(function (a, b) { return a + b; }, 0) / dts.length;
    if (avgDt <= 0) avgDt = 1;

    var vels = [];
    for (var j = 1; j < n; j++) {
      vels.push((history[j].memberCount - history[j - 1].memberCount) / avgDt);
    }

    var accels = [];
    for (var k = 1; k < vels.length; k++) {
      accels.push((vels[k] - vels[k - 1]) / avgDt);
    }

    var jerks = [];
    for (var l = 1; l < accels.length; l++) {
      jerks.push((accels[l] - accels[l - 1]) / avgDt);
    }

    var d1 = vels.length > 0 ? vels[vels.length - 1] : 0;
    var d2 = accels.length > 0 ? accels[accels.length - 1] : 0;
    var d3 = jerks.length > 0 ? jerks[jerks.length - 1] : 0;

    if (n >= 4) {
      var vreg = simpleLinReg(vels);
      if (Math.abs(vreg.slope) > 0.001) {
        d1 = vreg.slope * vels.length + vreg.intercept;
      }
      if (accels.length >= 2) {
        var areg = simpleLinReg(accels);
        if (Math.abs(areg.slope) > 0.001) {
          d2 = areg.slope * accels.length + areg.intercept;
        }
      }
      if (jerks.length >= 2) {
        var jreg = simpleLinReg(jerks);
        d3 = jreg.slope * jerks.length + jreg.intercept;
      }
    }

    return { d1: d1, d2: d2, d3: d3, avgDt: avgDt, vels: vels, accels: accels, jerks: jerks };
  }

  function simpleLinReg(arr) {
    var n = arr.length;
    if (n < 2) return { slope: 0, intercept: arr[0] || 0 };
    var sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (var i = 0; i < n; i++) {
      sx += i; sy += arr[i]; sxy += i * arr[i]; sxx += i * i;
    }
    var denom = n * sxx - sx * sx;
    var slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
    var intercept = (sy - slope * sx) / n;
    return { slope: slope, intercept: intercept };
  }

  function linearRegression(data) {
    var n = data.length;
    if (n < 2) return { slope: 0, intercept: data[0] ? data[0].memberCount : 0, r2: 0 };
    var sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (var i = 0; i < n; i++) {
      var y = data[i].memberCount;
      sx += i; sy += y; sxy += i * y; sxx += i * i;
    }
    var denom = n * sxx - sx * sx;
    var slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
    var intercept = (sy - slope * sx) / n;
    var yMean = sy / n;
    var ssRes = 0, ssTot = 0;
    for (var j = 0; j < n; j++) {
      var pred = slope * j + intercept;
      ssRes += (data[j].memberCount - pred) * (data[j].memberCount - pred);
      ssTot += (data[j].memberCount - yMean) * (data[j].memberCount - yMean);
    }
    return { slope: slope, intercept: intercept, r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot };
  }

  function taylorForecast(history, derivs, hoursAhead) {
    var lastTs = new Date(history[history.length - 1].timestamp).getTime();
    var y0 = history[history.length - 1].memberCount;
    var v = derivs.d1;
    var a = derivs.d2;
    var j = derivs.d3;
    var pts = [];
    for (var h = 1; h <= hoursAhead; h++) {
      var t = h;
      var pred = y0 + v * t + 0.5 * a * t * t + (1.0 / 6.0) * j * t * t * t;
      pts.push({ x: new Date(lastTs + h * 3600000), y: Math.max(0, Math.round(pred)) });
    }
    return pts;
  }

  function linearForecast(history, reg, hoursAhead) {
    var n = history.length;
    var lastTs = new Date(history[n - 1].timestamp).getTime();
    var intervalMs = n > 1 ? (lastTs - new Date(history[0].timestamp).getTime()) / (n - 1) : 600000;
    var intervalMinutes = intervalMs / 60000;
    var pts = [];
    for (var h = 1; h <= hoursAhead; h++) {
      var idx = n - 1 + (h * 60) / intervalMinutes;
      var pred = Math.max(0, Math.round(reg.slope * idx + reg.intercept));
      pts.push({ x: new Date(lastTs + h * 3600000), y: pred });
    }
    return pts;
  }

  function renderMainChart(history, taylorPts, linearPts) {
    if (mainChartInstance) mainChartInstance.destroy();
    var ctx = el("mainChart");
    if (!ctx) return;

    var actualPts = history.map(function (p) {
      return { x: new Date(p.timestamp), y: p.memberCount };
    });

    var forecastStartIdx = actualPts.length - 1;

    var taylorActual = actualPts.slice();
    var taylorForecast = [];
    for (var i = 0; i < forecastStartIdx; i++) {
      taylorForecast.push({ x: actualPts[i].x, y: null });
    }
    taylorForecast.push({ x: actualPts[forecastStartIdx].x, y: actualPts[forecastStartIdx].y });
    taylorPts.forEach(function (p) { taylorForecast.push(p); });

    var linearActual = actualPts.slice();
    var linearForecast = [];
    for (var j = 0; j < forecastStartIdx; j++) {
      linearForecast.push({ x: actualPts[j].x, y: null });
    }
    linearForecast.push({ x: actualPts[forecastStartIdx].x, y: actualPts[forecastStartIdx].y });
    linearPts.forEach(function (p) { linearForecast.push(p); });

    mainChartInstance = new Chart(ctx.getContext("2d"), {
      type: "line",
      data: {
        datasets: [
          {
            label: "Actual",
            data: actualPts,
            borderColor: "rgba(88, 101, 242, 0.9)",
            backgroundColor: "rgba(88, 101, 242, 0.06)",
            fill: true,
            tension: 0.3,
            pointRadius: actualPts.length < 50 ? 3 : 0,
            pointBackgroundColor: "rgba(88, 101, 242, 1)",
            pointHitRadius: 10,
            borderWidth: 2,
            spanGaps: false
          },
          {
            label: "3rd-Order Forecast",
            data: taylorForecast,
            borderColor: "rgba(63, 185, 80, 0.7)",
            backgroundColor: "rgba(63, 185, 80, 0.03)",
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2,
            borderDash: [6, 4],
            spanGaps: true
          },
          {
            label: "Linear Forecast",
            data: linearForecast,
            borderColor: "rgba(88, 101, 242, 0.3)",
            backgroundColor: "transparent",
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 1,
            borderDash: [4, 4],
            spanGaps: true
          }
        ]
      },
      options: makeChartOptions(function (v) { return fmt(v); })
    });
  }

  function renderDerivativeChart(history, derivs) {
    if (rateChartInstance) rateChartInstance.destroy();
    var ctx = el("rateChart");
    if (!ctx) return;

    var ts0 = new Date(history[0].timestamp).getTime();
    var avgMs = derivs.avgDt * 3600000;

    var vData = derivs.vels.map(function (v, i) {
      return { x: new Date(ts0 + (i + 1) * avgMs), y: Math.round(v * 100) / 100 };
    });
    var aData = derivs.accels.map(function (a, i) {
      return { x: new Date(ts0 + (i + 1.5) * avgMs), y: Math.round(a * 10000) / 10000 };
    });
    var jData = derivs.jerks.map(function (j, i) {
      return { x: new Date(ts0 + (i + 2) * avgMs), y: Math.round(j * 1000000) / 1000000 };
    });

    rateChartInstance = new Chart(ctx.getContext("2d"), {
      type: "line",
      data: {
        datasets: [
          {
            label: "Velocity (1st)",
            data: vData,
            borderColor: "rgba(63, 185, 80, 0.9)",
            backgroundColor: "rgba(63, 185, 80, 0.1)",
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: "rgba(63, 185, 80, 1)",
            borderWidth: 2
          },
          {
            label: "Acceleration (2nd)",
            data: aData,
            borderColor: "rgba(240, 136, 62, 0.9)",
            backgroundColor: "rgba(240, 136, 62, 0.05)",
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: "rgba(240, 136, 62, 1)",
            borderWidth: 2
          },
          {
            label: "Jerk (3rd)",
            data: jData,
            borderColor: "rgba(248, 81, 73, 0.9)",
            backgroundColor: "rgba(248, 81, 73, 0.05)",
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: "rgba(248, 81, 73, 1)",
            borderWidth: 2
          }
        ]
      },
      options: makeChartOptions(function (v) { return sign(v) + v.toFixed(2); })
    });
  }

  function makeChartOptions(tickCb) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#0c0c0c",
          borderColor: "#1a1a1a",
          borderWidth: 1,
          titleColor: "#f4f4f5",
          bodyColor: "#71717a",
          padding: 12,
          titleFont: { family: "'Inter', sans-serif", weight: "600", size: 12 },
          bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
          callbacks: {
            title: function (items) {
              if (!items.length) return "";
              var d = new Date(items[0].parsed.x);
              return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
                " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
            },
            label: function (ctx) {
              return " " + ctx.dataset.label + ": " + fmt(ctx.parsed.y);
            }
          }
        }
      },
      scales: {
        x: {
          type: "time",
          time: {
            tooltipFormat: "MMM d, yyyy HH:mm",
            displayFormats: { minute: "MMM d HH:mm", hour: "MMM d HH:mm", day: "MMM d" }
          },
          ticks: { color: "#3f3f46", maxTicksLimit: 8, font: { family: "'JetBrains Mono', monospace", size: 10 } },
          grid: { color: "rgba(26, 26, 26, 0.8)" },
          border: { color: "rgba(26, 26, 26, 0.8)" }
        },
        y: {
          ticks: {
            color: "#3f3f46",
            callback: tickCb,
            font: { family: "'JetBrains Mono', monospace", size: 10 },
            maxTicksLimit: 6
          },
          grid: { color: "rgba(26, 26, 26, 0.8)" },
          border: { color: "rgba(26, 26, 26, 0.8)" }
        }
      }
    };
  }

  function renderEmpty() {
    var c1 = el("mainChart");
    if (c1) c1.parentElement.innerHTML = '<div class="empty-state"><p>Waiting for data. The tracker polls every 10 minutes.</p></div>';
    var c2 = el("rateChart");
    if (c2) c2.parentElement.innerHTML = '<div class="empty-state"><p>Derivatives will appear once collected.</p></div>';
  }

  function init() {
    fetchData();
    setInterval(fetchData, POLL_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
