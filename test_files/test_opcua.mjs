/**
 * test_opcua.mjs — Kết nối OPC-UA tủ điện 192.168.10.100:4840
 * Cài trước: npm install node-opcua-client
 * Chạy:      node test_opcua.mjs
 *
 * Script này sẽ:
 *  1. Kết nối OPC-UA server
 *  2. Browse node gốc để liệt kê tất cả object/variable
 *  3. Đọc giá trị một số node phổ biến (điện áp, dòng, công suất)
 *  4. Subscribe realtime 1 giây/lần và in ra màn hình
 */

import {
  OPCUAClient,
  MessageSecurityMode,
  SecurityPolicy,
  AttributeIds,
  TimestampsToReturn,
  NodeClass,
  BrowseDirection,
} from 'node-opcua-client';

const ENDPOINT = 'opc.tcp://192.168.10.100:4840';
const MAX_BROWSE_DEPTH = 3; // duyệt tối đa 3 cấp
const REALTIME_INTERVAL_MS = 1000;

// ── Màu terminal ──────────────────────────────────────────────
const C = { reset:'\x1b[0m', bold:'\x1b[1m', red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m', cyan:'\x1b[36m', gray:'\x1b[90m' };
const ok   = s => `${C.green}✔${C.reset} ${s}`;
const info = s => `${C.cyan}→${C.reset} ${s}`;
const warn = s => `${C.yellow}⚠${C.reset} ${s}`;
const err  = s => `${C.red}✘${C.reset} ${s}`;
const dim  = s => `${C.gray}${s}${C.reset}`;

// NodeId của các tag điện phổ biến (IEC 61850 / Siemens naming)
// Sẽ update sau khi browse ra đúng nodeId
const COMMON_TAGS = [
  // Siemens ET200SP / S7 OPC-UA naming
  '"DB1"."Voltage_L1"', '"DB1"."Voltage_L2"', '"DB1"."Voltage_L3"',
  '"DB1"."Current_L1"', '"DB1"."Current_L2"', '"DB1"."Current_L3"',
  '"DB1"."ActivePower"', '"DB1"."ReactivePower"', '"DB1"."PowerFactor"',
  '"DB1"."Frequency"', '"DB1"."Energy_kWh"',
  // Generic naming
  'ns=3;s=Voltage_L1', 'ns=3;s=Current_L1', 'ns=3;s=ActivePower',
  'ns=2;s=Voltage', 'ns=2;s=Current', 'ns=2;s=Power',
];

// ── Browse đệ quy ─────────────────────────────────────────────
async function browseNode(session, nodeId, depth, prefix = '') {
  if (depth === 0) return;
  try {
    const result = await session.browse({ nodeId, browseDirection: BrowseDirection.Forward, resultMask: 63 });
    for (const ref of result.references || []) {
      const icon = ref.nodeClass === NodeClass.Variable ? '📊' : ref.nodeClass === NodeClass.Object ? '📁' : '·';
      console.log(`${prefix}${icon} ${ref.browseName.name} [${ref.nodeId.toString()}]`);
      if (ref.nodeClass === NodeClass.Object) {
        await browseNode(session, ref.nodeId, depth - 1, prefix + '  ');
      }
    }
  } catch (e) {
    console.log(dim(`${prefix}(browse error: ${e.message})`));
  }
}

// ── Đọc giá trị 1 node ───────────────────────────────────────
async function readNode(session, nodeId) {
  try {
    const dataValue = await session.readVariableValue(nodeId);
    if (dataValue.value?.value !== undefined && dataValue.value.value !== null) {
      return { ok: true, value: dataValue.value.value, type: dataValue.value.dataType };
    }
    return { ok: false, reason: 'null/undefined value' };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}  TEST OPC-UA — ${ENDPOINT}${C.reset}`);
  console.log(`${C.bold}════════════════════════════════════════════════${C.reset}\n`);

  const client = OPCUAClient.create({
    applicationName: 'StationOS-Probe',
    connectionStrategy: { initialDelay: 1000, maxRetry: 2 },
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    endpointMustExist: false,
  });

  // Bước 1: Kết nối
  process.stdout.write(info(`Kết nối tới ${ENDPOINT} ... `));
  try {
    await client.connect(ENDPOINT);
    process.stdout.write(ok('Thành công\n'));
  } catch (e) {
    process.stdout.write(err(`Thất bại: ${e.message}\n`));
    console.log(warn('Thiết bị từ chối kết nối OPC-UA. Kiểm tra lại endpoint hoặc security policy.'));
    process.exit(1);
  }

  // Bước 2: Tạo session
  process.stdout.write(info('Tạo session ... '));
  let session;
  try {
    session = await client.createSession();
    process.stdout.write(ok('Thành công\n'));
  } catch (e) {
    process.stdout.write(err(`Thất bại: ${e.message}\n`));
    await client.disconnect();
    process.exit(1);
  }

  // Bước 3: Browse address space
  console.log(`\n${C.bold}[Browse] Liệt kê Address Space (tối đa ${MAX_BROWSE_DEPTH} cấp):${C.reset}`);
  await browseNode(session, 'RootFolder', MAX_BROWSE_DEPTH);

  // Bước 4: Thử đọc các tag điện phổ biến
  console.log(`\n${C.bold}[Read] Thử đọc tag điện phổ biến:${C.reset}`);
  const readable = [];
  for (const nodeId of COMMON_TAGS) {
    const res = await readNode(session, nodeId);
    if (res.ok) {
      readable.push({ nodeId, value: res.value });
      console.log(ok(`${nodeId.padEnd(40)} = ${C.bold}${res.value}${C.reset} (${res.type})`));
    } else {
      console.log(dim(`  ${nodeId.padEnd(40)} - ${res.reason}`));
    }
  }

  if (readable.length === 0) {
    console.log(warn('Không đọc được tag nào theo tên mặc định.'));
    console.log(info('Cần dùng đúng NodeId từ kết quả Browse ở trên.'));
    console.log(info('Ví dụ: thay COMMON_TAGS bằng NodeId thực tế, dạng ns=X;s=TênTag'));
  }

  // Bước 5: Subscribe realtime (nếu có tag đọc được)
  if (readable.length > 0) {
    console.log(`\n${C.bold}[Subscribe] Realtime ${REALTIME_INTERVAL_MS}ms — Ctrl+C để dừng${C.reset}`);
    const subscription = await session.createSubscription2({
      requestedPublishingInterval: REALTIME_INTERVAL_MS,
      requestedMaxKeepAliveCount: 10,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 10,
    });

    for (const { nodeId } of readable) {
      const monItem = await subscription.monitor(
        { nodeId, attributeId: AttributeIds.Value },
        { samplingInterval: REALTIME_INTERVAL_MS, discardOldest: true, queueSize: 1 },
        TimestampsToReturn.Both,
      );
      monItem.on('changed', dv => {
        const ts = new Date(dv.sourceTimestamp || dv.serverTimestamp).toLocaleTimeString('vi-VN');
        console.log(`[${ts}] ${nodeId.padEnd(35)} = ${C.bold}${dv.value.value}${C.reset}`);
      });
    }

    // Giữ chương trình chạy
    await new Promise(resolve => {
      process.on('SIGINT', () => { console.log('\n' + warn('Dừng subscribe...')); resolve(); });
    });

    await subscription.terminate();
  }

  // Cleanup
  await session.close();
  await client.disconnect();
  console.log(ok('Đã đóng kết nối.\n'));
}

main().catch(e => {
  console.error(C.red + 'Lỗi:' + C.reset, e.message);
  process.exit(1);
});
