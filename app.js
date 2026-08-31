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

    var lastUpdated = document.getElementById("last-updated");
    if (lastUpdated) {
      var d = new Date(latest.timestamp);
      lastUpdated.textContent = "Last updated: " + d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    }

    if (history.length < 2) {
      el("stat-growth").textContent = "\u2014";
      el("stat-forecast7").textContent = "\u2014";
      el("stat-forecast30").textContent = "\u2014";
      el("stat-r2").textContent = "\u2014";
      return;
    }

    var first = history[0];
    var totalDays = (new Date(latest.timestamp) - new Date(first.timestamp)) / 86400000;
    var membersPerDay = totalDays > 0 ? (latest.memberCount - first.memberCount) / totalDays : 0;

    var reg = linearRegression(history);
    var predicted7 = Math.max(0, Math.round(reg.slope * (history.length - 1 + 168) + reg.intercept));
    var predicted30 = Math.max(0, Math.round(reg.slope * (history.length - 1 + 720) + reg.intercept));

    var growthEl = el("stat-growth");
    var growthSign = membersPerDay >= 0 ? "+" : "";
    growthEl.textContent = growthSign + membersPerDay.toFixed(1);
    growthEl.style.color = membersPerDay >= 0 ? "#3fb950" : "#f85149";

    el("stat-forecast7").textContent = fmt(predicted7);
    el("stat-forecast30").textContent = fmt(predicted30);
    el("stat-r2").textContent = reg.r2.toFixed(3);

    renderMainChart(history, reg);
    renderRateChart(history);
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
    var r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

    return { slope: slope, intercept: intercept, r2: r2 };
  }

  function generateForecast(history, reg, hoursAhead) {
    var n = history.length;
    var lastTs = new Date(history[n - 1].timestamp).getTime();
    var intervalMs = n > 1 ? (lastTs - new Date(history[0].timestamp).getTime()) / (n - 1) : 600000;
    var intervalMinutes = intervalMs / 60000;
    var points = [];
    for (var i = 1; i <= hoursAhead; i++) {
      var date = new Date(lastTs + intervalMs * i);
      var idx = n - 1 + (i * 60) / intervalMinutes;
      var predicted = Math.max(0, Math.round(reg.slope * idx + reg.intercept));
      points.push({ x: date.toISOString(), y: predicted });
    }
    return points;
  }

  function renderMainChart(history, reg) {
    if (mainChartInstance) mainChartInstance.destroy();

    var ctx = el("mainChart");
    if (!ctx) return;

    var historical = history.map(function (p) {
      return { x: p.timestamp, y: p.memberCount };
    });

    var forecast = generateForecast(history, reg, FORECAST_HOURS);
    var forecastStart = historical.length - 1;

    mainChartInstance = new Chart(ctx.getContext("2d"), {
      type: "line",
      data: {
        labels: historical.concat(forecast).map(function (p) { return p.x; }),
        datasets: [
          {
            label: "Members",
            data: historical.concat(forecast).map(function (p) { return p.y; }),
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            pointHitRadius: 10,
            borderWidth: 2,
            segment: {
              borderColor: function (ctx) {
                return ctx.p0DataIndex >= forecastStart ? "rgba(63, 185, 80, 0.6)" : "rgba(88, 101, 242, 0.9)";
              },
              borderDash: function (ctx) {
                return ctx.p0DataIndex >= forecastStart ? [6, 4] : [];
              },
              backgroundColor: function (ctx) {
                return ctx.p0DataIndex >= forecastStart ? "rgba(63, 185, 80, 0.04)" : "rgba(88, 101, 242, 0.06)";
              }
            }
          }
        ]
      },
      options: chartOptions(function (v) { return fmt(v); })
    });
  }

  function renderRateChart(history) {
    if (rateChartInstance) rateChartInstance.destroy();

    var ctx = el("rateChart");
    if (!ctx) return;

    var rates = [];
    for (var i = 1; i < history.length; i++) {
      var ts = new Date(history[i].timestamp);
      rates.push({
        label: ts.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        rate: history[i].memberCount - history[i - 1].memberCount
      });
    }

    rateChartInstance = new Chart(ctx.getContext("2d"), {
      type: "bar",
      data: {
        labels: rates.map(function (d) { return d.label; }),
        datasets: [{
          data: rates.map(function (d) { return d.rate; }),
          backgroundColor: rates.map(function (d) {
            return d.rate >= 0 ? "rgba(63, 185, 80, 0.6)" : "rgba(248, 81, 73, 0.6)";
          }),
          borderColor: rates.map(function (d) {
            return d.rate >= 0 ? "rgba(63, 185, 80, 1)" : "rgba(248, 81, 73, 1)";
          }),
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: chartOptions(function (v) { return (v >= 0 ? "+" : "") + fmt(v); })
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
    var chartPanel = el("mainChart");
    if (chartPanel) chartPanel.parentElement.innerHTML = '<div class="empty-state"><p>Waiting for data. The tracker polls every 10 minutes.</p></div>';
    var ratePanel = el("rateChart");
    if (ratePanel) ratePanel.parentElement.innerHTML = '<div class="empty-state"><p>Rate data will appear once collected.</p></div>';
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
