/**
 * test_s7.mjs — Kết nối PLC Siemens S7 tại 192.168.10.100:102
 * Cài trước: npm install nodes7
 * Chạy:      node test_s7.mjs
 *
 * Script này sẽ:
 *  1. Kết nối S7 PLC qua ISO-TCP (port 102)
 *  2. Đọc thử các Data Block (DB) và Marker (M) phổ biến
 *  3. In giá trị ra màn hình
 *
 * Ghi chú về địa chỉ S7:
 *   DB1,REAL0   = DB số 1, byte 0, kiểu REAL (4 byte = float)
 *   DB1,REAL4   = DB số 1, byte 4, ...
 *   M0.0        = Marker bit 0.0
 *   MW0         = Marker Word 0 (INT)
 */

import nodes7 from 'nodes7';

const HOST = '192.168.10.100';
const PORT = 102;
const RACK = 0; // Siemens S7-300: rack=0, slot=2; S7-1200/1500: rack=0, slot=1
const SLOT = 1; // Thử 1 trước, nếu lỗi đổi sang 2

// Danh sách tag cần đọc — điều chỉnh theo cấu hình PLC thực tế
// Gợi ý đặt tên theo IEC 61850 hoặc theo project của bạn
const TAGS = {
  'Voltage_L1':     'DB1,REAL0',
  'Voltage_L2':     'DB1,REAL4',
  'Voltage_L3':     'DB1,REAL8',
  'Current_L1':     'DB1,REAL12',
  'Current_L2':     'DB1,REAL16',
  'Current_L3':     'DB1,REAL20',
  'ActivePower':    'DB1,REAL24',
  'ReactivePower':  'DB1,REAL28',
  'PowerFactor':    'DB1,REAL32',
  'Frequency':      'DB1,REAL36',
  'Energy_kWh':     'DB1,REAL40',
  // Nếu dùng DB khác, ví dụ DB10:
  // 'DB10_Word0':  'DB10,INT0',
};

// ── Màu terminal ──────────────────────────────────────────────
const C = { reset:'\x1b[0m', bold:'\x1b[1m', red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m', cyan:'\x1b[36m', gray:'\x1b[90m' };
const ok   = s => `${C.green}✔${C.reset} ${s}`;
const info = s => `${C.cyan}→${C.reset} ${s}`;
const warn = s => `${C.yellow}⚠${C.reset} ${s}`;
const fail = s => `${C.red}✘${C.reset} ${s}`;

async function main() {
  console.log(`\n${C.bold}════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}  TEST S7 PLC — ${HOST}:${PORT} (rack=${RACK}, slot=${SLOT})${C.reset}`);
  console.log(`${C.bold}════════════════════════════════════════════════${C.reset}\n`);

  const conn = new nodes7();

  // Kết nối
  console.log(info(`Kết nối S7 tới ${HOST}:${PORT} rack=${RACK} slot=${SLOT} ...`));

  await new Promise((resolve, reject) => {
    conn.initiateConnection({ host: HOST, port: PORT, rack: RACK, slot: SLOT }, err => {
      if (err) reject(err);
      else resolve();
    });
  }).then(() => console.log(ok('Kết nối thành công')))
    .catch(e => {
      console.log(fail(`Kết nối thất bại: ${e.message}`));
      console.log(warn(`Thử đổi slot=2 (S7-300) hoặc slot=1 (S7-1200/1500)`));
      process.exit(1);
    });

  // Thêm địa chỉ các tag
  conn.setTranslationCB(tag => TAGS[tag]);
  conn.addItems(Object.keys(TAGS));

  // Đọc giá trị
  console.log(`\n${C.bold}[Read] Đọc tag từ PLC:${C.reset}`);
  await new Promise(resolve => {
    conn.readAllItems((err, values) => {
      if (err) {
        console.log(fail(`Lỗi đọc: ${err}`));
        resolve();
        return;
      }
      for (const [tag, addr] of Object.entries(TAGS)) {
        const val = values[tag];
        if (val !== undefined && val !== null && !isNaN(val)) {
          console.log(ok(`${tag.padEnd(20)} [${addr}] = ${C.bold}${Number(val).toFixed(4)}${C.reset}`));
        } else {
          console.log(warn(`${tag.padEnd(20)} [${addr}] = ${val ?? 'null'}`));
        }
      }
      resolve();
    });
  });

  // Realtime poll mỗi 1 giây
  console.log(`\n${C.bold}[Poll] Realtime 1s — Ctrl+C để dừng${C.reset}`);
  const interval = setInterval(() => {
    conn.readAllItems((err, values) => {
      if (err) { console.log(fail('Poll error: ' + err)); return; }
      const ts = new Date().toLocaleTimeString('vi-VN');
      const line = Object.keys(TAGS).map(tag => {
        const v = values[tag];
        return v !== undefined && !isNaN(v) ? `${tag}=${Number(v).toFixed(2)}` : `${tag}=ERR`;
      }).join('  |  ');
      console.log(`[${ts}] ${line}`);
    });
  }, 1000);

  await new Promise(resolve => process.on('SIGINT', resolve));
  clearInterval(interval);
  conn.dropConnection();
  console.log('\n' + ok('Đã đóng kết nối.\n'));
}

main().catch(e => {
  console.error(C.red + 'Lỗi:' + C.reset, e.message);
  process.exit(1);
});
