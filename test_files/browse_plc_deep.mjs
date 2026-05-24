/**
 * browse_plc_deep.mjs — Browse sâu vào PLC_1 để tìm tag dữ liệu
 * Cài trước: npm install node-opcua-client (đã cài)
 * Chạy:      node browse_plc_deep.mjs
 *
 * Kết quả mong đợi: in ra NodeId của từng biến (Variable)
 * trong PLC — copy vào driver OPC-UA của StationOS.
 */

import {
  OPCUAClient, MessageSecurityMode, SecurityPolicy,
  BrowseDirection, NodeClass, AttributeIds,
} from 'node-opcua-client';

const ENDPOINT = 'opc.tcp://192.168.10.100:4840';
const PLC_NODE = 'ns=3;s=PLC'; // Tìm được từ bước browse trước

// In tối đa N cấp, thu thập biến để in danh sách gọn cuối
const MAX_DEPTH = 6;
const variables  = []; // { nodeId, path, browseName }

// ── Màu terminal ─────────────────────────────────────────────
const C = { reset:'\x1b[0m', bold:'\x1b[1m', green:'\x1b[32m', yellow:'\x1b[33m', cyan:'\x1b[36m', gray:'\x1b[90m' };
const ok   = s => `${C.green}✔${C.reset} ${s}`;
const info = s => `${C.cyan}→${C.reset} ${s}`;
const dim  = s => `${C.gray}${s}${C.reset}`;

// ── Browse đệ quy thu thập Variable nodes ────────────────────
async function browseDeep(session, nodeId, depth, path = '') {
  if (depth === 0) return;
  let result;
  try {
    result = await session.browse({ nodeId, browseDirection: BrowseDirection.Forward, resultMask: 63 });
  } catch { return; }

  for (const ref of result.references || []) {
    const name    = ref.browseName.name || '?';
    const fullPath = path ? `${path}.${name}` : name;
    const nid     = ref.nodeId.toString();

    if (ref.nodeClass === NodeClass.Variable) {
      // Đọc thử giá trị ngay
      let valStr = '';
      try {
        const dv = await session.readVariableValue(nid);
        valStr = dv.value?.value !== undefined ? String(dv.value.value).substring(0, 60) : '(no value)';
      } catch { valStr = '(read error)'; }

      variables.push({ nodeId: nid, path: fullPath, value: valStr });
      console.log(`  📊 ${C.cyan}${nid.padEnd(35)}${C.reset} ${fullPath.padEnd(45)} = ${C.bold}${valStr}${C.reset}`);
    } else if (ref.nodeClass === NodeClass.Object) {
      const indent = '  '.repeat(MAX_DEPTH - depth);
      console.log(`${indent}📁 ${name} [${nid}]`);
      await browseDeep(session, nid, depth - 1, fullPath);
    }
  }
}

async function main() {
  console.log(`\n${C.bold}════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}  DEEP BROWSE PLC_1 — ${ENDPOINT}${C.reset}`);
  console.log(`${C.bold}════════════════════════════════════════════════════════${C.reset}\n`);

  const client = OPCUAClient.create({
    applicationName: 'StationOS-Browse',
    connectionStrategy: { initialDelay: 500, maxRetry: 2 },
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    endpointMustExist: false,
  });

  await client.connect(ENDPOINT);
  console.log(ok('Kết nối OPC-UA thành công'));

  const session = await client.createSession();
  console.log(ok('Session tạo thành công'));

  // Đọc thông tin thiết bị
  console.log(`\n${C.bold}── Thông tin thiết bị ──${C.reset}`);
  const infoTags = {
    'Manufacturer':    'ns=3;s=Manufacturer',
    'Model':           'ns=3;s=Model',
    'OrderNumber':     'ns=3;s=OrderNumber',
    'SerialNumber':    'ns=3;s=SerialNumber',
    'SoftwareRevision':'ns=3;s=SoftwareRevision',
    'HardwareRevision':'ns=3;s=HardwareRevision',
    'OperatingMode':   'ns=3;s=OperatingMode',
  };
  for (const [label, nid] of Object.entries(infoTags)) {
    try {
      const dv = await session.readVariableValue(nid);
      const val = dv.value?.value;
      if (val !== undefined && val !== null) {
        console.log(`  ${label.padEnd(20)} = ${C.bold}${val}${C.reset}`);
      }
    } catch { /* ignore */ }
  }

  // Browse sâu vào PLC_1
  console.log(`\n${C.bold}── Browse sâu PLC_1 [${PLC_NODE}] (tối đa ${MAX_DEPTH} cấp) ──${C.reset}`);
  console.log(dim('  NodeId                              Path                                          Value'));
  console.log(dim('  ' + '─'.repeat(100)));

  await browseDeep(session, PLC_NODE, MAX_DEPTH);

  // Tổng hợp
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`${C.bold}TỔNG HỢP: ${variables.length} biến tìm được${C.reset}\n`);

  if (variables.length > 0) {
    console.log(`${C.bold}// Dán vào driver OPC-UA của StationOS:${C.reset}`);
    console.log('const NODES = {');
    for (const v of variables) {
      // Chỉ in biến có giá trị thực (bỏ qua metadata string)
      const cleanPath = v.path.replace(/[^a-zA-Z0-9_.]/g, '_');
      console.log(`  '${cleanPath}': '${v.nodeId}',  // ${v.value}`);
    }
    console.log('};');
  } else {
    console.log(info('Không tìm được Variable nào. PLC có thể chưa có DB được expose qua OPC-UA.'));
    console.log(info('Kiểm tra lại trong TIA Portal: Project > PLC > OPC UA > Server Interface > Expose DB'));
  }

  await session.close();
  await client.disconnect();
  console.log('\n' + ok('Xong.\n'));
}

main().catch(e => {
  console.error('\x1b[31mLỗi:\x1b[0m', e.message);
  process.exit(1);
});
