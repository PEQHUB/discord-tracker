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
      .catch(function (err) {
        console.error("Failed to load data:", err);
      });
  }

  function buildDashboard(history) {
    if (!history || history.length < 1) {
      renderEmpty();
      return;
    }

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

    var derivs = computeDerivatives(history);
    var reg = linearRegression(history);
    var forecastTaylor = taylorForecast(history, derivs, FORECAST_HOURS);
    var forecastLinear = linearForecast(history, reg, FORECAST_HOURS);

    var d1El = el("stat-d1");
    d1El.textContent = sign(derivs.d1) + derivs.d1.toFixed(1) + "/hr";
    d1El.style.color = derivs.d1 >= 0 ? "#3fb950" : "#f85149";

    var d2El = el("stat-d2");
    d2El.textContent = sign(derivs.d2) + derivs.d2.toFixed(2) + "/hr\u00B2";
    d2El.style.color = derivs.d2 >= 0 ? "#3fb950" : "#f85149";

    var d3El = el("stat-d3");
    d3El.textContent = sign(derivs.d3) + derivs.d3.toFixed(3) + "/hr\u00B3";
    d3El.style.color = derivs.d3 >= 0 ? "#3fb950" : "#f85149";

    var forecastVal = forecastTaylor[forecastTaylor.length - 1].y;
    el("stat-forecast7").textContent = fmt(forecastVal);
    el("stat-r2").textContent = reg.r2.toFixed(3);

    renderMainChart(history, forecastTaylor, forecastLinear);
    renderDerivativeChart(history, derivs);
  }

  function computeDerivatives(history) {
    var n = history.length;
    var dt_hours = [];
    for (var i = 1; i < n; i++) {
      dt_hours.push((new Date(history[i].timestamp) - new Date(history[i - 1].timestamp)) / 3600000);
    }
    var avgDt = dt_hours.reduce(function (a, b) { return a + b; }, 0) / dt_hours.length;
    if (avgDt <= 0) avgDt = 1;

    var velocities = [];
    for (var j = 1; j < n; j++) {
      velocities.push((history[j].memberCount - history[j - 1].memberCount) / avgDt);
    }

    var d1 = velocities.length > 0 ? velocities[velocities.length - 1] : 0;

    var accelerations = [];
    for (var k = 1; k < velocities.length; k++) {
      accelerations.push((velocities[k] - velocities[k - 1]) / avgDt);
    }
    var d2 = accelerations.length > 0 ? accelerations[accelerations.length - 1] : 0;

    var jerks = [];
    for (var l = 1; l < accelerations.length; l++) {
      jerks.push((accelerations[l] - accelerations[l - 1]) / avgDt);
    }
    var d3 = jerks.length > 0 ? jerks[jerks.length - 1] : 0;

    if (n >= 4) {
      var vreg = linearRegressionValues(velocities);
      d1 = vreg.slope !== 0 ? vreg.slope * (velocities.length) + vreg.intercept : d1;
      if (accelerations.length >= 2) {
        var areg = linearRegressionValues(accelerations);
        d2 = areg.slope !== 0 ? areg.slope * (accelerations.length) + areg.intercept : d2;
      }
    }

    return { d1: d1, d2: d2, d3: d3, avgDt: avgDt, velocities: velocities, accelerations: accelerations, jerks: jerks };
  }

  function linearRegressionValues(arr) {
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
    var points = [];
    for (var h = 1; h <= hoursAhead; h++) {
      var t = h;
      var predicted = y0 + v * t + 0.5 * a * t * t + (1.0 / 6.0) * j * t * t * t;
      var date = new Date(lastTs + h * 3600000);
      points.push({ x: date.toISOString(), y: Math.max(0, Math.round(predicted)) });
    }
    return points;
  }

  function linearForecast(history, reg, hoursAhead) {
    var n = history.length;
    var lastTs = new Date(history[n - 1].timestamp).getTime();
    var intervalMs = n > 1 ? (lastTs - new Date(history[0].timestamp).getTime()) / (n - 1) : 600000;
    var intervalMinutes = intervalMs / 60000;
    var points = [];
    for (var h = 1; h <= hoursAhead; h++) {
      var idx = n - 1 + (h * 60) / intervalMinutes;
      var predicted = Math.max(0, Math.round(reg.slope * idx + reg.intercept));
      var date = new Date(lastTs + h * 3600000);
      points.push({ x: date.toISOString(), y: predicted });
    }
    return points;
  }

  function renderMainChart(history, taylorForecast, linearForecast) {
    if (mainChartInstance) mainChartInstance.destroy();
    var ctx = el("mainChart");
    if (!ctx) return;

    var historical = history.map(function (p) { return { x: p.timestamp, y: p.memberCount }; });
    var maxLen = Math.max(historical.length, taylorForecast.length, linearForecast.length);
    var allLabels = historical.map(function (p) { return p.x; });
    for (var i = allLabels.length; i < taylorForecast.length; i++) {
      allLabels.push(taylorForecast[i].x);
    }

    var taylorData = [];
    for (var t = 0; t < allLabels.length; t++) {
      if (t < historical.length) {
        taylorData.push(historical[t].y);
      } else {
        taylorData.push(taylorForecast[t - historical.length] ? taylorForecast[t - historical.length].y : null);
      }
    }

    var linearData = [];
    for (var l = 0; l < allLabels.length; l++) {
      if (l < historical.length) {
        linearData.push(historical[l].y);
      } else {
        linearData.push(linearForecast[l - historical.length] ? linearForecast[l - historical.length].y : null);
      }
    }

    var forecastStart = historical.length - 1;

    mainChartInstance = new Chart(ctx.getContext("2d"), {
      type: "line",
      data: {
        labels: allLabels,
        datasets: [
          {
            label: "Actual + Forecast",
            data: taylorData,
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            pointHitRadius: 10,
            borderWidth: 2,
            segment: {
              borderColor: function (c) {
                return c.p0DataIndex >= forecastStart ? "rgba(63, 185, 80, 0.7)" : "rgba(88, 101, 242, 0.9)";
              },
              borderDash: function (c) {
                return c.p0DataIndex >= forecastStart ? [6, 4] : [];
              },
              backgroundColor: function (c) {
                return c.p0DataIndex >= forecastStart ? "rgba(63, 185, 80, 0.04)" : "rgba(88, 101, 242, 0.06)";
              }
            }
          },
          {
            label: "Linear Forecast",
            data: linearData,
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 1,
            borderDash: [4, 4],
            segment: {
              borderColor: function (c) {
                return c.p0DataIndex >= forecastStart ? "rgba(88, 101, 242, 0.3)" : "transparent";
              }
            }
          }
        ]
      },
      options: chartOptions(function (v) { return fmt(v); })
    });
  }

  function renderDerivativeChart(history, derivs) {
    if (rateChartInstance) rateChartInstance.destroy();
    var ctx = el("rateChart");
    if (!ctx) return;

    var labels = [];
    for (var i = 1; i < history.length; i++) {
      var ts = new Date(history[i].timestamp);
      labels.push(ts.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
    }

    var d1Data = derivs.velocities.map(function (v) { return Math.round(v * 100) / 100; });
    var d2Data = derivs.accelerations.map(function (a) { return Math.round(a * 10000) / 10000; });
    var d3Data = derivs.jerks.map(function (j) { return Math.round(j * 1000000) / 1000000; });

    rateChartInstance = new Chart(ctx.getContext("2d"), {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Velocity (1st)",
            data: d1Data,
            borderColor: "rgba(63, 185, 80, 0.9)",
            backgroundColor: "rgba(63, 185, 80, 0.1)",
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            pointBackgroundColor: "rgba(63, 185, 80, 1)",
            borderWidth: 2
          },
          {
            label: "Acceleration (2nd)",
            data: d2Data,
            borderColor: "rgba(240, 136, 62, 0.9)",
            backgroundColor: "rgba(240, 136, 62, 0.05)",
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            pointBackgroundColor: "rgba(240, 136, 62, 1)",
            borderWidth: 2
          },
          {
            label: "Jerk (3rd)",
            data: d3Data,
            borderColor: "rgba(248, 81, 73, 0.9)",
            backgroundColor: "rgba(248, 81, 73, 0.05)",
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            pointBackgroundColor: "rgba(248, 81, 73, 1)",
            borderWidth: 2
          }
        ]
      },
      options: chartOptions(function (v) { return sign(v) + v.toFixed(2); })
    });
  }

  function chartOptions(tickCallback) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
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
              var d = new Date(items[0].label);
              return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
                " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
            },
            label: function (ctx) {
              return ctx.dataset.label + ": " + fmt(ctx.parsed.y);
            }
          }
        }
      },
      scales: {
        x: {
          type: "time",
          time: {
            tooltipFormat: "MMM d, yyyy HH:mm",
            displayFormats: { hour: "MMM d HH:mm", day: "MMM d" }
          },
          ticks: { color: "#3f3f46", maxTicksLimit: 8, font: { family: "'JetBrains Mono', monospace", size: 10 } },
          grid: { color: "rgba(26, 26, 26, 0.8)" },
          border: { color: "rgba(26, 26, 26, 0.8)" }
        },
        y: {
          ticks: {
            color: "#3f3f46",
            callback: tickCallback,
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
