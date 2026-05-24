/**
 * test_gateway.mjs — Test gateway tủ điện 192.168.10.200
 * Chạy: node test_gateway.mjs
 *
 * Tự động:
 *  1. Scan port (TCP) trên .200 để biết giao thức
 *  2. Nếu MQTT (1883) → subscribe tất cả topics, in realtime
 *  3. Nếu HTTP (80/8080...) → thử các endpoint phổ biến
 *  4. In raw payload để phân tích format
 */

import net   from 'node:net';
import http  from 'node:http';
import https from 'node:https';
import mqtt  from 'mqtt';

const GW_IP  = '192.168.10.200';
const TIMEOUT = 2000;

// ── Terminal colors ───────────────────────────────────────────
const C = {
  reset:'\x1b[0m', bold:'\x1b[1m',
  red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m',
  cyan:'\x1b[36m', magenta:'\x1b[35m', gray:'\x1b[90m',
};
const ok   = s => `${C.green}✔${C.reset} ${s}`;
const fail = s => `${C.red}✘${C.reset} ${s}`;
const info = s => `${C.cyan}→${C.reset} ${s}`;
const warn = s => `${C.yellow}⚠${C.reset} ${s}`;
const live = s => `${C.magenta}◉${C.reset} ${s}`;
const dim  = s => `${C.gray}${s}${C.reset}`;

// ── Port check ───────────────────────────────────────────────
function checkPort(ip, port) {
  return new Promise(resolve => {
    const s = new net.Socket();
    s.setTimeout(TIMEOUT);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error',   () => { s.destroy(); resolve(false); });
    s.connect(port, ip);
  });
}

// ── HTTP GET ─────────────────────────────────────────────────
function httpGet(url) {
  return new Promise(resolve => {
    const mod = url.startsWith('https') ? https : http;
    try {
      const req = mod.get(url, { timeout: 3000, rejectUnauthorized: false }, res => {
        let body = '';
        res.on('data', d => { body += d; if (body.length > 4096) req.destroy(); });
        res.on('end', () => resolve({ ok: true, status: res.statusCode, ct: res.headers['content-type'] || '', body: body.trim() }));
      });
      req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
      req.on('error',   () => resolve({ ok: false }));
    } catch { resolve({ ok: false }); }
  });
}

// ── Pretty print payload ─────────────────────────────────────
function printPayload(topic, raw) {
  const ts = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* not JSON */ }

  console.log(`\n[${C.gray}${ts}${C.reset}] ${C.cyan}topic:${C.reset} ${C.bold}${topic}${C.reset}`);

  if (parsed) {
    // Nếu có format gateway cabinets[]
    if (Array.isArray(parsed.cabinets)) {
      console.log(`  ${C.bold}Gateway IP:${C.reset} ${parsed.gatewayIp}`);
      for (const cab of parsed.cabinets) {
        const { cabinetCode, temp1, temp2, temp3, pd, ...rest } = cab;
        const code = cabinetCode || JSON.stringify(rest).substring(0, 20);
        const temps = [temp1, temp2, temp3].filter(v => v != null).map(v => `${v}°C`).join(' / ');
        const pdStr = pd != null ? ` | PD: ${pd} dB` : '';
        console.log(`  ${C.bold}${String(code).padEnd(10)}${C.reset} Temp: ${C.yellow}${temps}${C.reset}${pdStr}`);
      }
    } else {
      // Format khác → pretty print JSON gọn
      console.log(JSON.stringify(parsed, null, 2).split('\n').map(l => '  ' + l).join('\n'));
    }
  } else {
    // Raw bytes / plain text
    console.log(`  ${C.gray}${String(raw).substring(0, 300)}${C.reset}`);
  }
}

// ── MQTT subscriber ──────────────────────────────────────────
async function runMqtt(ip, port = 1883) {
  console.log(`\n${C.bold}── MQTT Subscribe ──────────────────────────────────${C.reset}`);
  console.log(info(`Kết nối MQTT: mqtt://${ip}:${port}`));

  return new Promise(resolve => {
    const client = mqtt.connect(`mqtt://${ip}:${port}`, {
      clientId: 'stationos-probe-' + Date.now(),
      connectTimeout: 5000,
      reconnectPeriod: 0,
    });

    const timer = setTimeout(() => {
      console.log(warn('MQTT: 10 giây không có message nào.'));
      console.log(dim('  Thử subscribe wildcard "#" nhưng gateway chưa gửi, hoặc topic khác.'));
      client.end(true);
      resolve('timeout');
    }, 10000);

    client.on('connect', () => {
      console.log(ok('MQTT kết nối thành công'));
      client.subscribe('#', { qos: 0 }, (err) => {
        if (err) console.log(fail('Subscribe lỗi: ' + err.message));
        else console.log(ok(`Subscribed topic: ${C.bold}#${C.reset} (tất cả topics)`));
        console.log(info('Đang chờ message... (10s timeout, Ctrl+C để dừng sớm)\n'));
      });
    });

    client.on('message', (topic, payload) => {
      clearTimeout(timer);
      printPayload(topic, payload.toString());
      // Sau lần đầu nhận, tiếp tục nghe cho đến Ctrl+C
    });

    client.on('error', err => {
      clearTimeout(timer);
      console.log(fail('MQTT error: ' + err.message));
      client.end(true);
      resolve('error');
    });

    // Ctrl+C → thoát sạch
    process.on('SIGINT', () => {
      clearTimeout(timer);
      console.log('\n' + ok('Dừng MQTT.\n'));
      client.end(true);
      resolve('exit');
    });
  });
}

// ── HTTP probe ───────────────────────────────────────────────
async function runHttp(ip, ports) {
  console.log(`\n${C.bold}── HTTP Probe ──────────────────────────────────────${C.reset}`);
  const endpoints = ['/', '/api', '/api/data', '/api/status', '/data', '/data.json', '/status.json', '/json', '/values', '/meters'];

  for (const port of ports) {
    const scheme = (port === 443 || port === 8443) ? 'https' : 'http';
    for (const path of endpoints) {
      const url = `${scheme}://${ip}:${port}${path}`;
      process.stdout.write(dim(`  GET ${url.padEnd(50)} `));
      const r = await httpGet(url);
      if (r.ok && r.status >= 200 && r.status < 300 && r.body.length > 0) {
        process.stdout.write(ok(`${r.status} (${r.body.length}B)\n`));
        const body = r.body;
        try {
          const j = JSON.parse(body);
          console.log(JSON.stringify(j, null, 2).split('\n').map(l => '    ' + l).join('\n'));
        } catch {
          console.log('    ' + body.substring(0, 400));
        }
      } else {
        process.stdout.write(dim(`${r.ok ? r.status : 'N/A'}\n`));
      }
    }
  }
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}═══════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}  TEST GATEWAY TỦ ĐIỆN — ${GW_IP}${C.reset}`);
  console.log(`${C.bold}═══════════════════════════════════════════════════${C.reset}\n`);

  // Bước 1: Ping check (TCP 1883)
  console.log(`${C.bold}[1] Scan port...${C.reset}`);
  const PORTS_TO_CHECK = [1883, 8883, 80, 8080, 443, 8443, 502, 4840];
  const open = [];

  for (const p of PORTS_TO_CHECK) {
    const isOpen = await checkPort(GW_IP, p);
    const label = { 1883:'MQTT', 8883:'MQTT-TLS', 80:'HTTP', 8080:'HTTP-alt', 443:'HTTPS', 8443:'HTTPS-alt', 502:'Modbus', 4840:'OPC-UA' }[p] || '';
    if (isOpen) {
      open.push(p);
      console.log(ok(`Port ${C.bold}${p}${C.reset} (${label}) — MỞ`));
    } else {
      console.log(fail(`Port ${p} (${label}) — đóng`));
    }
  }

  if (open.length === 0) {
    console.log(`\n${C.red}${C.bold}Không kết nối được tới ${GW_IP}.${C.reset}`);
    console.log(warn('Kiểm tra: thiết bị gateway có đang chạy không? Có cùng mạng không?'));
    process.exit(1);
  }

  console.log(`\n${info(`Port mở: ${open.join(', ')}`)}`);

  // Bước 2: Ưu tiên MQTT
  const hasMqtt = open.includes(1883) || open.includes(8883);
  const httpPorts = open.filter(p => [80, 8080, 443, 8443].includes(p));

  if (hasMqtt) {
    const port = open.includes(1883) ? 1883 : 8883;
    await runMqtt(GW_IP, port);
  } else if (httpPorts.length > 0) {
    console.log(warn('Không có MQTT — thử HTTP...'));
    await runHttp(GW_IP, httpPorts);
  } else {
    console.log(warn('Port mở nhưng không phải HTTP/MQTT thông thường.'));
    console.log(info('Port 502 mở → Modbus TCP. Chạy test_s7.mjs với địa chỉ .200 nếu cần.'));
  }
}

main().catch(e => {
  console.error(C.red + 'Lỗi:' + C.reset, e.message);
  process.exit(1);
});
