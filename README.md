# PULSE – HIIT Timer

Eine installierbare, offline-fähige HIIT-Web-App ohne Framework, Build-Prozess, Accounts oder externe Ressourcen. Standardsession: 60 s Aufwärmen, fünf Übungen à 40 s, 20 s Übungspause, drei Runden, 60 s Rundenpause nach jeder Runde einschließlich der letzten. Gesamtdauer: 18 Minuten inklusive Rundenpause nach der letzten Runde.

## Lokal starten

```bash
python3 -m http.server 8080
```

Dann `http://localhost:8080` öffnen. Service Worker benötigen HTTPS oder `localhost`; die App selbst funktioniert lokal auch ohne Service Worker.

## Auf Vercel bereitstellen

Importiere diesen Ordner als Vercel-Projekt (Framework Preset: Other, Root Directory: Projektordner, kein Build Command/Output Directory erforderlich) oder nutze im Ordner `vercel --prod` nach dem Anmelden.

## iPhone

Die veröffentlichte HTTPS-Adresse in Safari öffnen → Teilen → „Zum Home-Bildschirm“. Einmal vollständig online öffnen, dann sind alle benötigten Dateien für die Offline-Verwendung zwischengespeichert. Für hörbare Hinweise während des Trainings die App geöffnet lassen; iOS kann Audio im Hintergrund einschränken.

## Bedienung

Start/Pause, vorheriges/nächstes Intervall, zurücksetzen, Vollbild (wo vom Browser unterstützt), Toneffekte und bearbeitbare Übungen/Intervalle. Konfiguration wird lokal im Browser gespeichert. Während des Timers sind Trainingsplanänderungen gesperrt. Die Restzeit wird anhand der tatsächlichen Uhrzeit berechnet, um Timer-Drosselung im Hintergrund auszugleichen. Ein Wake Lock wird angefordert, falls das Gerät dies unterstützt.

## Tests

```bash
node tests/timer-core.test.js
node --check app.js
node --check service-worker.js
```
