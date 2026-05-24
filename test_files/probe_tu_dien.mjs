/**
 * probe_tu_dien.mjs — Quét HTTP tủ điện tại IP 192.168.10.100
 * Chạy: node probe_tu_dien.mjs
 * Không cần cài thêm package — dùng built-in http/https/net
 *
 * Kịch bản test:
 *  1. Scan rộng TCP port 1–9999 (concurrent) để tìm port đang mở
 *  2. Thử các endpoint API phổ biến trên mỗi port HTTP tìm được
 *  3. In raw response headers + body để phân tích
 */

import http  from 'node:http';
import https from 'node:https';
import net   from 'node:net';

const IP            = '192.168.10.100';
const TIMEOUT_PORT  = 1500; // ms cho TCP connect
const TIMEOUT_HTTP  = 4000; // ms cho HTTP request
const CONCURRENCY   = 200;  // số kết nối TCP song song

// ── Màu terminal ──────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', gray: '\x1b[90m',
};
const ok   = (s) => `${C.green}✔${C.reset} ${s}`;
const fail = (s) => `${C.red}✘${C.reset} ${s}`;
const info = (s) => `${C.cyan}→${C.reset} ${s}`;
const warn = (s) => `${C.yellow}⚠${C.reset} ${s}`;
const dim  = (s) => `${C.gray}${s}${C.reset}`;

// ── Tên giao thức phổ biến ────────────────────────────────────
const KNOWN_PORTS = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS',
  80: 'HTTP', 102: 'S7comm', 161: 'SNMP', 443: 'HTTPS',
  502: 'Modbus TCP', 503: 'Modbus TLS', 789: 'EtherNet/IP',
  1883: 'MQTT', 2000: 'Cisco', 2101: 'Modbus',
  3000: 'HTTP-alt', 4000: 'HTTP-alt', 4840: 'OPC-UA',
  5000: 'HTTP-alt', 5020: 'Modbus', 7000: 'HTTP-alt',
  8000: 'HTTP-alt', 8080: 'HTTP-proxy', 8443: 'HTTPS-alt',
  8888: 'HTTP-alt', 9090: 'HTTP-alt', 44818: 'EtherNet/IP',
  47808: 'BACnet',
};

// Endpoint phổ biến trên thiết bị công nghiệp / IoT
const ENDPOINTS = [
  '/',
  '/api', '/api/v1', '/api/v2',
  '/api/data', '/api/status', '/api/values', '/api/realtime',
  '/api/meter', '/api/readings', '/api/measurement', '/api/info',
  '/data', '/data.json', '/status', '/status.json',
  '/info', '/info.json', '/values', '/realtime',
  '/meter', '/energy', '/power', '/current', '/voltage',
  '/modbus', '/registers', '/getdata', '/getData', '/get_data',
  '/json', '/xml', '/cgi-bin/json', '/cgi-bin/data.cgi',
];

// ── 1. Check 1 port TCP ───────────────────────────────────────
function checkPort(host, port) {
  return new Promise(resolve => {
    const sock = new net.Socket();
    sock.setTimeout(TIMEOUT_PORT);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
    sock.on('error',   () => { sock.destroy(); resolve(false); });
    sock.connect(port, host);
  });
}

// Scan nhiều port đồng thời, giữ kết quả theo thứ tự
async function scanPorts(host, from, to, concurrency) {
  const open = [];
  let current = from;

  async function worker() {
    while (current <= to) {
      const port = current++;
      const isOpen = await checkPort(host, port);
      if (isOpen) open.push(port);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, to - from + 1) }, worker);
  await Promise.all(workers);
  return open.sort((a, b) => a - b);
}

// ── 2. HTTP GET ───────────────────────────────────────────────
function httpGet(url) {
  return new Promise(resolve => {
    const mod = url.startsWith('https') ? https : http;
    try {
      const req = mod.get(url, { timeout: TIMEOUT_HTTP, rejectUnauthorized: false }, res => {
        let body = '';
        res.on('data', chunk => { body += chunk; if (body.length > 8192) req.destroy(); });
        res.on('end', () => resolve({ ok: true, status: res.statusCode, headers: res.headers, body: body.trim() }));
      });
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, err: 'timeout' }); });
      req.on('error',   e  => resolve({ ok: false, err: e.message }));
    } catch (e) {
      resolve({ ok: false, err: e.message });
    }
  });
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}  PROBE TỦ ĐIỆN — ${IP}${C.reset}`);
  console.log(`${C.bold}════════════════════════════════════════════════${C.reset}\n`);

  // Bước 1: Scan port 1–9999
  console.log(`${C.bold}[1/3] Scan TCP port 1–9999 (${CONCURRENCY} luồng song song)...${C.reset}`);
  console.log(dim('    Đang quét, vui lòng chờ...\n'));

  const openPorts = await scanPorts(IP, 1, 9999, CONCURRENCY);

  if (openPorts.length === 0) {
    console.log(fail('Không có port nào mở trên ' + IP));
    console.log(warn('Thiết bị có ping nhưng không mở port — có thể firewall chặn hoặc dùng giao thức khác (Modbus RTU qua RS485?).'));
    process.exit(1);
  }

  console.log(`${C.green}${C.bold}Tìm thấy ${openPorts.length} port mở:${C.reset}`);
  for (const p of openPorts) {
    const name = KNOWN_PORTS[p] ? ` ${C.cyan}(${KNOWN_PORTS[p]})${C.reset}` : '';
    console.log(`  ${C.bold}${p}${C.reset}${name}`);
  }

  // Bước 2: Thử endpoint HTTP trên các port khả nghi
  const httpPorts = openPorts.filter(p => ![21,22,23,25,53,161,502,503,789,1883,4840,44818,47808].includes(p));

  if (httpPorts.length === 0) {
    console.log(`\n${warn('Không có port HTTP nào khả nghi.')}`);
    console.log(info('Port mở duy nhất có thể là Modbus TCP (502) hoặc giao thức khác.'));
    printProtocolTips(openPorts);
    return;
  }

  console.log(`\n${C.bold}[2/3] Thử HTTP endpoints trên port: ${httpPorts.join(', ')}...${C.reset}`);
  const found = [];

  for (const port of httpPorts) {
    const scheme = (port === 443 || port === 8443) ? 'https' : 'http';
    const baseUrl = `${scheme}://${IP}:${port}`;

    for (const path of ENDPOINTS) {
      const url = baseUrl + path;
      process.stdout.write(dim(`  GET ${url.padEnd(50)} `));
      const res = await httpGet(url);

      if (!res.ok) {
        process.stdout.write(dim(`${res.err}\n`));
        continue;
      }

      const is2xx = res.status >= 200 && res.status < 300;
      if (is2xx && res.body.length > 0) {
        process.stdout.write(ok(`${res.status} — ${res.body.length} bytes\n`));
        const ct = res.headers['content-type'] || '';
        found.push({ url, status: res.status, headers: res.headers, body: res.body,
          isJson: ct.includes('json') || res.body[0] === '{' || res.body[0] === '[',
          isXml:  ct.includes('xml')  || res.body[0] === '<' });
      } else {
        process.stdout.write(dim(`${res.status}\n`));
      }
    }
  }

  // Bước 3: Kết quả
  console.log(`\n${C.bold}[3/3] KẾT QUẢ${C.reset}`);

  if (found.length === 0) {
    console.log(warn('Không tìm thấy endpoint nào trả dữ liệu có ích.'));
    console.log(info('Thử mở trình duyệt tại: http://' + IP + ':' + httpPorts[0]));
    console.log(info('Hoặc xem tài liệu kỹ thuật của thiết bị để biết đúng API path.'));
    printProtocolTips(openPorts);
    return;
  }

  for (const r of found) {
    console.log(`\n${'─'.repeat(56)}`);
    console.log(`${C.bold}URL    :${C.reset} ${r.url}`);
    console.log(`${C.bold}Status :${C.reset} ${r.status}`);
    console.log(`${C.bold}Type   :${C.reset} ${r.headers['content-type'] || '(không có)'}`);
    console.log(`${C.bold}Body   :${C.reset}`);
    if (r.isJson) {
      try { console.log(JSON.stringify(JSON.parse(r.body), null, 2)); }
      catch { console.log(r.body.substring(0, 1000)); }
    } else {
      console.log(r.body.substring(0, 800));
      if (r.body.length > 800) console.log(dim(`... (${r.body.length} bytes tổng)`));
    }
  }

  console.log(`\n${'═'.repeat(56)}`);
  console.log(`${C.green}${C.bold}✔ Tìm thấy ${found.length} endpoint có dữ liệu.${C.reset}`);
  console.log(`Sao chép URL vào StationApiService hoặc tạo driver riêng.\n`);
}

function printProtocolTips(openPorts) {
  console.log(`\n${C.bold}Gợi ý theo port tìm thấy:${C.reset}`);
  if (openPorts.includes(502)) console.log(info('Port 502 mở → dùng thư viện Modbus TCP (jsmodbus, node-modbus)'));
  if (openPorts.includes(4840)) console.log(info('Port 4840 mở → dùng OPC-UA client (node-opcua)'));
  if (openPorts.includes(1883)) console.log(info('Port 1883 mở → dùng MQTT client (mqtt.js), subscribe topic tương ứng'));
  if (openPorts.includes(44818)) console.log(info('Port 44818 mở → EtherNet/IP (node-ethernet-ip)'));
  if (openPorts.includes(22)) console.log(info('Port 22 mở → SSH vào thiết bị để xem config API'));
  if (openPorts.includes(23)) console.log(info('Port 23 mở → Telnet để xem menu điều khiển'));
}

main().catch(err => {
  console.error(C.red + 'Lỗi:' + C.reset, err.message);
  process.exit(1);
});
