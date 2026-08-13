const LOCATIONS_KEY = 'weather-charts-locations';
const MODEL_KEY = 'weather-charts-model';
const DEFAULT_LOCATIONS = [
    { name: "Gustavia", latitude: 17.89618, longitude: -62.84978 },
    { name: "Auckland", latitude: -36.84853, longitude: 174.76349 },
    { name: "Munich", latitude: 48.13743, longitude: 11.57549 }
];
const MODEL_OPTIONS = [
    { value: 'default', label: 'Auto' },
    { value: 'ecmwf_ifs025', label: 'ECMWF IFS 0.25°' }
    // { value: 'gfs_seamless', label: 'GFS (NOAA)' },
    // { value: 'icon_seamless', label: 'ICON (DWD)' },
    // { value: 'gem_seamless', label: 'GEM (Canada)' },
    // { value: 'meteofrance_seamless', label: 'MeteoFrance' },
    // { value: 'ukmo_seamless', label: 'UKMO' }
];

function getSelectedModel() {
    return localStorage.getItem(MODEL_KEY) || 'default';
}

function setSelectedModel(value) {
    localStorage.setItem(MODEL_KEY, value);
}

function setupModelSelect() {
    const select = document.getElementById('model-select');
    if (!select) return;  // control not present on this page

    select.innerHTML = MODEL_OPTIONS.map(o =>
        `<option value="${o.value}">${o.label}</option>`
    ).join('');
    select.value = getSelectedModel();

    select.addEventListener('change', () => {
        setSelectedModel(select.value);
        renderSavedLocations();  // reload charts under the newly chosen model
    });
}

async function searchLocations(query) {
    if (query.length < 2) return [];
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=10`);
    const data = await res.json();
    return data.results || [];
}

function getSavedLocations() {
    const raw = localStorage.getItem(LOCATIONS_KEY);
    if (raw !== null) return JSON.parse(raw);

    // First visit shows default cities
    localStorage.setItem(LOCATIONS_KEY, JSON.stringify(DEFAULT_LOCATIONS));
    return DEFAULT_LOCATIONS;
}

function saveLocation(loc) {
    const saved = getSavedLocations();
    // avoid duplicates
    if (saved.some(l => l.latitude === loc.latitude && l.longitude === loc.longitude)) return;
    saved.push({ name: loc.name, country: loc.country, latitude: loc.latitude, longitude: loc.longitude });
    localStorage.setItem(LOCATIONS_KEY, JSON.stringify(saved));
    renderSavedLocations();
}

function removeLocation(index) {
    const saved = getSavedLocations();
    saved.splice(index, 1);
    localStorage.setItem(LOCATIONS_KEY, JSON.stringify(saved));
    renderSavedLocations();
}

function setupLocationSearch() {
    const searchInput = document.getElementById('location-search');
    const resultsDiv = document.getElementById('search-results');
    const addBtn = document.getElementById('add-location-btn');
    if (!searchInput || !resultsDiv) return;  // controls not present on this page

    let debounceTimer;
    let currentResults = [];

    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            currentResults = await searchLocations(searchInput.value);
            resultsDiv.innerHTML = currentResults.map((r, i) =>
                `<div class="result-item" data-index="${i}" style="cursor:pointer;padding:4px;">
             ${r.name}, ${r.admin1 || ''} ${r.country}
           </div>`
            ).join('');
            resultsDiv.querySelectorAll('.result-item').forEach((el, i) => {
                el.addEventListener('click', () => {
                    saveLocation(currentResults[i]);
                    currentResults = [];
                    searchInput.value = '';
                    resultsDiv.innerHTML = '';
                });
            });
        }, 300);
    });

    // Add button / Enter key: save the top search result
    function addTopResult() {
        if (currentResults.length === 0) return;
        saveLocation(currentResults[0]);
        currentResults = [];
        searchInput.value = '';
        resultsDiv.innerHTML = '';
    }

    if (addBtn) addBtn.addEventListener('click', addTopResult);
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addTopResult();
    });
}

function renderSavedLocations() {
    const saved = getSavedLocations();
    const container = document.getElementById('saved-locations');
    if (container) {
        container.innerHTML = saved.map((loc, i) =>
            `<span style="display:inline-block;background:#333;padding:5px 10px;margin:3px;border-radius:12px;">
           ${loc.name} <button data-index="${i}" class="remove-btn" style="margin-left:5px;">×</button>
         </span>`
        ).join('');
        container.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => removeLocation(Number(e.target.dataset.index)));
        });
    }
    loadAllCharts(saved);
}

function getCachedWeather(key) {
    const cached = localStorage.getItem(key);
    if (!cached) return null;

    try {
        const parsed = JSON.parse(cached);
        const ageMinutes = (Date.now() - parsed.timestamp) / 1000 / 60;
        if (ageMinutes < 60) return parsed.data;
    } catch (e) {
        console.warn("Failed to parse cached data", e);
    }

    return null;
}

function cacheWeather(key, data) {
    localStorage.setItem(
        key,
        JSON.stringify({
            timestamp: Date.now(),
            data
        })
    );
}

async function fetchWeather(model, name, lat, lon) {
    const key = `weather-charts-data-${model}-${name}`;
    const cached = getCachedWeather(key);
    if (cached) return cached;

    const baseUrl = "https://api.open-meteo.com/v1/forecast";
    const params = new URLSearchParams({
        ...(model === "default" ? {} : { models: model }),
        latitude: lat,
        longitude: lon,
        hourly: [
            "temperature_2m",
            "apparent_temperature",
            "relative_humidity_2m",
            "wind_speed_10m",
            "wind_direction_10m",
            "cloud_cover",
            "precipitation_probability",
            "precipitation",
            "snowfall"
        ].join(","),
        past_days: 2,
        forecast_days: 15,
        timezone: "Australia/Sydney"
    });
    const url = `${baseUrl}?${params.toString()}`;
    const response = await fetch(url);

    const data = await response.json();
    if (!data.hourly || !data.hourly.temperature_2m) {
        console.error('Missing expected data for', lat, lon, data);
        return null;
    }
    cacheWeather(key, data);
    return data;
}

function computeAbsoluteHumidity(tempC, rh) {
    // Saturation vapor pressure (hPa)
    const es = 6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5));
    // Actual vapor pressure (hPa)
    const e = (rh / 100) * es;
    // Absolute humidity (g/m³)
    return (2.1674 * e) / (tempC + 273.15) * 100;  // convert hPa to Pa
}

function formatLabels(hours) {
    const labels = [];
    const options = { weekday: 'short', day: 'numeric' };
    for (let i = 0; i < hours.length; i++) {
        const date = new Date(hours[i]);
        if (date.getHours() === 12) {
            let label = date.toLocaleString('en-AU', options);
            const day = date.getDay();
            if (day === 0 || day === 6) {  // Sunday or Saturday
                label = label.toUpperCase();
            }
            labels[i] = label;
        } else {
            labels[i] = '';
        }
    }
    return labels;
}

function createChart(container, location, hours, temp, apparent, humidity, wind, windDir, cloudCover, rainProb,
                     rainFall, snowFall) {
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.marginBottom = '10px';

    const label = document.createElement('div');
    label.textContent = location;
    label.style.writingMode = 'vertical-rl';
    label.style.transform = 'rotate(180deg)';
    label.style.marginRight = '10px';
    label.style.color = '#ccc';

    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 150;

    const absHumidity = temp.map((t, i) => computeAbsoluteHumidity(t, humidity[i]));

    wrapper.appendChild(label);
    wrapper.appendChild(canvas);
    container.appendChild(wrapper);

    const chartData = {
        labels: formatLabels(hours),
        windDirection: windDir,
        datasets: [
            {
                label: 'Temperature (°C)',
                type: 'line',
                data: temp,
                borderColor: 'rgb(255,145,0)',
                borderWidth: 2,
                yAxisID: 'y_0_40',
                pointRadius: 0,
                fill: false,
                backgroundColor: 'rgb(50,50,50)'
            },
            {
                label: 'Apparent (°C)',
                type: 'line',
                data: apparent,
                borderColor: 'rgb(255,200,0)',
                borderWidth: 2,
                borderDash: [4, 4],
                yAxisID: 'y_0_40',
                pointRadius: 0,
                fill: false,
                backgroundColor: 'rgb(50,50,50)'
            },
            {
                label: 'Wind speed (km/h)',
                type: 'line',
                data: wind,
                borderColor: 'rgba(255,255,255,0.5)',
                borderWidth: 2,
                yAxisID: 'y_0_40',
                pointRadius: 0,
                fill: false,
                backgroundColor: 'rgb(50,50,50)'
            },
            {
                label: 'Relative humidity (%)',
                type: 'line',
                data: humidity,
                borderColor: 'rgb(35,186,0)',
                borderWidth: 2,
                yAxisID: 'y_0_100',
                pointRadius: 0,
                fill: false,
                backgroundColor: 'rgb(50,50,50)'
            },
            {
                label: 'Absolute humidity (g/m³)',
                type: 'line',
                data: absHumidity,
                borderColor: 'rgb(181,78,216)',
                borderWidth: 2,
                yAxisID: 'y_0_40',
                pointRadius: 0,
                fill: false,
                backgroundColor: 'rgb(50,50,50)'
            },
            {
                label: 'Rainfall (mm/h)',
                type: 'bar',
                data: rainFall,
                borderColor: 'deepskyblue',
                backgroundColor: 'deepskyblue',
                yAxisID: 'y_0_5',
                borderSkipped: false,
                barPercentage: 0.75,
                categoryPercentage: 1.0,
                stack: 'overlay'
            },
            {
                label: 'Cloud cover (%)',
                type: 'line',
                data: cloudCover,
                borderWidth: 0,
                yAxisID: 'y_0_100',
                pointRadius: 0,
                fill: true,
                backgroundColor: 'rgba(120,120,120,0.3)'
            },
            {
                label: 'Rain probability (%)',
                type: 'line',
                data: rainProb,
                borderWidth: 0,
                yAxisID: 'y_0_100',
                pointRadius: 0,
                fill: true,
                backgroundColor: 'rgba(0,111,255,0.45)'
            }
        ]
    };

    // Only add snowfall dataset if there's at least one non-zero value
    if (snowFall.some(v => v > 0)) {
        chartData.datasets.splice(5, 0,{
            label: 'Snowfall (cm/h)',
            type: 'bar',
            data: snowFall,
            borderColor: 'red',
            backgroundColor: 'red',
            yAxisID: 'y_0_5',
            borderSkipped: false,
            barPercentage: 0.75,
            categoryPercentage: 1.0,
            stack: 'overlay'
        });
    }

    new Chart(canvas.getContext('2d'), {
        data: chartData,
        options: {
            responsive: true,
            interaction: {mode: 'index', intersect: false},
            stacked: false,
            plugins: {
                title: {display: false},
                legend: {display: false},
                windDirectionArrows: true,
                tooltip: {
                    callbacks: {
                        title: function (ctx) {
                            const index = ctx[0].dataIndex;
                            const rawDate = hours[index]; // `hours` must be available in this scope
                            const date = new Date(rawDate);
                            return date.toLocaleString('en-AU', {
                                weekday: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                            });
                        },
                        label: function (ctx) {
                            const label = ctx.dataset.label || '';
                            const value = ctx.formattedValue;
                            if (label.includes('Temperature')) return `${Number(value).toFixed(1)} °C`;
                            if (label.includes('Apparent')) return `${Number(value).toFixed(1)} °C apparent`;
                            if (label.includes('Wind speed')) return `${Math.round(value)} km/h wind`;
                            // if (label.includes('Wind direction')) return `${value} °`;
                            if (label.includes('Relative humidity')) return `${value}% RH`;
                            if (label.includes('Absolute humidity')) return `${Number(value).toFixed(1)} g/m³ AH`;
                            if (label.includes('Rainfall')) return `${value} mm/h rain`;
                            if (label.includes('Snowfall')) return `${value} cm/h snow`;
                            if (label.includes('Cloud cover')) return `${value}% cloud`;
                            if (label.includes('Rain probability')) return `${value}% rain`;
                            return `${label}: ${value}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        autoSkip: false,
                        maxRotation: 0,
                        minRotation: 0,
                        color: '#ccc'
                    },
                    grid: {
                        drawTicks: true,
                        drawOnChartArea: true,
                        color: (ctx) => {
                            const index = ctx.tick?.value;
                            if (index === undefined || !hours[index]) return 'transparent';

                            const tickTime = new Date(hours[index]);
                            const now = new Date();
                            const diffMinutes = Math.abs((tickTime - now) / 60000);

                            // Highlight the tick closest to current time (within 30 minutes)
                            if (diffMinutes < 30) return '#ff0';

                            const hour = tickTime.getHours();
                            if (hour === 0) return '#666';
                            if (hour === 12) return '#333';
                            return 'transparent';
                        }
                    }
                },
                y_0_40: {
                    type: 'linear',
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Temperature (°C) / Wind (km/h) / AH (g/m³)',
                        color: '#fff'
                    },
                    min: 0,
                    max: 40,
                    ticks: {
                        color: '#ccc',
                        stepSize: 5
                    },
                    grid: {
                        drawOnChartArea: true,
                        color: (ctx) => {
                            const value = ctx.tick.value;
                            return value % 10 === 0 ? '#666' : '#333';
                        }
                    }
                },
                y_0_100: {
                    type: 'linear',
                    position: 'right',
                    offset: false,
                    title: {
                        display: true,
                        text: 'RH (%) / Cloud cover (%) / Rain probability (%)',
                        color: '#fff'
                    },
                    min: 0,
                    max: 100,
                    ticks: {color: '#ccc'},
                    grid: {drawOnChartArea: false}
                },
                y_0_5: {
                    type: 'linear',
                    position: 'right',
                    offset: false,
                    title: {
                        display: true,
                        text: 'Rainfall (mm/h) / Snowfall (cm/h)',
                        color: '#fff'
                    },
                    min: 0,
                    max: 4,
                    ticks: {color: '#ccc'},
                    grid: {drawOnChartArea: false}
                }
            }
        },
        plugins: [windDirectionArrowsPlugin]
    });
}

const windDirectionArrowsPlugin = {
    id: 'windDirectionArrows',
    afterDatasetsDraw(chart) {
        if (!chart.options.plugins.windDirectionArrows) return;

        const ctx = chart.ctx;
        const windSpeed = chart.getDatasetMeta(2);  // wind speed dataset
        const windDir = chart.config.data.windDirection;
        if (!windDir) return;

        windSpeed.data.forEach((point, i) => {
            if (!windDir[i] || !point || i % 2 === 0) return;

            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.translate(point.x, point.y);
            ctx.rotate((windDir[i] + 180) * Math.PI / 180);
            ctx.beginPath();
            ctx.moveTo(0, -7);
            ctx.lineTo(-4, 7);
            ctx.lineTo(4, 7);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        });
    }
};

// Register the plugin globally
Chart.register(windDirectionArrowsPlugin);

async function loadAllCharts(locationsList) {
    const model = getSelectedModel();
    const container = document.getElementById('charts');
    container.innerHTML = '';  // clear previous charts before redrawing
    for (const loc of locationsList) {
        const data = await fetchWeather(model, loc.name, loc.latitude, loc.longitude);
        if (!data) continue;
        createChart(
            container,
            loc.name,
            data.hourly.time,
            data.hourly.temperature_2m,
            data.hourly.apparent_temperature,
            data.hourly.relative_humidity_2m,
            data.hourly.wind_speed_10m,
            data.hourly.wind_direction_10m,
            data.hourly.cloud_cover,
            data.hourly.precipitation_probability,
            data.hourly.precipitation,
            data.hourly.snowfall
        );
    }
}

// Wire up search input and model select, then do the initial render (search UI + saved chips + charts)
setupLocationSearch();
setupModelSelect();
renderSavedLocations();

// Automatically reload the page every hour
setInterval(() => {
    location.reload();
}, 3600 * 1000);
