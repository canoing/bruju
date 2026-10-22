    (() => {
      const API_KEY = "AIzaSyCGocQJg4P8EnWXpHWijF2We0Bc_JNz5Qc";
      const SCORE_MAX = 5000;
      const SCORE_DISTANCE_SCALE_METERS = 1000;
      const MISSION_RADIUS_METERS = 50000;

      const elements = {
        statusLight: document.getElementById("statusLight"),
        statusText: document.getElementById("statusText"),
        coordinateReadout: document.getElementById("coordinateReadout"),
        roundId: document.getElementById("roundId"),
        roundName: document.getElementById("roundName"),
        headingReadout: document.getElementById("headingReadout"),
        cardinalReadout: document.getElementById("cardinalReadout"),
        compassHeading: document.getElementById("compassHeading"),
        compassCardinal: document.getElementById("compassCardinal"),
        compass: document.getElementById("compass"),
        sceneCoordinates: document.getElementById("sceneCoordinates"),
        sceneLoader: document.getElementById("sceneLoader"),
        loaderTitle: document.getElementById("loaderTitle"),
        loaderCopy: document.getElementById("loaderCopy"),
        openMapButton: document.getElementById("openMapButton"),
        mapOverlay: document.getElementById("mapOverlay"),
        mapInstruction: document.getElementById("mapInstruction"),
        lineStatus: document.getElementById("lineStatus"),
        guessToolButton: document.getElementById("guessToolButton"),
        lineToolButton: document.getElementById("lineToolButton"),
        clearLinesButton: document.getElementById("clearLinesButton"),
        confirmButton: document.getElementById("confirmButton"),
        resultCard: document.getElementById("resultCard"),
        scoreReadout: document.getElementById("scoreReadout"),
        distanceReadout: document.getElementById("distanceReadout"),
        resultNote: document.getElementById("resultNote")
      };

      const cardinalDirections = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
      let previousCompassHeading = null;
      let compassRotation = 0;
      let locations = [];
      let currentLocation = null;
      let locationIndex = 0;
      let mapsApiReady = false;
      let mapInitialized = false;
      let map;
      let missionBoundary = null;
      let panorama;
      let guessMarker = null;
      let actualMarker = null;
      let guessPosition = null;
      let lineStart = null;
      let previewLine = null;
      let previewAzimuthMarker = null;
      let lines = [];
      let activeTool = "guess";
      let submitted = false;

      function setStatus(message, state) {
        elements.statusText.textContent = message;
        elements.statusLight.classList.toggle("ready", state === "ready");
        elements.statusLight.classList.toggle("error", state === "error");
      }

      function showLoader(title, message, error = false) {
        elements.loaderTitle.textContent = title;
        elements.loaderCopy.textContent = message;
        elements.sceneLoader.classList.remove("dismissed");
        elements.sceneLoader.querySelector(".loading-bar").hidden = error;
      }

      function showFatalError(message) {
        setStatus("ERROR DE INICIALIZACIÓN", "error");
        showLoader("No se pudo iniciar la misión", message, true);
      }

      function normalizeHeading(heading) {
        return ((heading % 360) + 360) % 360;
      }

      function updateHeading(heading) {
        const normalized = normalizeHeading(heading || 0);
        if (previousCompassHeading === null) {
          compassRotation = -normalized;
        } else {
          const shortestTurn = ((normalized - previousCompassHeading + 540) % 360) - 180;
          compassRotation -= shortestTurn;
        }
        previousCompassHeading = normalized;
        const degrees = Math.round(normalized).toString().padStart(3, "0");
        const cardinal = cardinalDirections[Math.round(normalized / 45) % 8];
        elements.headingReadout.textContent = `${degrees}°`;
        elements.compassHeading.textContent = `${degrees}°`;
        elements.cardinalReadout.textContent = cardinal;
        elements.compassCardinal.textContent = cardinal;
        elements.compass.style.setProperty("--heading", `${normalized}deg`);
        elements.compass.querySelectorAll(".compass-rose").forEach((rose) => {
          rose.style.transform = `rotate(${compassRotation}deg)`;
        });
        if (guessMarker) {
          guessMarker.setIcon(arrowIcon(normalized, submitted ? "#dc725d" : "#e2a354"));
          guessMarker.setTitle(`Tu posición estimada · mirando a ${degrees}° ${cardinal}`);
        }
        elements.lineStatus.innerHTML = `RUMBO DE VISTA <strong>${degrees}° ${cardinal}</strong>`;
      }

      function setTool(tool) {
        if (activeTool !== tool) cancelPendingLine();
        activeTool = tool;
        const isGuess = tool === "guess";
        elements.guessToolButton.classList.toggle("active", isGuess);
        elements.guessToolButton.setAttribute("aria-pressed", String(isGuess));
        elements.lineToolButton.classList.toggle("active", !isGuess);
        elements.lineToolButton.setAttribute("aria-pressed", String(!isGuess));
        elements.mapInstruction.innerHTML = isGuess
          ? "<strong>Marcar posición:</strong> selecciona un punto del mapa o arrastra la flecha para ajustar."
          : lineStart
            ? "<strong>Trazar línea:</strong> selecciona el punto final para completar el rumbo."
            : "<strong>Trazar línea:</strong> selecciona dos puntos del mapa para dibujar una línea de orientación.";
        map.setOptions({ draggableCursor: isGuess ? "crosshair" : "crosshair" });
      }

      function validateLocations(data) {
        if (!data || !Array.isArray(data.locations) || data.locations.length === 0) {
          throw new Error("coord.json debe incluir una lista «locations» con al menos una coordenada.");
        }
        return data.locations.map((location, index) => {
          const lat = Number(location.lat);
          const lng = Number(location.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            throw new Error(`La coordenada de la ubicación ${index + 1} en coord.json no es válida.`);
          }
          return {
            name: typeof location.name === "string" && location.name.trim() ? location.name.trim() : `Punto ${index + 1}`,
            lat,
            lng
          };
        });
      }

      async function loadLocations() {
        try {
          const response = await fetch("./coord.json", { cache: "no-store" });
          if (!response.ok) throw new Error(`No se pudo cargar coord.json (HTTP ${response.status}).`);
          locations = validateLocations(await response.json());
          locationIndex = Math.floor(Math.random() * locations.length);
          currentLocation = locations[locationIndex];
          elements.roundId.textContent = `RONDA ${String(locationIndex + 1).padStart(2, "0")}`;
          elements.roundName.textContent = currentLocation.name;
          elements.coordinateReadout.textContent = "COORDENADAS OCULTAS";
          elements.sceneCoordinates.textContent = "COORDENADAS DEL OBJETIVO OCULTAS";
          initializeWhenReady();
        } catch (error) {
          showFatalError(error instanceof Error ? error.message : "Error desconocido al cargar coord.json.");
        }
      }

      function initializeWhenReady() {
        if (!mapsApiReady || !currentLocation || mapInitialized) return;
        mapInitialized = true;
        try {
          initializeMaps();
        } catch (error) {
          mapInitialized = false;
          showFatalError(error instanceof Error ? error.message : "No se pudo inicializar Google Maps.");
        }
      }

      function initializeMaps() {
        const target = { lat: currentLocation.lat, lng: currentLocation.lng };
        const mapCenter = { lat: target.lat + 0.0028, lng: target.lng + 0.0028 };
        const panoramaElement = document.getElementById("pano");
        const mapElement = document.getElementById("map");
        if (!google.maps || !google.maps.StreetViewPanorama || !google.maps.Map) {
          throw new Error("La API de Google Maps no está disponible. Revisa la clave y las APIs habilitadas.");
        }

        panorama = new google.maps.StreetViewPanorama(panoramaElement, {
          pov: { heading: 0, pitch: 0 },
          zoom: 0,
          disableDefaultUI: true,
          clickToGo: true,
          linksControl: true,
          panControl: true,
          zoomControl: true,
          addressControl: false,
          fullscreenControl: false,
          motionTracking: false
        });
        panorama.addListener("pov_changed", () => updateHeading(panorama.getPov().heading));
        panorama.addListener("pano_changed", () => {
          if (!panorama.getPano()) return;
          elements.sceneLoader.classList.add("dismissed");
          setStatus("SISTEMA EN LÍNEA", "ready");
        });
        panorama.addListener("visible_changed", () => {
          if (panorama.getVisible()) elements.sceneLoader.classList.add("dismissed");
        });
        panorama.addListener("position_changed", () => {
          if (panorama.getPosition()) elements.sceneCoordinates.textContent = "UBICACIÓN OCULTA · STREET VIEW";
        });

        map = new google.maps.Map(mapElement, {
          center: mapCenter,
          zoom: 15,
          mapTypeId: google.maps.MapTypeId.SATELLITE,
          restriction: {
            latLngBounds: getMissionBounds(target),
            strictBounds: true
          },
          disableDefaultUI: true,
          clickableIcons: false,
          keyboardShortcuts: true,
          gestureHandling: "greedy",
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          rotateControl: false,
          tilt: 0
        });
        missionBoundary = new google.maps.Circle({
          map,
          center: target,
          radius: MISSION_RADIUS_METERS,
          clickable: false,
          fillColor: "#c7dc72",
          fillOpacity: .04,
          strokeColor: "#c7dc72",
          strokeOpacity: .9,
          strokeWeight: 2,
          zIndex: 1
        });
        map.addListener("click", (event) => {
          if (!event.latLng || submitted) return;
          if (!isWithinMissionRadius(event.latLng)) {
            elements.mapInstruction.innerHTML = `<strong>Límite del área:</strong> el objetivo está a ${formatDistance(MISSION_RADIUS_METERS)} de radio.`;
            return;
          }
          if (activeTool === "guess") setGuess(event.latLng);
          else addLinePoint(event.latLng);
        });
        map.addListener("mousemove", (event) => {
          if (activeTool === "line" && lineStart && event.latLng && previewLine) {
            updateLinePreview(event.latLng);
          }
        });
        map.addListener("tilesloaded", () => {
          if (!elements.mapOverlay.classList.contains("open")) return;
          elements.openMapButton.disabled = false;
        });
        elements.openMapButton.disabled = false;
        setStatus("BUSCANDO STREET VIEW", "ready");
        updateHeading(panorama.getPov().heading);
        new google.maps.StreetViewService().getPanorama({
          location: target,
          radius: 100,
          preference: google.maps.StreetViewPreference.NEAREST
        }, (data, status) => {
          if (status !== google.maps.StreetViewStatus.OK || !data || !data.location) {
            showFatalError("No se encontró cobertura Street View para esta coordenada. Comprueba el punto de coord.json y la disponibilidad de Street View.");
            return;
          }
          panorama.setPano(data.location.pano);
          panorama.setPosition(data.location.latLng);
          panorama.setVisible(true);
          elements.sceneLoader.classList.add("dismissed");
          setStatus("SISTEMA EN LÍNEA", "ready");
        });
        window.setTimeout(() => {
          if (!panorama.getPano()) {
            showFatalError("No se encontró cobertura Street View para esta coordenada. Comprueba el punto de coord.json y la disponibilidad de Street View.");
          }
        }, 15000);
      }

      function getMissionBounds(center) {
        const latitudeRadius = MISSION_RADIUS_METERS / 111320;
        const longitudeRadius = latitudeRadius / Math.max(Math.cos(center.lat * Math.PI / 180), 0.01);
        return {
          north: Math.min(90, center.lat + latitudeRadius),
          south: Math.max(-90, center.lat - latitudeRadius),
          east: Math.min(180, center.lng + longitudeRadius),
          west: Math.max(-180, center.lng - longitudeRadius)
        };
      }

      function toLatLng(position) {
        if (typeof position.lat === "function") return position;
        return new google.maps.LatLng(position.lat, position.lng);
      }

      function isWithinMissionRadius(position) {
        if (!currentLocation) return false;
        const target = new google.maps.LatLng(currentLocation.lat, currentLocation.lng);
        return google.maps.geometry.spherical.computeDistanceBetween(target, toLatLng(position)) <= MISSION_RADIUS_METERS;
      }

      function clampToMissionRadius(position) {
        const point = toLatLng(position);
        const target = new google.maps.LatLng(currentLocation.lat, currentLocation.lng);
        const distance = google.maps.geometry.spherical.computeDistanceBetween(target, point);
        if (distance <= MISSION_RADIUS_METERS) return point;
        const heading = google.maps.geometry.spherical.computeHeading(target, point);
        return google.maps.geometry.spherical.computeOffset(target, MISSION_RADIUS_METERS, heading);
      }

      function arrowIcon(heading = panorama?.getPov().heading || 0, fillColor = "#e2a354") {
        return {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          fillColor,
          fillOpacity: 1,
          strokeColor: "#172018",
          strokeWeight: 1.5,
          scale: 7,
          rotation: normalizeHeading(heading)
        };
      }

      function azimuthLabelIcon(heading, cardinal) {
        const label = `${Math.round(heading).toString().padStart(3, "0")}° ${cardinal}`;
        const radians = heading * Math.PI / 180;
        const labelX = 75 + Math.sin(radians) * 37;
        const labelY = 75 - Math.cos(radians) * 37;
        const svg = `
          <svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">
            <rect x="${labelX - 36}" y="${labelY - 13}" width="72" height="26" rx="6" fill="#101411" fill-opacity=".96" stroke="#c7dc72" stroke-width="2"/>
            <text x="${labelX}" y="${labelY + 5.5}" fill="#f1f4ec" font-family="monospace" font-size="16" font-weight="700" text-anchor="middle">${label}</text>
          </svg>`;
        return {
          url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
          scaledSize: new google.maps.Size(90, 90),
          anchor: new google.maps.Point(45, 45)
        };
      }

      function setGuess(position) {
        const boundedPosition = clampToMissionRadius(position);
        guessPosition = { lat: boundedPosition.lat(), lng: boundedPosition.lng() };
        submitted = false;
        elements.resultCard.classList.remove("visible");
        if (!guessMarker) {
          guessMarker = new google.maps.Marker({
            map,
            position: guessPosition,
            draggable: true,
            clickable: true,
            title: "Tu posición estimada: arrastra para ajustar",
            icon: arrowIcon(),
            zIndex: 20
          });
          guessMarker.addListener("dragend", () => {
            const markerPosition = guessMarker.getPosition();
            if (markerPosition) {
              const boundedMarkerPosition = clampToMissionRadius(markerPosition);
              guessMarker.setPosition(boundedMarkerPosition);
              guessPosition = { lat: boundedMarkerPosition.lat(), lng: boundedMarkerPosition.lng() };
              elements.confirmButton.disabled = false;
            }
          });
        } else {
          guessMarker.setPosition(guessPosition);
          guessMarker.setMap(map);
        }
        elements.confirmButton.disabled = false;
        setTool("guess");
      }

      function addLinePoint(position) {
        if (!isWithinMissionRadius(position)) {
          elements.mapInstruction.innerHTML = `<strong>Límite del área:</strong> las líneas deben quedar dentro de ${formatDistance(MISSION_RADIUS_METERS)} del objetivo.`;
          return;
        }
        if (!lineStart) {
          lineStart = position;
          previewLine = new google.maps.Polyline({
            map,
            path: [lineStart, lineStart],
            geodesic: true,
            strokeColor: "#c7dc72",
            strokeOpacity: .92,
            strokeWeight: 2,
            icons: [{
              icon: { path: google.maps.SymbolPath.FORWARD_OPEN_ARROW, scale: 2, strokeColor: "#c7dc72" },
              offset: "100%"
            }]
          });
          previewAzimuthMarker = new google.maps.Marker({
            map,
            position: lineStart,
            clickable: false,
            title: "Azimut provisional de la línea",
            icon: azimuthLabelIcon(0, cardinalDirections[0]),
            zIndex: 25
          });
          previewLine.addListener("click", (event) => {
            if (!event.latLng) return;
            event.domEvent?.stopPropagation();
            addLinePoint(event.latLng);
          });
          elements.mapInstruction.innerHTML = "<strong>Azimut provisional:</strong> mueve el cursor para orientar la línea.";
          return;
        }
        if (!previewLine || !previewAzimuthMarker) return;
        const lineEnd = position;
        previewLine.setPath([lineStart, lineEnd]);
        lines.push(previewLine);
        updateLinePreview(lineEnd);
        const heading = google.maps.geometry.spherical.computeHeading(lineStart, lineEnd);
        const normalizedHeading = normalizeHeading(heading);
        const normalized = Math.round(normalizedHeading).toString().padStart(3, "0");
        const cardinal = cardinalDirections[Math.round(normalizedHeading / 45) % 8];
        previewAzimuthMarker.setPosition(lineEnd);
        previewAzimuthMarker.setIcon(azimuthLabelIcon(normalizedHeading, cardinal));
        previewAzimuthMarker.setTitle(`Azimut de la línea: ${normalized}° ${cardinal}`);
        lines.push(previewAzimuthMarker);
        elements.mapInstruction.innerHTML = `<strong>Línea trazada:</strong> ${normalized}° ${cardinal}. Selecciona otros dos puntos para añadir otra.`;
        lineStart = null;
        previewLine = null;
        previewAzimuthMarker = null;
      }

      function updateLinePreview(position) {
        if (!lineStart || !previewLine || !previewAzimuthMarker) return;
        const endpoint = clampToMissionRadius(position);
        const heading = normalizeHeading(google.maps.geometry.spherical.computeHeading(lineStart, endpoint));
        const normalized = Math.round(heading).toString().padStart(3, "0");
        const cardinal = cardinalDirections[Math.round(heading / 45) % 8];
        previewLine.setPath([lineStart, endpoint]);
        previewAzimuthMarker.setPosition(endpoint);
        previewAzimuthMarker.setIcon(azimuthLabelIcon(heading, cardinal));
        previewAzimuthMarker.setTitle(`Azimut provisional: ${normalized}° ${cardinal}`);
        elements.mapInstruction.innerHTML = `<strong>Azimut provisional:</strong> ${normalized}° ${cardinal}.`;
      }

      function cancelPendingLine() {
        if (previewLine) previewLine.setMap(null);
        if (previewAzimuthMarker) previewAzimuthMarker.setMap(null);
        previewLine = null;
        previewAzimuthMarker = null;
        lineStart = null;
      }

      function openMap() {
        elements.mapOverlay.classList.add("open");
        elements.mapOverlay.setAttribute("aria-hidden", "false");
        google.maps.event.trigger(map, "resize");
        if (submitted && actualMarker && guessPosition) {
          const bounds = new google.maps.LatLngBounds();
          bounds.extend(guessPosition);
          bounds.extend(currentLocation);
          map.fitBounds(bounds, 80);
        } else if (guessPosition && guessMarker) {
          map.panTo(guessPosition);
        }
      }

      function closeMap() {
        elements.mapOverlay.classList.remove("open");
        elements.mapOverlay.setAttribute("aria-hidden", "true");
        cancelPendingLine();
        setTool("guess");
      }

      function clearLines() {
        lines.forEach((line) => line.setMap(null));
        lines = [];
        cancelPendingLine();
        elements.mapInstruction.innerHTML = activeTool === "line"
          ? "<strong>Trazar línea:</strong> selecciona dos puntos del mapa para dibujar una línea de orientación."
          : "<strong>Marcar posición:</strong> selecciona un punto del mapa o arrastra la flecha para ajustar.";
      }

      function haversineDistanceMeters(first, second) {
        const radians = (degrees) => degrees * Math.PI / 180;
        const lat1 = radians(first.lat);
        const lat2 = radians(second.lat);
        const deltaLat = radians(second.lat - first.lat);
        const deltaLng = radians(second.lng - first.lng);
        const a = Math.sin(deltaLat / 2) ** 2
          + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
        return 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }

      function formatDistance(meters) {
        if (meters < 1000) return `${Math.round(meters)} m`;
        return `${(meters / 1000).toFixed(2).replace(".", ",")} km`;
      }

      function confirmGuess() {
        if (!guessPosition || !currentLocation || submitted) return;
        submitted = true;
        const distance = haversineDistanceMeters(currentLocation, guessPosition);
        const score = Math.round(SCORE_MAX * Math.exp(-distance / SCORE_DISTANCE_SCALE_METERS));
        guessMarker.setDraggable(false);
        guessMarker.setIcon(arrowIcon(panorama.getPov().heading, "#dc725d"));
        elements.confirmButton.disabled = true;
        elements.scoreReadout.textContent = score.toLocaleString("es-ES");
        elements.distanceReadout.textContent = `Distancia al objetivo: ${formatDistance(distance)}.`;
        elements.resultNote.textContent = distance < 50
          ? "Excelente precisión. Has llegado prácticamente al punto exacto."
          : distance < 250
            ? "Muy buen trabajo. Tu lectura del terreno fue precisa."
            : distance < 1000
              ? "Buen comienzo. Combina más referencias y líneas de orientación."
              : "Sigue las referencias del terreno y cruza más rumbos antes de marcar.";
        elements.resultCard.classList.add("visible");

        actualMarker = new google.maps.Marker({
          map,
          position: currentLocation,
          title: `Objetivo real: ${currentLocation.name}`,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: "#c7dc72",
            fillOpacity: 1,
            strokeColor: "#172018",
            strokeWeight: 2,
            scale: 7
          },
          zIndex: 30
        });
        const resultLine = new google.maps.Polyline({
          map,
          path: [guessPosition, currentLocation],
          geodesic: true,
          clickable: false,
          strokeColor: "#e2a354",
          strokeOpacity: .95,
          strokeWeight: 2,
          zIndex: 10
        });
        lines.push(resultLine);
        const resultBounds = new google.maps.LatLngBounds();
        resultBounds.extend(guessPosition);
        resultBounds.extend(currentLocation);
        map.fitBounds(resultBounds, 80);
        closeMap();
      }

      function startNextRound() {
        if (!locations.length) return;
        if (guessMarker) guessMarker.setMap(null);
        if (actualMarker) actualMarker.setMap(null);
        clearLines();
        guessMarker = null;
        guessPosition = null;
        submitted = false;
        elements.confirmButton.disabled = true;
        elements.resultCard.classList.remove("visible");
        locationIndex = (locationIndex + 1) % locations.length;
        currentLocation = locations[locationIndex];
        elements.roundId.textContent = `RONDA ${String(locationIndex + 1).padStart(2, "0")}`;
        elements.roundName.textContent = currentLocation.name;
        elements.coordinateReadout.textContent = "COORDENADAS OCULTAS";
        const target = { lat: currentLocation.lat, lng: currentLocation.lng };
        map.setOptions({
          restriction: {
            latLngBounds: getMissionBounds(target),
            strictBounds: true
          }
        });
        missionBoundary.setCenter(target);
        map.setCenter({ lat: target.lat + 0.0028, lng: target.lng + 0.0028 });
        panorama.setPosition(target);
        panorama.setPov({ heading: 0, pitch: 0 });
        panorama.setVisible(true);
        showLoader("Cambiando de ubicación", "Cargando el siguiente punto de la misión.");
        setStatus("CAMBIANDO DE UBICACIÓN", "ready");
      }

      function makeCompassDraggable() {
        let dragging = false;
        let startX = 0;
        let startY = 0;
        let originX = 0;
        let originY = 0;
        elements.compass.addEventListener("pointerdown", (event) => {
          const bounds = elements.compass.getBoundingClientRect();
          dragging = true;
          startX = event.clientX;
          startY = event.clientY;
          originX = bounds.left;
          originY = bounds.top;
          elements.compass.setPointerCapture(event.pointerId);
        });
        elements.compass.addEventListener("pointermove", (event) => {
          if (!dragging) return;
          const scene = document.querySelector(".scene").getBoundingClientRect();
          const bounds = elements.compass.getBoundingClientRect();
          const x = Math.max(8, Math.min(scene.width - bounds.width - 8, originX + event.clientX - startX - scene.left));
          const y = Math.max(42, Math.min(scene.height - bounds.height - 8, originY + event.clientY - startY - scene.top));
          elements.compass.style.left = `${x}px`;
          elements.compass.style.top = `${y}px`;
        });
        const stopDragging = () => { dragging = false; };
        elements.compass.addEventListener("pointerup", stopDragging);
        elements.compass.addEventListener("pointercancel", stopDragging);
      }

      document.getElementById("openMapButton").addEventListener("click", openMap);
      document.getElementById("closeMapButton").addEventListener("click", closeMap);
      elements.guessToolButton.addEventListener("click", () => setTool("guess"));
      elements.lineToolButton.addEventListener("click", () => setTool("line"));
      elements.clearLinesButton.addEventListener("click", clearLines);
      elements.confirmButton.addEventListener("click", confirmGuess);
      document.getElementById("nextRoundButton").addEventListener("click", startNextRound);
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && elements.mapOverlay.classList.contains("open")) closeMap();
      });
      makeCompassDraggable();

      window.initRumboMaps = () => {
        mapsApiReady = true;
        initializeWhenReady();
      };
      window.gm_authFailure = () => {
        showFatalError("Google Maps rechazó la clave de API. Verifica su validez, restricciones y facturación.");
      };
      window.addEventListener("error", (event) => {
        if (event.message && event.message.toLowerCase().includes("google")) {
          showFatalError("No se pudo cargar Google Maps. Revisa la conexión y la configuración de la clave.");
        }
      });

      loadLocations();
      const mapsScript = document.createElement("script");
      mapsScript.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(API_KEY)}&callback=initRumboMaps&libraries=geometry&loading=async&v=weekly`;
      mapsScript.async = true;
      mapsScript.defer = true;
      mapsScript.onerror = () => showFatalError("No se pudo descargar la API de Google Maps. Comprueba tu conexión.");
      document.head.appendChild(mapsScript);
    })();
