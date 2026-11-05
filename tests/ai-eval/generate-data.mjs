#!/usr/bin/env node
// Generates the evaluation dataset: a small online shop in tests/ai-eval/data.
// Deterministic (seeded); rerun only to change the data, then commit the CSVs.
//
// Deliberate data problems, like in real exports: emails that differ only in
// case, lowercase country codes, products with missing or negative prices, and
// orders whose customer does not exist.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), 'data');
mkdirSync(out, { recursive: true });

// mulberry32: small, seeded, reproducible.
let seed = 20241231;
const random = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (min, max) => min + Math.floor(random() * (max - min + 1));
const pick = (items) => items[Math.floor(random() * items.length)];
const weighted = (pairs) => {
  let roll = random() * pairs.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [value, weight] of pairs) if ((roll -= weight) < 0) return value;
  return pairs.at(-1)[0];
};
const pad = (n) => String(n).padStart(2, '0');
const timestamp = (date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
const day = (date) => timestamp(date).slice(0, 10);
const between = (from, to) => new Date(from.getTime() + random() * (to.getTime() - from.getTime()));
const csvValue = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const writeCsv = (name, columns, rows) => {
  writeFileSync(resolve(out, name), [columns.join(','), ...rows.map((row) => columns.map((c) => csvValue(row[c])).join(','))].join('\n') + '\n');
  console.log(`${name}: ${rows.length} rows`);
};

// Customers
const firstNames = ['Anna', 'Ben', 'Clara', 'David', 'Emma', 'Felix', 'Greta', 'Hugo', 'Ines', 'Jonas', 'Klara', 'Lukas', 'Mia', 'Noah', 'Olivia', 'Paul', 'Rosa', 'Sam', 'Tara', 'Uwe', 'Vera', 'Wim', 'Yara', 'Zoe'];
const lastNames = ['Schmidt', 'Dubois', 'de Vries', 'Smith', 'Garcia', 'Becker', 'Martin', 'Jansen', 'Brown', 'Lopez', 'Wagner', 'Bernard', 'Bakker', 'Taylor', 'Fernandez', 'Hoffmann'];
const countries = [['DE', 35], ['FR', 18], ['NL', 14], ['US', 15], ['GB', 10], ['ES', 8]];
const customers = [];
const usedEmails = new Set();
for (let id = 1; id <= 150; id++) {
  const first = pick(firstNames);
  const last = pick(lastNames);
  let email = `${first}.${last.replace(/ /g, '')}`.toLowerCase();
  while (usedEmails.has(email)) email = `${email}${int(1, 99)}`;
  usedEmails.add(email);
  let country = weighted(countries);
  if (id % 23 === 0) country = country.toLowerCase(); // inconsistent codes
  customers.push({
    customer_id: id,
    email: `${email}@example.com`,
    first_name: first,
    last_name: last,
    country,
    signup_date: day(between(new Date('2023-01-01T00:00:00Z'), new Date('2024-11-30T00:00:00Z'))),
    marketing_opt_in: random() < 0.55,
  });
}
// Duplicate accounts: the same address with different capitalization.
for (const [id, source] of [[151, 12], [152, 47], [153, 88], [154, 131]]) {
  const original = customers[source - 1];
  const [local, domain] = original.email.split('@');
  customers.push({
    ...original,
    customer_id: id,
    email: `${local.split('.').map((part) => part[0].toUpperCase() + part.slice(1)).join('.')}@${domain.toUpperCase()}`,
    signup_date: day(between(new Date('2024-01-01T00:00:00Z'), new Date('2024-11-30T00:00:00Z'))),
  });
}
writeCsv('customers.csv', ['customer_id', 'email', 'first_name', 'last_name', 'country', 'signup_date', 'marketing_opt_in'], customers);

// Products
const catalog = {
  Kitchen: ['Ceramic Mug', 'Chef Knife', 'Cutting Board', 'French Press', 'Spice Rack', 'Cast Iron Pan', 'Tea Kettle', 'Salad Bowl'],
  Electronics: ['Wireless Mouse', 'USB-C Hub', 'Bluetooth Speaker', 'Noise Cancelling Headphones', 'Phone Charger', 'Smart Plug', 'Webcam', 'Mechanical Keyboard'],
  Books: ['SQL for Analysts', 'The Data Warehouse Toolkit', 'Cooking for Two', 'Gardening Basics', 'Travel Guide Portugal', 'Mystery at Sea', 'Learning DuckDB', 'Poems of the North'],
  Garden: ['Garden Hose', 'Pruning Shears', 'Seed Starter Kit', 'Watering Can', 'Raised Bed Kit', 'Solar Lamp', 'Bird Feeder', 'Compost Bin'],
  Toys: ['Wooden Train Set', 'Puzzle 1000 Pieces', 'Building Blocks', 'Plush Bear', 'Kite', 'Board Game Classic', 'Remote Control Car', 'Craft Kit'],
};
const priceRange = { Kitchen: [8, 90], Electronics: [15, 250], Books: [9, 45], Garden: [6, 120], Toys: [10, 80] };
const products = [];
for (const [category, names] of Object.entries(catalog)) {
  for (const name of names) {
    const id = products.length + 1;
    const [low, high] = priceRange[category];
    products.push({
      product_id: id,
      sku: `SKU-${String(id).padStart(4, '0')}`,
      name,
      category,
      unit_price: (int(low * 100, high * 100) / 100).toFixed(2),
      active: random() < 0.9,
    });
  }
}
products[6].unit_price = null; // Tea Kettle: missing price
products[21].unit_price = null; // Mystery at Sea: missing price
products[33].unit_price = '-4.99'; // Puzzle 1000 Pieces: negative price
writeCsv('products.csv', ['product_id', 'sku', 'name', 'category', 'unit_price', 'active'], products);

// Orders, order items, refunds
const sellable = products.filter((product) => product.unit_price !== null && Number(product.unit_price) > 0);
const orders = [];
const items = [];
const refunds = [];
const reasons = [['damaged', 4], ['late delivery', 3], ['wrong item', 2], ['changed mind', 3]];
for (let n = 0; n < 700; n++) {
  const orderId = 1001 + n;
  // More orders towards the end of the year.
  const month = weighted([[0, 6], [1, 6], [2, 7], [3, 7], [4, 8], [5, 8], [6, 7], [7, 7], [8, 8], [9, 9], [10, 12], [11, 15]]);
  const orderedAt = between(new Date(Date.UTC(2024, month, 1)), new Date(Date.UTC(2024, month + 1, 1) - 1000));
  const orphan = n % 117 === 50; // a customer that does not exist
  const customer = pick(customers);
  const status = weighted([['completed', 82], ['cancelled', 8], ['pending', 5], ['returned', 5]]);
  const blackFriday = month === 10 && orderedAt.getUTCDate() >= 25;
  const discount = blackFriday ? (random() < 0.7 ? 'BLACKFRIDAY' : null)
    : weighted([[null, 72], ['WELCOME10', 15], ['SUMMER15', month >= 5 && month <= 7 ? 13 : 0], ['NEWSLETTER5', 8]]);
  orders.push({
    order_id: orderId,
    customer_id: orphan ? 900 + n : customer.customer_id,
    order_ts: timestamp(orderedAt),
    status,
    shipping_country: customer.country.toUpperCase(),
    discount_code: discount,
  });
  let total = 0;
  const lines = weighted([[1, 40], [2, 30], [3, 20], [4, 10]]);
  for (let line = 1; line <= lines; line++) {
    const product = pick(sellable);
    const quantity = weighted([[1, 70], [2, 22], [3, 8]]);
    const unitPrice = Number(product.unit_price);
    total += quantity * unitPrice;
    items.push({ order_id: orderId, line_no: line, product_id: product.product_id, quantity, unit_price: unitPrice.toFixed(2) });
  }
  if ((status === 'returned' || (status === 'completed' && random() < 0.04))) {
    const full = status === 'returned';
    refunds.push({
      refund_id: refunds.length + 1,
      order_id: orderId,
      refunded_at: timestamp(new Date(orderedAt.getTime() + int(2, 20) * 86_400_000)),
      amount: (full ? total : Math.round(total * (0.2 + random() * 0.5) * 100) / 100).toFixed(2),
      reason: weighted(reasons),
    });
  }
}
writeCsv('orders.csv', ['order_id', 'customer_id', 'order_ts', 'status', 'shipping_country', 'discount_code'], orders);
writeCsv('order_items.csv', ['order_id', 'line_no', 'product_id', 'quantity', 'unit_price'], items);
writeCsv('refunds.csv', ['refund_id', 'order_id', 'refunded_at', 'amount', 'reason'], refunds);

// Website events for December 2024, kept as a raw file.
const events = [];
const pages = ['/', '/products', '/products/ceramic-mug', '/products/usb-c-hub', '/products/kite', '/blog/gift-guide'];
for (let visitor = 1; visitor <= 900; visitor++) {
  const anonymousId = `anon_${String(visitor).padStart(4, '0')}`;
  const customerId = random() < 0.4 ? pick(customers).customer_id : null;
  const source = weighted([['google', 40], ['newsletter', 18], ['instagram', 22], ['direct', 20]]);
  const device = random() < 0.62 ? 'mobile' : 'desktop';
  const sessions = weighted([[1, 60], [2, 25], [3, 15]]);
  for (let session = 0; session < sessions; session++) {
    let time = between(new Date('2024-12-01T00:00:00Z'), new Date('2024-12-31T22:00:00Z'));
    const add = (type, page) => {
      events.push({
        event_time: timestamp(time), anonymous_id: anonymousId, customer_id: customerId, event_type: type, page,
        properties: JSON.stringify({ utm_source: source, device }),
      });
      time = new Date(time.getTime() + int(20, 400) * 1000);
    };
    for (let views = int(1, 4); views > 0; views--) add('page_view', pick(pages));
    // Newsletter visitors convert best, Instagram visitors worst.
    const intent = { google: 0.28, newsletter: 0.45, instagram: 0.15, direct: 0.3 }[source];
    if (random() < intent) {
      add('add_to_cart', '/cart');
      if (random() < 0.6) {
        add('checkout', '/checkout');
        if (random() < 0.75) add('purchase', '/checkout/complete');
      }
    }
  }
}
events.sort((a, b) => a.event_time.localeCompare(b.event_time));
writeCsv('web_events.csv', ['event_time', 'anonymous_id', 'customer_id', 'event_type', 'page', 'properties'], events);
