const fs = require('fs');
const path = require('path');

const emojiRegex = /([\u{1F300}-\u{1F5FF}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]\s*)/gu;

const replacements = [
  { regex: emojiRegex, replacement: '' },
  { regex: /#ffffff/gi, replacement: 'var(--admin-text)' },
  { regex: /#fff\b/gi, replacement: 'var(--admin-text)' },
  { regex: /'white'/gi, replacement: "'var(--admin-text)'" },
  { regex: /"white"/gi, replacement: "'var(--admin-text)'" },
];

function processDirectory(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDirectory(fullPath);
    } else {
      if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
        let content = fs.readFileSync(fullPath, 'utf8');
        let newContent = content;
        
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
console.log('Done removing emojis and fixing white text.');
