# Connecting real data

The simulation is isolated on purpose. Every vehicle is an object with a position, a heading, a speed and a status, and `telemetryTick()` in `js/app.js` is the only function that changes those values. Replace that one function with a feed and the rest of the page does not care where the numbers came from.

## Step one: the hardware

Each vehicle needs something that knows where it is and can talk. Three options, cheapest first:

1. **A phone in the driver's pocket.** A small web page that calls `navigator.geolocation.watchPosition()` and posts the fix. Zero hardware cost, and you can pilot it this week. The catch is that it depends on the driver keeping the page open.  
2. **A dedicated GPS tracker**, the kind sold for fleet use, roughly ₹2,000 to ₹4,000 per unit plus a SIM. It speaks a fixed protocol, usually over TCP, and needs a small gateway to translate.  
3. **ESP32 with a NEO-6M or NEO-8M GPS module**, about ₹800 in parts. This is the one worth building if the project continues, because you control the firmware and it publishes MQTT directly.

## Step two: the transport

**MQTT** is the right fit for the hardware path. Run Mosquitto or use HiveMQ's free broker. Each vehicle publishes to its own topic:

campus/vehicles/auto-07   {"lat":19.1331,"lng":72.9148,"spd":18.4,"hdg":211,"ts":1717}

The browser subscribes over websockets with MQTT.js, so the page talks to the broker directly and there is still no backend of your own to run:

const client \= mqtt.connect('wss://broker.example.org:8084/mqtt');

client.subscribe('campus/vehicles/+');

client.on('message', (topic, buf) \=\> {

  const d \= JSON.parse(buf.toString());

  const v \= fleet.find(x \=\> x.id \=== topic.split('/').pop());

  if (v) { v.marker.setLatLng(\[d.lat, d.lng\]); v.speed \= d.spd; v.status \= d.status; }

});

**Firebase Realtime Database** is the fastest route to something working, and for a student project it is probably the right first choice. No broker to operate, offline handling included, and the client code is four lines:

import { getDatabase, ref, onValue } from 'firebase/database';

onValue(ref(getDatabase(), 'vehicles'), snap \=\> {

  Object.entries(snap.val()).forEach((\[id, d\]) \=\> applyUpdate(id, d));

});

Watch the billing. A vehicle publishing once a second, twelve hours a day, is around 43,000 writes per vehicle per day. Ten vehicles will still sit inside the free tier if you keep the payload small and drop updates when a vehicle is stationary, which you should do anyway.

**A WebSocket server of your own**, say `ws` on Node or FastAPI on Python, is worth it once you want server-side logic: matching a request to a vehicle, holding a booking, keeping history for analysis. Vehicles post to it, it fans out to browsers, and it becomes the place where the dispatch rules live.

## Step three: the parts that change on the page

Four things, and only four:

1. **Build the fleet from the feed** instead of from `PATROLS`. Keep `makeVehicle` for the marker and popup, drop the patrol path.  
2. **Replace `advance()` and `animate()`** with interpolation between the last two received fixes. Animating towards the newest fix over about 1.5 seconds hides GPS jitter and looks smoother than snapping.  
3. **Handle vehicles going quiet.** If no fix arrives for 30 seconds, grey the marker out. A stale dot that looks live is worse than no dot.  
4. **Snap fixes to the road graph.** `nearestNode()` already exists. Consumer GPS drifts 5 to 15 metres, enough to put an auto inside a building, and snapping removes most of it.

## Also worth doing

**Swap Dijkstra for OSRM** if you want turn-by-turn directions and live traffic weighting. A hosted instance answers `/route/v1/driving/lng,lat;lng,lat` and returns the geometry ready to draw. The graph in this file stays useful as the offline fallback.

**Add the demand side.** The whole point of the survey work is that waiting is a matching problem, not a supply problem. A request button that writes a pickup request to the same feed, and a driver view that shows nearby requests, is what turns this from a tracker into the thing that actually cuts the 12.6 minutes.

**Log everything from day one.** Every fix, every request, every match. Three weeks of that data answers the questions the interviews could only estimate: where vehicles idle, how long the search really takes, which hostels get skipped.

## A realistic order of work

| Stage | What it proves | Effort |
| :---- | :---- | :---- |
| Phone GPS on 2 vehicles into Firebase, this page as the display | The pipeline works end to end | A weekend |
| Request button and a driver view | Matching beats adding vehicles | A week |
| ESP32 trackers on the full fleet | It survives without driver cooperation | A month |
| Own WebSocket service with dispatch logic and history | It can be operated and measured | A term |

Every stage is useful on its own, and none of them requires the previous one to have been perfect.