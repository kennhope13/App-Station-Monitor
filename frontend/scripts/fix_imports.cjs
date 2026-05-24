const fs = require('fs');

function fixFile(file, replacements) {
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
  [/import React, \{ useState, useEffect, useRef \} from 'react';/, "import { useState, useEffect } from 'react';"],
  [/Alert, /, 'AlertItem, '],
  [/: Alert\[\]/, ': AlertItem[]']
]);

// 2. Remove React from others
const filesNoReact = [
  'src/pages/device-management/DeviceManagementPage.tsx',
  'src/pages/rule-engine/RuleEnginePage.tsx',
  'src/pages/user-management/UserManagementPage.tsx',
  'src/pages/audit-log/AuditLogPage.tsx',
  'src/pages/license/LicensePage.tsx',
  'src/pages/login/LoginPage.tsx',
  'src/pages/maintenance/MaintenancePage.tsx',
  'src/pages/multisite/MultisitePage.tsx',
  'src/pages/reports/ReportsPage.tsx',
  'src/pages/settings/SettingsPage.tsx',
];

for (const f of filesNoReact) {
  fixFile(f, [
    [/import React, \{ /, 'import { '],
    [/import React from 'react';\r?\n?/, '']
  ]);
}

// 3. RealtimeMonitorPage
fixFile('src/pages/realtime-monitor/RealtimeMonitorPage.tsx', [
  [/import React, \{ useState, useEffect, useRef \} from 'react';/, "import { useState, useEffect } from 'react';"]
]);

// 4. TempTab.tsx nullability
fixFile('src/pages/analytics/tabs/TempTab.tsx', [
  [/T_LABELS\[i\]!/g, 'T_LABELS[i] ?? ""'],
  [/T_COLORS\[i\]!/g, 'T_COLORS[i] ?? ""'],
  [/CAM_LABELS\[i\]!/g, 'CAM_LABELS[i] ?? ""'],
  [/CAM_COLORS\[i\]!/g, 'CAM_COLORS[i] ?? ""'],
  [/if \(hmAlmV !== undefined && val >= hmAlmV\) return '#ef4444';/, "if (hmAlmV !== undefined && val !== null && val >= hmAlmV) return '#ef4444';"]
]);

console.log('Cleanup done!');
