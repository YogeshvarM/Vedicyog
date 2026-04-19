// Main Application Logic - Vedicyog

const API_URL = '';

let currentChartData = null;

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('birth-form');
    const loadSampleBtn = document.getElementById('load-sample');
    const downloadPdfBtn = document.getElementById('download-pdf');
    const newChartBtn = document.getElementById('new-chart');

    form.addEventListener('submit', handleFormSubmit);
    loadSampleBtn.addEventListener('click', loadSampleData);
    downloadPdfBtn.addEventListener('click', downloadPDF);
    newChartBtn.addEventListener('click', showForm);

    document.addEventListener('click', (e) => {
        if (!e.target.classList.contains('planet-badge')) {
            closePlanetInfo();
        }
    });
});

async function handleFormSubmit(e) {
    e.preventDefault();

    const name = document.getElementById('name').value || 'User';
    const date = document.getElementById('date').value;
    const time = document.getElementById('time').value;
    const place = document.getElementById('place').value;

    if (!date || !time || !place) {
        showError('Please fill in all required fields');
        return;
    }

    showLoading(true);
    hideError();

    try {
        const response = await fetch(`${API_URL}/full_chart`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, date, time, place })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.detail || `Server error: ${response.status}`);
        }

        const data = await response.json();
        currentChartData = data;
        renderResults(data);
    } catch (error) {
        showError(error.message || 'Failed to fetch chart data');
    } finally {
        showLoading(false);
    }
}

function loadSampleData() {
    document.getElementById('name').value = 'Sample User';
    document.getElementById('date').value = '1999-05-05';
    document.getElementById('time').value = '14:35';
    document.getElementById('place').value = 'Kanchipuram, India';
}

function showLoading(show) {
    document.getElementById('loading').classList.toggle('hidden', !show);
    document.getElementById('submit-btn').disabled = show;
}

function showError(message) {
    const errorDiv = document.getElementById('error-msg');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
}

function hideError() {
    document.getElementById('error-msg').classList.add('hidden');
}

function showForm() {
    document.getElementById('form-section').classList.remove('hidden');
    document.getElementById('results-section').classList.add('hidden');
}

function renderResults(data) {
    document.getElementById('form-section').classList.add('hidden');
    document.getElementById('results-section').classList.remove('hidden');

    renderBirthInfo(data.birth_data);
    renderPanchanga(data.panchanga);
    renderChart('d1-chart', data.d1_chart, 'D1 - Rasi');
    renderPlanetLegend('planet-legend', data.d1_chart);

    if (data.charts) {
        renderChartTabs('chart-tabs', data.charts);
        renderAllDivisionalCharts('divisional-charts', data.charts);
    }

    if (data.dashas || (data.raw_chart && data.raw_chart.dashas)) {
        const dashaData = data.raw_chart?.dashas || data.dashas;
        renderDashas('dasha-section', dashaData);
    }
}

function renderBirthInfo(birthData) {
    const container = document.getElementById('birth-info');
    container.innerHTML = `
        <div class="text-center mb-4 pdf-only hidden">
            <h1 class="text-2xl font-bold text-amber-400">Vedicyog</h1>
            <p class="text-gray-400 text-sm">Vedic Astrology Report</p>
        </div>
        <h2 class="text-xl font-semibold mb-4 text-amber-300">Birth Details</h2>
        <div class="info-grid">
            <div class="info-item">
                <div class="info-label">Name</div>
                <div class="info-value">${birthData.name || 'User'}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Date</div>
                <div class="info-value">${formatDate(birthData.date)}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Time</div>
                <div class="info-value">${birthData.time}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Place</div>
                <div class="info-value">${birthData.place}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Ascendant</div>
                <div class="info-value">${birthData.ascendant_sign}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Moon Sign</div>
                <div class="info-value">${birthData.moon_sign}</div>
            </div>
        </div>
    `;
}

function renderPanchanga(panchanga) {
    const container = document.getElementById('panchanga-section');
    container.innerHTML = `
        <h2 class="text-xl font-semibold mb-4 text-amber-300">Panchanga</h2>
        <div class="info-grid">
            <div class="info-item">
                <div class="info-label">Tithi</div>
                <div class="info-value">${panchanga.tithi || '-'}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Nakshatra</div>
                <div class="info-value">${panchanga.nakshatra || '-'}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Yoga</div>
                <div class="info-value">${panchanga.yoga || '-'}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Karana</div>
                <div class="info-value">${panchanga.karana || '-'}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Vaara</div>
                <div class="info-value">${panchanga.vaara || '-'}</div>
            </div>
        </div>
    `;
}

function renderDashas(containerId, dashaData) {
    const container = document.getElementById(containerId);
    if (!container || !dashaData) {
        container.innerHTML = '<p class="text-gray-400">Dasha data not available</p>';
        return;
    }

    container.innerHTML = '';

    const mahadashas = dashaData.all?.mahadashas || dashaData.mahadashas || {};
    const dashaOrder = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury'];

    const sortedDashas = Object.entries(mahadashas).sort((a, b) => {
        const dateA = new Date(a[1].start);
        const dateB = new Date(b[1].start);
        return dateA - dateB;
    });

    const today = new Date();

    sortedDashas.forEach(([planet, dasha], index) => {
        const startDate = new Date(dasha.start);
        const endDate = new Date(dasha.end);
        const isCurrent = today >= startDate && today <= endDate;

        const dashaItem = document.createElement('div');
        dashaItem.className = 'dasha-item';

        const header = document.createElement('div');
        header.className = `dasha-header ${isCurrent ? 'active' : ''}`;
        header.innerHTML = `
            <span class="planet-name">${planet} Mahadasha ${isCurrent ? '(Current)' : ''}</span>
            <span class="dates">${formatDate(dasha.start)} - ${formatDate(dasha.end)}</span>
        `;

        const content = document.createElement('div');
        content.className = 'dasha-content';

        if (dasha.antardashas) {
            const sortedAntardashas = Object.entries(dasha.antardashas).sort((a, b) => {
                return new Date(a[1].start) - new Date(b[1].start);
            });

            sortedAntardashas.forEach(([adPlanet, adData]) => {
                const adStart = new Date(adData.start);
                const adEnd = new Date(adData.end);
                const isCurrentAD = isCurrent && today >= adStart && today <= adEnd;

                const adItem = document.createElement('div');
                adItem.className = `antardasha-item ${isCurrentAD ? 'current' : ''}`;
                adItem.innerHTML = `
                    <div class="flex justify-between items-center">
                        <span class="font-medium">${adPlanet} ${isCurrentAD ? '(Current)' : ''}</span>
                        <span class="text-xs text-gray-400">${formatDate(adData.start)} - ${formatDate(adData.end)}</span>
                    </div>
                `;

                if (adData.pratyantardashas) {
                    const padList = document.createElement('div');
                    padList.className = 'pratyantardasha-list';

                    const sortedPAD = Object.entries(adData.pratyantardashas).sort((a, b) => {
                        return new Date(a[1].start) - new Date(b[1].start);
                    });

                    sortedPAD.forEach(([padPlanet, padData]) => {
                        const padItem = document.createElement('div');
                        padItem.className = 'pratyantardasha-item';
                        padItem.innerHTML = `${padPlanet}: ${formatDate(padData.start)} - ${formatDate(padData.end)}`;
                        padList.appendChild(padItem);
                    });

                    adItem.appendChild(padList);
                    adItem.addEventListener('click', (e) => {
                        e.stopPropagation();
                        padList.classList.toggle('open');
                    });
                }

                content.appendChild(adItem);
            });
        }

        header.addEventListener('click', () => {
            const wasOpen = content.classList.contains('open');
            document.querySelectorAll('.dasha-content').forEach(c => c.classList.remove('open'));
            if (!wasOpen) {
                content.classList.add('open');
            }
        });

        if (isCurrent) {
            content.classList.add('open');
        }

        dashaItem.appendChild(header);
        dashaItem.appendChild(content);
        container.appendChild(dashaItem);
    });
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

async function downloadPDF() {
    const element = document.getElementById('pdf-content');
    const btn = document.getElementById('download-pdf');

    btn.disabled = true;
    btn.textContent = 'Generating PDF...';

    document.body.classList.add('pdf-mode');

    if (currentChartData?.charts) {
        renderAllDivisionalCharts('divisional-charts', currentChartData.charts);
    }

    await new Promise(r => setTimeout(r, 300));

    const options = {
        margin: [10, 10, 10, 10],
        filename: `Vedicyog-${currentChartData?.birth_data?.name || 'chart'}.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: {
            scale: 2,
            useCORS: true,
            logging: false
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: {
            mode: ['avoid-all', 'css'],
            before: '.pdf-page-break-before',
            avoid: ['.chart-item', '.dasha-item', '.info-grid', '.chart-grid']
        }
    };

    try {
        await html2pdf().set(options).from(element).save();
    } catch (error) {
        alert('Failed to generate PDF: ' + error.message);
    } finally {
        document.body.classList.remove('pdf-mode');
        btn.disabled = false;
        btn.innerHTML = `
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
            Download PDF
        `;
    }
}
