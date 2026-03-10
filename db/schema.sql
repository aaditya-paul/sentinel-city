-- Enable PostGIS for geographic locations if needed (optional for exact bounding box queries, but we can also just use simple floats for 200m grid for the MVP)
-- CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS locations_grid (
    id SERIAL PRIMARY KEY,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    stress_index FLOAT NOT NULL DEFAULT 0.0,
    noise_score FLOAT NOT NULL DEFAULT 0.0,
    crowd_score FLOAT NOT NULL DEFAULT 0.0,
    aqi_score FLOAT NOT NULL DEFAULT 0.0,
    temperature_score FLOAT NOT NULL DEFAULT 0.0,
    traffic_score FLOAT NOT NULL DEFAULT 0.0,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexing for bounding box queries, simple B-Tree on lat/lng will be sufficient for an MVP without PostGIS
CREATE INDEX idx_locations_grid_lat_lng ON locations_grid (latitude, longitude);

CREATE TABLE IF NOT EXISTS signals_raw (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    noise FLOAT,
    crowd FLOAT,
    aqi FLOAT,
    temperature FLOAT,
    traffic FLOAT
);
