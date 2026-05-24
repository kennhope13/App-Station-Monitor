const fs = require('fs');
const path = require('path');

const replacements = [
  { regex: /#090e1a/gi, replacement: 'var(--admin-bg)' },
  { regex: /#0f172a/gi, replacement: 'var(--admin-panel)' },
  { regex: /#1e293b/gi, replacement: 'var(--admin-border)' },
  { regex: /#e2e8f0/gi, replacement: 'var(--admin-text)' },
  { regex: /#94a3b8/gi, replacement: 'var(--admin-text-muted)' },
  // Optional: replace rgba versions if possible, but let's stick to hex for now
];

function processDirectory(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDirectory(fullPath);
    } else {
      if (fullPath.endsWith('.tsx') || fullPath.endsWith('.css')) {
        let content = fs.readFileSync(fullPath, 'utf8');
        let modified = false;
        
        // Skip theme.css and types.ts which might need specific Chart.js logic
        if (fullPath.includes('theme.css') || fullPath.includes('types.ts')) continue;

        for (const rule of replacements) {
          if (rule.regex.test(content)) {
            // Check if it's already wrapped in var(--admin-bg, #090e1a)
            // To be safe, we just replace the raw string if it's not inside a var fallback.
            // Actually, a simple replace is fine since we are moving away from hardcoded fallbacks.
            // Wait, if it says ar(--admin-bg, #090e1a), replacing #090e1a yields ar(--admin-bg, var(--admin-bg)), which is valid CSS but ugly.
            // Let's refine the regex: replace #090e1a only if it's not preceded by , 
            // Regex: /(?<!,\s*)#090e1a/gi (lookbehinds might not work in all older node, but this is modern node)
          }
        }
        
        let newContent = content;
        // Strip out existing var fallbacks to clean up first: var(--admin-bg, #090e1a) -> var(--admin-bg)
        newContent = newContent.replace(/var\(--admin-bg,\s*#090e1a\)/gi, 'var(--admin-bg)');
        newContent = newContent.replace(/var\(--admin-panel,\s*#0f172a\)/gi, 'var(--admin-panel)');
        
        // Now replace raw hexes
        for (const rule of replacements) {
          newContent = newContent.replace(rule.regex, rule.replacement);
        }

        if (newContent !== content) {
          fs.writeFileSync(fullPath, newContent, 'utf8');
          console.log('Updated: ' + fullPath);
        }
      }
    }
  }
}

processDirectory(path.join(__dirname, 'src'));
console.log('Done refactoring colors.');
