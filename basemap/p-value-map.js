function initPValueMap(config) {

    // --- 1. DYNAMIC UI INJECTION ---
    function injectUI() {
        const uiHTML = `
            <div id="status-bar">Initializing...</div>
            <div id="map"></div>

            <div id="popup" class="ol-popup">
                <a href="#" id="popup-closer" class="ol-popup-closer"></a>
                <div id="popup-content"></div>
            </div>

            <div id="top-left-controls" class="ol-control-panel" style="padding: 5px;">
                <button id="draw-box-btn" class="draw-btn">⬜ Draw Rectangle (Download)</button>
            </div>

            <div id="top-right-controls" class="ol-control-panel">
                <div id="layer-control-content">Loading...</div>
            </div>

            <div id="bottom-left-controls" class="ol-control-panel">
                <label class="control-label">Geology Opacity</label>
                <input type="range" id="geo-opacity" min="0" max="1" step="0.01" value="0.65">
                <label class="control-label">Data Point Size</label>
                <input type="range" id="point-size" min="1" max="10" step="1" value="6">
            </div>

            <div id="bottom-right-controls" class="ol-control-panel instruction-panel">
                <h4>Map Instructions</h4>
                <ul>
                    <li><b>Layers:</b> Click arrow to expand methods.</li>
                    <li><b>Data:</b> Click points for info.</li>
                    <li><b>Geology:</b> Click map for Unit info.</li>
                    <li><b>Download:</b> Click Draw Rectangle tool.</li>
                </ul>
                <div style="margin-top:8px; border-top:1px solid #ccc; padding-top:5px;">
                    <b>P-Value Colors:</b><br>
                    <span class="legend-dot" style="background:#b617b6;"></span> 0.025 ≤ p ≤ 0.075<br>
                    <span class="legend-dot" style="background:#8bff00;"></span> p < 0.025 OR 0.075 < p < 0.95<br>
                    <span class="legend-dot" style="background:#ff0503;"></span> p ≥ 0.95
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('afterbegin', uiHTML);
    }

    injectUI();


    // --- 2. CORE MAP LOGIC & FUNCTIONS ---
    function escapeHTML(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>'"]/g, 
            tag => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
            }[tag] || tag)
        );
    }

    var samples = []; 
    var groupedLayers = {}; 
    var currentRadius = 6;
    var drawInteraction;

    const esriLayer = new ol.layer.Tile({
        source: new ol.source.XYZ({
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',
            attributions: 'Tiles &copy; Esri'
        }),
        className: 'dimmable-layer', zIndex: 1
    });

    const googleTerrainLayer = new ol.layer.Tile({
        source: new ol.source.XYZ({ url: 'https://mt0.google.com/vt/lyrs=p&x={x}&y={y}&z={z}' }),
        className: 'dimmable-layer', zIndex: 1, visible: false
    });

    const googleHybridLayer = new ol.layer.Tile({
        source: new ol.source.XYZ({ url: 'http://mt0.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}' }),
        className: 'dimmable-layer', zIndex: 1, visible: false
    });

    const baseLayers = {
        'esriWorldShadedRelief': esriLayer,
        'googleTerrain': googleTerrainLayer,
        'googleHybrid': googleHybridLayer
    };

    let geologyLayer = null;
    let geologySource = null;
    const mapLayers = [esriLayer, googleTerrainLayer, googleHybridLayer];

    if (config.wmsUrl) {
        geologySource = new ol.source.TileWMS({
            url: config.wmsUrl,
            params: {'LAYERS': config.wmsLayers, 'TILED': true, 'FORMAT': 'image/png'},
            serverType: 'geoserver',
            crossOrigin: 'anonymous'
        });
        geologyLayer = new ol.layer.Tile({ source: geologySource, opacity: 0.65, zIndex: 10 });
        mapLayers.push(geologyLayer);
    }

    const drawSource = new ol.source.Vector({wrapX: false});
    const drawVector = new ol.layer.Vector({
        source: drawSource, zIndex: 100,
        style: new ol.style.Style({
            stroke: new ol.style.Stroke({color: '#00ff00', width: 2}),
            fill: new ol.style.Fill({color: 'rgba(0, 255, 0, 0.1)'})
        })
    });
    mapLayers.push(drawVector);

    const map = new ol.Map({
        target: 'map',
        layers: mapLayers,
        view: new ol.View({
            center: ol.proj.fromLonLat(config.mapCenter),
            zoom: config.mapZoom
        })
    });

    const popupContainer = document.getElementById('popup');
    const popupContent = document.getElementById('popup-content');
    const popupCloser = document.getElementById('popup-closer');

    const overlay = new ol.Overlay({
        element: popupContainer,
        autoPan: { animation: { duration: 250 } }
    });
    map.addOverlay(overlay);

    popupCloser.onclick = function () {
        overlay.setPosition(undefined);
        popupCloser.blur();
        return false;
    };

    map.on('singleclick', function (evt) {
        let hitFeature = null;

        map.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
            if (layer !== drawVector) {
                hitFeature = feature;
                return true; 
            }
        });

        if (hitFeature) {
            const props = hitFeature.getProperties();
            popupContent.innerHTML = `
                <div style="font-size:13px">
                    <b>${escapeHTML(props['Sample Name']) || 'Sample'}</b><br>
                    <table class="popup-table" style="width:100%; margin-top:5px;">
                        <tr><td><b>Method:</b></td><td>${escapeHTML(props['Method'])}</td></tr>
                        <tr><td><b>Lithology:</b></td><td>${escapeHTML(props['Lithology']) || ''}</td></tr>
                        <tr><td><b>Mineral:</b></td><td>${escapeHTML(props['Mineral']) || ''}</td></tr>
                        <tr><td><b>Age:</b></td><td>${escapeHTML(props['Age (Ma)']) || ''} ± ${escapeHTML(props['2sigma']) || ''}</td></tr>
                        <tr><td><b>P-Value:</b></td><td>${escapeHTML(props['p-value'] || props['P-value'])}</td></tr>
                        <tr><td><b>Source:</b></td><td>${escapeHTML(props['Source']) || ''}</td></tr>
                    </table>
                </div>`;
            overlay.setPosition(evt.coordinate);
        } else if (geologyLayer && geologyLayer.getVisible() && config.wmsUrl) {
            const viewResolution = map.getView().getResolution();
            const url = geologySource.getFeatureInfoUrl(
                evt.coordinate, viewResolution, 'EPSG:3857',
                {'INFO_FORMAT': 'text/html'}
            );
            if (url) {
                $.ajax({
                    url: url,
                    success: function (data) {
                        if (data && data.length > 20) {
                            popupContent.innerHTML = data;
                            overlay.setPosition(evt.coordinate);
                        }
                    }
                });
            }
        }
    });

    const drawBtn = document.getElementById('draw-box-btn');
    
    function addDrawInteraction() {
        drawInteraction = new ol.interaction.Draw({
            source: drawSource,
            type: 'Circle',
            geometryFunction: ol.interaction.Draw.createBox()
        });
        
        drawInteraction.on('drawend', function(e) {
            map.removeInteraction(drawInteraction);
            drawBtn.classList.remove('active');
            
            const extent = e.feature.getGeometry().getExtent(); 
            
            const selectedData = samples.filter(function(s) {
                const lat = parseFloat(s['Lat (N)']);
                const lon = parseFloat(s['Long (E)']);
                if (isNaN(lat) || isNaN(lon)) return false;
                const coord = ol.proj.fromLonLat([lon, lat]);
                return ol.extent.containsCoordinate(extent, coord);
            });

            if (selectedData.length === 0) { 
                alert("No samples found inside the selection box."); 
            } else {
                var filename = prompt("Enter file name to save (e.g., my_data):", "selected_samples");
                if (filename) {
                    if (!filename.endsWith(".csv")) filename += ".csv";
                    var csv = Papa.unparse(selectedData);
                    var blobContent = "\uFEFF" + csv;
                    var blob = new Blob([blobContent], { type: "text/csv;charset=utf-8;" });
                    var link = document.createElement("a");
                    link.href = URL.createObjectURL(blob);
                    link.download = filename;
                    document.body.appendChild(link); 
                    link.click(); 
                    document.body.removeChild(link);
                }
            }
            setTimeout(() => drawSource.clear(), 1000);
        });
        
        map.addInteraction(drawInteraction);
    }

    drawBtn.addEventListener('click', function() {
        if (this.classList.contains('active')) {
            map.removeInteraction(drawInteraction);
            this.classList.remove('active');
        } else {
            addDrawInteraction();
            this.classList.add('active');
        }
    });

    document.getElementById('geo-opacity').addEventListener('input', function(e) {
        if(geologyLayer) geologyLayer.setOpacity(parseFloat(e.target.value));
    });

    document.getElementById('point-size').addEventListener('input', function(e) {
        currentRadius = parseInt(e.target.value);
        Object.values(groupedLayers).forEach(methodGroup => {
            Object.values(methodGroup).forEach(layer => {
                layer.getSource().changed(); 
            });
        });
    });
    
    function showStatus(msg) {
        var el = document.getElementById('status-bar');
        el.innerHTML = msg; el.style.display = 'block';
        setTimeout(function() { el.style.display = 'none'; }, 4000);
    }

    // UPDATED STYLE FUNCTION
    function createStyle(method, fillColor) {
        return function() {
            const stroke = new ol.style.Stroke({ color: '#000', width: 1 });
            const fill = new ol.style.Fill({ color: fillColor });
            
            let imageStyle;
            
            if (method === "U-Pb") {
                // Only U-Pb gets the circle
                imageStyle = new ol.style.Circle({ fill: fill, stroke: stroke, radius: currentRadius });
            } else if (method === "FT") {
                // FT keeps the triangle
                const triangleRadius = currentRadius * 1.5;
                imageStyle = new ol.style.RegularShape({ fill: fill, stroke: stroke, points: 3, radius: triangleRadius, angle: 0 });
            } else {
                // Any other method defaults to a square
                const squareRadius = currentRadius * Math.SQRT2;
                imageStyle = new ol.style.RegularShape({ fill: fill, stroke: stroke, points: 4, radius: squareRadius, angle: Math.PI / 4 });
            }

            return new ol.style.Style({ image: imageStyle });
        };
    }

    // UPDATED DATA PROCESSOR
    function processData(rawData) {
        samples = rawData;
        var count = 0;
        
        Object.values(groupedLayers).forEach(methodGroup => {
            Object.values(methodGroup).forEach(layer => map.removeLayer(layer));
        });
        groupedLayers = {}; 

        const featureGroups = {};

        samples.forEach(function(s) {
            var lat = parseFloat(s['Lat (N)']), lon = parseFloat(s['Long (E)']);
            var method = s['Method'] || "Unknown";
            
            // EXPLICIT FILTER: Skip these methods completely
            if (method === "U-Pb Multiple" || method === "FT Multiple") return;

            var pValue = parseFloat(s['p-value'] || s['P-value']); 
            
            var fillColor = '#000000'; 
            var rangeLabel = "No Data";

            if (!isNaN(pValue)) {
                if (pValue >= 0.025 && pValue <= 0.075) {
                    fillColor = '#b617b6'; rangeLabel = "0.025 ≤ p ≤ 0.075";
                } else if (pValue >= 0.95) {
                    fillColor = '#ff0503'; rangeLabel = "p ≥ 0.95";
                } else {
                    fillColor = '#8bff00'; rangeLabel = "p < 0.025 OR 0.075 < p < 0.95";
                }
            }
            
            if (!isNaN(lat) && !isNaN(lon)) {
                if (!featureGroups[method]) featureGroups[method] = {};
                if (!featureGroups[method][rangeLabel]) {
                    featureGroups[method][rangeLabel] = { color: fillColor, features: [] };
                }
                
                const feature = new ol.Feature({
                    geometry: new ol.geom.Point(ol.proj.fromLonLat([lon, lat]))
                });
                feature.setProperties(s); 
                
                featureGroups[method][rangeLabel].features.push(feature);
                count++;
            }
        });

        Object.keys(featureGroups).forEach(method => {
            groupedLayers[method] = {};
            Object.keys(featureGroups[method]).forEach(range => {
                const groupData = featureGroups[method][range];
                
                let layerZIndex = 20; 
                if (range === "p ≥ 0.95") layerZIndex = 30; 
                else if (range === "p < 0.025 OR 0.075 < p < 0.95") layerZIndex = 25; 
                
                const vectorSource = new ol.source.Vector({ features: groupData.features });
                const vectorLayer = new ol.layer.Vector({
                    source: vectorSource,
                    style: createStyle(method, groupData.color),
                    zIndex: layerZIndex 
                });
                
                map.addLayer(vectorLayer);
                groupedLayers[method][range] = vectorLayer;
            });
        });

        buildLayerControl();
        showStatus("Loaded " + count + " samples.");
    }

    // UPDATED LEGEND CONTROL BUILDER
    function buildLayerControl() {
        var container = document.getElementById('layer-control-content');
        var html = '';
        
        html += '<div class="layer-section">';
        html += '<div class="layer-section-title">Base Maps</div>';
        html += '<div class="base-layer-item"><label><input type="radio" name="basemap" value="esriWorldShadedRelief" checked> Esri Shaded Relief</label></div>';
        html += '<div class="base-layer-item"><label><input type="radio" name="basemap" value="googleTerrain"> Google Terrain</label></div>';
        html += '<div class="base-layer-item"><label><input type="radio" name="basemap" value="googleHybrid"> Google Satellite</label></div>';
        html += '</div>';

        if (config.wmsUrl) {
            html += '<div class="layer-section">';
            html += '<div class="layer-section-title">Geology</div>';
            html += '<div class="base-layer-item"><label><input type="checkbox" id="geology-layer" checked> Geological Units</label></div>';
            html += '</div>';
        }

        html += '<div class="layer-section"><div class="layer-section-title">Data Layers</div>';

        var methods = Object.keys(groupedLayers).sort();
        methods.forEach(function(method) {
            var ranges = groupedLayers[method];
            var methodId = method.replace(/\s+/g, '_');
            
            html += '<div class="method-group">';
            html += '<div class="method-header" data-method="' + methodId + '">';
            html += '<span class="method-toggle">▶</span>';
            html += '<input type="checkbox" class="method-checkbox" data-method="' + method + '" checked>';
            html += '<span class="method-name">' + method + '</span></div>';
            html += '<div class="pvalue-list" data-method="' + methodId + '">';

            var rangeOrder = ["0.025 ≤ p ≤ 0.075", "p < 0.025 OR 0.075 < p < 0.95", "p ≥ 0.95", "No Data"];
            var colors = {
                "0.025 ≤ p ≤ 0.075": "#b617b6", "p < 0.025 OR 0.075 < p < 0.95": "#8bff00",
                "p ≥ 0.95": "#ff0503", "No Data": "#000000"
            };

            rangeOrder.forEach(function(range) {
                if (ranges[range]) {
                    // Update symbol logic for the legend
                    var symbolClass = 'square'; // Default for others
                    if (method === "U-Pb") symbolClass = 'circle';
                    else if (method === "FT") symbolClass = 'triangle';
                    
                    html += '<div class="pvalue-item"><label>';
                    html += '<input type="checkbox" class="pvalue-checkbox" data-method="' + method + '" data-range="' + range + '" checked>';
                    html += range;
                    
                    if (symbolClass === 'triangle') {
                        html += '<span class="pvalue-color ' + symbolClass + '" style="--fill-color: ' + colors[range] + ';"></span>';
                    } else {
                        html += '<span class="pvalue-color ' + symbolClass + '" style="background-color: ' + colors[range] + ';"></span>';
                    }
                    html += '</label></div>';
                }
            });
            html += '</div></div>';
        });
        html += '</div>';
        
        container.innerHTML = html;

        container.querySelectorAll('input[name="basemap"]').forEach(radio => {
            radio.addEventListener('change', function(e) {
                Object.values(baseLayers).forEach(layer => layer.setVisible(false));
                if(baseLayers[e.target.value]) baseLayers[e.target.value].setVisible(true);
            });
        });

        if (config.wmsUrl) {
            container.querySelector('#geology-layer').addEventListener('change', function(e) {
                if(geologyLayer) geologyLayer.setVisible(e.target.checked);
            });
        }

        container.querySelectorAll('.method-header').forEach(header => {
            header.addEventListener('click', function(e) {
                if (e.target.type === 'checkbox') return;
                var methodId = header.getAttribute('data-method');
                var pvalueList = container.querySelector('.pvalue-list[data-method="' + methodId + '"]');
                var toggle = header.querySelector('.method-toggle');
                pvalueList.classList.toggle('show');
                toggle.classList.toggle('expanded');
            });
        });

        container.querySelectorAll('.method-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', function(e) {
                var method = checkbox.getAttribute('data-method');
                var isChecked = checkbox.checked;
                
                Object.values(groupedLayers[method]).forEach(layer => layer.setVisible(isChecked));
                
                container.querySelectorAll('.pvalue-checkbox[data-method="' + method + '"]').forEach(cb => {
                    cb.checked = isChecked;
                });
            });
        });

        container.querySelectorAll('.pvalue-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', function(e) {
                var method = checkbox.getAttribute('data-method');
                var range = checkbox.getAttribute('data-range');
                groupedLayers[method][range].setVisible(checkbox.checked);

                var methodGroup = groupedLayers[method];
                var allChecked = true;
                var anyChecked = false;
                Object.values(methodGroup).forEach(layer => {
                    if(layer.getVisible()) anyChecked = true;
                    else allChecked = false;
                });
                
                var methodCheckbox = container.querySelector('.method-checkbox[data-method="' + method + '"]');
                methodCheckbox.checked = allChecked;
                methodCheckbox.indeterminate = anyChecked && !allChecked;
            });
        });
    }

    if (config.dataUrl && config.dataUrl !== "") {
        showStatus("Loading Data...");
        Papa.parse(config.dataUrl, {
            download: true, header: true, skipEmptyLines: true,
            complete: function(results) {
                if (results.data && results.data.length > 0) processData(results.data);
                else showStatus("Data file is empty.");
            },
            error: function() { showStatus("Error loading CSV."); }
        });
    }
}
