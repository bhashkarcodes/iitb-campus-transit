# IITB Campus Live Auto & Buggy Tracker

A live map of shared autos and electric buggies on the IIT Bombay campus, with route planning and ETAs. It runs entirely in the browser. No build step, no server, no API keys.

**Live demo:** https://bhashkarcodes.github.io/iitb-campus-transit/
![Screenshot of the prototype showing a planned route from Hostel 16 to the Lecture Hall Complex]()

---

## What it does

- **Campus map.** 29 landmarks: three gates, Main Building, Convocation Hall, Central Library, LHC, KReSIT, SAC, Gymkhana and Hostels 1 to 18\.  
- **Live fleet.** Seven autos and four buggies move along the road network and report status, occupancy, speed and fuel or battery every 2.5 seconds.  
- **Route planning.** Pick two points from the dropdowns or click the map. Dijkstra over 499 road nodes gives the optimised route in blue and an alternative in grey, with walking and riding ETAs.  
- **Door-to-door timing.** Ride time plus the 7.3 minute average wait measured in our campus survey, which is often what decides whether walking is faster.  
- **Layer toggles** for autos, buggies, hostels, the academic zone and the raw road graph.

The vehicle positions are simulated. Everything else, including the roads and the distances, is real. See [docs/real-data.md](http://docs/real-data.md) for how to connect actual GPS feeds.

## Running it locally

Clone and open `index.html`:

git clone https://github.com/USERNAME/iitb-campus-transit.git

cd iitb-campus-transit

python3 \-m http.server 8000

Then visit `http://localhost:8000`. You can also just double-click `index.html`, though some browsers restrict pages opened from `file://`.

`dist/iitb-transit-standalone.html` is the same application inlined into one file, for sharing over email or a USB stick.

## Project structure

.

├── index.html                       the page

├── css/

│   └── styles.css                   all styling, colours defined in :root

├── js/

│   ├── campus-data.js               landmarks, roads, speeds  \<- edit this

│   └── app.js                       geometry, routing, simulation, UI

├── dist/

│   └── iitb-transit-standalone.html single-file build

├── docs/

│   ├── real-data.md                 connecting live GPS

│   ├── deploying.md                 publishing to GitHub Pages

│   └── screenshot.jpg

├── .editorconfig

├── .gitignore

├── LICENSE

└── README.md

To move the prototype to another campus you only edit `js/campus-data.js`.

## How the routing works

The road network is a list of polylines. Points are de-duplicated to five decimal places, so roads that share a point automatically join there, which turns the list into a graph. Dijkstra finds the shortest path, then runs again with every edge of the first route weighted up by 3.2, which produces a genuinely different alternative rather than the same road twice. About 85% of landmark pairs have one.

Distances include the walk from each endpoint onto the road network, so a trip between two buildings that share a road node still reports a sensible number.

## Data and licence

Landmark coordinates and the road network come from OpenStreetMap, simplified to about five metres. That data is © OpenStreetMap contributors and is licensed under the [ODbL](https://www.openstreetmap.org/copyright), which is why the attribution in the corner of the map has to stay. Hostels 17 and 18 are not mapped individually in OSM, so those two pins sit at the middle of their block.

The code is MIT licensed. See [LICENSE](http://LICENSE).

## Background

This came out of a campus transit study: a survey of 56 students and interviews with 10 auto drivers. The headline finding is that students wait an average of 7.3 minutes and drivers wait 5.3 minutes between fares, so every completed ride carries about 12.6 minutes of waiting on both sides. That is a matching problem, not a shortage of vehicles, which is the gap this prototype is meant to close.
