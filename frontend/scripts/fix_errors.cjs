const fs = require('fs');

function fixFile(file, replacements) {
  if (!fs.existsSync(file)) return;
  let content = fs.readFileSync(file, 'utf8');
  let newContent = content;
  for (const [regex, replacement] of replacements) {
    newContent = newContent.replace(regex, replacement);
  }
  if (content !== newContent) {
    fs.writeFileSync(file, newContent, 'utf8');
    console.log('Fixed:', file);
  }
}

// 1. DashboardPage: Alert -> AlertItem
fixFile('src/pages/dashboard/DashboardPage.tsx', [
  [/Alert, /, 'AlertItem, '],
  [/: Alert\[\]/, ': AlertItem[]'],
  [/import React, \{ /, 'import { ']
]);

// 2. TempTab.tsx nullability
fixFile('src/pages/analytics/tabs/TempTab.tsx', [
  [/T_LABELS\[i\]/g, '(T_LABELS[i] || "")'],
  [/T_COLORS\[i\]/g, '(T_COLORS[i] || "")'],
  [/CAM_LABELS\[i\]/g, '(CAM_LABELS[i] || "")'],
  [/CAM_COLORS\[i\]/g, '(CAM_COLORS[i] || "")'],
  [/if \(almV !== undefined && val >= almV\)/, 'if (almV !== undefined && val !== null && val >= almV)'],
  [/if \(warnV !== undefined && val >= warnV\)/, 'if (warnV !== undefined && val !== null && val >= warnV)'],
  [/import React, \{ /, 'import { '],
  [/import React from 'react';\r?\n?/, '']
]);

// 3. ReportTab.tsx nullability & unused vars
fixFile('src/pages/reports/tabs/ReportTab.tsx', [
  [/alerts \}: \{ stationId: string, alerts: AlertItem\[\] \}/, '}: { stationId: string, alerts: AlertItem[] }'],
  [/setFrom\(d.toISOString\(\).split\('T'\)\[0\] \?\? ''\);/g, "setFrom(d.toISOString().split('T')[0] || '');"],
  [/setTo\(new Date\(\).toISOString\(\).split\('T'\)\[0\] \?\? ''\);/g, "setTo(new Date().toISOString().split('T')[0] || '');"]
]);

// 4. RealtimeMonitorPage
fixFile('src/pages/realtime-monitor/RealtimeMonitorPage.tsx', [
  [/import React, \{ useState, useEffect, useRef \} from 'react';/, "import { useState, useEffect } from 'react';"]
]);

console.log('Done!');
