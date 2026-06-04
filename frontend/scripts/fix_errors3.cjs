const fs = require('fs');

function fixFile(file, replacer) {
  if (!fs.existsSync(file)) return;
  let content = fs.readFileSync(file, 'utf8');
  let newContent = replacer(content);
  if (content !== newContent) {
    fs.writeFileSync(file, newContent, 'utf8');
    console.log('Fixed:', file);
  }
}

// 1. DashboardPage
fixFile('src/pages/dashboard/DashboardPage.tsx', (content) => {
  // If metadata doesn't exist on AlertItem, either cast it or use type assertion
  content = content.replace(/alert\.metadata/g, '(alert as any).metadata');
  return content;
});

// 2. PdTab
fixFile('src/pages/analytics/tabs/PdTab.tsx', (content) => {
  content = content.replace(/T_LABELS\[i\]/g, '(T_LABELS[i] || "")');
  content = content.replace(/T_COLORS\[i\]/g, '(T_COLORS[i] || "")');
  content = content.replace(/CAM_LABELS\[i\]/g, '(CAM_LABELS[i] || "")');
  content = content.replace(/CAM_COLORS\[i\]/g, '(CAM_COLORS[i] || "")');
  content = content.replace(/if \(almV !== undefined && val >= almV\)/, 'if (almV !== undefined && val !== null && val >= almV)');
  content = content.replace(/if \(warnV !== undefined && val >= warnV\)/, 'if (warnV !== undefined && val !== null && val >= warnV)');
  return content;
});

// 3. TempTab
fixFile('src/pages/analytics/tabs/TempTab.tsx', (content) => {
  content = content.replace(/T_LABELS\[i\]/g, '(T_LABELS[i] || "")');
  content = content.replace(/T_COLORS\[i\]/g, '(T_COLORS[i] || "")');
  content = content.replace(/CAM_LABELS\[i\]/g, '(CAM_LABELS[i] || "")');
  content = content.replace(/CAM_COLORS\[i\]/g, '(CAM_COLORS[i] || "")');
  content = content.replace(/if \(almV !== undefined && val >= almV\)/, 'if (almV !== undefined && val !== null && val >= almV)');
  content = content.replace(/if \(warnV !== undefined && val >= warnV\)/, 'if (warnV !== undefined && val !== null && val >= warnV)');
  return content;
});

// 4. RealtimeMonitorPage
fixFile('src/pages/realtime-monitor/RealtimeMonitorPage.tsx', (content) => {
  content = content.replace(/import React, \{ useState, useEffect, useRef \} from 'react';/, "import { useState, useEffect } from 'react';");
  // Also if it was already changed:
  content = content.replace(/import \{ useState, useEffect, useRef \} from 'react';/, "import { useState, useEffect } from 'react';");
  return content;
});

// 5. ReportTab
fixFile('src/pages/reports/tabs/ReportTab.tsx', (content) => {
  content = content.replace(/d\.toISOString\(\)\.split\('T'\)\[0\] \?\? ''/g, "(d.toISOString().split('T')[0] || '')");
  content = content.replace(/new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\] \?\? ''/g, "(new Date().toISOString().split('T')[0] || '')");
  return content;
});

// Remove unused React in ALL tabs just to be safe
const dirs = ['src/pages/analytics/tabs', 'src/pages/dashboard', 'src/pages/maintenance'];
for (const dir of dirs) {
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.tsx')) {
        fixFile(`${dir}/${f}`, c => c.replace(/import React from 'react';\r?\n?/, ''));
        fixFile(`${dir}/${f}`, c => c.replace(/import React, \{/g, 'import {'));
      }
    }
  }
}

console.log('Done script 3!');
