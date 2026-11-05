#!/usr/bin/env node
// Generates the files the evaluation serves at https://data.example.com/ (see
// run.mjs): weather stations as CSV, their readings as Parquet, weather alerts
// as JSON, and a warehouse inventory as a DuckDB database. They are about
// other things than the shop, so a model cannot answer from the loaded tables.
//
// Deterministic (seeded); rerun only to change the data, then commit the files
// in data/remote. Needs the DuckDB CLI on the PATH for the Parquet and DuckDB
// files, in a version DuckDB-Wasm can read (the same or older).

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const out = resolve(dirname(fileURLToPath(import.meta.url)), 'data/remote');
const scratch = mkdtempSync(join(tmpdir(), 'ai-eval-remote-'));
mkdirSync(join(out, 'weather'), { recursive: true });
mkdirSync(join(out, 'logistics'), { recursive: true });

// mulberry32, as in generate-data.mjs.
let seed = 20250601;
const random = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (min, max) => min + Math.floor(random() * (max - min + 1));
const pick = (items) => items[Math.floor(random() * items.length)];
const pad = (n, width = 2) => String(n).padStart(width, '0');
const csv = (columns, rows) => [columns.join(','), ...rows.map((row) => columns.map((column) => row[column]).join(','))].join('\n') + '\n';

/** Runs SQL in the DuckDB CLI, without the user's ~/.duckdbrc. */
function duckdb(sql, database = ':memory:') {
  const env = { ...process.env };
  delete env.AI_AGENT;
  const result = spawnSync('duckdb', ['-init', '/dev/null', database, '-c', sql], { encoding: 'utf8', env });
  if (result.error) throw new Error(`The DuckDB CLI is needed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

// Weather stations: the column is country_code, while questions say "country".
// The station counts per country differ, so "the most" has one answer.
const countries = [['DE', 10], ['FR', 8], ['NL', 6], ['AT', 5], ['CH', 4], ['BE', 3]];
const places = ['Hill', 'Lake', 'Field', 'Harbor', 'Ridge', 'Valley', 'Forest', 'Airport', 'Bridge', 'Meadow'];
const stations = [];
for (const [country, count] of countries) {
  for (let i = 0; i < count; i++) {
    const id = stations.length + 1;
    stations.push({
      station_id: `ST${pad(id, 3)}`,
      station_name: `${pick(places)} ${country}-${pad(i + 1)}`,
      country_code: country,
      elevation_m: int(0, 1800),
      opened_on: `${int(1960, 2015)}-${pad(int(1, 12))}-${pad(int(1, 28))}`,
    });
  }
}
writeFileSync(join(out, 'weather/stations.csv'), csv(['station_id', 'station_name', 'country_code', 'elevation_m', 'opened_on'], stations));

// Daily readings of every station in June 2025, written as Parquet.
const readings = [];
for (const station of stations) {
  for (let day = 1; day <= 30; day++) {
    readings.push({
      station_id: station.station_id,
      reading_date: `2025-06-${pad(day)}`,
      temperature_c: (int(80, 320) / 10).toFixed(1),
      precipitation_mm: (random() < 0.6 ? 0 : int(1, 400) / 10).toFixed(1),
    });
  }
}
writeFileSync(join(scratch, 'readings.csv'), csv(['station_id', 'reading_date', 'temperature_c', 'precipitation_mm'], readings));
duckdb(`COPY (SELECT * FROM read_csv('${join(scratch, 'readings.csv')}')) TO '${join(out, 'weather/readings.parquet')}' (FORMAT parquet)`);

// Weather alerts as a JSON array.
const severities = ['minor', 'minor', 'minor', 'moderate', 'moderate', 'severe'];
const alerts = Array.from({ length: 45 }, (_, i) => ({
  alert_id: i + 1,
  station_id: pick(stations).station_id,
  severity: pick(severities),
  issued_at: `2025-06-${pad(int(1, 30))} ${pad(int(0, 23))}:${pad(int(0, 59))}:00`,
}));
writeFileSync(join(out, 'weather/alerts.json'), `${JSON.stringify(alerts, null, 1)}\n`);

// A warehouse inventory as a DuckDB database, gzipped (a small database file is mostly empty blocks).
const warehouses = [
  { warehouse_id: 1, city: 'Rotterdam', opened_on: '2015-04-01' },
  { warehouse_id: 2, city: 'Leipzig', opened_on: '2018-09-15' },
  { warehouse_id: 3, city: 'Lyon', opened_on: '2020-02-01' },
  { warehouse_id: 4, city: 'Poznan', opened_on: '2022-06-20' },
];
const stock = [];
for (let sku = 1; sku <= 150; sku++) {
  stock.push({ sku: `SKU-${pad(sku, 4)}`, warehouse_id: pick(warehouses).warehouse_id, quantity: int(0, 120), updated_at: `2025-06-${pad(int(1, 30))}` });
}
writeFileSync(join(scratch, 'warehouses.csv'), csv(['warehouse_id', 'city', 'opened_on'], warehouses));
writeFileSync(join(scratch, 'stock.csv'), csv(['sku', 'warehouse_id', 'quantity', 'updated_at'], stock));
const database = join(scratch, 'inventory.duckdb');
duckdb([
  `CREATE TABLE warehouses AS SELECT * FROM read_csv('${join(scratch, 'warehouses.csv')}')`,
  `CREATE TABLE stock AS SELECT * FROM read_csv('${join(scratch, 'stock.csv')}')`,
  'CHECKPOINT',
].join('; '), database);
writeFileSync(join(out, 'logistics/inventory.duckdb.gz'), gzipSync(readFileSync(database), { level: 9 }));
rmSync(scratch, { recursive: true, force: true });

console.log(`stations.csv: ${stations.length} rows, readings.parquet: ${readings.length} rows, alerts.json: ${alerts.length} alerts, ` +
  `inventory.duckdb: ${warehouses.length} warehouses and ${stock.length} stock rows`);
