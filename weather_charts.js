const locations = {
    "Blackheath": { lat: -33.6356, lon: 150.2852 },
    "Sydney": { lat: -33.8688, lon: 151.2093 },
    "Lithgow": { lat: -33.4811, lon: 150.1368 },
    "Nowra": { lat: -34.8871, lon: 150.6005 },
    "Point Perpendicular" :{ lat: -35.0936, lon: 150.8053 },
    "Bungonia": { lat: -34.8573, lon: 149.9432 },
    "Natimuk": { lat: -36.7421, lon: 141.9413 },

    "Orange": { lat: -33.2816, lon: 149.0862 },
    "Narooma": { lat: -36.2193, lon: 150.1324 },

    "Byron Bay": { lat: -28.6534, lon: 153.5334 },
    "Brisbane": { lat: -27.4705, lon: 153.0260 }
};

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

async function fetchWeather(name, lat, lon) {
    const cacheKey = `weather-charts-data-${name}`;
    const cached = getCachedWeather(cacheKey);
    if (cached) return cached;

    const response = await fetch(`https://api.open-meteo.com/v1/forecast?models=ecmwf_ifs025&latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation_probability,precipitation&past_days=1&forecast_days=15&timezone=Australia/Sydney`);

    const data = await response.json();
    if (!data.hourly || !data.hourly.temperature_2m) {
        console.error('Missing expected data for', lat, lon, data);
        return null;
    }
    cacheWeather(cacheKey, data);
    return data;
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

function createChart(container, location, hours, temp, humidity, wind, windDir, cloudCover, rainProb, rainAmount) {
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
                backgroundColor: 'rgb(255,145,0)'
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
                backgroundColor: 'rgb(35,186,0)'
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
                backgroundColor: 'rgba(255,255,255,0.5)'
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
            },
            {
                label: 'Rainfall (mm/h)',
                type: 'bar',
                data: rainAmount,
                borderColor: 'deepskyblue',
                backgroundColor: 'deepskyblue',
                yAxisID: 'y_0_5',
                borderSkipped: false,
                barPercentage: 0.75,
                categoryPercentage: 1.0
            }
        ]
    };

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
                            if (label.includes('Temperature')) return `${Math.round(value)} °C`;
                            if (label.includes('Relative humidity')) return `${value}% RH`;
                            if (label.includes('Wind speed')) return `${Math.round(value)} km/h wind`;
                            if (label.includes('Wind direction')) return `${value} °`;
                            if (label.includes('Cloud cover')) return `${value}% cloud`;
                            if (label.includes('Rain probability')) return `${value}% rain`;
                            if (label.includes('Rainfall')) return `${value} mm/h rain`;
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
                        text: 'Temperature (°C) / Wind (km/h)',
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
                        text: 'Relative humidity (%) / Cloud cover (%) / Rain probability (%)',
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
                        text: 'Rainfall (mm/h)',
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

async function loadAllCharts() {
    const container = document.getElementById('charts');
    for (const [name, { lat, lon }] of Object.entries(locations)) {
        const data = await fetchWeather(name, lat, lon);
        if (!data) continue;
        createChart(
            container,
            name,
            data.hourly.time,
            data.hourly.temperature_2m,
            data.hourly.relative_humidity_2m,
            data.hourly.wind_speed_10m,
            data.hourly.wind_direction_10m,
            data.hourly.cloud_cover,
            data.hourly.precipitation_probability,
            data.hourly.precipitation
        );
    }
}

loadAllCharts();

// Automatically reload the page every hour
setInterval(() => {
    location.reload();
}, 3600 * 1000);
