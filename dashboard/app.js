(function () {
  var DATA_URL = "data/members.json";
  var FORECAST_HOURS = 168;
  var POLL_MS = 5 * 60 * 1000;

  var el = function (id) { return document.getElementById(id); };

  function fmt(n) {
    return n.toLocaleString("en-US");
  }

  function fetchData() {
    fetch(DATA_URL)
      .then(function (r) {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
      .then(buildDashboard)
      .catch(function (err) {
        console.error("Failed to load data:", err);
        el("stats-grid").innerHTML =
          '<div class="empty-state"><div class="icon">&#9888;</div><p>Failed to load tracker data. Check the console.</p></div>';
      });
  }

  function buildDashboard(history) {
    if (!history || history.length < 2) {
      renderEmpty();
      return;
    }

    var latest = history[history.length - 1];
    var first = history[0];

    var memberCount = latest.memberCount;
    var onlineCount = latest.onlineCount;
    var totalDays = (new Date(latest.timestamp) - new Date(first.timestamp)) / 86400000;
    var membersPerDay = totalDays > 0 ? (memberCount - first.memberCount) / totalDays : 0;

    var reg = linearRegression(history);
    var forecast = generateForecast(history, reg, FORECAST_HOURS);

    var predicted7 = Math.max(0, Math.round(reg.slope * (history.length - 1 + 168) + reg.intercept));
    var predicted30 = Math.max(0, Math.round(reg.slope * (history.length - 1 + 720) + reg.intercept));

    renderStats(memberCount, onlineCount, membersPerDay, predicted7, predicted30, reg.r2);
    renderMainChart(history, forecast);
    renderRateChart(history);
  }

  function linearRegression(history) {
    var n = history.length;
    if (n < 2) return { slope: 0, intercept: history[0] ? history[0].memberCount : 0, r2: 0 };

    var sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
    history.forEach(function (p, i) {
      sx += i;
      sy += p.memberCount;
      sxy += i * p.memberCount;
      sxx += i * i;
      syy += p.memberCount * p.memberCount;
    });

    var denom = n * sxx - sx * sx;
    var slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
    var intercept = (sy - slope * sx) / n;

    var yMean = sy / n;
    var ssRes = 0, ssTot = 0;
    history.forEach(function (p, i) {
      var pred = slope * i + intercept;
      ssRes += (p.memberCount - pred) * (p.memberCount - pred);
      ssTot += (p.memberCount - yMean) * (p.memberCount - yMean);
    });
    var r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

    return { slope: slope, intercept: intercept, r2: r2 };
  }

  function generateForecast(history, reg, hoursAhead) {
    var n = history.length;
    var lastTs = new Date(history[n - 1].timestamp).getTime();
    var intervalMs = n > 1 ? (lastTs - new Date(history[0].timestamp).getTime()) / (n - 1) : 600000;
    var intervalPoints = intervalMs / 60000;
    var points = [];
    for (var i = 1; i <= hoursAhead; i++) {
      var date = new Date(lastTs + intervalMs * i);
      var idx = n - 1 + (i * 60) / intervalPoints;
      var predicted = reg.slope * idx + reg.intercept;
      points.push({ x: date.toISOString(), y: Math.max(0, Math.round(predicted)) });
    }
    return points;
  }

  function renderStats(memberCount, onlineCount, membersPerDay, pred7, pred30, r2) {
    var stats = el("stats-grid");
    var growthClass = membersPerDay >= 0 ? "up" : "down";
    var growthArrow = membersPerDay >= 0 ? "&#9650;" : "&#9660;";
    var growthSign = membersPerDay >= 0 ? "+" : "";

    stats.innerHTML =
      '<div class="stat-card">' +
        '<div class="label">Total Members</div>' +
        '<div class="value accent" id="val-members">' + fmt(memberCount) + "</div>" +
        '<div class="delta ' + growthClass + '">' + growthArrow + " " + growthSign + membersPerDay.toFixed(1) + "/day</div>" +
      "</div>" +
      '<div class="stat-card">' +
        '<div class="label">Online Now</div>' +
        '<div class="value" id="val-online">' + fmt(onlineCount) + "</div>" +
        '<div class="delta">' + ((onlineCount / memberCount) * 100).toFixed(1) + "% of total</div>" +
      "</div>" +
      '<div class="stat-card">' +
        '<div class="label">Predicted 7 Days</div>' +
        '<div class="value green">' + fmt(pred7) + "</div>" +
        '<div class="delta up">&#9650; +' + fmt(Math.round(pred7 - memberCount)) + "</div>" +
      "</div>" +
      '<div class="stat-card">' +
        '<div class="label">Predicted 30 Days</div>' +
        '<div class="value purple">' + fmt(pred30) + "</div>" +
        '<div class="delta up">&#9650; +' + fmt(Math.round(pred30 - memberCount)) + "</div>" +
      "</div>" +
      '<div class="stat-card">' +
        '<div class="label">R&sup2; Confidence</div>' +
        '<div class="value">' + r2.toFixed(3) + "</div>" +
        '<div class="delta">' + (r2 > 0.7 ? "Strong trend" : r2 > 0.4 ? "Moderate trend" : "Weak trend") + "</div>" +
      "</div>";
  }

  function renderMainChart(history, forecast) {
    var ctx = el("mainChart").getContext("2d");
    var allPts = history.map(function (p) { return { x: p.timestamp, y: p.memberCount }; }).concat(forecast);
    var forecastStart = history.length - 1;

    new Chart(ctx, {
      type: "line",
      data: {
        labels: allPts.map(function (p) { return p.x; }),
        datasets: [
          {
            label: "Members",
            data: allPts.map(function (p) { return p.y; }),
            borderColor: "rgba(88, 101, 242, 0.9)",
            backgroundColor: "rgba(88, 101, 242, 0.08)",
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            pointHitRadius: 10,
            borderWidth: 2,
            segment: {
              borderColor: function (_ctx) {
                return _ctx.p0DataIndex >= forecastStart - 1 ? "rgba(63, 185, 80, 0.6)" : "rgba(88, 101, 242, 0.9)";
              },
              borderDash: function (_ctx) {
                return _ctx.p0DataIndex >= forecastStart - 1 ? [6, 4] : [];
              },
            },
          },
          {
            label: "Forecast",
            data: forecast.map(function (p) { return p.y; }),
            borderColor: "rgba(63, 185, 80, 0.7)",
            backgroundColor: "transparent",
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2,
            borderDash: [6, 4],
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#161b22",
            borderColor: "#30363d",
            borderWidth: 1,
            titleColor: "#c9d1d9",
            bodyColor: "#8b949e",
            padding: 12,
            callbacks: {
              label: function (_ctx) { return _ctx.dataset.label + ": " + fmt(_ctx.parsed.y) + " members"; },
            },
          },
        },
        scales: {
          x: {
            type: "time",
            time: { tooltipFormat: "MMM d, yyyy HH:mm", displayFormats: { hour: "MMM d HH:mm", day: "MMM d" } },
            ticks: { color: "#8b949e", maxTicksLimit: 10, font: { size: 11 } },
            grid: { color: "rgba(48, 54, 61, 0.5)" },
          },
          y: {
            ticks: { color: "#8b949e", callback: function (v) { return fmt(v); }, font: { size: 11 } },
            grid: { color: "rgba(48, 54, 61, 0.5)" },
          },
        },
      },
    });
  }

  function renderRateChart(history) {
    var ctx = el("rateChart").getContext("2d");
    var dailyRates = computeDailyRates(history);

    new Chart(ctx, {
      type: "bar",
      data: {
        labels: dailyRates.map(function (d) { return d.label; }),
        datasets: [
          {
            label: "Members / Day",
            data: dailyRates.map(function (d) { return d.rate; }),
            backgroundColor: dailyRates.map(function (d) { return d.rate >= 0 ? "rgba(63, 185, 80, 0.6)" : "rgba(248, 81, 73, 0.6)"; }),
            borderColor: dailyRates.map(function (d) { return d.rate >= 0 ? "rgba(63, 185, 80, 1)" : "rgba(248, 81, 73, 1)"; }),
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#161b22",
            borderColor: "#30363d",
            borderWidth: 1,
            titleColor: "#c9d1d9",
            bodyColor: "#8b949e",
            callbacks: {
              label: function (_ctx) { return fmt(_ctx.parsed.y) + " members/day"; },
            },
          },
        },
        scales: {
          x: { ticks: { color: "#8b949e", maxTicksLimit: 12, font: { size: 11 } }, grid: { display: false } },
          y: {
            ticks: { color: "#8b949e", callback: function (v) { return (v >= 0 ? "+" : "") + fmt(v); }, font: { size: 11 } },
            grid: { color: "rgba(48, 54, 61, 0.5)" },
          },
        },
      },
    });
  }

  function computeDailyRates(history) {
    var rates = [];
    for (var i = 1; i < history.length; i++) {
      var prev = history[i - 1].memberCount;
      var curr = history[i].memberCount;
      var ts = new Date(history[i].timestamp);
      var label = ts.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      rates.push({ label: label, rate: curr - prev });
    }
    return rates;
  }

  function renderEmpty() {
    el("stats-grid").innerHTML =
      '<div class="empty-state" style="grid-column: 1 / -1;">' +
        '<div class="icon">&#128202;</div>' +
        '<p>Waiting for first data point. The tracker polls every 10 minutes.</p>' +
      "</div>";
    el("mainChart").parentElement.innerHTML =
      '<div class="empty-state"><div class="icon">&#128200;</div><p>Data will appear here once collected.</p></div>';
    el("rateChart").parentElement.innerHTML =
      '<div class="empty-state"><div class="icon">&#128201;</div><p>Rate data will appear here once collected.</p></div>';
  }

  function init() {
    fetchData();
    setInterval(fetchData, POLL_MS);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
