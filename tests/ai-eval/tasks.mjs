// Evaluation tasks: questions people ask about their own data, on the online
// shop dataset (dataset.mjs), and about files and a database on the web
// (generate-remote.mjs; run.mjs serves them at https://data.example.com/).
// Expected answers come from each task's `reference` query (or the last of
// its statements), run in the same DuckDB before the model starts; tasks that
// change data are checked afterwards with their `verify` query. A task with
// `prompts` asks them in one conversation, as follow-up questions.
//
// A check receives (run, reference, verified):
//   run:       { answer, outcome, queries: [{ sql, ok, columns, rows }], ... }
//   reference: rows of the reference query (display strings)
//   verified:  rows of the verify query, or null when it failed
// Query results hold display strings: timestamps as ISO text, lists as JSON.

const NUMBER = /-?\d+(?:\.\d+)?/g;
const numbersIn = (text) => [...String(text).replace(/(\d),(?=\d{3}\b)/g, '$1').matchAll(NUMBER)].map((match) => Number(match[0]));
const close = (a, b) => Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.002);
const isNumber = (value) => value !== '' && value !== 'NULL' && !Number.isNaN(Number(value));

/** Whether `text` contains `value`: numbers within 0.2%, other values as case-insensitive words. */
const contains = (text, value) => {
  if (isNumber(value)) return numbersIn(text).some((number) => close(number, Number(value)));
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w@.])${escaped}($|[^\\w@])`, 'i').test(String(text));
};

const successful = (run) => run.queries.filter((query) => query.ok);
const cellsOf = (query) => query.rows.flat().join('\n');

/** All values appear in the answer, or all appear in the result of one query the model ran. */
const hasAll = (run, values) =>
  values.every((value) => contains(run.answer, value)) ||
  successful(run).some((query) => values.every((value) => contains(cellsOf(query), value)));

const column = (rows, index) => rows.map((row) => row[index]);
const result = (pass, reason) => ({ pass, reason });

/** The host run.mjs serves data/remote at. */
export const WEB = 'https://data.example.com';
const STATIONS = `${WEB}/weather/stations.csv`;
const READINGS = `${WEB}/weather/readings.parquet`;
const ALERTS = `${WEB}/weather/alerts.json`;
const INVENTORY = `${WEB}/logistics/inventory.duckdb`;
const COUNTRY_NAMES = { DE: 'Germany', FR: 'France', NL: 'Netherlands', AT: 'Austria', CH: 'Switzerland', BE: 'Belgium' };

/** A cell value, with an empty count (NULL) equal to 0. */
const cell = (value) => (value === 'NULL' ? '0' : String(value));

const REVENUE_2024_BY_MONTH = `
  SELECT date_trunc('month', o.order_ts) AS month, round(sum(i.quantity * i.unit_price), 2) AS revenue
  FROM orders o JOIN order_items i USING (order_id)
  WHERE o.status = 'completed' AND year(o.order_ts) = 2024
  GROUP BY month ORDER BY month`;

export const TASKS = [
  // Getting oriented
  {
    id: 'overview',
    prompt: 'I just loaded some shop data. Which tables are there and how many rows does each have?',
    reference: `SELECT 'customers', count(*) FROM customers UNION ALL SELECT 'products', count(*) FROM products
      UNION ALL SELECT 'orders', count(*) FROM orders UNION ALL SELECT 'order_items', count(*) FROM order_items
      UNION ALL SELECT 'refunds', count(*) FROM refunds`,
    check: (run, ref) => result(hasAll(run, ref.flat()), 'names all five tables with their row counts'),
  },
  {
    id: 'orders-by-status',
    prompt: 'How many orders do we have in each status?',
    reference: 'SELECT status, count(*) FROM orders GROUP BY status',
    check: (run, ref) => result(hasAll(run, ref.flat()), 'lists every status with its count'),
  },

  // Business questions
  {
    id: 'monthly-revenue',
    prompt: 'What was our revenue per month in 2024? Only count completed orders; revenue is quantity times unit price.',
    reference: REVENUE_2024_BY_MONTH,
    check: (run, ref) => result(hasAll(run, column(ref, 1)), 'all twelve monthly revenues'),
  },
  {
    id: 'top-products-q4',
    prompt: 'Which 5 products brought in the most revenue in Q4 2024, counting completed orders only?',
    reference: `SELECT p.name FROM orders o JOIN order_items i USING (order_id) JOIN products p USING (product_id)
      WHERE o.status = 'completed' AND o.order_ts >= '2024-10-01' AND o.order_ts < '2025-01-01'
      GROUP BY p.name ORDER BY sum(i.quantity * i.unit_price) DESC LIMIT 5`,
    check: (run, ref) => result(hasAll(run, column(ref, 0)), 'names the five top products'),
  },
  {
    id: 'aov-by-country',
    prompt: 'What is the average order value per shipping country for completed orders?',
    reference: `SELECT o.shipping_country, round(avg(t.total), 2) FROM orders o
      JOIN (SELECT order_id, sum(quantity * unit_price) AS total FROM order_items GROUP BY order_id) t USING (order_id)
      WHERE o.status = 'completed' GROUP BY o.shipping_country`,
    check: (run, ref) => result(hasAll(run, column(ref, 1)), 'average order value of every country'),
  },
  {
    id: 'best-customers',
    prompt: 'Who are our 5 best customers by total spend on completed orders? Show their email and how much they spent.',
    // Ranking accounts, or people after merging accounts whose emails differ only in case.
    reference: `WITH spend AS (SELECT c.customer_id, c.email, sum(i.quantity * i.unit_price) AS total
        FROM orders o JOIN order_items i USING (order_id) JOIN customers c USING (customer_id)
        WHERE o.status = 'completed' GROUP BY ALL)
      (SELECT 'account', email, round(total, 2) FROM spend ORDER BY total DESC LIMIT 5)
      UNION ALL
      (SELECT 'person', lower(email), round(sum(total), 2) FROM spend GROUP BY lower(email) ORDER BY sum(total) DESC LIMIT 5)`,
    check: (run, ref) => result(
      ['account', 'person'].some((kind) => hasAll(run, ref.filter((row) => row[0] === kind).flatMap((row) => row.slice(1)))),
      'emails and spend of the top five (per account or per person)'
    ),
  },
  {
    id: 'lapsed-customers',
    prompt: 'How many customers ordered before October 2024 but have not ordered since then?',
    // With or without the orders whose customer does not exist.
    reference: `SELECT
        (SELECT count(*) FROM (SELECT customer_id FROM orders GROUP BY customer_id HAVING max(order_ts) < '2024-10-01')),
        (SELECT count(*) FROM (SELECT o.customer_id FROM orders o SEMI JOIN customers c USING (customer_id)
          GROUP BY o.customer_id HAVING max(o.order_ts) < '2024-10-01'))`,
    check: (run, ref) => result(
      ref[0].some((count) => contains(run.answer, count) || successful(run).some((query) => query.rows.length === Number(count))),
      `says ${ref[0].join(" or ")}`
    ),
  },
  {
    id: 'discount-impact',
    prompt: 'What share of completed orders used a discount code, and is their average order value higher or lower than without one?',
    reference: `WITH t AS (SELECT o.order_id, o.discount_code IS NOT NULL AS discounted, sum(i.quantity * i.unit_price) AS total
        FROM orders o JOIN order_items i USING (order_id) WHERE o.status = 'completed' GROUP BY ALL)
      SELECT round(100 * avg(discounted::INT), 1), round(avg(total) FILTER (WHERE discounted), 2), round(avg(total) FILTER (WHERE NOT discounted), 2) FROM t`,
    check: (run, ref) => {
      const [share, withDiscount, without] = ref[0].map(Number);
      const shareStated = numbersIn(run.answer).some((n) => Math.abs(n - share) <= 0.6 || Math.abs(n * 100 - share) <= 0.6);
      return result(shareStated && hasAll(run, [withDiscount, without]), `share ${share}% and both averages`);
    },
  },
  {
    id: 'refund-reasons',
    prompt: 'What are the most common refund reasons, and how much money was refunded for each?',
    reference: 'SELECT reason, count(*), round(sum(amount), 2) FROM refunds GROUP BY reason',
    check: (run, ref) => result(hasAll(run, [...column(ref, 0), ...column(ref, 2)]), 'each reason with its refunded amount'),
  },

  // Data quality
  {
    id: 'duplicate-accounts',
    prompt: 'Do we have duplicate customer accounts? Look for email addresses that only differ in upper and lower case.',
    reference: 'SELECT lower(email) FROM customers GROUP BY lower(email) HAVING count(*) > 1',
    check: (run, ref) => result(hasAll(run, column(ref, 0)), 'lists the four duplicated emails'),
  },
  {
    id: 'orphan-orders',
    prompt: "Are there orders whose customer doesn't exist in the customers table? Which ones?",
    reference: 'SELECT o.order_id FROM orders o ANTI JOIN customers c USING (customer_id)',
    check: (run, ref) => result(hasAll(run, column(ref, 0)), 'lists the six orphaned orders'),
  },
  {
    id: 'bad-prices',
    prompt: 'Which products have a missing or negative price?',
    reference: 'SELECT name FROM products WHERE unit_price IS NULL OR unit_price < 0',
    check: (run, ref) => result(hasAll(run, column(ref, 0)), 'names the three products'),
  },
  {
    id: 'country-codes',
    prompt: 'The country codes in the customers table look inconsistent. Which values are there, and how many customers have each?',
    reference: 'SELECT country, count(*) FROM customers WHERE country <> upper(country) GROUP BY country',
    check: (run, ref) => result(
      successful(run).some((query) => ref.every(([code, count]) =>
        query.rows.some((row) => row.includes(code) && row.some((cell) => isNumber(cell) && close(Number(cell), Number(count)))))),
      'a query shows the lowercase codes (de, nl, us) separately with their counts'
    ),
  },

  // Files
  {
    id: 'daily-visitors',
    prompt: 'web_events.csv has our website events. How many unique visitors (anonymous_id) did we have per day in the last 7 days of the file?',
    reference: `SELECT event_time::DATE AS day, count(DISTINCT anonymous_id) FROM read_csv('web_events.csv')
      GROUP BY day ORDER BY day DESC LIMIT 7`,
    check: (run, ref) => result(hasAll(run, column(ref, 1)), 'visitor counts of the last seven days'),
  },
  {
    id: 'utm-purchases',
    prompt: 'In web_events.csv, which utm_source brought the most purchases? The source is in the JSON properties column.',
    // Purchase events or purchasing visitors.
    reference: `SELECT json_extract_string(properties, '$.utm_source') AS source, count(*) AS purchases,
        count(DISTINCT anonymous_id) AS purchasers
      FROM read_csv('web_events.csv') WHERE event_type = 'purchase' GROUP BY source ORDER BY purchases DESC`,
    check: (run, ref) => result(
      contains(run.answer, ref[0][0]) && (hasAll(run, [ref[0][1]]) || hasAll(run, [ref[0][2]])),
      `names ${ref[0][0]} with its purchases`
    ),
  },
  {
    id: 'funnel',
    prompt: 'Using web_events.csv, how many distinct visitors reached each step: page_view, add_to_cart, checkout, and purchase?',
    reference: `SELECT event_type, count(DISTINCT anonymous_id) FROM read_csv('web_events.csv') GROUP BY event_type`,
    check: (run, ref) => result(hasAll(run, column(ref, 1)), 'visitor count of every step'),
  },

  // Changes the user asks for
  {
    id: 'create-summary-table',
    prompt: 'Create a table called monthly_revenue with one row per month of 2024 and the revenue of completed orders (quantity times unit price).',
    reference: REVENUE_2024_BY_MONTH,
    verify: 'SELECT * FROM monthly_revenue',
    check: (_run, ref, verified) => result(
      verified !== null && column(ref, 1).every((value) => contains(verified.flat().join('\n'), value)),
      'monthly_revenue holds all twelve monthly revenues'
    ),
  },
  {
    id: 'export-csv',
    prompt: 'Export all customers from Germany to a CSV file called german_customers.csv.',
    reference: "SELECT count(*) FROM customers WHERE upper(country) = 'DE'",
    verify: "SELECT count(*) FROM read_csv('german_customers.csv')",
    check: (_run, ref, verified) => result(
      verified !== null && Number(verified[0]?.[0]) === Number(ref[0][0]),
      `the file has all ${ref[0][0]} German customers (including the lowercase code)`
    ),
  },

  // Files on the web: the model gets their columns in the schema block (describeUrls)
  {
    id: 'web-csv-groups',
    prompt: `Count the weather stations per country in ${STATIONS}`,
    reference: `SELECT country_code, count(*) FROM read_csv('${STATIONS}') GROUP BY ALL`,
    check: (run, ref) => result(hasAll(run, ref.flat()), 'every country code with its station count'),
  },
  {
    id: 'web-parquet-count',
    prompt: `How many rows does ${READINGS} have?`,
    reference: `SELECT count(*) FROM read_parquet('${READINGS}')`,
    check: (run, ref) => result(hasAll(run, ref[0]), `says ${ref[0][0]}`),
  },
  {
    id: 'web-json-severity',
    prompt: `How many alerts of each severity are in ${ALERTS}?`,
    reference: `SELECT severity, count(*) FROM read_json('${ALERTS}') GROUP BY ALL`,
    check: (run, ref) => result(hasAll(run, ref.flat()), 'every severity with its count'),
  },
  {
    id: 'web-follow-up',
    // The follow-up does not repeat the URL.
    prompts: [`How many weather stations are in ${STATIONS}?`, 'Which country has the most of them?'],
    reference: `SELECT country_code FROM read_csv('${STATIONS}') GROUP BY ALL ORDER BY count(*) DESC LIMIT 1`,
    check: (run, ref) => {
      const code = ref[0][0];
      return result(contains(run.answer, code) || contains(run.answer, COUNTRY_NAMES[code]), `the follow-up answer names ${code}`);
    },
  },

  // A DuckDB database on the web: the model has to attach it
  {
    id: 'attach-only',
    prompt: `Attach the remote database ${INVENTORY}`,
    reference: 'SELECT 1',
    verify: `SELECT count(*) FROM duckdb_databases() WHERE path = '${INVENTORY}'`,
    check: (_run, _ref, verified) => result(Number(verified?.[0]?.[0]) === 1, 'the database is attached'),
  },
  {
    id: 'attach-query',
    prompt: `How many units are in stock in total in the database ${INVENTORY}?`,
    reference: [`ATTACH '${INVENTORY}' AS eval_reference (READ_ONLY)`, 'SELECT sum(quantity) FROM eval_reference.stock'],
    check: (run, ref) => result(hasAll(run, ref[0]), `says ${ref[0][0]}`),
  },

  // DuckDB features that small models do not know well
  {
    id: 'howto-split',
    prompt: "How do I split a comma-separated string into a list in DuckDB? Show it with 'red,green,blue'.",
    reference: 'SELECT 1',
    check: (run) => result(
      successful(run).some((query) => query.rows.flat().some((value) => /^\[\s*"?red"?\s*,\s*"?green"?\s*,\s*"?blue"?\s*\]$/.test(value))),
      'ran a query that returned the list [red, green, blue]'
    ),
  },
  {
    id: 'pivot-status',
    prompt: 'Pivot the orders table: one row per shipping country, one column per order status, and the number of orders in each cell.',
    reference: 'PIVOT orders ON status USING count(*) GROUP BY shipping_country',
    check: (run, ref) => result(
      successful(run).some((query) => query.rows.length === ref.length &&
        ref.every((expected) => query.rows.some((row) => expected.every((value) => row.map(cell).includes(cell(value)))))),
      'a query shows the order count of every status per country'
    ),
  },
  {
    id: 'summarize-products',
    prompt: 'How can I get summary statistics (min, max, average, share of missing values) for every column of the products table?',
    reference: 'SELECT column_name FROM (SUMMARIZE products)',
    check: (run, ref) => result(
      successful(run).some((query) => ref.every(([column]) => query.rows.some((row) => row.includes(column))) &&
        ['min', 'max'].every((name) => query.columns.some((column) => column.toLowerCase().includes(name)))),
      'a query shows min and max for every column of products'
    ),
  },
];
