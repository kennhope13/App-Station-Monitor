/**
 * test_plc_s7_db32.mjs
 * Chạy test đọc trực tiếp DB32 của PLC 192.168.10.100 qua nodes7.
 * 
 * Cách chạy:
 *   cd /home/admin-/Desktop/DA/stationos-main/test_files
 *   node test_plc_s7_db32.mjs
 */

import nodes7 from 'nodes7';

const HOST = '192.168.10.100';
const PORT = 102;
const RACK = 0;
const SLOT = 1; // S7-1200 mặc định slot = 1

const TAGS = {
  'nhiet_do_pha_1': 'DB32,INT0',
  'nhiet_do_pha_3': 'DB32,INT2',
  'nhiet_do_pha_2': 'DB32,INT4',
  'phong_dien':     'DB32,INT8'
};

const C = { reset:'\x1b[0m', bold:'\x1b[1m', red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m', cyan:'\x1b[36m', gray:'\x1b[90m' };
const ok   = s => `${C.green}✔${C.reset} ${s}`;
const info = s => `${C.cyan}→${C.reset} ${s}`;
const warn = s => `${C.yellow}⚠${C.reset} ${s}`;
const fail = s => `${C.red}✘${C.reset} ${s}`;

async function main() {
  console.log(`\n${C.bold}════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}  TEST ĐỌC PLC S7 DB32 — ${HOST}:${PORT} (rack=${RACK}, slot=${SLOT})${C.reset}`);
  console.log(`${C.bold}════════════════════════════════════════════════${C.reset}\n`);

  const conn = new nodes7();

  console.log(info(`Đang kết nối tới PLC ${HOST}:${PORT}...`));

  await new Promise((resolve, reject) => {
    conn.initiateConnection({ host: HOST, port: PORT, rack: RACK, slot: SLOT }, err => {
      if (err) reject(err);
      else resolve();
    });
  }).then(() => console.log(ok('Kết nối thành công!')))
    .catch(e => {
      console.log(fail(`Kết nối thất bại: ${e.message}`));
      console.log(warn(`Vui lòng kiểm tra:`));
      console.log(`  1. PLC đã bật nguồn và cắm dây mạng.`);
      console.log(`  2. Tích chọn "Permit access with PUT/GET" trong TIA Portal.`));
      process.exit(1);
    });

  conn.setTranslationCB(tag => TAGS[tag]);
  conn.addItems(Object.keys(TAGS));

  console.log(`\n${C.bold}[Read] Đang đọc dữ liệu từ DB32...${C.reset}`);
  await new Promise(resolve => {
    conn.readAllItems((err, values) => {
      if (err) {
        console.log(fail(`Lỗi đọc DB32: ${err}`));
        resolve();
        return;
      }
      for (const [tag, addr] of Object.entries(TAGS)) {
        const val = values[tag];
        if (val !== undefined && val !== null && !isNaN(val)) {
          console.log(ok(`${tag.padEnd(20)} [${addr}] = ${C.bold}${val}${C.reset}`));
        } else {
          console.log(warn(`${tag.padEnd(20)} [${addr}] = ${val ?? 'Lỗi/Không tìm thấy'}`));
        }
      }
      resolve();
    });
  });

  conn.dropConnection();
  console.log('\n' + ok('Đã đóng kết nối.\n'));
}

main().catch(e => {
  console.error(C.red + 'Lỗi hệ thống:' + C.reset, e.message);
  process.exit(1);
});
