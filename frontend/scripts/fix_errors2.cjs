const fs = require('fs');
const path = require('path');

const replacements = [
  { regex: /rgba?\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.0[345]\s*\)/gi, replacement: 'var(--admin-hover)' },
  { regex: /rgba?\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.[01][0-9]\s*\)/gi, replacement: 'var(--admin-border-light)' },
  { regex: /rgba?\(\s*15\s*,\s*23\s*,\s*42\s*,\s*0\.95\s*\)/gi, replacement: 'var(--admin-overlay)' },
  { regex: /#64748b/gi, replacement: 'var(--admin-text-muted)' },
  { regex: /#cbd5e1/gi, replacement: 'var(--admin-text-muted)' },
  { regex: /#94a3b8/gi, replacement: 'var(--admin-text-muted)' },
  { regex: /#f1f5f9/gi, replacement: 'var(--admin-text)' },
  { regex: /#e2e8f0/gi, replacement: 'var(--admin-text)' },
  { regex: /#060c1c/gi, replacement: 'var(--admin-bg)' },
  { regex: /#334155/gi, replacement: 'var(--admin-border)' },
];

function processDirectory(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDirectory(fullPath);
    } else {
      if (fullPath.endsWith('.tsx') || fullPath.endsWith('.css') || fullPath.endsWith('.ts')) {
        let content = fs.readFileSync(fullPath, 'utf8');
        let newContent = content;
        
        if (fullPath.includes('theme.css')) continue;

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
console.log('Done deep refactoring colors.');
