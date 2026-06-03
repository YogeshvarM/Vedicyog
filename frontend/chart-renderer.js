// South Indian Chart Renderer
// Fixed sign positions - signs are always in the same place

const SOUTH_INDIAN_LAYOUT = [
    // Row 0: Pisces, Aries, Taurus, Gemini
    { sign: 'Pisces', row: 0, col: 0 },
    { sign: 'Aries', row: 0, col: 1 },
    { sign: 'Taurus', row: 0, col: 2 },
    { sign: 'Gemini', row: 0, col: 3 },
    // Row 1: Aquarius, (center), (center), Cancer
    { sign: 'Aquarius', row: 1, col: 0 },
    { sign: 'Cancer', row: 1, col: 3 },
    // Row 2: Capricorn, (center), (center), Leo
    { sign: 'Capricorn', row: 2, col: 0 },
    { sign: 'Leo', row: 2, col: 3 },
    // Row 3: Sagittarius, Scorpio, Libra, Virgo
    { sign: 'Sagittarius', row: 3, col: 0 },
    { sign: 'Scorpio', row: 3, col: 1 },
    { sign: 'Libra', row: 3, col: 2 },
    { sign: 'Virgo', row: 3, col: 3 }
];

function getSignPosition(sign) {
    const pos = SOUTH_INDIAN_LAYOUT.find(p => p.sign === sign);
    return pos || { row: 0, col: 0 };
}

function createChartGrid(chartData, chartName = 'D1', showAscendant = true) {
    const container = document.createElement('div');
    container.className = 'chart-wrapper';

    const grid = document.createElement('div');
    grid.className = 'chart-grid';

    const signToHouse = {};
    const signToPlanets = {};
    let ascendantSign = null;

    if (chartData && chartData.houses) {
        chartData.houses.forEach(house => {
            const sign = house.sign;
            signToHouse[sign] = house.house_number;
            if (house.house_number === 1) {
                ascendantSign = sign;
            }
            if (house.occupants && house.occupants.length > 0) {
                signToPlanets[sign] = house.occupants;
            }
        });
    }

    const cells = [];
    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
            if ((row === 1 || row === 2) && (col === 1 || col === 2)) {
                continue;
            }

            const layoutItem = SOUTH_INDIAN_LAYOUT.find(p => p.row === row && p.col === col);
            if (!layoutItem) continue;

            const cell = document.createElement('div');
            cell.className = 'chart-cell';
            cell.dataset.sign = layoutItem.sign;

            const signLabel = document.createElement('span');
            signLabel.className = 'sign-label';
            signLabel.textContent = getSignAbbr(layoutItem.sign);
            cell.appendChild(signLabel);

            const houseNum = signToHouse[layoutItem.sign];
            if (houseNum) {
                const houseLabel = document.createElement('span');
                houseLabel.className = 'house-number';
                houseLabel.textContent = houseNum;
                cell.appendChild(houseLabel);
            }

            if (showAscendant && layoutItem.sign === ascendantSign) {
                cell.classList.add('asc-house');
                const ascMarker = document.createElement('span');
                ascMarker.className = 'asc-marker';
                ascMarker.textContent = 'ASC';
                cell.appendChild(ascMarker);
            }

            const planets = signToPlanets[layoutItem.sign];
            if (planets && planets.length > 0) {
                const planetsDiv = document.createElement('div');
                planetsDiv.className = 'planets';

                planets.forEach(p => {
                    const badge = document.createElement('span');
                    const dignity = getPlanetDignity(p.planet, p.sign);
                    badge.className = `planet-badge dignity-${dignity.dignity}`;
                    badge.textContent = getPlanetAbbr(p.planet);
                    badge.dataset.planet = p.planet;
                    badge.dataset.sign = p.sign;
                    badge.dataset.dignity = dignity.label;

                    badge.addEventListener('click', togglePlanetInfo);
                    badge.addEventListener('mouseenter', showTooltip);
                    badge.addEventListener('mouseleave', hideTooltip);

                    planetsDiv.appendChild(badge);
                });

                cell.appendChild(planetsDiv);
            }

            cells.push({ row, col, cell });
        }
    }

    const centerCell = document.createElement('div');
    centerCell.className = 'chart-cell center';
    centerCell.style.gridColumn = '2 / 4';
    centerCell.style.gridRow = '2 / 4';

    const centerText = document.createElement('div');
    centerText.className = 'text-center';
    centerText.innerHTML = `<div class="text-amber-400 font-semibold">${chartName}</div>`;
    if (ascendantSign) {
        centerText.innerHTML += `<div class="text-xs text-gray-400 mt-1">Asc: ${ascendantSign}</div>`;
    }
    centerCell.appendChild(centerText);

    cells.sort((a, b) => {
        if (a.row !== b.row) return a.row - b.row;
        return a.col - b.col;
    });

    cells.forEach(({ row, col, cell }) => {
        if (row < 2 || (row === 1 && col === 0)) {
            grid.appendChild(cell);
        }
        if (row === 1 && col === 3) {
            return;
        }
    });

    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
            if ((row === 1 || row === 2) && (col === 1 || col === 2)) {
                continue;
            }

            const cellData = cells.find(c => c.row === row && c.col === col);
            if (cellData) {
                grid.appendChild(cellData.cell);
            }

            if (row === 1 && col === 0) {
                grid.appendChild(centerCell);
            }
        }
    }

    container.appendChild(grid);
    return container;
}

function renderChart(containerId, chartData, chartName = 'D1') {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    const chartGrid = createChartGrid(chartData, chartName);
    container.appendChild(chartGrid);
}

function renderAllDivisionalCharts(containerId, chartsData, activeCharts = null) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    const chartOrder = ['d2', 'd3', 'd4', 'd7', 'd9', 'd10', 'd12', 'd16', 'd20', 'd24', 'd27', 'd30', 'd40', 'd45', 'd60'];
    const chartNames = {
        'd2': 'D2 - Hora', 'd3': 'D3 - Drekkana', 'd4': 'D4 - Chaturthamsa',
        'd7': 'D7 - Saptamsa', 'd9': 'D9 - Navamsa', 'd10': 'D10 - Dasamsa',
        'd12': 'D12 - Dwadasamsa', 'd16': 'D16 - Shodasamsa', 'd20': 'D20 - Vimsamsa',
        'd24': 'D24 - Chaturvimsamsa', 'd27': 'D27 - Saptavimsamsa', 'd30': 'D30 - Trimsamsa',
        'd40': 'D40 - Khavedamsa', 'd45': 'D45 - Akshavedamsa', 'd60': 'D60 - Shashtiamsa'
    };

    const chartsToShow = activeCharts || Object.keys(chartsData);

    chartsToShow.forEach(key => {
        const lowerKey = key.toLowerCase();
        if (!chartsData[lowerKey]) return;

        const chartWrapper = document.createElement('div');
        chartWrapper.className = 'chart-item';
        chartWrapper.id = `chart-${lowerKey}`;

        const titleDiv = document.createElement('div');
        titleDiv.className = 'chart-title-section';

        const title = document.createElement('h3');
        title.className = 'text-sm font-semibold text-amber-300 mb-2 text-center';
        title.textContent = chartNames[lowerKey] || lowerKey.toUpperCase();
        titleDiv.appendChild(title);

        chartWrapper.appendChild(titleDiv);

        const chartGrid = createChartGrid(chartsData[lowerKey], lowerKey.toUpperCase(), true);
        chartWrapper.appendChild(chartGrid);

        container.appendChild(chartWrapper);
    });
}

function renderChartTabs(containerId, chartsData) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    const allTab = document.createElement('button');
    allTab.className = 'chart-tab active';
    allTab.textContent = 'All';
    allTab.dataset.chart = 'all';
    container.appendChild(allTab);

    const chartKeys = Object.keys(chartsData).sort((a, b) => {
        const numA = parseInt(a.replace('d', ''));
        const numB = parseInt(b.replace('d', ''));
        return numA - numB;
    });

    chartKeys.forEach(key => {
        const tab = document.createElement('button');
        tab.className = 'chart-tab';
        tab.textContent = key.toUpperCase();
        tab.dataset.chart = key;
        container.appendChild(tab);
    });

    container.addEventListener('click', (e) => {
        if (!e.target.classList.contains('chart-tab')) return;

        container.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');

        const chart = e.target.dataset.chart;
        if (chart === 'all') {
            renderAllDivisionalCharts('divisional-charts', chartsData);
        } else {
            renderAllDivisionalCharts('divisional-charts', chartsData, [chart]);
        }
    });
}

function showTooltip(e) {
    if (window.innerWidth < 768) return;

    const tooltip = document.getElementById('tooltip');
    if (!tooltip) return;

    const planet = e.target.dataset.planet || 'Unknown';
    const sign = e.target.dataset.sign || 'Unknown';
    const dignity = e.target.dataset.dignity || 'Unknown';

    tooltip.innerHTML = `
        <div class="font-semibold text-amber-300">${planet}</div>
        <div>Sign: ${sign}</div>
        <div>Status: <span class="font-medium">${dignity}</span></div>
    `;

    const rect = e.target.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - 75;
    let top = rect.bottom + 8;

    if (left < 10) left = 10;
    if (left + 150 > window.innerWidth) left = window.innerWidth - 160;
    if (top + 80 > window.innerHeight) top = rect.top - 85;

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.classList.remove('hidden');
}

function hideTooltip() {
    const tooltip = document.getElementById('tooltip');
    if (tooltip) tooltip.classList.add('hidden');
}

function togglePlanetInfo(e) {
    e.stopPropagation();
    const planet = e.target.dataset.planet || 'Unknown';
    const sign = e.target.dataset.sign || 'Unknown';
    const dignity = e.target.dataset.dignity || 'Unknown';

    const infoPanel = document.getElementById('planet-info-panel');
    if (!infoPanel) return;

    infoPanel.innerHTML = `
        <div class="flex justify-between items-center mb-2">
            <span class="text-lg font-bold text-amber-400">${planet}</span>
            <button onclick="closePlanetInfo()" class="text-gray-400 hover:text-white text-xl">&times;</button>
        </div>
        <div class="space-y-1 text-sm">
            <div><span class="text-gray-400">Sign:</span> <span class="text-white">${sign}</span></div>
            <div><span class="text-gray-400">Dignity:</span> <span class="text-white font-medium">${dignity}</span></div>
        </div>
    `;
    infoPanel.classList.remove('hidden');
}

function closePlanetInfo() {
    const infoPanel = document.getElementById('planet-info-panel');
    if (infoPanel) infoPanel.classList.add('hidden');
}

function renderPlanetLegend(containerId, chartData) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    const allPlanets = [];
    if (chartData && chartData.houses) {
        chartData.houses.forEach(house => {
            if (house.occupants) {
                house.occupants.forEach(p => {
                    const dignity = getPlanetDignity(p.planet, p.sign);
                    allPlanets.push({ ...p, ...dignity });
                });
            }
        });
    }

    const legendTitle = document.createElement('h3');
    legendTitle.className = 'text-sm font-semibold text-amber-300 mb-3';
    legendTitle.textContent = 'Legend';
    container.appendChild(legendTitle);

    const legendGrid = document.createElement('div');
    legendGrid.className = 'legend-grid';

    const ascItem = document.createElement('div');
    ascItem.className = 'legend-item';
    ascItem.innerHTML = `
        <span class="legend-badge" style="background: linear-gradient(135deg, #92400e, #78350f); border: 2px solid #fbbf24;">1</span>
        <span class="text-amber-300 font-medium">Ascendant House (Lagna)</span>
    `;
    legendGrid.appendChild(ascItem);

    const dignityColors = [
        { class: 'exalted', label: 'Exalted', color: 'text-green-400' },
        { class: 'own', label: 'Own Sign', color: 'text-blue-400' },
        { class: 'moolatrikona', label: 'Moolatrikona', color: 'text-purple-400' },
        { class: 'friend', label: "Friend's Sign", color: 'text-green-300' },
        { class: 'neutral', label: 'Neutral', color: 'text-gray-400' },
        { class: 'enemy', label: "Enemy's Sign", color: 'text-orange-400' },
        { class: 'debilitated', label: 'Debilitated', color: 'text-red-400' }
    ];

    dignityColors.forEach(d => {
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = `
            <span class="legend-badge dignity-${d.class}">P</span>
            <span class="${d.color}">${d.label}</span>
        `;
        legendGrid.appendChild(item);
    });

    container.appendChild(legendGrid);

    if (allPlanets.length > 0) {
        const planetTitle = document.createElement('h3');
        planetTitle.className = 'text-sm font-semibold text-amber-300 mb-3 mt-4';
        planetTitle.textContent = 'Planets in Chart';
        container.appendChild(planetTitle);

        const planetGrid = document.createElement('div');
        planetGrid.className = 'legend-grid';

        allPlanets.forEach(p => {
            const item = document.createElement('div');
            item.className = 'legend-item';

            const badge = document.createElement('span');
            badge.className = `legend-badge dignity-${p.dignity}`;
            badge.textContent = getPlanetAbbr(p.planet);
            item.appendChild(badge);

            const text = document.createElement('span');
            text.innerHTML = `<span class="text-gray-300">${p.planet}</span> <span class="text-gray-500">in ${p.sign}</span> - <span class="${p.dignity === 'exalted' ? 'text-green-400' : p.dignity === 'debilitated' ? 'text-red-400' : 'text-gray-400'}">${p.label}</span>`;
            item.appendChild(text);

            planetGrid.appendChild(item);
        });

        container.appendChild(planetGrid);
    }
}
