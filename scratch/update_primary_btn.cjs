const fs = require('fs');
let css = fs.readFileSync('src/ui/styles.css', 'utf8');

const target = `.mode-btn-primary {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 58px;
  padding: 10px 16px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(74, 144, 226, 0.22) 0%, rgba(18, 24, 34, 0.96) 100%);
  border: 1.5px solid var(--accent);
  color: var(--text);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  text-align: left;
}
.mode-btn-primary:hover {
  background: linear-gradient(135deg, rgba(74, 144, 226, 0.34) 0%, rgba(24, 32, 46, 0.98) 100%);
  border-color: #60a5fa;
  box-shadow: 0 6px 22px rgba(56, 189, 248, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2);
  transform: translateY(-1px);
}
.mode-btn-primary:active { transform: translateY(1px); }
.mode-btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 8px;
  background: linear-gradient(135deg, #38bdf8 0%, #2563eb 100%);
  color: #0b0f17;
  flex-shrink: 0;
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.45);
}`;

const replacement = `.mode-btn-primary {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 8px 14px;
  border-radius: 8px;
  background: var(--surface);
  border: 1px solid var(--line-2);
  color: var(--text);
  cursor: pointer;
  transition: all 0.15s ease-out;
  text-align: left;
}
.mode-btn-primary:hover {
  border-color: var(--accent);
  background: rgba(74, 144, 226, 0.06);
  color: #ffffff;
}
.mode-btn-primary:active { transform: translateY(1px); }
.mode-btn-icon {
  color: var(--accent);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}`;

// Normalize line endings for replacement
const norm = (s) => s.replace(/\r\n/g, '\n');
if (norm(css).includes(norm(target))) {
  // Find where in raw css
  const idx = norm(css).indexOf(norm(target));
  // Replace in css
  const isCRLF = css.includes('\r\n');
  const targetRaw = isCRLF ? target.replace(/\n/g, '\r\n') : target.replace(/\r\n/g, '\n');
  const repRaw = isCRLF ? replacement.replace(/\n/g, '\r\n') : replacement.replace(/\r\n/g, '\n');
  css = css.replace(targetRaw, repRaw);
  fs.writeFileSync('src/ui/styles.css', css, 'utf8');
  console.log('Successfully updated .mode-btn-primary styles in styles.css');
} else {
  console.error('Target not found in styles.css');
  process.exit(1);
}
